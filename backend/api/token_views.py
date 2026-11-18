# api/token_views.py
from rest_framework_simplejwt.views import TokenRefreshView

from api.tenancy import platform_context


class PlatformSafeTokenRefreshView(TokenRefreshView):
    """Refresh runs before any tenant is known, so it needs platform mode to find the user."""

    def post(self, request, *args, **kwargs):
        with platform_context():
            return super().post(request, *args, **kwargs)