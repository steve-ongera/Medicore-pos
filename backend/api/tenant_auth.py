# api/tenant_auth.py
"""
Where the tenant is decided, and where an unpaid shop is stopped.

TenantJWTAuthentication runs for EVERY authenticated API call, before any view's own
permission_classes, so the subscription gate cannot be bypassed by a view that overrides
permissions (yours all do).

IMPORTANT: do not import DRF views (TokenRefreshView, generics, etc.) in this module.
DRF loads this file while building APIView, so importing views here creates a circular import.
"""
from django.conf import settings
from rest_framework import exceptions
from rest_framework.permissions import SAFE_METHODS
from rest_framework_simplejwt.authentication import JWTAuthentication

from api.tenancy import platform_context, reset_tenancy, set_current_shop, set_platform_mode

API_PREFIX = getattr(settings, "TENANT_API_PREFIX", "/api/")
ADMIN_PREFIX = getattr(settings, "TENANT_ADMIN_PREFIX", "/admin/")

# Open even when the shop has no active bundle: sign in, buy a bundle, read alerts.
# (Like topping up airtime when your balance is zero.)
ALWAYS_ALLOWED = ("auth/", "subscription/", "billing/", "notifications/")


class ShopSuspended(exceptions.PermissionDenied):
    default_detail = "This shop account is suspended. Please contact support."
    default_code = "shop_suspended"


class TenantJWTAuthentication(JWTAuthentication):
    def get_user(self, validated_token):
        # The user is looked up by the token's own id, before any tenant is known.
        with platform_context():
            return super().get_user(validated_token)

    def authenticate(self, request):
        result = super().authenticate(request)
        if result is None:
            return None
        user, token = result

        # Platform staff use /admin/, never the shop API. No shop = no API access.
        if user.shop_id is None:
            raise exceptions.PermissionDenied("This account is not linked to a shop.")
        shop = user.shop
        if shop.status != "ACTIVE":
            raise ShopSuspended()

        set_current_shop(shop)
        self._gate(request, shop)
        return user, token

    @staticmethod
    def _gate(request, shop):
        """No active bundle -> read-only. History is never hidden or deleted."""
        if request.method in SAFE_METHODS:
            return
        relative = request.path.split(API_PREFIX, 1)[-1].lstrip("/")
        if relative.startswith(ALWAYS_ALLOWED):
            return
        from api.entitlements import SubscriptionRequired, snapshot  # lazy: avoids import cycle

        if not snapshot(shop).is_active:
            raise SubscriptionRequired()


class TenancyMiddleware:
    """
    Place AFTER AuthenticationMiddleware.
    - Clears tenant state at the start and end of every request (threads are reused).
    - Enables platform mode for /admin/ only; a shop-linked user in /admin/ sees nothing.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        reset_tenancy()
        try:
            if request.path.startswith(ADMIN_PREFIX):
                set_platform_mode(True)  # needed so admin login / session user lookup can find users
                user = request.user
                if user.is_authenticated and user.shop_id is not None:
                    set_platform_mode(False)
            return self.get_response(request)
        finally:
            reset_tenancy()