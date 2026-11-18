# api/serializers.py
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from api.tenancy import get_current_shop

from api.models import (
    Medicine,
    MedicineBatch,
    OTCSale,
    OTCSaleAmendment,
    OTCSaleItem,
    PaymentMethod,
    Role,
    StockTransaction,
    Supplier,
)

User = get_user_model()


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


class MedicineField(serializers.PrimaryKeyRelatedField):
    """Evaluated per request, so it only offers THIS shop's medicines."""

    def get_queryset(self):
        return Medicine.objects.all()


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
# Pharmacy stock
# ---------------------------------------------------------------------------
class SupplierSerializer(serializers.ModelSerializer):
    class Meta:
        model = Supplier
        fields = ["id", "name", "phone", "email", "address", "created_at"]
        read_only_fields = ["id", "created_at"]


class MedicineSerializer(serializers.ModelSerializer):
    current_stock = serializers.IntegerField(read_only=True)
    is_low_stock = serializers.BooleanField(read_only=True)

    class Meta:
        model = Medicine
        fields = ["id", "name", "generic_name", "category", "unit", "unit_price",
                  "insurance_price", "reorder_level", "is_visible",
                  "current_stock", "is_low_stock", "created_at"]
        read_only_fields = ["id", "created_at"]


class MedicineAutocompleteSerializer(serializers.ModelSerializer):
    """Light payload for the POS grid / search. `stock_qty` is annotated by the view."""

    current_stock = serializers.SerializerMethodField()
    is_low_stock = serializers.SerializerMethodField()

    class Meta:
        model = Medicine
        fields = ["id", "name", "generic_name", "category", "unit", "unit_price",
                  "insurance_price", "reorder_level", "is_visible",
                  "current_stock", "is_low_stock"]

    def get_current_stock(self, obj):
        return getattr(obj, "stock_qty", None) or 0

    def get_is_low_stock(self, obj):
        return self.get_current_stock(obj) <= obj.reorder_level


class MedicineBatchSerializer(serializers.ModelSerializer):
    medicine_name = serializers.CharField(source="medicine.name", read_only=True)
    supplier_name = serializers.CharField(source="supplier.name", read_only=True, default=None)

    class Meta:
        model = MedicineBatch
        fields = ["id", "medicine", "medicine_name", "supplier", "supplier_name",
                  "batch_number", "quantity_received", "quantity_remaining",
                  "expiry_date", "received_date"]
        read_only_fields = ["id", "received_date", "quantity_remaining"]


class StockTransactionSerializer(serializers.ModelSerializer):
    medicine_name = serializers.CharField(source="medicine.name", read_only=True)
    batch_number = serializers.CharField(source="batch.batch_number", read_only=True, default=None)
    performed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = StockTransaction
        fields = ["id", "medicine", "medicine_name", "batch", "batch_number",
                  "transaction_type", "quantity", "reason",
                  "performed_by", "performed_by_name", "created_at"]
        read_only_fields = fields

    def get_performed_by_name(self, obj):
        u = obj.performed_by
        return (u.get_full_name() or u.username) if u else None


class QuickAddMedicineSerializer(serializers.Serializer):
    """Create medicine + first batch + STOCK_IN in one go (from the POS screen)."""

    name = serializers.CharField(max_length=150)
    generic_name = serializers.CharField(max_length=150, required=False, allow_blank=True, default="")
    category = serializers.CharField(max_length=100, required=False, allow_blank=True, default="")
    unit = serializers.CharField(max_length=30, required=False, default="tablet")
    unit_price = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal("0"))
    reorder_level = serializers.IntegerField(min_value=0, required=False, default=20)
    quantity = serializers.IntegerField(min_value=1)
    batch_number = serializers.CharField(max_length=60, required=False, allow_blank=True, default="")
    expiry_date = serializers.DateField()


class SetMedicineStockSerializer(serializers.Serializer):
    """Stock-take: set the on-hand quantity to an exact number."""

    quantity = serializers.IntegerField(min_value=0)
    reason = serializers.CharField(max_length=255, required=False, allow_blank=True, default="Stock take")


# ---------------------------------------------------------------------------
# Sales
# ---------------------------------------------------------------------------
class OTCSaleItemSerializer(serializers.ModelSerializer):
    medicine_name = serializers.CharField(source="medicine.name", read_only=True)
    unit = serializers.CharField(source="medicine.unit", read_only=True)
    batch_number = serializers.CharField(source="batch.batch_number", read_only=True, default=None)

    class Meta:
        model = OTCSaleItem
        fields = ["id", "medicine", "medicine_name", "unit", "batch", "batch_number",
                  "quantity", "unit_price", "subtotal"]


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


class OTCSaleItemInputSerializer(serializers.Serializer):
    medicine = MedicineField()
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
from api.models import ShopSettings, SubscriptionRequest  # noqa: E402


class ShopSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = ShopSettings
        fields = ["name", "address", "phone", "email", "kra_pin", "currency",
                  "receipt_footer", "expiry_alert_days"]


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
    email = serializers.EmailField(required=False, allow_blank=True, default="")
    phone = serializers.CharField(max_length=20, required=False, allow_blank=True, default="")

    def validate_password(self, value):
        validate_password(value)
        return value