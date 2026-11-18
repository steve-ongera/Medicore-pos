# api/admin.py  -  the PLATFORM console (you, not your customers)
# Only superusers with NO shop can use it meaningfully (TenancyMiddleware enables platform mode for them).
# Never give shop users is_staff / is_superuser.
from django.contrib import admin, messages
from django.db import transaction

from api import entitlements
from api.models import (
    Bundle, BundlePurchase, MpesaPayment, PurchaseSource, Shop, SubscriptionRequest, WalletTransaction,
)


class ReadOnly(admin.ModelAdmin):
    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(Shop)
class ShopAdmin(admin.ModelAdmin):
    list_display = ("name", "status", "wallet_balance", "phone", "created_at")
    list_filter = ("status",)
    search_fields = ("name", "email", "phone", "slug")
    readonly_fields = ("wallet_balance", "created_at")
    actions = ["suspend", "activate", "grant_basic_month", "run_billing_now"]

    @admin.action(description="Suspend selected shops (blocks all API access)")
    def suspend(self, request, qs):
        qs.update(status="SUSPENDED")

    @admin.action(description="Re-activate selected shops")
    def activate(self, request, qs):
        qs.update(status="ACTIVE")

    # Both actions below go through api.entitlements, the single place that owns bundle rules.
    @admin.action(description="Grant one free month of the BASIC bundle (goodwill / support)")
    def grant_basic_month(self, request, qs):
        bundle = Bundle.objects.filter(code="BASIC", is_active=True).first()
        if not bundle:
            self.message_user(request, "BASIC bundle not found. Run bootstrap_saas first.", messages.ERROR)
            return
        for shop in qs:
            entitlements.buy_bundle(shop, bundle, source=PurchaseSource.ADMIN, quantity=1)
        self.message_user(request, f"Granted {bundle.name} to {qs.count()} shop(s).")

    @admin.action(description="Run the billing cycle now (auto-renew, mark expired, send reminders)")
    def run_billing_now(self, request, qs):
        self.message_user(request, f"Billing cycle: {entitlements.run_billing_cycle()}")


@admin.register(Bundle)
class BundleAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "price", "validity_days", "sales_allowance", "max_users", "is_trial", "is_active")
    list_editable = ("is_active",)


@admin.register(BundlePurchase)
class BundlePurchaseAdmin(ReadOnly):
    list_display = ("shop", "bundle", "status", "source", "expires_at", "sales_used", "sales_allowance_total")
    list_filter = ("status", "source", "bundle")


@admin.register(WalletTransaction)
class WalletTransactionAdmin(ReadOnly):
    list_display = ("shop", "kind", "amount", "balance_after", "reference", "created_at")
    list_filter = ("kind",)
    search_fields = ("reference", "note")


@admin.register(MpesaPayment)
class MpesaPaymentAdmin(ReadOnly):
    list_display = ("shop", "phone", "amount", "status", "mpesa_receipt", "created_at")
    list_filter = ("status",)


@admin.register(SubscriptionRequest)
class SubscriptionRequestAdmin(admin.ModelAdmin):
    list_display = ("shop", "plan", "months", "amount", "mpesa_reference", "status", "created_at")
    list_filter = ("status", "plan")
    search_fields = ("mpesa_reference", "phone")
    readonly_fields = ("shop", "plan", "months", "amount", "phone", "mpesa_reference", "requested_by")
    actions = ["approve", "reject"]

    @admin.action(description="Approve: check the M-Pesa code first, then activate the bundle")
    def approve(self, request, qs):
        for r in qs.filter(status="PENDING"):
            bundle = Bundle.objects.filter(code=r.plan, is_active=True).first()
            if not bundle:
                self.message_user(request, f"{r.mpesa_reference}: unknown bundle {r.plan}", messages.ERROR)
                continue
            dup = (SubscriptionRequest.objects.filter(mpesa_reference__iexact=r.mpesa_reference, status="APPROVED")
                   .exclude(pk=r.pk).exists())
            if dup:
                self.message_user(request, f"{r.mpesa_reference}: code already approved elsewhere", messages.ERROR)
                continue
            with transaction.atomic():
                entitlements.buy_bundle(r.shop, bundle, source=PurchaseSource.MPESA_MANUAL, quantity=r.months)
                r.status = "APPROVED"
                r.save(update_fields=["status", "updated_at"])

    @admin.action(description="Reject selected requests")
    def reject(self, request, qs):
        for r in qs.filter(status="PENDING"):
            r.status = "REJECTED"
            r.save(update_fields=["status", "updated_at"])