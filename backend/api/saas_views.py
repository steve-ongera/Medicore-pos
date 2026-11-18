# api/saas_views.py
"""
SaaS endpoints. `subscription_view` keeps the SAME response keys your Subscriptions page
already reads (plan, plan_label, started_at, expires_at, is_active, days_left, plans, requests)
and adds new ones (wallet_balance, sales_remaining, limits, features, bundles), so the existing
frontend keeps working and can adopt the new fields at its own pace.
"""
import base64
import hmac
import re
import secrets
from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.contrib.auth import get_user_model, password_validation
from django.db import transaction
from django.utils import timezone
from django.utils.text import slugify
from rest_framework import serializers, status
from rest_framework.decorators import api_view, authentication_classes, permission_classes, throttle_classes
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework_simplejwt.tokens import RefreshToken

from api import entitlements
from api.models import Role, ShopSettings, SubscriptionRequest
from api.saas_models import Bundle, MpesaPayment, PaymentStatus, Shop, WalletTransaction
from api.serializers import SubscriptionRequestSerializer, UserSerializer
from api.tenancy import platform_context, tenant_context

User = get_user_model()


class LoginThrottle(AnonRateThrottle):
    scope = "login"


class RegisterThrottle(AnonRateThrottle):
    scope = "register"


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


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def topup_view(request):
    _owner_only(request)
    phone = _msisdn(request.data.get("phone"))
    try:
        amount = Decimal(str(request.data.get("amount")))
    except InvalidOperation:
        amount = Decimal("-1")
    if amount != amount.to_integral_value() or not (10 <= amount <= 150000):
        raise ValidationError({"amount": "Enter a whole amount between 10 and 150,000."})
    try:
        data = _stk_push(phone, amount, reference="MEDICORE")
    except Exception:
        return Response({"detail": "Could not reach M-Pesa. Please try again."}, status=status.HTTP_502_BAD_GATEWAY)
    MpesaPayment.unscoped.create(
        shop=request.user.shop, checkout_request_id=data["CheckoutRequestID"],
        merchant_request_id=data.get("MerchantRequestID", ""), phone=phone, amount=amount,
    )
    return Response({"detail": "Check your phone and enter your M-Pesa PIN.",
                     "checkout_request_id": data["CheckoutRequestID"]}, status=status.HTTP_202_ACCEPTED)


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
        entitlements.credit_wallet(Shop.objects.get(pk=pay.shop_id), paid, reference=f"MPESA:{receipt}",
                                   note="M-Pesa top-up")
    return Response(ok)


# ---------------------------------------------------------------------------
# Self-service registration: Shop + owner + settings + free trial, atomically.
# ---------------------------------------------------------------------------
class RegisterSerializer(serializers.Serializer):
    shop_name = serializers.CharField(max_length=150)
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(write_only=True)
    first_name = serializers.CharField(max_length=150, required=False, allow_blank=True, default="")
    email = serializers.EmailField(required=False, allow_blank=True, default="")
    phone = serializers.CharField(max_length=20, required=False, allow_blank=True, default="")

    def validate_password(self, value):
        password_validation.validate_password(value)
        return value


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
            ShopSettings.objects.create(shop=shop, name=d["shop_name"], phone=d["phone"], email=d["email"])
        entitlements.start_trial(shop)
    refresh = RefreshToken.for_user(user)
    return Response({"access": str(refresh.access_token), "refresh": str(refresh),
                     "user": UserSerializer(user).data}, status=status.HTTP_201_CREATED)