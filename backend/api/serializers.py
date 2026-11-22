# api/serializers.py
#
# Python names are now Product-based, but the JSON the frontend reads/sends is unchanged:
#   - output keeps `medicine` / `medicine_name` (and also adds `product` / `product_name`)
#   - input accepts `medicine` (what the frontend sends) or `product`
import re
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from api.models import (
    BusinessType,
    EXPIRY_TRACKED_TYPES,  # noqa: F401  (re-exported for other modules)
    OTCSale,
    OTCSaleAmendment,
    OTCSaleItem,
    PaymentMethod,
    Product,
    ProductBatch,
    Role,  # noqa: F401
    ShopSettings,
    StockTransaction,
    SubscriptionRequest,
    Supplier,
)
from api.tenancy import get_current_shop

User = get_user_model()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
class ProductField(serializers.PrimaryKeyRelatedField):
    """Evaluated per request, so it only offers THIS shop's products."""

    def get_queryset(self):
        return Product.objects.all()


# Old name, in case another module imports it.
MedicineField = ProductField


class LegacyProductKeyMixin:
    """Lets a payload use `product` instead of the legacy `medicine` key."""

    def to_internal_value(self, data):
        if "product" in data and "medicine" not in data:
            data = data.copy()
            data["medicine"] = data["product"]
        return super().to_internal_value(data)


# ---------------------------------------------------------------------------
# Accounts
# ---------------------------------------------------------------------------
class UserSerializer(serializers.ModelSerializer):
    full_name = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "email", "first_name", "last_name", "full_name",
                  "role", "phone", "is_active", "date_joined"]
        read_only_fields = ["id", "date_joined"]

    def get_full_name(self, obj):
        return obj.get_full_name() or obj.username


class UserCreateSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=6)

    class Meta:
        model = User
        fields = ["id", "username", "email", "first_name", "last_name", "role", "phone", "password"]
        read_only_fields = ["id"]

    def create(self, validated_data):
        password = validated_data.pop("password")
        user = User(shop=get_current_shop(), **validated_data)
        user.set_password(password)
        user.save()
        return user


class ChangePasswordSerializer(serializers.Serializer):
    old_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True)

    def validate_new_password(self, value):
        validate_password(value)
        return value


# ---------------------------------------------------------------------------
# Stock (products)
# ---------------------------------------------------------------------------
class SupplierSerializer(serializers.ModelSerializer):
    class Meta:
        model = Supplier
        fields = ["id", "name", "phone", "email", "address", "created_at"]
        read_only_fields = ["id", "created_at"]


MAX_IMAGE_BYTES = 5 * 1024 * 1024


def _check_image(value):
    if value and value.size > MAX_IMAGE_BYTES:
        raise serializers.ValidationError("Image must be 5 MB or smaller.")
    return value


class ProductSerializer(serializers.ModelSerializer):
    current_stock = serializers.IntegerField(read_only=True)
    is_low_stock = serializers.BooleanField(read_only=True)

    class Meta:
        model = Product
        fields = ["id", "name", "generic_name", "category", "unit", "unit_price",
                  "insurance_price", "reorder_level", "is_visible", "barcode", "sku",
                  "image", "current_stock", "is_low_stock", "created_at"]
        read_only_fields = ["id", "created_at"]

    def validate_image(self, value):
        return _check_image(value)

    def validate_barcode(self, value):
        value = value.strip()
        if value:
            dupes = Product.objects.filter(barcode=value)  # tenant-scoped
            if self.instance:
                dupes = dupes.exclude(pk=self.instance.pk)
            if dupes.exists():
                raise serializers.ValidationError("Another product already uses this barcode.")
        return value


class ProductAutocompleteSerializer(serializers.ModelSerializer):
    """Light payload for the POS grid / search. `stock_qty` is annotated by the view.
    Pass context={"request": request} so `image` comes back as an absolute URL."""

    current_stock = serializers.SerializerMethodField()
    is_low_stock = serializers.SerializerMethodField()

    class Meta:
        model = Product
        fields = ["id", "name", "generic_name", "category", "unit", "unit_price",
                  "insurance_price", "reorder_level", "is_visible", "barcode", "sku",
                  "image", "current_stock", "is_low_stock"]

    def get_current_stock(self, obj):
        return getattr(obj, "stock_qty", None) or 0

    def get_is_low_stock(self, obj):
        return self.get_current_stock(obj) <= obj.reorder_level


class ProductBatchSerializer(LegacyProductKeyMixin, serializers.ModelSerializer):
    # Writable under the legacy key `medicine`; stored on the model as `product`.
    medicine = ProductField(source="product")
    medicine_name = serializers.CharField(source="product.name", read_only=True)
    product = serializers.UUIDField(source="product_id", read_only=True)
    product_name = serializers.CharField(source="product.name", read_only=True)
    supplier_name = serializers.CharField(source="supplier.name", read_only=True, default=None)

    class Meta:
        model = ProductBatch
        fields = ["id", "medicine", "medicine_name", "product", "product_name",
                  "supplier", "supplier_name",
                  "batch_number", "quantity_received", "quantity_remaining",
                  "expiry_date", "received_date"]
        read_only_fields = ["id", "received_date", "quantity_remaining"]

    def validate(self, attrs):
        # Expiry is only mandatory for shops that track it (pharmacy, supermarket...).
        if "expiry_date" in attrs or self.instance is None:
            if attrs.get("expiry_date") is None and ShopSettings.load().tracks_expiry:
                raise serializers.ValidationError({"expiry_date": "Expiry date is required."})
        return attrs


class StockTransactionSerializer(serializers.ModelSerializer):
    medicine = serializers.UUIDField(source="product_id", read_only=True)
    medicine_name = serializers.CharField(source="product.name", read_only=True)
    product = serializers.UUIDField(source="product_id", read_only=True)
    product_name = serializers.CharField(source="product.name", read_only=True)
    batch_number = serializers.CharField(source="batch.batch_number", read_only=True, default=None)
    performed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = StockTransaction
        fields = ["id", "medicine", "medicine_name", "product", "product_name",
                  "batch", "batch_number",
                  "transaction_type", "quantity", "reason",
                  "performed_by", "performed_by_name", "created_at"]
        read_only_fields = fields

    def get_performed_by_name(self, obj):
        u = obj.performed_by
        return (u.get_full_name() or u.username) if u else None


class QuickAddProductSerializer(serializers.Serializer):
    """Create product + first batch + STOCK_IN in one go (from the POS screen)."""

    name = serializers.CharField(max_length=150)
    generic_name = serializers.CharField(max_length=150, required=False, allow_blank=True, default="")
    category = serializers.CharField(max_length=100, required=False, allow_blank=True, default="")
    unit = serializers.CharField(max_length=30, required=False, default="piece")
    unit_price = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal("0"))
    insurance_price = serializers.DecimalField(
        max_digits=10, decimal_places=2, min_value=Decimal("0"),
        required=False, allow_null=True, default=None,
    )
    reorder_level = serializers.IntegerField(min_value=0, required=False, default=20)
    quantity = serializers.IntegerField(min_value=1)
    batch_number = serializers.CharField(max_length=60, required=False, allow_blank=True, default="")
    expiry_date = serializers.DateField(required=False, allow_null=True, default=None)
    barcode = serializers.CharField(max_length=64, required=False, allow_blank=True, default="")
    sku = serializers.CharField(max_length=60, required=False, allow_blank=True, default="")
    image = serializers.ImageField(required=False, allow_null=True, default=None)

    def validate_image(self, value):
        return _check_image(value)


class SetProductStockSerializer(serializers.Serializer):
    """Stock-take: set the on-hand quantity to an exact number."""

    quantity = serializers.IntegerField(min_value=0)
    reason = serializers.CharField(max_length=255, required=False, allow_blank=True, default="Stock take")


# ---------------------------------------------------------------------------
# Sales
# ---------------------------------------------------------------------------
class OTCSaleItemSerializer(serializers.ModelSerializer):
    medicine = serializers.UUIDField(source="product_id", read_only=True)
    medicine_name = serializers.CharField(source="product.name", read_only=True)
    product = serializers.UUIDField(source="product_id", read_only=True)
    product_name = serializers.CharField(source="product.name", read_only=True)
    unit = serializers.CharField(source="product.unit", read_only=True)
    batch_number = serializers.CharField(source="batch.batch_number", read_only=True, default=None)

    class Meta:
        model = OTCSaleItem
        fields = ["id", "medicine", "medicine_name", "product", "product_name", "unit",
                  "batch", "batch_number", "quantity", "unit_price", "subtotal"]


class OTCSaleSerializer(serializers.ModelSerializer):
    items = OTCSaleItemSerializer(many=True, read_only=True)
    balance = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    served_by_name = serializers.SerializerMethodField()
    qr_code_url = serializers.SerializerMethodField()

    class Meta:
        model = OTCSale
        fields = ["id", "sale_number", "customer_name", "customer_phone",
                  "subtotal", "discount", "total_amount", "amount_paid", "balance",
                  "payment_method", "reference_number",
                  "served_by", "served_by_name", "items",
                  "qr_code_url", "sold_at", "amended_at"]
        read_only_fields = fields

    def get_served_by_name(self, obj):
        u = obj.served_by
        return (u.get_full_name() or u.username) if u else None

    def get_qr_code_url(self, obj):
        if not obj.qr_code:
            return None
        request = self.context.get("request")
        return request.build_absolute_uri(obj.qr_code.url) if request else obj.qr_code.url


class OTCSaleItemInputSerializer(LegacyProductKeyMixin, serializers.Serializer):
    # Frontend sends `medicine`; validated_data exposes it as `product`.
    medicine = ProductField(source="product")
    quantity = serializers.IntegerField(min_value=1)
    # Cashier-overridden total for this line (e.g. a negotiated price). Optional.
    line_amount = serializers.DecimalField(
        max_digits=10, decimal_places=2, min_value=Decimal("0"), required=False, allow_null=True
    )


class OTCSaleCreateSerializer(serializers.Serializer):
    customer_name = serializers.CharField(max_length=150, required=False, allow_blank=True, default="")
    customer_phone = serializers.CharField(max_length=20, required=False, allow_blank=True, default="")
    discount = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal("0"), required=False, default=Decimal("0"))
    payment_method = serializers.ChoiceField(choices=PaymentMethod.choices, default=PaymentMethod.CASH)
    reference_number = serializers.CharField(max_length=100, required=False, allow_blank=True, default="")
    amount_paid = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal("0"), required=False, allow_null=True)
    items = OTCSaleItemInputSerializer(many=True, allow_empty=False)


class OTCSaleAmendSerializer(OTCSaleCreateSerializer):
    reason = serializers.CharField(max_length=255)


class OTCSaleAmendmentSerializer(serializers.ModelSerializer):
    amended_by_name = serializers.SerializerMethodField()

    class Meta:
        model = OTCSaleAmendment
        fields = ["id", "sale", "amended_by", "amended_by_name", "reason", "before", "after", "created_at"]
        read_only_fields = fields

    def get_amended_by_name(self, obj):
        u = obj.amended_by
        return (u.get_full_name() or u.username) if u else None


# ---------------------------------------------------------------------------
# Settings & subscription
# ---------------------------------------------------------------------------
class ShopSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = ShopSettings
        fields = ["name", "address", "phone", "email", "kra_pin", "currency",
                  "receipt_footer", "expiry_alert_days", "business_type", "tracks_expiry"]


class SubscriptionRequestSerializer(serializers.ModelSerializer):
    requested_by_name = serializers.SerializerMethodField()

    class Meta:
        model = SubscriptionRequest
        fields = ["id", "plan", "months", "amount", "phone", "mpesa_reference",
                  "status", "note", "requested_by_name", "created_at"]
        read_only_fields = ["id", "amount", "status", "note", "requested_by_name", "created_at"]

    def get_requested_by_name(self, obj):
        u = obj.requested_by
        return (u.get_full_name() or u.username) if u else None

    def validate_plan(self, value):
        if value == "TRIAL":
            raise serializers.ValidationError("Pick a paid plan.")
        return value

    def validate_months(self, value):
        if not 1 <= value <= 24:
            raise serializers.ValidationError("Choose between 1 and 24 months.")
        return value


class AddPaymentSerializer(serializers.Serializer):
    amount = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal("0.01"))
    reference_number = serializers.CharField(max_length=100, required=False, allow_blank=True, default="")


# ---------------------------------------------------------------------------
# SaaS: self-service sign-up
# ---------------------------------------------------------------------------
class RegisterSerializer(serializers.Serializer):
    shop_name = serializers.CharField(max_length=150)
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(write_only=True)
    first_name = serializers.CharField(max_length=150, required=False, allow_blank=True, default="")
    last_name = serializers.CharField(max_length=150, required=False, allow_blank=True, default="")
    # Required now: people sign in with their email.
    email = serializers.EmailField()
    phone = serializers.CharField(max_length=20, required=False, allow_blank=True, default="")
    # Optional: the current sign-up form does not send these, so new shops default to a pharmacy.
    business_type = serializers.ChoiceField(choices=BusinessType.choices, required=False, default=BusinessType.PHARMACY)
    tracks_expiry = serializers.BooleanField(required=False, default=None, allow_null=True)

    def validate_email(self, value):
        return value.strip().lower()

    def validate_username(self, value):
        value = value.strip().lower()
        if (not re.match(r"^[a-z0-9._]{3,30}$", value) or value.startswith(".")
                or value.endswith(".") or ".." in value):
            raise serializers.ValidationError("Use 3-30 letters, numbers, dots or underscores.")
        return value

    def validate_password(self, value):
        validate_password(value)
        return value


class ResetPasswordSerializer(serializers.Serializer):
    identifier = serializers.CharField()
    code = serializers.CharField(max_length=6, min_length=6)
    new_password = serializers.CharField(write_only=True)

    def validate_new_password(self, value):
        validate_password(value)
        return value


# ---------------------------------------------------------------------------
# Backwards-compatible names (aliases) for any module still importing the old ones.
# ---------------------------------------------------------------------------
MedicineSerializer = ProductSerializer
MedicineAutocompleteSerializer = ProductAutocompleteSerializer
MedicineBatchSerializer = ProductBatchSerializer
QuickAddMedicineSerializer = QuickAddProductSerializer
SetMedicineStockSerializer = SetProductStockSerializer