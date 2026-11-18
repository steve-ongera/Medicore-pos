# api/management/commands/bootstrap_saas.py
"""
python manage.py bootstrap_saas [--shop-name "Medicore Pharmacy"]

1. Seeds the bundle catalogue (PLACEHOLDER prices - edit in the admin).
   The free trial is 1 day and 5 sales. Re-running this command re-syncs every bundle
   listed in BUNDLES to the database (update_or_create on `code`).
2. Creates Shop #1 from your existing single-shop data and attaches every existing row to it.
3. Converts the old single-row Subscription into a BundlePurchase.
Run it while TENANCY_BACKFILL=True (shop columns still nullable). Safe to re-run.

Note: purchases store a snapshot of the bundle at purchase time, so changing the catalogue
here never alters trials or bundles that shops already hold. It only affects new purchases.
"""
from django.apps import apps
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone
from django.utils.text import slugify

from api.models import ShopSettings, Subscription, User
from api.models import Bundle, BundlePurchase, PurchaseSource, PurchaseStatus, Shop
from api.tenancy import platform_context

BUNDLES = [
    dict(code="TRIAL", name="Poa Trial", description="1-day free trial (5 sales, 5 medicines)", price=0,
         validity_days=1, sales_allowance=5, max_users=2, max_products=5, features=["full_reports"],
         is_trial=True, sort_order=0),
    dict(code="SIKU", name="Siku", description="Daily bundle", price=50, validity_days=1,
         sales_allowance=100, max_users=2, max_products=500, features=[], sort_order=10),
    dict(code="WIKI", name="Wiki", description="Weekly bundle", price=250, validity_days=7,
         sales_allowance=800, max_users=3, max_products=1000, features=[], sort_order=20),
    dict(code="BASIC", name="Mwezi", description="Monthly, unlimited sales", price=1000, validity_days=30,
         sales_allowance=None, max_users=5, max_products=2000, features=[], sort_order=30),
    dict(code="PRO", name="Mwezi Plus", description="Monthly, everything", price=2500, validity_days=30,
         sales_allowance=None, max_users=None, max_products=None, features=["full_reports"], sort_order=40),
]


class Command(BaseCommand):
    help = "Seed bundles and migrate the existing single-shop data into Shop #1."

    def add_arguments(self, parser):
        parser.add_argument("--shop-name", default="")

    @transaction.atomic
    def handle(self, *args, **opts):
        with platform_context():
            for b in BUNDLES:
                Bundle.objects.update_or_create(code=b["code"], defaults=b)
            self.stdout.write(self.style.SUCCESS(f"Seeded {len(BUNDLES)} bundles."))

            shop = Shop.objects.order_by("created_at").first()
            if shop is None:
                legacy = ShopSettings._base_manager.filter(shop__isnull=True).first()
                name = opts["shop_name"] or (legacy.name if legacy else "Medicore Pharmacy")
                shop = Shop.objects.create(name=name, slug=slugify(name)[:50] or "shop",
                                           email=getattr(legacy, "email", ""), phone=getattr(legacy, "phone", ""))
                self.stdout.write(f"Created shop: {shop.name}")

            for model in apps.get_app_config("api").get_models():
                if model in (Shop, Bundle) or not any(f.name == "shop" for f in model._meta.get_fields()):
                    continue
                qs = model._base_manager.filter(shop__isnull=True)
                if model is User:
                    qs = qs.filter(is_superuser=False)  # platform staff stay shop-less
                n = qs.update(shop=shop)
                if n:
                    self.stdout.write(f"  {model.__name__}: attached {n} rows")

            legacy_sub = Subscription._base_manager.filter(pk=1).first()
            if legacy_sub and not BundlePurchase.unscoped.filter(shop=shop).exists():
                bundle = Bundle.objects.filter(code=legacy_sub.plan).first() or Bundle.objects.get(code="TRIAL")
                alive = legacy_sub.expires_at > timezone.now()
                BundlePurchase.unscoped.create(
                    shop=shop, bundle=bundle, source=PurchaseSource.ADMIN,
                    status=PurchaseStatus.ACTIVE if alive else PurchaseStatus.EXPIRED,
                    starts_at=legacy_sub.started_at, expires_at=legacy_sub.expires_at,
                    sales_allowance_total=bundle.sales_allowance,
                )
                self.stdout.write("Converted legacy Subscription into a BundlePurchase.")
        self.stdout.write(self.style.SUCCESS("Done. Now set TENANCY_BACKFILL=False and run makemigrations/migrate."))