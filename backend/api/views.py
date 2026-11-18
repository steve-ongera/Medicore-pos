# api/views.py
import base64
import hmac
import re
import secrets
from datetime import timedelta, datetime
from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.contrib.auth import authenticate, get_user_model
from django.db import transaction
from django.db.models import Count, DecimalField, ExpressionWrapper, F, Q, Sum, Value
from django.db.models.functions import Greatest, TruncDate
from django.utils import timezone
from django.utils.text import slugify
from rest_framework import status, viewsets
from rest_framework.decorators import (
    action, api_view, authentication_classes, permission_classes, throttle_classes,
)
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.throttling import AnonRateThrottle
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken

from django.contrib.auth import get_user_model
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from api.models import (
    Medicine,
    MedicineBatch,
    OTCSale,
    OTCSaleAmendment,
    OTCSaleItem,
    Role,
    ShopSettings,
    StockTransaction,
    StockTransactionType,
    Subscription,
    SubscriptionRequest,
    Supplier,
    Conversation, ConversationParticipant, Message, Notification,
    # Multi-business
    BusinessType, EXPIRY_TRACKED_TYPES,
    # SaaS
    Bundle, MpesaPayment, PaymentStatus, Shop, WalletTransaction,
)
from api.permissions import (
    MEDICINE_EDIT_ROLES,
    SALE_AMEND_ANY_ROLES,
    CanEditMedicine,
    CanManageStock,
    CanSell,
    CanViewReports,
    CanViewShopReports,
    IsAdmin,
)
from api.serializers import (
    AddPaymentSerializer,
    ChangePasswordSerializer,
    MedicineAutocompleteSerializer,
    MedicineBatchSerializer,
    MedicineSerializer,
    OTCSaleAmendmentSerializer,
    OTCSaleAmendSerializer,
    OTCSaleCreateSerializer,
    OTCSaleSerializer,
    QuickAddMedicineSerializer,
    RegisterSerializer,
    SetMedicineStockSerializer,
    ShopSettingsSerializer,
    StockTransactionSerializer,
    SubscriptionRequestSerializer,
    SupplierSerializer,
    UserCreateSerializer,
    UserSerializer,
)
from api import entitlements
from api.tenancy import platform_context, tenant_context
from api.utils import generate_qr_code

User = get_user_model()


class LoginThrottle(AnonRateThrottle):
    scope = "login"


class RegisterThrottle(AnonRateThrottle):
    scope = "register"


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------
class OutOfStockError(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "Insufficient stock."
    default_code = "out_of_stock"


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([LoginThrottle])
def login_view(request):
    username = request.data.get("username", "")
    password = request.data.get("password", "")
    with platform_context():  # nobody is signed in yet, so no tenant exists
        user = authenticate(request, username=username, password=password)
    if not user or not user.is_active:
        return Response({"detail": "Invalid username or password."}, status=status.HTTP_401_UNAUTHORIZED)
    if user.shop_id is None or user.shop.status != "ACTIVE":
        return Response({"detail": "This account cannot sign in. Contact support."}, status=status.HTTP_403_FORBIDDEN)
    refresh = RefreshToken.for_user(user)
    return Response({
        "access": str(refresh.access_token),
        "refresh": str(refresh),
        "user": UserSerializer(user).data,
    })


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def logout_view(request):
    token = request.data.get("refresh")
    if token:
        try:
            RefreshToken(token).blacklist()
        except Exception:
            pass  # blacklist app not installed or token already invalid
    return Response({"detail": "Logged out."})


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def me_view(request):
    if request.method == "PATCH":
        # Users may only edit their own contact details, never role/username.
        allowed = {k: v for k, v in request.data.items() if k in ("first_name", "last_name", "email", "phone")}
        s = UserSerializer(request.user, data=allowed, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
    return Response(UserSerializer(request.user).data)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def shop_view(request):
    return Response(ShopSettingsSerializer(ShopSettings.load()).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def change_password_view(request):
    s = ChangePasswordSerializer(data=request.data)
    s.is_valid(raise_exception=True)
    if not request.user.check_password(s.validated_data["old_password"]):
        raise ValidationError({"old_password": "Incorrect password."})
    request.user.set_password(s.validated_data["new_password"])
    request.user.save()
    return Response({"detail": "Password changed."})


class UserViewSet(viewsets.ModelViewSet):
    """Staff management - admin only."""

    permission_classes = [IsAdmin]

    def get_queryset(self):  # per request: tenant-scoped
        return User.objects.all().order_by("username")

    def perform_create(self, serializer):
        entitlements.enforce_limit(self.request.user.shop, "users", User.objects.filter(is_active=True).count())
        serializer.save()

    def get_serializer_class(self):
        return UserCreateSerializer if self.action == "create" else UserSerializer


# ---------------------------------------------------------------------------
# Stock helpers
# ---------------------------------------------------------------------------
def _log(medicine, batch, kind, qty, reason, user):
    return StockTransaction.objects.create(
        medicine=medicine, batch=batch, transaction_type=kind,
        quantity=qty, reason=reason, performed_by=user,
    )


def _stock_annotated(qs):
    return qs.annotate(
        stock_qty=Sum("batches__quantity_remaining", filter=Q(batches__is_deleted=False))
    )


def _fefo(qs):
    """Earliest expiry first; no-expiry batches last, oldest first (works on every database)."""
    return qs.order_by(F("expiry_date").asc(nulls_last=True), "created_at")


# ---------------------------------------------------------------------------
# Suppliers / Products (Medicine model) / Batches / Transactions
# ---------------------------------------------------------------------------
class SupplierViewSet(viewsets.ModelViewSet):
    serializer_class = SupplierSerializer

    def get_queryset(self):  # per request: tenant-scoped
        return Supplier.objects.all().order_by("name")

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [IsAuthenticated()]
        return [CanManageStock()]

    def perform_destroy(self, instance):
        instance.soft_delete()


class MedicineViewSet(viewsets.ModelViewSet):
    """Products. Served at /medicines/ (legacy) and /products/ (generic alias)."""

    serializer_class = MedicineSerializer

    def get_queryset(self):
        qs = Medicine.objects.all().order_by("name")
        p = self.request.query_params
        if p.get("category"):
            qs = qs.filter(category__iexact=p["category"])
        if p.get("barcode"):
            qs = qs.filter(barcode=p["barcode"])
        if p.get("search"):
            s = p["search"]
            qs = qs.filter(Q(name__icontains=s) | Q(generic_name__icontains=s)
                           | Q(barcode__icontains=s) | Q(sku__icontains=s))
        return qs

    def get_permissions(self):
        if self.action in ("list", "retrieve", "autocomplete", "low_stock"):
            return [IsAuthenticated()]
        if self.action == "set_stock":
            return [CanEditMedicine()]
        if self.action == "quick_add":
            return [CanEditMedicine()]
        return [CanEditMedicine()]

    def perform_create(self, serializer):
        entitlements.enforce_limit(self.request.user.shop, "products", Medicine.objects.count())
        serializer.save()

    def perform_destroy(self, instance):
        instance.soft_delete()

    @action(detail=False, methods=["get"], url_path="low-stock")
    def low_stock(self, request):
        qs = _stock_annotated(Medicine.objects.filter(is_visible=True))
        items = [m for m in qs if (m.stock_qty or 0) <= m.reorder_level]
        return Response(MedicineAutocompleteSerializer(items, many=True).data)

    @action(detail=False, methods=["get"])
    def autocomplete(self, request):
        """
        ?q=para           -> search by name / generic name / barcode / SKU (max 30)
        (no q)            -> browse mode: every visible product A-Z
        ?include_hidden=1 -> also hidden ones (edit roles only)
        """
        q = (request.query_params.get("q") or "").strip()
        include_hidden = request.query_params.get("include_hidden") in ("1", "true", "True")
        qs = Medicine.objects.all()
        if not (include_hidden and request.user.role in MEDICINE_EDIT_ROLES):
            qs = qs.filter(is_visible=True)
        if q:
            qs = qs.filter(Q(name__icontains=q) | Q(generic_name__icontains=q)
                           | Q(barcode__icontains=q) | Q(sku__icontains=q))
        qs = _stock_annotated(qs).order_by("name")
        if q:
            qs = qs[:30]
        return Response(MedicineAutocompleteSerializer(qs, many=True).data)

    @action(detail=False, methods=["post"], url_path="quick-add")
    @transaction.atomic
    def quick_add(self, request):
        entitlements.enforce_limit(request.user.shop, "products", Medicine.objects.count())
        s = QuickAddMedicineSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        medicine = Medicine.objects.create(
            name=d["name"], generic_name=d["generic_name"], category=d["category"],
            unit=d["unit"], unit_price=d["unit_price"], reorder_level=d["reorder_level"],
            barcode=d["barcode"], sku=d["sku"],
        )
        batch_no = d["batch_number"] or f"B-{timezone.now():%Y%m%d%H%M%S}"
        batch = MedicineBatch.objects.create(
            medicine=medicine, batch_number=batch_no,
            quantity_received=d["quantity"], quantity_remaining=d["quantity"],
            expiry_date=d.get("expiry_date"),
        )
        _log(medicine, batch, StockTransactionType.STOCK_IN, d["quantity"], "Quick add", request.user)
        medicine = _stock_annotated(Medicine.objects.filter(pk=medicine.pk)).get()
        return Response(MedicineAutocompleteSerializer(medicine).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"], url_path="branch-stock")
    def branch_stock(self, request, pk=None):
        """Per-batch breakdown (kept under the old name so the frontend call is unchanged).
        `quantity` is what the edit modal reads; `total` is kept for older callers."""
        medicine = self.get_object()
        batches = list(_fefo(medicine.batches.filter(quantity_remaining__gt=0)))
        total = sum(b.quantity_remaining for b in batches)
        return Response({
            "medicine": medicine.id,
            "quantity": total,
            "total": total,
            "batches": MedicineBatchSerializer(batches, many=True).data,
        })

    @action(detail=True, methods=["post"], url_path="set-stock")
    @transaction.atomic
    def set_stock(self, request, pk=None):
        """Stock-take: force on-hand to an exact number via ADJUSTMENT rows (FEFO removal)."""
        medicine = self.get_object()
        s = SetMedicineStockSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        target, reason = s.validated_data["quantity"], s.validated_data["reason"]

        batches = list(_fefo(medicine.batches.select_for_update().filter(quantity_remaining__gt=0)))
        current = sum(b.quantity_remaining for b in batches)
        diff = target - current

        if diff > 0:
            batch = batches[-1] if batches else MedicineBatch.objects.create(
                medicine=medicine, batch_number=f"ADJ-{timezone.now():%Y%m%d%H%M%S}",
                quantity_received=0, quantity_remaining=0,
                expiry_date=(timezone.now().date() + timedelta(days=365))
                if ShopSettings.load().tracks_expiry else None,
            )
            batch.quantity_remaining += diff
            batch.quantity_received += diff
            batch.save(update_fields=["quantity_remaining", "quantity_received", "updated_at"])
            _log(medicine, batch, StockTransactionType.ADJUSTMENT, diff, reason, request.user)
        elif diff < 0:
            to_remove = -diff
            for b in batches:  # earliest expiry first
                if to_remove <= 0:
                    break
                take = min(b.quantity_remaining, to_remove)
                b.quantity_remaining -= take
                b.save(update_fields=["quantity_remaining", "updated_at"])
                _log(medicine, b, StockTransactionType.ADJUSTMENT, -take, reason, request.user)
                to_remove -= take

        medicine = _stock_annotated(Medicine.objects.filter(pk=medicine.pk)).get()
        data = MedicineAutocompleteSerializer(medicine).data
        return Response({**data, "medicine": data})  # the edit modal reads r.medicine


class MedicineBatchViewSet(viewsets.ModelViewSet):
    serializer_class = MedicineBatchSerializer

    def get_queryset(self):
        qs = _fefo(MedicineBatch.objects.select_related("medicine", "supplier"))
        if self.request.query_params.get("medicine"):
            qs = qs.filter(medicine_id=self.request.query_params["medicine"])
        return qs

    def get_permissions(self):
        if self.action in ("list", "retrieve", "expiring_soon"):
            return [IsAuthenticated()]
        return [CanManageStock()]

    @transaction.atomic
    def perform_create(self, serializer):
        qty = serializer.validated_data["quantity_received"]
        batch = serializer.save(quantity_remaining=qty)
        _log(batch.medicine, batch, StockTransactionType.STOCK_IN, qty, "Stock received", self.request.user)

    def perform_destroy(self, instance):
        instance.soft_delete()

    @action(detail=False, methods=["get"], url_path="expiring-soon")
    def expiring_soon(self, request):
        days = int(request.query_params.get("days", 90))
        cutoff = timezone.now().date() + timedelta(days=days)
        # Batches without an expiry date never match `expiry_date__lte`, so they are skipped.
        qs = self.get_queryset().filter(quantity_remaining__gt=0, expiry_date__lte=cutoff)
        return Response(MedicineBatchSerializer(qs, many=True).data)


class StockTransactionViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = StockTransactionSerializer
    permission_classes = [CanManageStock]

    def get_queryset(self):
        qs = StockTransaction.objects.select_related("medicine", "batch", "performed_by")
        p = self.request.query_params
        if p.get("medicine"):
            qs = qs.filter(medicine_id=p["medicine"])
        if p.get("transaction_type"):
            qs = qs.filter(transaction_type=p["transaction_type"])
        return qs


# ---------------------------------------------------------------------------
# Sales (POS)
# ---------------------------------------------------------------------------
def otc_sale_snapshot(sale):
    """JSON-safe picture of a sale, stored before/after an amendment."""
    return {
        "customer_name": sale.customer_name,
        "customer_phone": sale.customer_phone,
        "payment_method": sale.payment_method,
        "reference_number": sale.reference_number,
        "discount": str(sale.discount),
        "subtotal": str(sale.subtotal),
        "total_amount": str(sale.total_amount),
        "amount_paid": str(sale.amount_paid),
        "items": [
            {"medicine": str(i.medicine_id), "medicine_name": i.medicine.name,
             "quantity": i.quantity, "unit_price": str(i.unit_price), "subtotal": str(i.subtotal)}
            for i in sale.items.select_related("medicine")
        ],
    }


class OTCSaleViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = OTCSaleSerializer
    permission_classes = [CanSell]

    def get_queryset(self):
        qs = (OTCSale.objects.select_related("served_by")
              .prefetch_related("items__medicine", "items__batch").order_by("-sold_at"))
        u = self.request.user
        if u.role == Role.CASHIER:
            qs = qs.filter(served_by=u)  # cashiers only see their own
        p = self.request.query_params
        if p.get("date"):
            qs = qs.filter(sold_at__date=p["date"])
        if p.get("date_from"):
            qs = qs.filter(sold_at__date__gte=p["date_from"])
        if p.get("date_to"):
            qs = qs.filter(sold_at__date__lte=p["date_to"])
        if p.get("payment_method"):
            qs = qs.filter(payment_method=p["payment_method"])
        if p.get("served_by"):
            qs = qs.filter(served_by_id=p["served_by"])
        if p.get("unpaid") in ("1", "true", "True"):
            qs = qs.filter(total_amount__gt=F("amount_paid"))
        if p.get("search"):
            s = p["search"]
            qs = qs.filter(Q(sale_number__icontains=s) | Q(customer_name__icontains=s)
                           | Q(customer_phone__icontains=s) | Q(reference_number__icontains=s))
        return qs

    # -- helpers ------------------------------------------------------------
    @staticmethod
    def _price_line(medicine, quantity, line_amount):
        """Returns (unit_price, line_total). A cashier-entered line_amount wins."""
        if line_amount is None:
            unit_price = medicine.unit_price
            return unit_price, unit_price * quantity
        return (line_amount / quantity).quantize(Decimal("0.01")), line_amount

    def _add_items(self, sale, items, user):
        """FEFO batch pick (no-expiry batches oldest first) + deduct + ledger. Returns the subtotal."""
        subtotal = Decimal("0")
        for it in items:
            medicine, qty = it["medicine"], it["quantity"]
            batch = _fefo(MedicineBatch.objects.select_for_update()
                          .filter(medicine=medicine, quantity_remaining__gte=qty)).first()
            if not batch:
                raise OutOfStockError(f"Insufficient stock for {medicine.name}.")
            unit_price, line_total = self._price_line(medicine, qty, it.get("line_amount"))
            OTCSaleItem.objects.create(
                sale=sale, medicine=medicine, batch=batch, quantity=qty,
                unit_price=unit_price, subtotal=line_total,
            )
            batch.quantity_remaining -= qty
            batch.save(update_fields=["quantity_remaining", "updated_at"])
            _log(medicine, batch, StockTransactionType.STOCK_OUT, qty,
                 f"OTC sale {sale.sale_number}", user)
            subtotal += line_total
        return subtotal

    @staticmethod
    def _finish(sale, subtotal, discount, amount_paid):
        total = max(subtotal - discount, Decimal("0"))
        sale.subtotal, sale.discount, sale.total_amount = subtotal, discount, total
        sale.amount_paid = total if amount_paid is None else amount_paid
        sale.qr_code = generate_qr_code(
            f"OTC:{sale.sale_number}|AMOUNT:{total}", sale.sale_number
        )
        sale.save()

    # -- actions ------------------------------------------------------------
    @transaction.atomic
    def create(self, request):
        s = OTCSaleCreateSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        entitlements.consume_sale(request.user.shop)  # inside the atomic block: a failed sale never burns a credit
        sale = OTCSale.objects.create(
            customer_name=d["customer_name"], customer_phone=d["customer_phone"],
            discount=d["discount"], payment_method=d["payment_method"],
            reference_number=d["reference_number"], served_by=request.user,
        )
        subtotal = self._add_items(sale, d["items"], request.user)
        self._finish(sale, subtotal, d["discount"], d.get("amount_paid"))
        return Response(OTCSaleSerializer(sale, context={"request": request}).data,
                        status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"])
    def receipt(self, request, pk=None):
        sale = self.get_object()
        data = OTCSaleSerializer(sale, context={"request": request}).data
        data["shop"] = ShopSettingsSerializer(ShopSettings.load()).data
        return Response(data)

    @action(detail=True, methods=["get"])
    def amendments(self, request, pk=None):
        sale = self.get_object()
        return Response(OTCSaleAmendmentSerializer(sale.amendments.all(), many=True).data)

    @action(detail=True, methods=["post"], url_path="add-payment")
    @transaction.atomic
    def add_payment(self, request, pk=None):
        """Collect (part of) an outstanding balance. Audited like any other change."""
        sale = self.get_object()
        s = AddPaymentSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        if sale.balance <= 0:
            raise ValidationError({"amount": "This sale is already fully paid."})
        amount = s.validated_data["amount"]
        if amount > sale.balance:
            raise ValidationError({"amount": f"Only {sale.balance} is outstanding."})
        before = otc_sale_snapshot(sale)
        sale.amount_paid += amount
        if s.validated_data["reference_number"]:
            sale.reference_number = s.validated_data["reference_number"]
        sale.save(update_fields=["amount_paid", "reference_number", "updated_at"])
        OTCSaleAmendment.objects.create(
            sale=sale, amended_by=request.user, reason=f"Balance payment of {amount}",
            before=before, after=otc_sale_snapshot(sale),
        )
        return Response(OTCSaleSerializer(sale, context={"request": request}).data)

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def amend(self, request, pk=None):
        sale = self.get_object()
        u = request.user

        # Role rules: admin/pharmacist any sale; cashier only own sale, same day.
        if u.role not in SALE_AMEND_ANY_ROLES:
            if sale.served_by_id != u.id or sale.sold_at.date() != timezone.localdate():
                raise PermissionDenied("Cashiers can only amend their own sales from today.")

        s = OTCSaleAmendSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        before = otc_sale_snapshot(sale)

        # 1) put the old stock back
        for old in sale.items.select_related("medicine", "batch"):
            if old.batch_id:
                batch = MedicineBatch.objects.select_for_update().get(pk=old.batch_id)
                batch.quantity_remaining += old.quantity
                batch.save(update_fields=["quantity_remaining", "updated_at"])
                _log(old.medicine, batch, StockTransactionType.ADJUSTMENT, old.quantity,
                     f"Amend {sale.sale_number}: restore", u)
        sale.items.all().delete()

        # 2) re-take stock for the corrected lines
        sale.customer_name, sale.customer_phone = d["customer_name"], d["customer_phone"]
        sale.payment_method, sale.reference_number = d["payment_method"], d["reference_number"]
        subtotal = self._add_items(sale, d["items"], u)
        self._finish(sale, subtotal, d["discount"], d.get("amount_paid"))
        sale.amended_at = timezone.now()
        sale.save(update_fields=["amended_at"])

        OTCSaleAmendment.objects.create(
            sale=sale, amended_by=u, reason=d["reason"],
            before=before, after=otc_sale_snapshot(sale),
        )
        sale.refresh_from_db()
        return Response(OTCSaleSerializer(sale, context={"request": request}).data)


# ---------------------------------------------------------------------------
# Dashboard / reports
# ---------------------------------------------------------------------------
@api_view(["GET"])
@permission_classes([CanViewReports])
def reports_summary(request):
    """
    One call feeds the dashboard and reports pages.
    ?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD   (default: last 30 days)
    Cashiers only ever see their own sales.
    """
    today = timezone.localdate()
    p = request.query_params
    date_to = p.get("date_to") or str(today)
    date_from = p.get("date_from") or str(today - timedelta(days=29))

    sales = OTCSale.objects.filter(sold_at__date__gte=date_from, sold_at__date__lte=date_to)
    if request.user.role == Role.CASHIER:
        sales = sales.filter(served_by=request.user)

    agg = sales.aggregate(
        count=Count("id"), revenue=Sum("total_amount"), discount=Sum("discount"),
        collected=Sum("amount_paid"),
        outstanding=Sum(F("total_amount") - F("amount_paid"), filter=Q(total_amount__gt=F("amount_paid"))),
    )
    money = lambda v: str(v or Decimal("0"))  # noqa: E731

    by_day = [
        {"date": str(r["d"]), "count": r["count"], "revenue": money(r["revenue"])}
        for r in sales.annotate(d=TruncDate("sold_at")).values("d")
        .annotate(count=Count("id"), revenue=Sum("total_amount")).order_by("d")
    ]
    by_method = [
        {"method": r["payment_method"], "count": r["count"], "revenue": money(r["revenue"])}
        for r in sales.values("payment_method").annotate(count=Count("id"), revenue=Sum("total_amount"))
        .order_by("-revenue")
    ]
    by_cashier = [
        {"name": r["served_by__username"] or "-", "count": r["count"], "revenue": money(r["revenue"])}
        for r in sales.values("served_by__username").annotate(count=Count("id"), revenue=Sum("total_amount"))
        .order_by("-revenue")
    ]
    top_medicines = [
        {"name": r["medicine__name"], "quantity": r["qty"], "revenue": money(r["revenue"])}
        for r in OTCSaleItem.objects.filter(sale__in=sales).values("medicine__name")
        .annotate(qty=Sum("quantity"), revenue=Sum("subtotal")).order_by("-revenue")[:8]
    ]

    # Stock health (shop-wide, not date filtered)
    meds = list(_stock_annotated(Medicine.objects.filter(is_visible=True)))
    live = MedicineBatch.objects.filter(quantity_remaining__gt=0)
    stock_value = live.aggregate(v=Sum(ExpressionWrapper(
        F("quantity_remaining") * F("medicine__unit_price"), output_field=DecimalField())))["v"]
    # Batches with no expiry date never match the expiry filters below.
    stock = {
        "medicines": len(meds),
        "low_stock": sum(1 for m in meds if 0 < (m.stock_qty or 0) <= m.reorder_level),
        "out_of_stock": sum(1 for m in meds if (m.stock_qty or 0) == 0),
        "expiring_90_days": live.filter(expiry_date__gte=today, expiry_date__lte=today + timedelta(days=90)).count(),
        "expired": live.filter(expiry_date__lt=today).count(),
        "stock_value": money(stock_value),
    }

    recent = OTCSaleSerializer(
        sales.select_related("served_by").prefetch_related("items__medicine").order_by("-sold_at")[:8],
        many=True, context={"request": request},
    ).data

    return Response({
        "range": {"date_from": date_from, "date_to": date_to},
        "totals": {
            "sales_count": agg["count"] or 0, "revenue": money(agg["revenue"]),
            "discount": money(agg["discount"]), "collected": money(agg["collected"]),
            "outstanding": money(agg["outstanding"]),
        },
        "by_day": by_day, "by_method": by_method, "by_cashier": by_cashier,
        "top_medicines": top_medicines, "stock": stock, "recent_sales": recent,
    })


# ---------------------------------------------------------------------------
# Dashboard, reports & payments summary
# ---------------------------------------------------------------------------
ZERO = Value(Decimal("0"), output_field=DecimalField())


def _sales_scope(request):
    """All sales, or only the caller's own when they are a cashier."""
    qs = OTCSale.objects.all()
    if request.user.role == Role.CASHIER:
        qs = qs.filter(served_by=request.user)
    return qs


def _date_range(request, default_days=30):
    """Returns (date_from, date_to) as dates from ?date_from & ?date_to (inclusive)."""
    today = timezone.localdate()
    try:
        d_to = datetime.strptime(request.query_params.get("date_to", ""), "%Y-%m-%d").date()
    except ValueError:
        d_to = today
    try:
        d_from = datetime.strptime(request.query_params.get("date_from", ""), "%Y-%m-%d").date()
    except ValueError:
        d_from = d_to - timedelta(days=default_days - 1)
    if d_from > d_to:
        d_from, d_to = d_to, d_from
    return d_from, d_to


def _money(v):
    return str(v or Decimal("0"))


def _daily_series(qs, d_from, d_to):
    """One row per day (zero-filled): revenue, number of sales."""
    rows = (qs.annotate(day=TruncDate("sold_at")).values("day")
            .annotate(revenue=Sum("total_amount"), sales=Count("id")))
    by_day = {r["day"]: r for r in rows}
    out, d = [], d_from
    while d <= d_to:
        r = by_day.get(d)
        out.append({"date": d.isoformat(), "revenue": _money(r["revenue"]) if r else "0",
                    "sales": r["sales"] if r else 0})
        d += timedelta(days=1)
    return out


def _by_method(qs):
    rows = qs.values("payment_method").annotate(total=Sum("total_amount"), count=Count("id")).order_by("-total")
    return [{"method": r["payment_method"], "total": _money(r["total"]), "count": r["count"]} for r in rows]


def _top_items(sale_qs, limit=10):
    rows = (OTCSaleItem.objects.filter(sale__in=sale_qs)
            .values("medicine_id", "medicine__name", "medicine__unit")
            .annotate(quantity=Sum("quantity"), revenue=Sum("subtotal"))
            .order_by("-revenue")[:limit])
    return [{"medicine": str(r["medicine_id"]), "name": r["medicine__name"], "unit": r["medicine__unit"],
             "quantity": r["quantity"], "revenue": _money(r["revenue"])} for r in rows]


@api_view(["GET"])
@permission_classes([CanSell])
def dashboard_summary(request):
    """KPIs, 14-day trend, payment split, top sellers, recent sales, stock alerts."""
    days = min(max(int(request.query_params.get("days", 14) or 14), 1), 90)
    today = timezone.localdate()
    d_from = today - timedelta(days=days - 1)
    scope = _sales_scope(request)
    today_qs = scope.filter(sold_at__date=today)
    range_qs = scope.filter(sold_at__date__gte=d_from, sold_at__date__lte=today)

    today_agg = today_qs.aggregate(revenue=Sum("total_amount"), sales=Count("id"))
    items_today = OTCSaleItem.objects.filter(sale__in=today_qs).aggregate(q=Sum("quantity"))["q"] or 0
    outstanding = scope.aggregate(
        v=Sum(Greatest(F("total_amount") - F("amount_paid"), ZERO, output_field=DecimalField()))
    )["v"]

    settings_row = ShopSettings.load()
    meds = list(_stock_annotated(Medicine.objects.filter(is_visible=True)))
    low = [m for m in meds if (m.stock_qty or 0) <= m.reorder_level]
    cutoff = today + timedelta(days=settings_row.expiry_alert_days)
    # Shops that do not track expiry never get expiry alerts.
    expiring = (
        MedicineBatch.objects.filter(quantity_remaining__gt=0, expiry_date__lte=cutoff).count()
        if settings_row.tracks_expiry else 0
    )

    recent = (scope.select_related("served_by").prefetch_related("items__medicine")
              .order_by("-sold_at")[:8])
    return Response({
        "today": {"revenue": _money(today_agg["revenue"]), "sales": today_agg["sales"] or 0,
                  "items_sold": items_today},
        "outstanding": _money(outstanding),
        "low_stock_count": len(low),
        "out_of_stock_count": sum(1 for m in meds if (m.stock_qty or 0) == 0),
        "expiring_count": expiring,
        "trend": _daily_series(range_qs, d_from, today),
        "payment_methods": _by_method(range_qs),
        "top_medicines": _top_items(range_qs, 6),
        "recent_sales": OTCSaleSerializer(recent, many=True, context={"request": request}).data,
        "low_stock": MedicineAutocompleteSerializer(
            sorted(low, key=lambda m: (m.stock_qty or 0))[:8], many=True).data,
    })


@api_view(["GET"])
@permission_classes([CanViewShopReports])
def sales_report(request):
    d_from, d_to = _date_range(request)
    qs = OTCSale.objects.filter(sold_at__date__gte=d_from, sold_at__date__lte=d_to)
    totals = qs.aggregate(
        gross=Sum("subtotal"), discount=Sum("discount"), revenue=Sum("total_amount"), sales=Count("id"),
        outstanding=Sum(Greatest(F("total_amount") - F("amount_paid"), ZERO, output_field=DecimalField())),
    )
    n = totals["sales"] or 0
    by_cashier = (qs.values("served_by", "served_by__first_name", "served_by__last_name", "served_by__username")
                  .annotate(total=Sum("total_amount"), count=Count("id")).order_by("-total"))
    return Response({
        "date_from": d_from.isoformat(), "date_to": d_to.isoformat(),
        "totals": {"gross": _money(totals["gross"]), "discount": _money(totals["discount"]),
                   "revenue": _money(totals["revenue"]), "outstanding": _money(totals["outstanding"]),
                   "sales": n,
                   "average_sale": _money((totals["revenue"] or Decimal("0")) / n) if n else "0"},
        "daily": _daily_series(qs, d_from, d_to),
        "payment_methods": _by_method(qs),
        "cashiers": [{"id": str(r["served_by"]) if r["served_by"] else None,
                      "name": (f'{r["served_by__first_name"]} {r["served_by__last_name"]}'.strip()
                               or r["served_by__username"] or "Unknown"),
                      "total": _money(r["total"]), "count": r["count"]} for r in by_cashier],
    })


@api_view(["GET"])
@permission_classes([CanViewShopReports])
def product_report(request):
    entitlements.require_feature(request.user.shop, "full_reports")
    d_from, d_to = _date_range(request)
    qs = OTCSale.objects.filter(sold_at__date__gte=d_from, sold_at__date__lte=d_to)
    return Response({"date_from": d_from.isoformat(), "date_to": d_to.isoformat(),
                     "items": _top_items(qs, 100)})


@api_view(["GET"])
@permission_classes([CanViewShopReports])
def stock_report(request):
    """Stock on hand valued at selling price, plus low / out-of-stock and expiring batches."""
    entitlements.require_feature(request.user.shop, "full_reports")
    cfg = ShopSettings.load()
    meds = list(_stock_annotated(Medicine.objects.filter(is_visible=True)).order_by("name"))
    rows, value = [], Decimal("0")
    for m in meds:
        qty = m.stock_qty or 0
        v = m.unit_price * qty
        value += v
        rows.append({"id": str(m.id), "name": m.name, "category": m.category, "unit": m.unit,
                     "quantity": qty, "unit_price": _money(m.unit_price), "value": _money(v),
                     "reorder_level": m.reorder_level,
                     "status": "OUT" if qty == 0 else ("LOW" if qty <= m.reorder_level else "OK")})
    today = timezone.localdate()
    cutoff = today + timedelta(days=cfg.expiry_alert_days)
    if cfg.tracks_expiry:
        batches = (MedicineBatch.objects.select_related("medicine")
                   .filter(quantity_remaining__gt=0, expiry_date__lte=cutoff).order_by("expiry_date"))
    else:
        batches = []
    return Response({
        "total_value": _money(value),
        "total_products": len(rows),
        "low_count": sum(1 for r in rows if r["status"] == "LOW"),
        "out_count": sum(1 for r in rows if r["status"] == "OUT"),
        "items": rows,
        "expiring": [{"id": str(b.id), "medicine": b.medicine.name, "batch_number": b.batch_number,
                      "quantity_remaining": b.quantity_remaining, "expiry_date": b.expiry_date.isoformat(),
                      "days_left": (b.expiry_date - today).days} for b in batches],
    })


@api_view(["GET"])
@permission_classes([CanSell])
def payments_summary(request):
    d_from, d_to = _date_range(request, default_days=1)
    qs = _sales_scope(request).filter(sold_at__date__gte=d_from, sold_at__date__lte=d_to)
    t = qs.aggregate(
        billed=Sum("total_amount"), sales=Count("id"),
        outstanding=Sum(Greatest(F("total_amount") - F("amount_paid"), ZERO, output_field=DecimalField())),
    )
    billed, out = t["billed"] or Decimal("0"), t["outstanding"] or Decimal("0")
    return Response({
        "date_from": d_from.isoformat(), "date_to": d_to.isoformat(),
        "billed": _money(billed), "collected": _money(billed - out), "outstanding": _money(out),
        "sales": t["sales"] or 0, "by_method": _by_method(qs),
    })


# ---------------------------------------------------------------------------
# Shop settings & subscription
# ---------------------------------------------------------------------------
@api_view(["GET", "PATCH"])
def shop_settings_view(request):
    """Any signed-in user may read (receipts need it); only the owner may change."""
    if not request.user.is_authenticated:
        raise PermissionDenied()
    cfg = ShopSettings.load()
    if request.method == "PATCH":
        if request.user.role != Role.SUPER_ADMIN:
            raise PermissionDenied("Only the admin can change shop settings.")
        s = ShopSettingsSerializer(cfg, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)
    return Response(ShopSettingsSerializer(cfg).data)


# ---------------------------------------------------------------------------
# SaaS: subscription, wallet, bundles, M-Pesa, sign-up
# subscription_view keeps the response keys the Subscriptions page already reads
# (plan, plan_label, started_at, expires_at, is_active, days_left, plans, requests)
# and adds wallet_balance, sales_remaining, limits, features, bundles.
# ---------------------------------------------------------------------------
def _owner_only(request):
    if request.user.role != Role.SUPER_ADMIN:
        raise PermissionDenied("Only the shop owner can do this.")


# ---------------------------------------------------------------------------
# Subscription (compatible with the existing frontend)
# ---------------------------------------------------------------------------
def _feature_lines(b):
    lines = [
        "Unlimited sales" if b.sales_allowance is None else f"{b.sales_allowance:,} sales",
        "Unlimited staff accounts" if b.max_users is None else f"Up to {b.max_users} staff accounts",
        f"Valid {b.validity_days} day{'s' if b.validity_days != 1 else ''}",
    ]
    if "full_reports" in (b.features or []):
        lines.append("Full sales & stock reports")
    return lines


def _plan_catalog():
    return [
        {
            "code": b.code, "name": b.name, "price": str(b.price), "validity_days": b.validity_days,
            # same key the old page reads, normalised to a 30-day price
            "price_per_month": int(round(b.price * 30 / b.validity_days)),
            "features": _feature_lines(b),
        }
        for b in Bundle.objects.filter(is_active=True, is_trial=False)
    ]


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def subscription_view(request):
    shop = Shop.objects.get(pk=request.user.shop_id)

    if request.method == "POST":  # "I paid by M-Pesa, please activate" (manual approval flow)
        _owner_only(request)
        bundle = Bundle.objects.filter(code=request.data.get("plan"), is_active=True, is_trial=False).first()
        if not bundle:
            raise ValidationError({"plan": "Unknown bundle."})
        s = SubscriptionRequestSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        ref = s.validated_data["mpesa_reference"].strip().upper()
        # _base_manager on purpose: a receipt code must be unique across ALL shops.
        if SubscriptionRequest._base_manager.filter(mpesa_reference__iexact=ref).exclude(status="REJECTED").exists():
            raise ValidationError({"mpesa_reference": "This M-Pesa code has already been used."})
        s.save(requested_by=request.user, mpesa_reference=ref,
               amount=bundle.price * s.validated_data["months"])
        return Response(s.data, status=status.HTTP_201_CREATED)

    ent = entitlements.snapshot(shop)
    active = list(entitlements.active_purchases(shop))
    top = active[-1] if active else None
    return Response({
        # --- keys the existing page already reads ---
        "plan": top.bundle.code if top else "NONE",
        "plan_label": top.bundle.name if top else "No active bundle",
        "started_at": min(p.starts_at for p in active) if active else None,
        "expires_at": ent.expires_at,
        "is_active": ent.is_active,
        "days_left": ent.days_left,
        "plans": _plan_catalog(),
        "requests": SubscriptionRequestSerializer(SubscriptionRequest.objects.all()[:10], many=True).data,
        # --- new keys ---
        "wallet_balance": str(shop.wallet_balance),
        "sales_remaining": None if ent.sales_unlimited else ent.sales_remaining,
        "limits": {"max_users": ent.max_users, "max_products": ent.max_products},
        "features": sorted(ent.features),
        "bundles": [
            {"code": p.bundle.code, "name": p.bundle.name, "expires_at": p.expires_at,
             "sales_remaining": p.sales_remaining, "auto_renew": p.auto_renew}
            for p in active
        ],
    })


# ---------------------------------------------------------------------------
# Wallet & bundle purchase (the "airtime -> bundle" flow)
# ---------------------------------------------------------------------------
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def wallet_view(request):
    shop = Shop.objects.get(pk=request.user.shop_id)
    txs = WalletTransaction.objects.order_by("-created_at")[:30]  # scoped to this shop
    return Response({
        "balance": str(shop.wallet_balance),
        "transactions": [{"kind": t.kind, "amount": str(t.amount), "balance_after": str(t.balance_after),
                          "note": t.note, "created_at": t.created_at} for t in txs],
    })


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def buy_bundle_view(request):
    _owner_only(request)
    bundle = Bundle.objects.filter(code=request.data.get("bundle"), is_active=True, is_trial=False).first()
    if not bundle:
        raise ValidationError({"bundle": "Unknown bundle."})
    try:
        quantity = int(request.data.get("quantity", 1))
    except (TypeError, ValueError):
        quantity = 0
    if not 1 <= quantity <= 12:
        raise ValidationError({"quantity": "Choose between 1 and 12."})
    purchase = entitlements.buy_bundle(
        request.user.shop, bundle, quantity=quantity,
        auto_renew=bool(request.data.get("auto_renew")), user=request.user,
    )
    return Response({"detail": f"{bundle.name} activated.", "expires_at": purchase.expires_at},
                    status=status.HTTP_201_CREATED)


# ---------------------------------------------------------------------------
# M-Pesa top-up (Daraja STK push). UNTESTED against the live API: try it in the sandbox first.
# Needs `pip install requests` and these settings (read from env):
#   MPESA_ENV ("sandbox"|"production"), MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET,
#   MPESA_SHORTCODE, MPESA_PASSKEY, MPESA_CALLBACK_TOKEN (long random string),
#   PUBLIC_API_URL (e.g. https://api.yourdomain.co.ke)
# ---------------------------------------------------------------------------
def _msisdn(phone):
    p = re.sub(r"\D", "", phone or "")
    if len(p) == 10 and p.startswith("0"):
        p = "254" + p[1:]
    elif len(p) == 9 and p[0] in "17":
        p = "254" + p
    if not (len(p) == 12 and p.startswith("254")):
        raise ValidationError({"phone": "Enter a valid Safaricom number, e.g. 0712345678."})
    return p


def _daraja_base():
    return "https://api.safaricom.co.ke" if getattr(settings, "MPESA_ENV", "sandbox") == "production" \
        else "https://sandbox.safaricom.co.ke"


def _stk_push(phone, amount, reference):
    import requests  # local import so the project still boots without it

    base = _daraja_base()
    auth = requests.get(f"{base}/oauth/v1/generate", params={"grant_type": "client_credentials"},
                        auth=(settings.MPESA_CONSUMER_KEY, settings.MPESA_CONSUMER_SECRET), timeout=15)
    auth.raise_for_status()
    stamp = timezone.localtime().strftime("%Y%m%d%H%M%S")
    password = base64.b64encode(f"{settings.MPESA_SHORTCODE}{settings.MPESA_PASSKEY}{stamp}".encode()).decode()
    callback = f"{settings.PUBLIC_API_URL}/api/billing/mpesa/callback/{settings.MPESA_CALLBACK_TOKEN}/"
    resp = requests.post(
        f"{base}/mpesa/stkpush/v1/processrequest",
        headers={"Authorization": f"Bearer {auth.json()['access_token']}"},
        json={
            "BusinessShortCode": settings.MPESA_SHORTCODE, "Password": password, "Timestamp": stamp,
            "TransactionType": "CustomerPayBillOnline", "Amount": int(amount), "PartyA": phone,
            "PartyB": settings.MPESA_SHORTCODE, "PhoneNumber": phone, "CallBackURL": callback,
            "AccountReference": reference[:12], "TransactionDesc": "Medicore wallet top-up",
        },
        timeout=20,
    )
    resp.raise_for_status()
    return resp.json()


def _settle_payment(pay, paid, receipt):
    """Credit the wallet for a confirmed M-Pesa payment and, if it was for a bundle, buy it straight away."""
    shop = Shop.objects.get(pk=pay.shop_id)
    note = f"M-Pesa payment for {pay.bundle_code}" if pay.bundle_code else "M-Pesa top-up"
    tx = entitlements.credit_wallet(shop, paid, reference=f"MPESA:{receipt}", note=note)
    if tx is None or not pay.bundle_code:
        return  # duplicate receipt (already handled) or a plain top-up
    bundle = Bundle.objects.filter(code=pay.bundle_code, is_active=True, is_trial=False).first()
    if bundle is None:
        return  # the money stays safely in the wallet
    try:
        entitlements.buy_bundle(shop, bundle, quantity=pay.quantity, auto_renew=pay.auto_renew)
    except entitlements.InsufficientBalance:
        pass  # price changed mid-payment: money stays in the wallet


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def topup_view(request):
    """
    {"phone", "bundle": "BASIC", "quantity": 1}  -> pay for a bundle in ONE step (price set by the server)
    {"phone", "amount": 500}                     -> plain wallet top-up
    """
    _owner_only(request)
    phone = _msisdn(request.data.get("phone"))
    bundle, quantity = None, 1

    code = request.data.get("bundle")
    if code:
        bundle = Bundle.objects.filter(code=code, is_active=True, is_trial=False).first()
        if not bundle:
            raise ValidationError({"bundle": "Unknown bundle."})
        try:
            quantity = int(request.data.get("quantity", 1))
        except (TypeError, ValueError):
            quantity = 0
        if not 1 <= quantity <= 12:
            raise ValidationError({"quantity": "Choose between 1 and 12."})
        amount = Decimal(bundle.price) * quantity
        if amount < 1 or amount != amount.to_integral_value():
            raise ValidationError({"bundle": "This bundle cannot be paid with M-Pesa."})
    else:
        try:
            amount = Decimal(str(request.data.get("amount")))
        except InvalidOperation:
            amount = Decimal("-1")
        if amount != amount.to_integral_value() or not (10 <= amount <= 150000):
            raise ValidationError({"amount": "Enter a whole amount between 10 and 150,000."})

    intent = {"bundle_code": bundle.code if bundle else "", "quantity": quantity,
              "auto_renew": bool(request.data.get("auto_renew")) if bundle else False}

    # DEBUG ONLY: skip Safaricom, settle immediately. Never set DJANGO_DEBUG=1 on a live server.
    if settings.DEBUG:
        receipt = f"DBG{secrets.token_hex(4).upper()}"
        checkout_id = f"DEBUG-{secrets.token_hex(8)}"
        with transaction.atomic():
            pay = MpesaPayment.unscoped.create(
                shop=request.user.shop, checkout_request_id=checkout_id, merchant_request_id="DEBUG",
                phone=phone, amount=amount, status=PaymentStatus.SUCCESS, mpesa_receipt=receipt,
                result_desc="DEBUG bypass", **intent)
            _settle_payment(pay, amount, receipt)
        return Response({"detail": "DEBUG mode: M-Pesa bypassed.", "checkout_request_id": checkout_id},
                        status=status.HTTP_202_ACCEPTED)

    try:
        data = _stk_push(phone, amount, reference="MEDICORE")
    except Exception:
        return Response({"detail": "Could not reach M-Pesa. Please try again."}, status=status.HTTP_502_BAD_GATEWAY)
    MpesaPayment.unscoped.create(
        shop=request.user.shop, checkout_request_id=data["CheckoutRequestID"],
        merchant_request_id=data.get("MerchantRequestID", ""), phone=phone, amount=amount, **intent)
    return Response({"detail": "Check your phone and enter your M-Pesa PIN.",
                     "checkout_request_id": data["CheckoutRequestID"]}, status=status.HTTP_202_ACCEPTED)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def payment_status_view(request, checkout_id):
    """The Subscription page polls this after the STK prompt. SUCCESS means the bundle is already active."""
    _owner_only(request)
    pay = MpesaPayment.objects.filter(checkout_request_id=checkout_id).first()  # scoped to this shop
    if pay is None:
        return Response({"detail": "Payment not found."}, status=status.HTTP_404_NOT_FOUND)
    return Response({"status": pay.status, "bundle": pay.bundle_code, "detail": pay.result_desc})


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
def mpesa_callback(request, token):
    """
    Called by Safaricom. Safe because: (1) the URL carries a secret token, (2) we only credit a
    CheckoutRequestID WE created, (3) the paid amount must equal the amount we requested,
    (4) the receipt is the idempotency key, so retries/duplicates can never double-credit.
    Hardening to add: confirm with the STK Query API and/or allowlist Safaricom's IPs.
    """
    expected = getattr(settings, "MPESA_CALLBACK_TOKEN", "")
    if not expected or not hmac.compare_digest(str(token), expected):
        return Response(status=status.HTTP_404_NOT_FOUND)

    ok = {"ResultCode": 0, "ResultDesc": "Accepted"}
    try:
        cb = request.data["Body"]["stkCallback"]
        checkout_id = cb["CheckoutRequestID"]
    except (KeyError, TypeError):
        return Response(ok)

    with platform_context(), transaction.atomic():
        pay = MpesaPayment.unscoped.select_for_update().filter(checkout_request_id=checkout_id).first()
        if pay is None or pay.status != PaymentStatus.PENDING:
            return Response(ok)
        if cb.get("ResultCode") != 0:
            pay.status, pay.result_desc = PaymentStatus.FAILED, str(cb.get("ResultDesc", ""))[:255]
            pay.save(update_fields=["status", "result_desc", "updated_at"])
            return Response(ok)
        items = {i.get("Name"): i.get("Value") for i in cb.get("CallbackMetadata", {}).get("Item", [])}
        paid, receipt = Decimal(str(items.get("Amount", "0"))), str(items.get("MpesaReceiptNumber", ""))
        if paid != pay.amount or not receipt:
            pay.status, pay.result_desc = PaymentStatus.MISMATCH, f"paid={paid} receipt={receipt}"[:255]
            pay.save(update_fields=["status", "result_desc", "updated_at"])
            return Response(ok)
        pay.status, pay.mpesa_receipt = PaymentStatus.SUCCESS, receipt
        pay.save(update_fields=["status", "mpesa_receipt", "updated_at"])
        _settle_payment(pay, paid, receipt)

    return Response(ok)


# ---------------------------------------------------------------------------
# Self-service registration: Shop + owner + settings + free trial, atomically.
# ---------------------------------------------------------------------------
@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([RegisterThrottle])
def register_shop(request):
    s = RegisterSerializer(data=request.data)
    s.is_valid(raise_exception=True)
    d = s.validated_data
    with platform_context(), transaction.atomic():
        if User.objects.filter(username__iexact=d["username"]).exists():
            raise ValidationError({"username": "This username is taken."})
        base = slugify(d["shop_name"])[:40] or "shop"
        slug = f"{base}-{secrets.token_hex(2)}"
        while Shop.objects.filter(slug=slug).exists():
            slug = f"{base}-{secrets.token_hex(3)}"
        shop = Shop.objects.create(name=d["shop_name"], slug=slug, email=d["email"], phone=d["phone"])
        user = User(username=d["username"], first_name=d["first_name"], email=d["email"],
                    phone=d["phone"], role=Role.SUPER_ADMIN, shop=shop)
        user.set_password(d["password"])
        user.save()
        with tenant_context(shop):
            btype = d["business_type"]
            tracks = d["tracks_expiry"] if d.get("tracks_expiry") is not None else btype in EXPIRY_TRACKED_TYPES
            ShopSettings.objects.create(shop=shop, name=d["shop_name"], phone=d["phone"], email=d["email"],
                                        business_type=btype, tracks_expiry=tracks)
        entitlements.start_trial(shop)
    refresh = RefreshToken.for_user(user)
    return Response({"access": str(refresh.access_token), "refresh": str(refresh),
                     "user": UserSerializer(user).data}, status=status.HTTP_201_CREATED)


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def business_types(request):
    """Public list of business types, so a sign-up dropdown needs no hardcoding."""
    return Response([{"value": v, "label": label, "tracks_expiry": v in EXPIRY_TRACKED_TYPES}
                     for v, label in BusinessType.choices])


# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------
class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = ["id", "title", "message", "link", "priority", "is_read", "read_at", "created_at"]
        read_only_fields = fields


class NotificationViewSet(viewsets.ReadOnlyModelViewSet):
    """Everyone only ever sees their own notifications."""

    serializer_class = NotificationSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Notification.objects.filter(recipient=self.request.user).order_by("-created_at")

    @action(detail=False, methods=["get"])
    def unread(self, request):
        qs = self.get_queryset().filter(is_read=False)[:50]
        return Response(NotificationSerializer(qs, many=True).data)

    @action(detail=False, methods=["get"], url_path="unread-count")
    def unread_count(self, request):
        return Response({"unread_count": self.get_queryset().filter(is_read=False).count()})

    @action(detail=True, methods=["post"], url_path="mark-read")
    def mark_read(self, request, pk=None):
        n = self.get_object()
        if not n.is_read:
            n.is_read, n.read_at = True, timezone.now()
            n.save(update_fields=["is_read", "read_at", "updated_at"])
        return Response(NotificationSerializer(n).data)

    @action(detail=False, methods=["post"], url_path="mark-all-read")
    def mark_all_read(self, request):
        now = timezone.now()
        updated = self.get_queryset().filter(is_read=False).update(is_read=True, read_at=now)
        return Response({"marked": updated})


# ---------------------------------------------------------------------------
# Messaging
# ---------------------------------------------------------------------------
def _name(u):
    return (u.get_full_name() or u.username) if u else None


def _user_brief(u):
    return {"id": str(u.id), "username": u.username, "full_name": _name(u), "role": u.role}


def _unread_for(conv, participant):
    qs = conv.messages.exclude(sender_id=participant.user_id)
    if participant.last_read_at:
        qs = qs.filter(created_at__gt=participant.last_read_at)
    return qs.count()


def serialize_conversation(conv, user):
    links = list(conv.participant_links.select_related("user"))
    me = next((p for p in links if p.user_id == user.id), None)
    others = [p.user for p in links if p.user_id != user.id]
    last = conv.messages.select_related("sender").order_by("-created_at").first()
    title = conv.title if conv.is_group else (_name(others[0]) if others else "You")
    return {
        "id": str(conv.id),
        "title": title,
        "is_group": conv.is_group,
        "participants": [_user_brief(p.user) for p in links],
        "other_user": _user_brief(others[0]) if (others and not conv.is_group) else None,
        "last_message": ({
            "id": str(last.id), "body": last.body, "sender": str(last.sender_id) if last.sender_id else None,
            "sender_name": _name(last.sender), "created_at": last.created_at,
        } if last else None),
        "unread_count": _unread_for(conv, me) if me else 0,
        "updated_at": conv.updated_at,
    }


def serialize_message(m, user):
    return {
        "id": str(m.id), "conversation": str(m.conversation_id),
        "sender": str(m.sender_id) if m.sender_id else None, "sender_name": _name(m.sender),
        "body": m.body, "created_at": m.created_at, "is_mine": m.sender_id == user.id,
    }


class ConversationViewSet(viewsets.ViewSet):
    """Only participants can see or post in a conversation."""

    permission_classes = [IsAuthenticated]

    def _mine(self, request):
        return Conversation.objects.filter(participants=request.user)

    def list(self, request):
        convs = self._mine(request).order_by("-updated_at")
        return Response([serialize_conversation(c, request.user) for c in convs])

    def retrieve(self, request, pk=None):
        conv = get_object_or_404(self._mine(request), pk=pk)
        return Response(serialize_conversation(conv, request.user))

    def create(self, request):
        """Start (or reopen) a direct chat: {"user_id": "<uuid>"}.
        Or a group: {"user_ids": [...], "title": "Shift team"}."""
        ids = request.data.get("user_ids")
        if ids:
            users = list(User.objects.filter(pk__in=ids, is_active=True).exclude(pk=request.user.pk))
            if not users:
                raise ValidationError({"user_ids": "Pick at least one other staff member."})
            conv = Conversation.objects.create(is_group=True, title=(request.data.get("title") or "Group chat")[:150])
            for u in [request.user, *users]:
                ConversationParticipant.objects.create(conversation=conv, user=u)
            return Response(serialize_conversation(conv, request.user), status=201)

        uid = request.data.get("user_id")
        if not uid:
            raise ValidationError({"user_id": "This field is required."})
        try:
            other = User.objects.get(pk=uid, is_active=True)
        except (User.DoesNotExist, ValueError, Exception):
            raise ValidationError({"user_id": "User not found."})
        if other.pk == request.user.pk:
            raise ValidationError({"user_id": "You cannot message yourself."})

        conv = (Conversation.objects.filter(is_group=False, participants=request.user)
                .filter(participants=other).first())
        created = conv is None
        if created:
            conv = Conversation.objects.create(is_group=False)
            for u in (request.user, other):
                ConversationParticipant.objects.create(conversation=conv, user=u)
        return Response(serialize_conversation(conv, request.user), status=201 if created else 200)

    @action(detail=True, methods=["get", "post"], url_path="messages")
    def messages(self, request, pk=None):
        conv = get_object_or_404(self._mine(request), pk=pk)

        if request.method == "POST":
            body = (request.data.get("body") or request.data.get("text") or "").strip()
            if not body:
                raise ValidationError({"body": "Message cannot be empty."})
            if len(body) > 4000:
                raise ValidationError({"body": "Message is too long (max 4000 characters)."})
            msg = Message.objects.create(conversation=conv, sender=request.user, body=body)
            conv.save(update_fields=["updated_at"])  # bumps it to the top of the list
            ConversationParticipant.objects.filter(conversation=conv, user=request.user)\
                .update(last_read_at=msg.created_at)
            return Response(serialize_message(msg, request.user), status=201)

        qs = conv.messages.select_related("sender")
        after = request.query_params.get("after")  # ISO timestamp, handy for polling
        if after:
            qs = qs.filter(created_at__gt=after)
        msgs = list(qs.order_by("-created_at")[:200])[::-1]
        return Response([serialize_message(m, request.user) for m in msgs])

    @action(detail=True, methods=["post"])
    def read(self, request, pk=None):
        conv = get_object_or_404(self._mine(request), pk=pk)
        ConversationParticipant.objects.filter(conversation=conv, user=request.user)\
            .update(last_read_at=timezone.now())
        return Response({"detail": "Marked as read."})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def unread_message_count(request):
    total = 0
    for p in ConversationParticipant.objects.filter(user=request.user).select_related("conversation"):
        total += _unread_for(p.conversation, p)
    return Response({"unread_count": total})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def chat_users(request):
    """Staff directory for starting a chat (active users except yourself)."""
    qs = User.objects.filter(is_active=True).exclude(pk=request.user.pk).order_by("first_name", "username")
    s = (request.query_params.get("search") or "").strip()
    if s:
        qs = qs.filter(Q(username__icontains=s) | Q(first_name__icontains=s) | Q(last_name__icontains=s))
    return Response([_user_brief(u) for u in qs])