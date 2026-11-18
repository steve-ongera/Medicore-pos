# api/tenancy.py
"""
Multi-tenancy core for Medicore POS.

Model: shared database, shared schema, a `shop` foreign key on every tenant row.

THE RULES THAT MAKE THIS SAFE
  1. The tenant is NEVER taken from the request body, URL or headers. It is read from the
     authenticated user's own row (user.shop) and held in a ContextVar for one request.
  2. Every tenant model's default manager filters by that shop.
  3. FAIL CLOSED: with no tenant and no explicit platform mode, managers return NOTHING.
  4. Writes are stamped with the current shop, and a write for a different shop raises.
  5. Only code that deliberately uses `platform_context()`, `.unscoped` or `_base_manager`
     (login, registration, billing jobs, Django admin) can see across shops.
"""
import contextvars
from contextlib import contextmanager

from django.conf import settings
from django.contrib.auth.models import UserManager
from django.db import models

from api.managers import AllObjectsManager, SoftDeleteManager

_current_shop = contextvars.ContextVar("current_shop", default=None)
_platform_mode = contextvars.ContextVar("platform_mode", default=False)


class TenantError(RuntimeError):
    """A tenant row was written with no tenant, or for a different tenant."""


def get_current_shop():
    return _current_shop.get()


def set_current_shop(shop):
    _current_shop.set(shop)


def set_platform_mode(on):
    _platform_mode.set(bool(on))


def reset_tenancy():
    _current_shop.set(None)
    _platform_mode.set(False)


@contextmanager
def tenant_context(shop):
    """Run code as one shop (background jobs, tests, onboarding)."""
    token = _current_shop.set(shop)
    try:
        yield shop
    finally:
        _current_shop.reset(token)


@contextmanager
def platform_context():
    """Cross-tenant access. Use ONLY for login, registration, billing jobs and admin."""
    token = _platform_mode.set(True)
    try:
        yield
    finally:
        _platform_mode.reset(token)


# ---------------------------------------------------------------------------
# Managers
# ---------------------------------------------------------------------------
class TenantScopeMixin:
    def get_queryset(self):
        qs = super().get_queryset()
        shop = _current_shop.get()
        if shop is not None:
            return qs.filter(shop=shop)
        if _platform_mode.get():
            return qs
        return qs.none()  # fail closed


class TenantManager(TenantScopeMixin, models.Manager):
    pass


class TenantSoftDeleteManager(TenantScopeMixin, SoftDeleteManager):
    pass


class TenantAllObjectsManager(TenantScopeMixin, AllObjectsManager):
    pass


class TenantUserManager(TenantScopeMixin, UserManager):
    pass


# ---------------------------------------------------------------------------
# Model plumbing
# ---------------------------------------------------------------------------
def shop_fk():
    """FK to the tenant. Set TENANCY_BACKFILL=True in settings ONLY while migrating existing data."""
    return models.ForeignKey(
        "api.Shop",
        on_delete=models.CASCADE,
        related_name="+",
        editable=False,
        null=getattr(settings, "TENANCY_BACKFILL", False),
    )


def stamp_shop(obj):
    """Called from save(): attach the current shop, or block a cross-tenant write."""
    current = _current_shop.get()
    if obj.shop_id is None:
        if current is None:
            raise TenantError(f"Cannot save {obj.__class__.__name__} without an active shop.")
        obj.shop = current
    elif current is not None and obj.shop_id != current.id:
        raise TenantError("Cross-tenant write blocked.")


class ShopOwned(models.Model):
    """Abstract base for billing/ledger models that are not BaseModel (no soft delete)."""

    shop = shop_fk()
    objects = TenantManager()  # scoped (default)
    unscoped = models.Manager()  # billing services / admin only

    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        stamp_shop(self)
        super().save(*args, **kwargs)