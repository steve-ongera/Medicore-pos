# api/tests/test_saas.py  (create api/tests/__init__.py too)
# Run: python manage.py test api.tests.test_saas
# These use the real JWT login so the tenant + subscription gate are exercised exactly as in production.
# If your sale-number / QR helpers need tweaks for tests, adjust the sale payload below.
from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api import entitlements
from api.models import Medicine, MedicineBatch, Role, User
from api.models import Bundle, BundlePurchase, PurchaseSource, Shop
from api.tenancy import tenant_context

PW = "S3cure-pass-123"


def make_shop(name, username, bundle, **bundle_kwargs):
    shop = Shop.objects.create(name=name, slug=name.lower().replace(" ", "-"))
    owner = User.objects.create_user(username=username, password=PW, role=Role.SUPER_ADMIN, shop=shop)
    with tenant_context(shop):
        med = Medicine.objects.create(name=f"{name} Paracetamol", unit_price=10)
        MedicineBatch.objects.create(medicine=med, batch_number="B1", quantity_received=50,
                                     quantity_remaining=50, expiry_date=timezone.now().date() + timedelta(days=300))
    if bundle:
        entitlements.buy_bundle(shop, bundle, source=PurchaseSource.ADMIN)
    return shop, owner, med


def client_for(username):
    c = APIClient()
    r = c.post("/api/auth/login/", {"username": username, "password": PW}, format="json")
    assert r.status_code == 200, r.content
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {r.data['access']}")
    return c


class SaasTests(TestCase):
    def setUp(self):
        self.big = Bundle.objects.create(code="BIG", name="Big", price=1000, validity_days=30,
                                         sales_allowance=None, max_users=5, max_products=None)
        self.tiny = Bundle.objects.create(code="TINY", name="Tiny", price=50, validity_days=1,
                                          sales_allowance=2, max_users=1, max_products=None)
        self.a, self.a_owner, self.a_med = make_shop("Shop A", "owner_a", self.big)
        self.b, self.b_owner, self.b_med = make_shop("Shop B", "owner_b", self.big)

    def sale(self, client, med):
        return client.post("/api/otc-sales/", {"payment_method": "CASH",
                           "items": [{"medicine": str(med.id), "quantity": 1}]}, format="json")

    # ---- isolation -------------------------------------------------------
    def test_lists_only_own_medicines(self):
        r = client_for("owner_a").get("/api/medicines/")
        names = [m["name"] for m in (r.data["results"] if isinstance(r.data, dict) else r.data)]
        self.assertEqual(names, ["Shop A Paracetamol"])

    def test_cannot_read_or_edit_other_shops_medicine(self):
        c = client_for("owner_a")
        self.assertEqual(c.get(f"/api/medicines/{self.b_med.id}/").status_code, 404)
        self.assertEqual(c.patch(f"/api/medicines/{self.b_med.id}/", {"unit_price": "1"}, format="json").status_code, 404)

    def test_cannot_sell_other_shops_medicine(self):
        r = self.sale(client_for("owner_a"), self.b_med)
        self.assertEqual(r.status_code, 400)  # not a valid choice in this tenant

    # ---- bundle rules ----------------------------------------------------
    def test_sales_credits_run_out(self):
        shop, _, med = make_shop("Shop C", "owner_c", self.tiny)
        c = client_for("owner_c")
        self.assertEqual(self.sale(c, med).status_code, 201)
        self.assertEqual(self.sale(c, med).status_code, 201)
        r = self.sale(c, med)
        self.assertEqual(r.status_code, 402)
        self.assertEqual(r.data["detail"].code, "credits_exhausted")

    def test_expired_shop_is_read_only(self):
        shop, _, med = make_shop("Shop D", "owner_d", None)
        BundlePurchase.unscoped.create(shop=shop, bundle=self.big, source=PurchaseSource.ADMIN,
                                       starts_at=timezone.now() - timedelta(days=40),
                                       expires_at=timezone.now() - timedelta(days=10))
        c = client_for("owner_d")
        self.assertEqual(c.get("/api/medicines/").status_code, 200)  # history stays visible
        self.assertEqual(self.sale(c, med).status_code, 402)  # writes blocked
        self.assertEqual(c.get("/api/subscription/").status_code, 200)  # can still go and pay

    def test_seat_limit(self):
        shop, _, _ = make_shop("Shop E", "owner_e", self.tiny)  # max_users=1, owner already counts
        r = client_for("owner_e").post("/api/users/", {"username": "cashier1", "password": PW,
                                                       "role": Role.CASHIER}, format="json")
        self.assertEqual(r.status_code, 402)

    def test_suspended_shop_blocked(self):
        self.a.status = "SUSPENDED"
        self.a.save()
        self.assertEqual(client_for("owner_a").get("/api/medicines/").status_code, 403)

    def test_credits_consumed_earliest_expiry_first(self):
        shop, _, _ = make_shop("Shop F", "owner_f", None)
        now = timezone.now()
        late = BundlePurchase.unscoped.create(shop=shop, bundle=self.tiny, source=PurchaseSource.ADMIN, starts_at=now,
                                              expires_at=now + timedelta(days=9), sales_allowance_total=5)
        early = BundlePurchase.unscoped.create(shop=shop, bundle=self.tiny, source=PurchaseSource.ADMIN, starts_at=now,
                                               expires_at=now + timedelta(days=1), sales_allowance_total=5)
        entitlements.consume_sale(shop)
        early.refresh_from_db()
        late.refresh_from_db()
        self.assertEqual((early.sales_used, late.sales_used), (1, 0))

    def test_wallet_credit_is_idempotent(self):
        entitlements.credit_wallet(self.a, 500, reference="MPESA:ABC123")
        entitlements.credit_wallet(self.a, 500, reference="MPESA:ABC123")
        self.a.refresh_from_db()
        self.assertEqual(self.a.wallet_balance, 500)