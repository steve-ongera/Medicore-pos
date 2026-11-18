# api/entitlements.py
"""
Everything that decides "what is this shop allowed to do right now" lives here.
Views call these functions; they never re-implement the rules.
"""
from dataclasses import dataclass, field
from datetime import timedelta
from decimal import Decimal
from typing import Optional

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import APIException

from api.models import (
    Bundle, BundlePurchase, PurchaseSource, PurchaseStatus, Shop, WalletTransaction,
)
from api.tenancy import platform_context, tenant_context


# ---------------------------------------------------------------------------
# Errors: all HTTP 402 so the UI can show "buy a bundle". The frontend already
# displays response.detail, so no frontend change is needed.
# ---------------------------------------------------------------------------
class _PaymentRequired(APIException):
    status_code = 402


class SubscriptionRequired(_PaymentRequired):
    default_detail = "Your bundle has expired. Buy a bundle to continue selling."
    default_code = "subscription_required"


class CreditsExhausted(_PaymentRequired):
    default_detail = "You have used all your sales credits. Buy a bundle to continue."
    default_code = "credits_exhausted"


class LimitReached(_PaymentRequired):
    default_detail = "Your bundle limit has been reached."
    default_code = "limit_reached"


class FeatureLocked(_PaymentRequired):
    default_detail = "This feature is not in your bundle."
    default_code = "feature_locked"


class InsufficientBalance(_PaymentRequired):
    default_detail = "Insufficient wallet balance. Top up with M-Pesa first."
    default_code = "insufficient_balance"


# ---------------------------------------------------------------------------
# Reading entitlements
# ---------------------------------------------------------------------------
@dataclass
class Entitlements:
    is_active: bool = False
    expires_at: Optional[object] = None
    days_left: int = 0
    sales_unlimited: bool = False
    sales_remaining: int = 0
    max_users: Optional[int] = 0  # None = unlimited
    max_products: Optional[int] = 0
    features: set = field(default_factory=set)


def active_purchases(shop, lock=False):
    now = timezone.now()
    qs = (
        BundlePurchase.unscoped.filter(
            shop=shop, status=PurchaseStatus.ACTIVE, starts_at__lte=now, expires_at__gt=now
        )
        .select_related("bundle")
        .order_by("expires_at")
    )
    return qs.select_for_update(of=("self",)) if lock else qs


def snapshot(shop) -> Entitlements:
    purchases = list(active_purchases(shop))
    if not purchases:
        return Entitlements()

    def cap(attr):
        values = [getattr(p.bundle, attr) for p in purchases]
        return None if any(v is None for v in values) else max(values)  # bundles stack: best limit wins

    expires = max(p.expires_at for p in purchases)
    return Entitlements(
        is_active=True,
        expires_at=expires,
        days_left=max((expires - timezone.now()).days, 0),
        sales_unlimited=any(p.sales_allowance_total is None for p in purchases),
        sales_remaining=sum(p.sales_remaining or 0 for p in purchases if p.sales_allowance_total is not None),
        max_users=cap("max_users"),
        max_products=cap("max_products"),
        features=set().union(*[set(p.bundle.features or []) for p in purchases]),
    )


# ---------------------------------------------------------------------------
# Enforcement (call these from views; always server-side)
# ---------------------------------------------------------------------------
def consume_sale(shop, n=1):
    """Spend sales credits, earliest-expiring bundle first. Call INSIDE the sale's transaction."""
    with transaction.atomic():
        purchases = list(active_purchases(shop, lock=True))
        if not purchases:
            raise SubscriptionRequired()
        if any(p.sales_allowance_total is None for p in purchases):
            return  # unlimited bundle active
        for p in purchases:  # already ordered by expires_at
            if p.sales_remaining >= n:
                p.sales_used += n
                p.save(update_fields=["sales_used"])
                return
        raise CreditsExhausted()


def enforce_limit(shop, resource, current_count):
    """resource: 'users' or 'products'. Raises when adding one more would exceed the cap."""
    cap = getattr(snapshot(shop), f"max_{resource}")
    if cap is not None and current_count >= cap:
        raise LimitReached(f"Your bundle allows {cap} {resource}. Buy a bigger bundle to add more.")


def require_feature(shop, feature):
    if feature not in snapshot(shop).features:
        raise FeatureLocked(f"'{feature}' is not in your current bundle. Upgrade to unlock it.")


# ---------------------------------------------------------------------------
# Money: wallet + purchases (all under a row lock on the shop)
# ---------------------------------------------------------------------------
def _post(shop, amount, kind, *, reference=None, note="", user=None):
    shop.wallet_balance = shop.wallet_balance + Decimal(amount)
    shop.save(update_fields=["wallet_balance"])
    return WalletTransaction.unscoped.create(
        shop=shop, kind=kind, amount=amount, balance_after=shop.wallet_balance,
        reference=reference, note=note, created_by=user,
    )


@transaction.atomic
def credit_wallet(shop, amount, reference, note=""):
    """Idempotent: the same `reference` (e.g. an M-Pesa receipt) can only ever credit once."""
    shop = Shop.objects.select_for_update().get(pk=shop.pk)
    if WalletTransaction.unscoped.filter(reference=reference).exists():
        return None
    return _post(shop, Decimal(amount), "TOPUP", reference=reference, note=note)


@transaction.atomic
def buy_bundle(shop, bundle, *, source=PurchaseSource.WALLET, quantity=1, auto_renew=False, user=None):
    """`quantity` months/weeks/days multiplies validity AND allowance (buy 3 -> 3x of both)."""
    shop = Shop.objects.select_for_update().get(pk=shop.pk)
    if not bundle.is_active:
        raise InsufficientBalance("That bundle is no longer on sale.")
    cost = Decimal(bundle.price) * quantity
    if source == PurchaseSource.WALLET:
        if shop.wallet_balance < cost:
            raise InsufficientBalance()
        _post(shop, -cost, "BUNDLE", note=f"{bundle.name} x{quantity}", user=user)
    now = timezone.now()
    return BundlePurchase.unscoped.create(
        shop=shop, bundle=bundle, source=source, starts_at=now,
        expires_at=now + timedelta(days=bundle.validity_days * quantity),
        sales_allowance_total=None if bundle.sales_allowance is None else bundle.sales_allowance * quantity,
        price_paid=0 if source == PurchaseSource.TRIAL else cost,
        auto_renew=auto_renew,
    )


def start_trial(shop):
    bundle = Bundle.objects.filter(is_trial=True, is_active=True).first()
    if not bundle or BundlePurchase.unscoped.filter(shop=shop, source=PurchaseSource.TRIAL).exists():
        return None
    return buy_bundle(shop, bundle, source=PurchaseSource.TRIAL)


# ---------------------------------------------------------------------------
# Scheduled housekeeping (cron every 5-15 minutes, or a Celery beat task):
#   python manage.py shell -c "from api.entitlements import run_billing_cycle; print(run_billing_cycle())"
# Access is decided by timestamps at request time, so this is NOT what blocks an expired shop;
# it only auto-renews, marks rows EXPIRED and sends reminders.
# ---------------------------------------------------------------------------
def _notify_owners(shop, title, message, dedupe_key):
    from api.models import Notification, Role, User  # lazy: avoids import cycle

    with tenant_context(shop):
        if Notification.objects.filter(dedupe_key=dedupe_key).exists():
            return
        for owner in User.objects.filter(role=Role.SUPER_ADMIN, is_active=True):
            Notification.objects.create(
                recipient=owner, title=title, message=message, link="/subscriptions",
                priority="HIGH", dedupe_key=dedupe_key,
            )


def run_billing_cycle():
    now = timezone.now()
    renewed = expired = reminded = 0
    with platform_context():
        due = BundlePurchase.unscoped.filter(status=PurchaseStatus.ACTIVE, expires_at__lte=now).select_related("bundle")
        for p in list(due):
            shop = Shop.objects.get(pk=p.shop_id)
            if p.auto_renew and p.bundle.is_active and not p.bundle.is_trial:
                try:
                    buy_bundle(shop, p.bundle, auto_renew=True)
                    renewed += 1
                except InsufficientBalance:
                    _notify_owners(shop, "Bundle expired",
                                   "Top up your wallet and buy a bundle to keep selling.", f"expired:{p.pk}")
            p.status, p.auto_renew = PurchaseStatus.EXPIRED, False
            p.save(update_fields=["status", "auto_renew"])
            expired += 1

        soon = BundlePurchase.unscoped.filter(
            status=PurchaseStatus.ACTIVE, auto_renew=False, bundle__validity_days__gte=7,
            expires_at__gt=now, expires_at__lte=now + timedelta(days=3),
        ).select_related("bundle")
        for p in list(soon):
            shop = Shop.objects.get(pk=p.shop_id)
            _notify_owners(shop, "Bundle expiring soon",
                           f"{p.bundle.name} expires on {p.expires_at:%d %b %H:%M}. Buy again to avoid interruption.",
                           f"expiring:{p.pk}")
            reminded += 1
    return {"renewed": renewed, "expired": expired, "reminded": reminded}