# api/saas_models.py
"""
SaaS models. Safaricom analogy:
  Shop            = a subscriber (SIM)
  wallet_balance  = airtime
  Bundle          = a data/minutes bundle: price + validity + allowances (sales credits, seats, features)
  BundlePurchase  = a bundle you bought: expires, and its sales credits are consumed
                    earliest-expiring first
  WalletTransaction = immutable ledger of every top-up and purchase
  MpesaPayment    = one STK push (idempotency anchor for the callback)
"""
import uuid

from django.db import models

from api.tenancy import ShopOwned

__all__ = [
    "ShopStatus", "Shop", "Bundle", "PurchaseSource", "PurchaseStatus", "BundlePurchase",
    "WalletTransaction", "PaymentStatus", "MpesaPayment",
]


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
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "mpesa_payments"
        ordering = ["-created_at"]