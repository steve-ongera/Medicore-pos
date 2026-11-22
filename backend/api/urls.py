# api/urls.py
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from api import views
from api.token_views import PlatformSafeTokenRefreshView

router = DefaultRouter()
router.register("users", views.UserViewSet, basename="user")
router.register("suppliers", views.SupplierViewSet, basename="supplier")
router.register("products", views.ProductViewSet, basename="product")
router.register("medicines", views.ProductViewSet, basename="medicine")  # legacy alias, keeps the frontend working
router.register("product-batches", views.ProductBatchViewSet, basename="product-batch")
router.register("medicine-batches", views.ProductBatchViewSet, basename="medicine-batch")  # legacy alias
router.register("stock-transactions", views.StockTransactionViewSet, basename="stock-transaction")
router.register("otc-sales", views.OTCSaleViewSet, basename="otc-sale")

router.register(r"notifications", views.NotificationViewSet, basename="notification")
router.register(r"conversations", views.ConversationViewSet, basename="conversation")

urlpatterns = [
    path("auth/login/", views.login_view, name="login"),
    path("auth/logout/", views.logout_view, name="logout"),
    path("auth/refresh/", PlatformSafeTokenRefreshView.as_view(), name="token-refresh"),
    path("auth/register/", views.register_shop, name="register-shop"),
    path("auth/username-suggestions/", views.username_suggestions, name="username-suggestions"),
    path("auth/check-username/", views.check_username, name="check-username"),
    path("auth/me/", views.me_view, name="me"),
    path("auth/forgot-password/", views.forgot_password, name="forgot-password"),
    path("auth/verify-reset-code/", views.verify_reset_code, name="verify-reset-code"),
    path("auth/reset-password/", views.reset_password, name="reset-password"),
    path("business-types/", views.business_types, name="business-types"),
    path("shop/", views.shop_view, name="shop"),
    path("subscription/", views.subscription_view, name="subscription"),  # one entry only
    path("billing/wallet/", views.wallet_view, name="billing-wallet"),
    path("billing/buy-bundle/", views.buy_bundle_view, name="billing-buy-bundle"),
    path("billing/topup/", views.topup_view, name="billing-topup"),
    path("billing/mpesa/callback/<str:token>/", views.mpesa_callback, name="mpesa-callback"),
    path("billing/payment/<str:checkout_id>/", views.payment_status_view, name="billing-payment-status"),
    path("reports/summary/", views.reports_summary, name="reports-summary"),
    path("auth/change-password/", views.change_password_view, name="change-password"),
    path("dashboard/summary/", views.dashboard_summary, name="dashboard-summary"),
    path("reports/sales/", views.sales_report, name="report-sales"),
    path("reports/products/", views.product_report, name="report-products"),
    path("reports/stock/", views.stock_report, name="report-stock"),
    path("payments/summary/", views.payments_summary, name="payments-summary"),
    path("settings/shop/", views.shop_settings_view, name="shop-settings"),
    path("messages/unread-count/", views.unread_message_count),
    path("chat/users/", views.chat_users),
    path("", include(router.urls)),
]