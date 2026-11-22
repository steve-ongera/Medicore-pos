# api/models.py
#
# Medicore POS: multi-business point-of-sale models (multi-tenant SaaS, single `api` app).
# Serves pharmacies, supermarkets, mini-marts, general retail, hardware, electronics, boutiques...
#
# NOTE: the model names (Medicine, MedicineBatch, ...) are kept so the frontend, URLs and
# migrations keep working. "Medicine" is simply the generic *product* model.
#
# Sections:
#   1. Abstract base      - UUID pk, timestamps, soft delete
#   2. Accounts           - Role, User
#   3. Stock              - Supplier, Medicine (product), MedicineBatch, StockTransaction
#   4. Sales (POS)        - OTCSale, OTCSaleItem, OTCSaleAmendment
#   5. Shop settings, legacy Subscription, SubscriptionRequest, Notification, chat
#   6. SaaS               - Shop, Bundle, BundlePurchase, WalletTransaction, MpesaPayment

import uuid
from datetime import timedelta

from django.contrib.auth.models import AbstractUser
from django.core.validators import MinValueValidator
from django.db import models
from django.utils import timezone

from api.tenancy import (
    ShopOwned, TenantAllObjectsManager, TenantSoftDeleteManager, TenantUserManager, shop_fk, stamp_shop,
)
from api.utils import generate_otc_sale_number


# ---------------------------------------------------------------------------
# 1. Abstract base
# ---------------------------------------------------------------------------
class BaseModel(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    shop = shop_fk()  # the tenant that owns this row
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    is_deleted = models.BooleanField(default=False)
    deleted_at = models.DateTimeField(null=True, blank=True)

    # `objects` hides soft-deleted rows; `all_objects` returns everything.
    objects = TenantSoftDeleteManager()
    all_objects = TenantAllObjectsManager()

    class Meta:
        abstract = True
        ordering = ["-created_at"]

    def save(self, *args, **kwargs):
        stamp_shop(self)
        super().save(*args, **kwargs)

    def soft_delete(self):
        self.is_deleted = True
        self.deleted_at = timezone.now()
        self.save(update_fields=["is_deleted", "deleted_at"])



# ---------------------------------------------------------------------------
# 2. Accounts
# ---------------------------------------------------------------------------
class Role(models.TextChoices):
    # Same role names as the HMIS so utils/roles.js and the sidebar keep working.
    SUPER_ADMIN = "SUPER_ADMIN", "Super Admin / Owner"
    PHARMACIST = "PHARMACIST", "Pharmacist / Store Manager"
    CASHIER = "CASHIER", "Cashier"
    ACCOUNTANT = "ACCOUNTANT", "Accountant"


class User(AbstractUser):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.CASHIER)
    phone = models.CharField(max_length=20, blank=True)
    is_active_staff = models.BooleanField(default=True)
    # Null only for platform staff (superusers), who can use /admin/ but not the API.
    shop = models.ForeignKey("api.Shop", null=True, blank=True, on_delete=models.CASCADE, related_name="users")

    objects = TenantUserManager()

    class Meta:
        db_table = "users"

    def __str__(self):
        return f"{self.get_full_name() or self.username} ({self.role})"


class PasswordResetCode(models.Model):
    """One emailed OTP. Only a keyed hash of the code is stored, never the code itself."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey("api.User", on_delete=models.CASCADE, related_name="reset_codes")
    code_hash = models.CharField(max_length=64)
    attempts = models.PositiveSmallIntegerField(default=0)
    is_used = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()

    class Meta:
        db_table = "password_reset_codes"
        ordering = ["-created_at"]

        
class PaymentMethod(models.TextChoices):
    CASH = "CASH", "Cash"
    MPESA = "MPESA", "M-Pesa"
    CARD = "CARD", "Card"


# ---------------------------------------------------------------------------
# 3. Stock
# ---------------------------------------------------------------------------
class Supplier(BaseModel):
    name = models.CharField(max_length=150)
    phone = models.CharField(max_length=20, blank=True)
    email = models.EmailField(blank=True)
    address = models.CharField(max_length=255, blank=True)

    class Meta:
        db_table = "suppliers"

    def __str__(self):
        return self.name


class Medicine(BaseModel):
    """A product in the catalog (medicine, grocery item, any retail item).
    Stock is derived from its batches."""

    name = models.CharField(max_length=150)
    generic_name = models.CharField(max_length=150, blank=True)
    category = models.CharField(max_length=100, blank=True)
    unit = models.CharField(max_length=30, default="tablet")  # tablet, syrup, piece, pack, bottle...
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    insurance_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    reorder_level = models.PositiveIntegerField(default=20)
    barcode = models.CharField(max_length=64, blank=True, db_index=True)
    sku = models.CharField(max_length=60, blank=True)
    image = models.ImageField(upload_to="products/", null=True, blank=True)  # NEW
    is_visible = models.BooleanField(
        default=True, help_text="When False, hidden from the POS grid and pickers (editors can still un-hide it)."
    )

    class Meta:
        db_table = "medicines"
        verbose_name = "product"
        verbose_name_plural = "products"

    @property
    def current_stock(self):
        return sum(b.quantity_remaining for b in self.batches.filter(is_deleted=False))

    @property
    def is_low_stock(self):
        return self.current_stock <= self.reorder_level

    def __str__(self):
        return self.name


class MedicineBatch(BaseModel):
    medicine = models.ForeignKey(Medicine, on_delete=models.CASCADE, related_name="batches")
    supplier = models.ForeignKey(Supplier, null=True, blank=True, on_delete=models.SET_NULL, related_name="batches")
    batch_number = models.CharField(max_length=60)
    quantity_received = models.PositiveIntegerField()
    quantity_remaining = models.PositiveIntegerField()
    # Optional: shops that do not track expiry (hardware, clothes, electronics) leave it empty.
    expiry_date = models.DateField(null=True, blank=True)
    received_date = models.DateField(auto_now_add=True)

    class Meta:
        db_table = "medicine_batches"
        unique_together = ("medicine", "batch_number")

    def __str__(self):
        return f"{self.medicine.name} - {self.batch_number}"


class StockTransactionType(models.TextChoices):
    STOCK_IN = "STOCK_IN", "Stock In"
    STOCK_OUT = "STOCK_OUT", "Stock Out"
    ADJUSTMENT = "ADJUSTMENT", "Adjustment"
    EXPIRED = "EXPIRED", "Expired / Written Off"


class StockTransaction(BaseModel):
    """Ledger entry for every stock movement."""

    medicine = models.ForeignKey(Medicine, on_delete=models.CASCADE, related_name="stock_transactions")
    batch = models.ForeignKey(MedicineBatch, null=True, blank=True, on_delete=models.SET_NULL, related_name="stock_transactions")
    transaction_type = models.CharField(max_length=20, choices=StockTransactionType.choices)
    quantity = models.IntegerField()
    reason = models.CharField(max_length=255, blank=True)
    performed_by = models.ForeignKey(User, null=True, on_delete=models.SET_NULL, related_name="stock_transactions")

    class Meta:
        db_table = "stock_transactions"


# ---------------------------------------------------------------------------
# 4. Sales (POS)
# ---------------------------------------------------------------------------
class OTCSale(BaseModel):
    """A walk-in sale (header). Line items live in OTCSaleItem."""

    sale_number = models.CharField(max_length=30, editable=False)

    customer_name = models.CharField(max_length=150, blank=True)
    customer_phone = models.CharField(max_length=20, blank=True)

    subtotal = models.DecimalField(max_digits=10, decimal_places=2, default=0, editable=False)
    discount = models.DecimalField(max_digits=10, decimal_places=2, default=0, validators=[MinValueValidator(0)])
    total_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0, editable=False)
    amount_paid = models.DecimalField(max_digits=10, decimal_places=2, default=0)

    payment_method = models.CharField(max_length=20, choices=PaymentMethod.choices, default=PaymentMethod.CASH)
    reference_number = models.CharField(max_length=100, blank=True)  # M-Pesa code / card auth

    served_by = models.ForeignKey(User, null=True, on_delete=models.SET_NULL, related_name="otc_sales")
    qr_code = models.ImageField(upload_to="receipts/qr/", null=True, blank=True)
    sold_at = models.DateTimeField(auto_now_add=True)
    amended_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "otc_sales"
        constraints = [models.UniqueConstraint(fields=["shop", "sale_number"], name="uniq_sale_number_per_shop")]

    def save(self, *args, **kwargs):
        if not self.sale_number:
            self.sale_number = generate_otc_sale_number()
        super().save(*args, **kwargs)

    @property
    def balance(self):
        """Positive = still owed, negative = change given."""
        return self.total_amount - self.amount_paid

    def __str__(self):
        return f"{self.sale_number} - KES {self.total_amount}"


class OTCSaleItem(BaseModel):
    sale = models.ForeignKey(OTCSale, on_delete=models.CASCADE, related_name="items")
    medicine = models.ForeignKey(Medicine, on_delete=models.PROTECT, related_name="otc_sale_items")
    batch = models.ForeignKey(MedicineBatch, null=True, on_delete=models.SET_NULL, related_name="otc_sale_items")
    quantity = models.PositiveIntegerField()
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    subtotal = models.DecimalField(max_digits=10, decimal_places=2, editable=False)

    class Meta:
        db_table = "otc_sale_items"

    def save(self, *args, **kwargs):
        # The view passes the cashier's custom line amount; otherwise price x qty.
        if self.subtotal is None:
            self.subtotal = self.unit_price * self.quantity
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.medicine.name} x{self.quantity}"


class OTCSaleAmendment(BaseModel):
    """Audit row for every correction to a processed sale."""

    sale = models.ForeignKey(OTCSale, on_delete=models.CASCADE, related_name="amendments")
    amended_by = models.ForeignKey(User, null=True, on_delete=models.SET_NULL, related_name="otc_amendments")
    reason = models.CharField(max_length=255)
    before = models.JSONField(default=dict, blank=True)
    after = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = "otc_sale_amendments"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.sale.sale_number} corrected by {self.amended_by}"


# ---------------------------------------------------------------------------
# 5. Shop settings & subscription
# ---------------------------------------------------------------------------
class BusinessType(models.TextChoices):
    PHARMACY = "PHARMACY", "Pharmacy"
    SUPERMARKET = "SUPERMARKET", "Supermarket"
    MINIMART = "MINIMART", "Mini-mart / Grocery"
    RETAIL = "RETAIL", "General retail shop"
    HARDWARE = "HARDWARE", "Hardware"
    ELECTRONICS = "ELECTRONICS", "Electronics"
    BOUTIQUE = "BOUTIQUE", "Boutique / Clothing"
    OTHER = "OTHER", "Other"


# Business types where goods expire, so expiry dates are tracked by default.
# (Plain string values, so `"PHARMACY" in EXPIRY_TRACKED_TYPES` works for raw strings too.)
EXPIRY_TRACKED_TYPES = {
    BusinessType.PHARMACY.value,
    BusinessType.SUPERMARKET.value,
    BusinessType.MINIMART.value,
}


class ShopSettings(ShopOwned):
    """One row per shop: details and alert thresholds."""

    name = models.CharField(max_length=150, default="My Shop")
    business_type = models.CharField(max_length=20, choices=BusinessType.choices, default=BusinessType.PHARMACY)
    tracks_expiry = models.BooleanField(default=True, help_text="Ask for and alert on batch expiry dates.")
    address = models.CharField(max_length=255, blank=True)
    phone = models.CharField(max_length=30, blank=True)
    email = models.EmailField(blank=True)
    kra_pin = models.CharField(max_length=30, blank=True)
    currency = models.CharField(max_length=5, default="KES")
    receipt_footer = models.CharField(max_length=255, blank=True, default="Thank you for shopping with us.")
    expiry_alert_days = models.PositiveIntegerField(default=90)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "shop_settings"
        constraints = [models.UniqueConstraint(fields=["shop"], name="uniq_settings_per_shop")]

    @classmethod
    def load(cls):
        from api.tenancy import get_current_shop

        shop = get_current_shop()
        obj, _ = cls.objects.get_or_create(shop=shop, defaults={"name": shop.name})
        return obj

    def __str__(self):
        return self.name


class SubscriptionPlan(models.TextChoices):
    TRIAL = "TRIAL", "Free trial"
    BASIC = "BASIC", "Basic"
    PRO = "PRO", "Pro"


class Subscription(models.Model):
    """Single-row table (pk=1). A 14-day trial is created the first time it is read."""

    plan = models.CharField(max_length=10, choices=SubscriptionPlan.choices, default=SubscriptionPlan.TRIAL)
    started_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField()

    class Meta:
        db_table = "subscription"

    @classmethod
    def load(cls):
        obj = cls.objects.filter(pk=1).first()
        if obj is None:
            now = timezone.now()
            obj = cls.objects.create(pk=1, plan=SubscriptionPlan.TRIAL,
                                     started_at=now, expires_at=now + timedelta(days=14))
        return obj

    @property
    def is_active(self):
        return self.expires_at > timezone.now()

    @property
    def days_left(self):
        return max((self.expires_at - timezone.now()).days, 0)

    def extend(self, plan, months):
        """Renew from today, or from the current expiry if still running (no lost days)."""
        base = max(self.expires_at, timezone.now())
        self.plan = plan
        self.expires_at = base + timedelta(days=30 * months)
        self.save()


class SubscriptionRequest(BaseModel):
    """A shop's request to subscribe/renew, with the M-Pesa reference of the payment.
    Staff approve it in the Django admin, which extends the Subscription."""

    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        APPROVED = "APPROVED", "Approved"
        REJECTED = "REJECTED", "Rejected"

    plan = models.CharField(max_length=20)  # a Bundle.code
    months = models.PositiveIntegerField(default=1)
    amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    phone = models.CharField(max_length=20, blank=True)
    mpesa_reference = models.CharField(max_length=40)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    note = models.CharField(max_length=255, blank=True)
    requested_by = models.ForeignKey(User, null=True, on_delete=models.SET_NULL, related_name="subscription_requests")

    class Meta:
        db_table = "subscription_requests"
        ordering = ["-created_at"]


class NotificationPriority(models.TextChoices):
    CRITICAL = "CRITICAL", "Critical"
    HIGH = "HIGH", "High"
    NORMAL = "NORMAL", "Normal"
    LOW = "LOW", "Low"


class Notification(BaseModel):
    """One alert for one user (bell dropdown)."""

    recipient = models.ForeignKey(User, on_delete=models.CASCADE, related_name="notifications")
    title = models.CharField(max_length=200)
    message = models.TextField(blank=True)
    link = models.CharField(max_length=255, blank=True)  # front-end route, e.g. /inventory
    priority = models.CharField(max_length=10, choices=NotificationPriority.choices,
                                default=NotificationPriority.NORMAL)
    is_read = models.BooleanField(default=False, db_index=True)
    read_at = models.DateTimeField(null=True, blank=True)
    # Lets scheduled jobs avoid sending the same alert twice (e.g. "low-stock:2026-11-04").
    dedupe_key = models.CharField(max_length=100, blank=True, db_index=True)

    class Meta:
        db_table = "notifications"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.recipient_id}: {self.title}"


class Conversation(BaseModel):
    """A direct (2 people) or group chat between staff."""

    title = models.CharField(max_length=150, blank=True)  # used for groups only
    is_group = models.BooleanField(default=False)
    participants = models.ManyToManyField(User, through="ConversationParticipant", related_name="conversations")

    class Meta:
        db_table = "conversations"
        ordering = ["-updated_at"]


class ConversationParticipant(models.Model):
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name="participant_links")
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="conversation_links")
    last_read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "conversation_participants"
        unique_together = ("conversation", "user")


class Message(BaseModel):
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name="messages")
    sender = models.ForeignKey(User, null=True, on_delete=models.SET_NULL, related_name="sent_messages")
    body = models.TextField()

    class Meta:
        db_table = "messages"
        ordering = ["created_at"]
        indexes = [models.Index(fields=["conversation", "created_at"])]


# ---------------------------------------------------------------------------
# 6. SaaS: tenants, bundles, wallet, M-Pesa
#    Safaricom analogy:
#      Shop = subscriber (SIM)            wallet_balance = airtime
#      Bundle = data/minutes bundle       BundlePurchase = a bundle you bought (credits spent
#      WalletTransaction = append-only ledger            earliest-expiring first)
#      MpesaPayment = one STK push (idempotency anchor for the callback)
# ---------------------------------------------------------------------------
class ShopStatus(models.TextChoices):
    ACTIVE = "ACTIVE", "Active"
    SUSPENDED = "SUSPENDED", "Suspended"
    CLOSED = "CLOSED", "Closed"


class Shop(models.Model):
    """The tenant. Platform-level (not itself tenant scoped)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=150)
    slug = models.SlugField(max_length=60, unique=True)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=20, blank=True)
    status = models.CharField(max_length=10, choices=ShopStatus.choices, default=ShopStatus.ACTIVE)
    wallet_balance = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "shops"

    def __str__(self):
        return self.name


class Bundle(models.Model):
    """The catalogue (platform-level). Blank allowance/limit = unlimited."""

    code = models.CharField(max_length=20, unique=True)
    name = models.CharField(max_length=60)
    description = models.CharField(max_length=255, blank=True)
    price = models.DecimalField(max_digits=10, decimal_places=2)
    validity_days = models.PositiveIntegerField(default=30)
    sales_allowance = models.PositiveIntegerField(null=True, blank=True, help_text="Sales credits; blank = unlimited")
    max_users = models.PositiveIntegerField(null=True, blank=True, help_text="Staff accounts; blank = unlimited")
    max_products = models.PositiveIntegerField(null=True, blank=True, help_text="Medicines; blank = unlimited")
    features = models.JSONField(default=list, blank=True, help_text='e.g. ["full_reports"]')
    is_trial = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    sort_order = models.PositiveIntegerField(default=100)

    class Meta:
        db_table = "bundles"
        ordering = ["sort_order", "price"]

    def __str__(self):
        return f"{self.name} (KES {self.price})"


class PurchaseSource(models.TextChoices):
    WALLET = "WALLET", "Wallet"
    MPESA_MANUAL = "MPESA_MANUAL", "M-Pesa (manual approval)"
    ADMIN = "ADMIN", "Granted by admin"
    TRIAL = "TRIAL", "Free trial"


class PurchaseStatus(models.TextChoices):
    ACTIVE = "ACTIVE", "Active"
    EXPIRED = "EXPIRED", "Expired"
    CANCELLED = "CANCELLED", "Cancelled"


class BundlePurchase(ShopOwned):
    bundle = models.ForeignKey(Bundle, on_delete=models.PROTECT, related_name="purchases")
    status = models.CharField(max_length=10, choices=PurchaseStatus.choices, default=PurchaseStatus.ACTIVE)
    source = models.CharField(max_length=15, choices=PurchaseSource.choices)
    starts_at = models.DateTimeField()
    expires_at = models.DateTimeField()
    # Snapshot at purchase time, so later catalogue edits never change what was bought.
    sales_allowance_total = models.PositiveIntegerField(null=True, blank=True)  # None = unlimited
    sales_used = models.PositiveIntegerField(default=0)
    price_paid = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    auto_renew = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "bundle_purchases"
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["shop", "status", "expires_at"])]

    @property
    def sales_remaining(self):
        if self.sales_allowance_total is None:
            return None
        return max(self.sales_allowance_total - self.sales_used, 0)

    def __str__(self):
        return f"{self.shop_id} {self.bundle.code} -> {self.expires_at:%Y-%m-%d}"


class WalletTransaction(ShopOwned):
    """Append-only ledger. Never edit or delete rows."""

    kind = models.CharField(max_length=20)  # TOPUP, BUNDLE, REFUND, ADJUSTMENT
    amount = models.DecimalField(max_digits=12, decimal_places=2)  # signed
    balance_after = models.DecimalField(max_digits=12, decimal_places=2)
    reference = models.CharField(max_length=60, unique=True, null=True, blank=True)  # e.g. MPESA:QWE123 (idempotency)
    note = models.CharField(max_length=255, blank=True)
    created_by = models.ForeignKey("api.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "wallet_transactions"
        ordering = ["-created_at"]


class PaymentStatus(models.TextChoices):
    PENDING = "PENDING", "Pending"
    SUCCESS = "SUCCESS", "Success"
    FAILED = "FAILED", "Failed"
    MISMATCH = "MISMATCH", "Amount mismatch - review"


class MpesaPayment(ShopOwned):
    checkout_request_id = models.CharField(max_length=100, unique=True)
    merchant_request_id = models.CharField(max_length=100, blank=True)
    phone = models.CharField(max_length=15)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    status = models.CharField(max_length=10, choices=PaymentStatus.choices, default=PaymentStatus.PENDING)
    mpesa_receipt = models.CharField(max_length=30, blank=True)
    result_desc = models.CharField(max_length=255, blank=True)

    bundle_code = models.CharField(max_length=20, blank=True, default="")
    quantity = models.PositiveIntegerField(default=1)
    auto_renew = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "mpesa_payments"
        ordering = ["-created_at"]