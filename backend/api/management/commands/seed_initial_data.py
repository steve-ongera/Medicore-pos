# api/management/commands/seed_initial_data.py
"""
Seeds the platform with its starting data. Safe to run repeatedly.

    python manage.py seed_initial_data                 # bundles only (needed before anyone can sign up)
    python manage.py seed_initial_data --demo          # + a demo supermarket with sample products
    python manage.py seed_initial_data --demo --password "S0meStr0ng!Pass"

Needs api/management/__init__.py and api/management/commands/__init__.py to exist.
"""
from datetime import timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from api import entitlements
from api.models import (
    Bundle, BusinessType, Product, ProductBatch, Role, Shop, ShopSettings,
    StockTransaction, StockTransactionType, User,
)
from api.tenancy import platform_context, tenant_context

# code, name, description, price (whole KES, so M-Pesa can charge it), validity_days,
# sales_allowance (None = unlimited), max_users, max_products, features, is_trial, sort_order
BUNDLES = [
    ("TRIAL", "Free trial", "1 day, 5 sales, to try the system", 0, 1, 5, 2, 50, [], True, 10),
    ("DAILY", "Daily", "A day of selling for a busy day or a pop-up", 50, 1, 50, 1, 100, [], False, 20),
    ("WEEKLY", "Weekly", "A week of selling for a small shop", 300, 7, 300, 2, 200, [], False, 30),
    ("BASIC", "Basic", "A month for a single small shop", 800, 30, 1000, 3, 300, [], False, 40),
    ("STANDARD", "Standard", "A month with full reports for a growing shop", 1500, 30, 3000, 5, 1000,
     ["full_reports"], False, 50),
    ("PRO", "Pro", "Unlimited selling, staff and products with full reports", 2400, 30, None, None, None,
     ["full_reports"], False, 60),
]

# name, category, unit, unit_price, reorder_level, sku, quantity, shelf_life_days (None = no expiry)
DEMO_PRODUCTS = [
    ("Unga Maize Flour 2kg", "Groceries", "pack", "190", 20, "GRO-001", 80, 240),
    ("Cooking Oil 1L", "Groceries", "bottle", "320", 15, "GRO-002", 60, 360),
    ("Sugar 1kg", "Groceries", "pack", "180", 20, "GRO-003", 100, 540),
    ("Fresh Milk 500ml", "Dairy", "pack", "65", 30, "DAI-001", 120, 7),
    ("Bar Soap 800g", "Household", "piece", "150", 10, "HOU-001", 50, None),
    ("Paracetamol 500mg (16s)", "Pharmacy", "pack", "40", 20, "PHA-001", 200, 720),
    ("School Exercise Book", "Stationery", "piece", "50", 25, "STA-001", 150, None),
    ("LED Bulb 9W", "Electricals", "piece", "250", 10, "ELE-001", 40, None),
]


class Command(BaseCommand):
    help = "Seed bundles, and optionally a demo shop with sample products."

    def add_arguments(self, parser):
        parser.add_argument("--demo", action="store_true", help="Also create a demo shop with sample products.")
        parser.add_argument("--password", default="ChangeMe123!", help="Password for the demo owner account.")

    def handle(self, *args, **opts):
        self.seed_bundles()
        if opts["demo"]:
            self.seed_demo(opts["password"])
        self.stdout.write(self.style.SUCCESS("Done."))

    # ------------------------------------------------------------------
    def seed_bundles(self):
        with platform_context():
            for code, name, desc, price, days, sales, users, products, features, trial, order in BUNDLES:
                _, created = Bundle.objects.update_or_create(
                    code=code,
                    defaults=dict(
                        name=name, description=desc, price=Decimal(price), validity_days=days,
                        sales_allowance=sales, max_users=users, max_products=products,
                        features=features, is_trial=trial, is_active=True, sort_order=order,
                    ),
                )
                self.stdout.write(f"  bundle {code}: {'created' if created else 'updated'}")

    # ------------------------------------------------------------------
    @transaction.atomic
    def seed_demo(self, password):
        with platform_context():
            shop, created = Shop.objects.get_or_create(
                slug="demo-shop",
                defaults=dict(name="Demo Supermarket", email="demo@example.com", phone="0712345678"),
            )
            owner = User.objects.filter(username="demo.owner").first()
            if owner is None:
                owner = User(username="demo.owner", first_name="Demo", last_name="Owner",
                             email="demo@example.com", phone="0712345678",
                             role=Role.SUPER_ADMIN, shop=shop)
                owner.set_password(password)
                owner.save()
            if created:
                entitlements.start_trial(shop)

        with tenant_context(shop):
            if not ShopSettings.objects.exists():
                ShopSettings.objects.create(
                    shop=shop, name=shop.name, phone=shop.phone, email=shop.email,
                    business_type=BusinessType.SUPERMARKET, tracks_expiry=True,
                )
            today = timezone.now().date()
            added = 0
            for name, category, unit, price, reorder, sku, qty, shelf in DEMO_PRODUCTS:
                if Product.objects.filter(sku=sku).exists():
                    continue
                product = Product.objects.create(
                    name=name, category=category, unit=unit, unit_price=Decimal(price),
                    reorder_level=reorder, sku=sku,
                )
                batch = ProductBatch.objects.create(
                    product=product, batch_number=f"SEED-{sku}",
                    quantity_received=qty, quantity_remaining=qty,
                    expiry_date=(today + timedelta(days=shelf)) if shelf else None,
                )
                StockTransaction.objects.create(
                    product=product, batch=batch, transaction_type=StockTransactionType.STOCK_IN,
                    quantity=qty, reason="Seed data", performed_by=owner,
                )
                added += 1

        self.stdout.write(f"  demo shop ready (owner: demo.owner / {password}), {added} product(s) added")