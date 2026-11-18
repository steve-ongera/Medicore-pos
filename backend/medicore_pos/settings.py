# medicore_pos/settings.py  (SaaS-hardened)
# Required env vars in production: DJANGO_SECRET_KEY, DJANGO_ALLOWED_HOSTS, CORS_ORIGINS,
# DB_NAME / DB_USER / DB_PASSWORD (Postgres), MPESA_* , MPESA_CALLBACK_TOKEN, PUBLIC_API_URL.
# For local development set DJANGO_DEBUG=1 and the defaults below are used.
import os
from datetime import timedelta
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

# Load variables from a .env file next to manage.py (optional: `pip install python-dotenv`).
# Real environment variables always win, so production can set them in systemd/Docker instead.
try:
    from dotenv import load_dotenv

    load_dotenv(BASE_DIR / ".env")
except ImportError:
    pass

DEBUG = os.environ.get("DJANGO_DEBUG") == "1"
if DEBUG:
    SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "dev-only-insecure-key")
    ALLOWED_HOSTS = os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")
    CORS_ALLOWED_ORIGINS = os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",")
else:
    SECRET_KEY = os.environ["DJANGO_SECRET_KEY"]  # no default: refuse to start without it
    ALLOWED_HOSTS = os.environ["DJANGO_ALLOWED_HOSTS"].split(",")
    CORS_ALLOWED_ORIGINS = os.environ["CORS_ORIGINS"].split(",")

INSTALLED_APPS = [
    "django.contrib.admin", "django.contrib.auth", "django.contrib.contenttypes",
    "django.contrib.sessions", "django.contrib.messages", "django.contrib.staticfiles",
    "rest_framework", "rest_framework_simplejwt", "rest_framework_simplejwt.token_blacklist",
    "corsheaders", "api",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "api.tenant_auth.TenancyMiddleware",  # resets tenant context per request; platform mode for /admin/ only
    "django.contrib.messages.middleware.MessageMiddleware",
]

ROOT_URLCONF = "medicore_pos.urls"

TEMPLATES = [{
    "BACKEND": "django.template.backends.django.DjangoTemplates", "DIRS": [], "APP_DIRS": True,
    "OPTIONS": {"context_processors": [
        "django.template.context_processors.request",
        "django.contrib.auth.context_processors.auth",
        "django.contrib.messages.context_processors.messages"]},
}]

WSGI_APPLICATION = "medicore_pos.wsgi.application"

# Row locks (select_for_update) that protect wallet and sales credits need PostgreSQL.
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "db.sqlite3",
    }
}


STATIC_URL = "static/"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
USE_TZ = True
TIME_ZONE = "Africa/Nairobi"
AUTH_USER_MODEL = "api.User"
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["api.tenant_auth.TenantJWTAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.UserRateThrottle"],
    "DEFAULT_THROTTLE_RATES": {"user": "600/min", "anon": "30/min", "login": "10/min", "register": "5/hour"},
    "NUM_PROXIES": 1,  # number of reverse proxies (nginx) in front of Django
}
SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=30),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": True,  # api.js already stores the new refresh token
    "BLACKLIST_AFTER_ROTATION": True,
}

# Production hardening
SECURE_SSL_REDIRECT = SESSION_COOKIE_SECURE = CSRF_COOKIE_SECURE = not DEBUG
SECURE_HSTS_SECONDS = 0 if DEBUG else 31536000
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")  # behind nginx; remove if not proxied

# SaaS / M-Pesa
TENANCY_BACKFILL = False  # True ONLY while migrating existing data (rollout steps 1-3)
MPESA_ENV = os.environ.get("MPESA_ENV", "sandbox")
MPESA_CONSUMER_KEY = os.environ.get("MPESA_CONSUMER_KEY", "")
MPESA_CONSUMER_SECRET = os.environ.get("MPESA_CONSUMER_SECRET", "")
MPESA_SHORTCODE = os.environ.get("MPESA_SHORTCODE", "")
MPESA_PASSKEY = os.environ.get("MPESA_PASSKEY", "")
MPESA_CALLBACK_TOKEN = os.environ.get("MPESA_CALLBACK_TOKEN", "")
PUBLIC_API_URL = os.environ.get("PUBLIC_API_URL", "")