# Add these to medicore_pos/settings.py
#
# pip install django djangorestframework djangorestframework-simplejwt django-cors-headers pillow "qrcode[pil]"

from datetime import timedelta

INSTALLED_APPS += [
    "rest_framework",
    "rest_framework_simplejwt",
    "rest_framework_simplejwt.token_blacklist",  # optional: lets logout invalidate refresh tokens
    "corsheaders",
    "api",
]

MIDDLEWARE.insert(0, "corsheaders.middleware.CorsMiddleware")

AUTH_USER_MODEL = "api.User"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework_simplejwt.authentication.JWTAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(hours=1),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": False,
}

CORS_ALLOWED_ORIGINS = ["http://localhost:5173"]  # Vite dev server

MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

# Shop name/address/phone/footer are edited in the app (Settings page) and stored in the
# database. Subscription plan prices are placeholders - override them here if you like:
# POS_PLANS = [{"code": "BASIC", "name": "Basic", "price_per_month": 1500, "features": [...]},
#              {"code": "PRO",   "name": "Pro",   "price_per_month": 3500, "features": [...]}]
