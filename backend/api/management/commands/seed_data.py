# api/management/commands/seed_data.py
"""
Fills the database with realistic demo data for the POS.

    python manage.py seed_data                      # 6 months of history, 1500 medicines
    python manage.py seed_data --months 9           # longer history
    python manage.py seed_data --medicines 800      # different catalogue size
    python manage.py seed_data --flush              # wipe previous demo data first
    python manage.py seed_data --seed 7             # different (but repeatable) random data

Multi-tenant: everything is created INSIDE one shop (default slug "demo-pharmacy", created if
missing), so it never touches another shop's data. --flush only wipes THAT shop's demo data.

    python manage.py seed_data --shop-slug demo-pharmacy --shop-name "Demo Pharmacy"

Creates: staff accounts (one per role, all with password "password123" unless --password is
given), shop settings, an active bundle, suppliers, medicines (core list + generated brand and
strength variants), stock batches with restocks, every stock movement in the ledger, thousands
of walk-in sales spread over the period (with discounts, M-Pesa/card/cash, a few
unpaid balances and audited corrections), and a handful of low-stock / near-expiry /
expired batches so the dashboard and reports have something to show.

Every record is dated in the past (not "now"), so charts and reports look lived-in.
Receipt QR images are not generated (they are optional).
"""
import calendar
import random
import string
from contextlib import contextmanager
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from itertools import accumulate
from math import ceil

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from api.management.commands.bootstrap_saas import BUNDLES
from api.models import (
    Bundle, BundlePurchase, Medicine, MedicineBatch, OTCSale, OTCSaleAmendment, OTCSaleItem,
    PurchaseSource, PurchaseStatus, Role, Shop, ShopSettings, StockTransaction,
    StockTransactionType, SubscriptionRequest, Supplier, User,
)
from api.tenancy import platform_context, tenant_context

# ---------------------------------------------------------------------------
# Demo catalogue:  name, generic name, category, unit, selling price (KES), popularity 1-10
# ---------------------------------------------------------------------------
MEDICINES = [
    # Pain & fever
    ("Panadol 500mg", "Paracetamol", "Pain & Fever", "tablet", 5, 10),
    ("Ibuprofen 400mg", "Ibuprofen", "Pain & Fever", "tablet", 8, 7),
    ("Diclofenac 50mg", "Diclofenac sodium", "Pain & Fever", "tablet", 10, 5),
    ("Aspirin 300mg", "Acetylsalicylic acid", "Pain & Fever", "tablet", 4, 2),
    ("Mara Moja", "Paracetamol + Caffeine", "Pain & Fever", "tablet", 6, 6),
    # Antibiotics
    ("Amoxicillin 500mg", "Amoxicillin", "Antibiotics", "capsule", 15, 8),
    ("Azithromycin 500mg", "Azithromycin", "Antibiotics", "tablet", 120, 3),
    ("Ciprofloxacin 500mg", "Ciprofloxacin", "Antibiotics", "tablet", 25, 5),
    ("Metronidazole 400mg", "Metronidazole", "Antibiotics", "tablet", 6, 7),
    ("Cotrimoxazole 480mg", "Sulfamethoxazole + Trimethoprim", "Antibiotics", "tablet", 5, 4),
    ("Doxycycline 100mg", "Doxycycline", "Antibiotics", "capsule", 12, 3),
    ("Cefuroxime 500mg", "Cefuroxime", "Antibiotics", "tablet", 90, 2),
    ("Flucloxacillin 500mg", "Flucloxacillin", "Antibiotics", "capsule", 20, 3),
    # Malaria
    ("Coartem 20/120", "Artemether + Lumefantrine", "Antimalarials", "pack", 350, 6),
    ("Quinine 300mg", "Quinine sulphate", "Antimalarials", "tablet", 20, 2),
    ("Malaria rapid test", "Malaria RDT", "Diagnostics", "kit", 150, 4),
    # Allergy, cough & cold
    ("Cetirizine 10mg", "Cetirizine", "Allergy & Cold", "tablet", 10, 6),
    ("Loratadine 10mg", "Loratadine", "Allergy & Cold", "tablet", 12, 3),
    ("Piriton 4mg", "Chlorpheniramine", "Allergy & Cold", "tablet", 2, 5),
    ("Benylin cough syrup 100ml", "Diphenhydramine", "Allergy & Cold", "bottle", 280, 4),
    ("Strepsils lozenges", "Amylmetacresol", "Allergy & Cold", "pack", 180, 5),
    ("Vicks inhaler", "Menthol", "Allergy & Cold", "piece", 120, 4),
    # Digestive
    ("ORS sachet", "Oral rehydration salts", "Digestive", "sachet", 40, 6),
    ("Omeprazole 20mg", "Omeprazole", "Digestive", "capsule", 12, 6),
    ("Gaviscon liquid 150ml", "Sodium alginate", "Digestive", "bottle", 450, 3),
    ("Buscopan 10mg", "Hyoscine butylbromide", "Digestive", "tablet", 25, 4),
    ("Loperamide 2mg", "Loperamide", "Digestive", "capsule", 15, 3),
    ("Zinc 20mg dispersible", "Zinc sulphate", "Digestive", "tablet", 10, 4),
    ("Metoclopramide 10mg", "Metoclopramide", "Digestive", "tablet", 5, 2),
    # Chronic conditions
    ("Amlodipine 5mg", "Amlodipine", "Chronic Care", "tablet", 8, 5),
    ("Metformin 500mg", "Metformin", "Chronic Care", "tablet", 6, 5),
    ("Atenolol 50mg", "Atenolol", "Chronic Care", "tablet", 6, 3),
    ("Losartan 50mg", "Losartan", "Chronic Care", "tablet", 15, 3),
    ("Glibenclamide 5mg", "Glibenclamide", "Chronic Care", "tablet", 5, 2),
    ("Atorvastatin 20mg", "Atorvastatin", "Chronic Care", "tablet", 25, 3),
    # Vitamins & supplements
    ("Vitamin C 500mg", "Ascorbic acid", "Vitamins", "tablet", 5, 6),
    ("Multivitamin 60s", "Multivitamin", "Vitamins", "bottle", 650, 3),
    ("Folic acid 5mg", "Folic acid", "Vitamins", "tablet", 2, 3),
    ("Ferrous sulphate 200mg", "Iron", "Vitamins", "tablet", 3, 3),
    ("Calcium + Vitamin D", "Calcium carbonate", "Vitamins", "bottle", 800, 2),
    # Skin & first aid
    ("Hydrocortisone cream 1%", "Hydrocortisone", "Skin & First Aid", "tube", 220, 3),
    ("Clotrimazole cream", "Clotrimazole", "Skin & First Aid", "tube", 250, 4),
    ("Povidone iodine 100ml", "Povidone iodine", "Skin & First Aid", "bottle", 200, 3),
    ("Plasters (box of 100)", "Adhesive bandage", "Skin & First Aid", "box", 150, 4),
    ("Cotton wool 100g", "Cotton wool", "Skin & First Aid", "piece", 120, 3),
    ("Crepe bandage 10cm", "Bandage", "Skin & First Aid", "piece", 100, 2),
    ("Surgical gloves (box)", "Latex gloves", "Skin & First Aid", "box", 600, 2),
    # Family health & devices
    ("Postinor-2", "Levonorgestrel", "Family Health", "pack", 250, 3),
    ("Trust condoms (3s)", "Condoms", "Family Health", "pack", 100, 6),
    ("Pregnancy test strip", "hCG test", "Family Health", "piece", 100, 4),
    ("Glucometer strips (50)", "Glucose test strips", "Devices", "pack", 1200, 2),
    ("Digital thermometer", "Thermometer", "Devices", "piece", 450, 2),
    ("Face masks (box of 50)", "Surgical mask", "Devices", "box", 300, 3),
    ("Hand sanitizer 100ml", "Alcohol gel", "Devices", "bottle", 150, 4),
]

# generic, category, unit, base price (KES), strengths/forms  -> used to generate extra variants
GENERICS = [
    ("Paracetamol", "Pain & Fever", "tablet", 5, ["500mg", "1g", "650mg"]),
    ("Ibuprofen", "Pain & Fever", "tablet", 8, ["200mg", "400mg", "600mg"]),
    ("Diclofenac", "Pain & Fever", "tablet", 10, ["25mg", "50mg", "75mg"]),
    ("Naproxen", "Pain & Fever", "tablet", 12, ["250mg", "500mg"]),
    ("Tramadol", "Pain & Fever", "capsule", 18, ["50mg", "100mg"]),
    ("Amoxicillin", "Antibiotics", "capsule", 15, ["250mg", "500mg"]),
    ("Amoxicillin + Clavulanate", "Antibiotics", "tablet", 45, ["375mg", "625mg", "1g"]),
    ("Azithromycin", "Antibiotics", "tablet", 120, ["250mg", "500mg"]),
    ("Ciprofloxacin", "Antibiotics", "tablet", 25, ["250mg", "500mg", "750mg"]),
    ("Levofloxacin", "Antibiotics", "tablet", 60, ["250mg", "500mg"]),
    ("Erythromycin", "Antibiotics", "tablet", 18, ["250mg", "500mg"]),
    ("Cefalexin", "Antibiotics", "capsule", 22, ["250mg", "500mg"]),
    ("Cefixime", "Antibiotics", "tablet", 70, ["200mg", "400mg"]),
    ("Doxycycline", "Antibiotics", "capsule", 12, ["100mg"]),
    ("Metronidazole", "Antibiotics", "tablet", 6, ["200mg", "400mg"]),
    ("Clindamycin", "Antibiotics", "capsule", 40, ["150mg", "300mg"]),
    ("Artemether + Lumefantrine", "Antimalarials", "pack", 350, ["20/120mg", "80/480mg"]),
    ("Dihydroartemisinin + Piperaquine", "Antimalarials", "pack", 400, ["40/320mg"]),
    ("Sulfadoxine + Pyrimethamine", "Antimalarials", "tablet", 30, ["500/25mg"]),
    ("Cetirizine", "Allergy & Cold", "tablet", 10, ["5mg", "10mg"]),
    ("Loratadine", "Allergy & Cold", "tablet", 12, ["10mg"]),
    ("Chlorpheniramine", "Allergy & Cold", "tablet", 2, ["4mg"]),
    ("Salbutamol", "Allergy & Cold", "tablet", 4, ["2mg", "4mg"]),
    ("Salbutamol inhaler", "Allergy & Cold", "piece", 350, ["100mcg"]),
    ("Cough syrup", "Allergy & Cold", "bottle", 220, ["100ml", "200ml"]),
    ("Throat lozenges", "Allergy & Cold", "pack", 150, ["8s", "16s"]),
    ("Omeprazole", "Digestive", "capsule", 12, ["20mg", "40mg"]),
    ("Esomeprazole", "Digestive", "tablet", 35, ["20mg", "40mg"]),
    ("Ranitidine", "Digestive", "tablet", 6, ["150mg", "300mg"]),
    ("Antacid suspension", "Digestive", "bottle", 250, ["100ml", "200ml"]),
    ("Loperamide", "Digestive", "capsule", 15, ["2mg"]),
    ("Hyoscine butylbromide", "Digestive", "tablet", 25, ["10mg"]),
    ("Domperidone", "Digestive", "tablet", 10, ["10mg"]),
    ("Albendazole", "Digestive", "tablet", 30, ["400mg"]),
    ("Mebendazole", "Digestive", "tablet", 20, ["100mg", "500mg"]),
    ("Amlodipine", "Chronic Care", "tablet", 8, ["5mg", "10mg"]),
    ("Nifedipine", "Chronic Care", "tablet", 10, ["10mg", "20mg"]),
    ("Atenolol", "Chronic Care", "tablet", 6, ["25mg", "50mg", "100mg"]),
    ("Losartan", "Chronic Care", "tablet", 15, ["50mg", "100mg"]),
    ("Enalapril", "Chronic Care", "tablet", 8, ["5mg", "10mg"]),
    ("Hydrochlorothiazide", "Chronic Care", "tablet", 5, ["25mg", "50mg"]),
    ("Furosemide", "Chronic Care", "tablet", 5, ["20mg", "40mg"]),
    ("Metformin", "Chronic Care", "tablet", 6, ["500mg", "850mg", "1000mg"]),
    ("Glibenclamide", "Chronic Care", "tablet", 5, ["2.5mg", "5mg"]),
    ("Gliclazide", "Chronic Care", "tablet", 12, ["40mg", "80mg"]),
    ("Atorvastatin", "Chronic Care", "tablet", 25, ["10mg", "20mg", "40mg"]),
    ("Simvastatin", "Chronic Care", "tablet", 15, ["10mg", "20mg", "40mg"]),
    ("Vitamin C", "Vitamins", "tablet", 5, ["250mg", "500mg", "1000mg"]),
    ("Vitamin B complex", "Vitamins", "tablet", 4, ["30s", "100s"]),
    ("Multivitamin", "Vitamins", "bottle", 650, ["30s", "60s", "100s"]),
    ("Folic acid", "Vitamins", "tablet", 2, ["1mg", "5mg"]),
    ("Ferrous sulphate", "Vitamins", "tablet", 3, ["200mg"]),
    ("Zinc sulphate", "Vitamins", "tablet", 10, ["20mg"]),
    ("Calcium + Vitamin D", "Vitamins", "bottle", 800, ["30s", "60s"]),
    ("Hydrocortisone cream", "Skin & First Aid", "tube", 220, ["1%", "2.5%"]),
    ("Clotrimazole cream", "Skin & First Aid", "tube", 250, ["1%"]),
    ("Betamethasone cream", "Skin & First Aid", "tube", 260, ["0.1%"]),
    ("Gentamicin eye drops", "Skin & First Aid", "bottle", 180, ["0.3%"]),
    ("Povidone iodine", "Skin & First Aid", "bottle", 200, ["100ml", "500ml"]),
    ("Crepe bandage", "Skin & First Aid", "piece", 100, ["5cm", "7.5cm", "10cm", "15cm"]),
    ("Surgical gloves", "Skin & First Aid", "box", 600, ["Small", "Medium", "Large"]),
    ("Pregnancy test", "Family Health", "piece", 100, ["Strip", "Midstream"]),
    ("Condoms", "Family Health", "pack", 100, ["3s", "12s"]),
    ("Combined oral contraceptive", "Family Health", "pack", 150, ["21s", "28s"]),
    ("Glucometer strips", "Devices", "pack", 1200, ["25s", "50s", "100s"]),
    ("Face masks", "Devices", "box", 300, ["Box of 50"]),
    ("Hand sanitizer", "Devices", "bottle", 150, ["100ml", "250ml", "500ml"]),
]

MAKERS = ["Cosmos", "Dawa", "Universal", "Beta Healthcare", "Cipla", "Mylan", "Strides", "Aspen",
          "Emzor", "Lords", "Glenmark", "Sun Pharma", "Hetero", "Ajanta", "Zydus", "Laborex",
          "Biodeal", "Regal", "Medivet", "Shalina"]

SUPPLIERS = [
    ("Kenya Medical Supplies Authority (KEMSA)", "0720 111 001"),
    ("Mediplus Distributors", "0721 222 002"),
    ("Pharma Wholesalers Ltd", "0722 333 003"),
    ("Dawa Kenya Limited", "0723 444 004"),
    ("Medisel Kenya", "0724 555 005"),
]

STAFF = [  # username, first, last, role
    ("admin", "Wanjiru", "Kamau", Role.SUPER_ADMIN),
    ("pharmacist", "Brian", "Otieno", Role.PHARMACIST),
    ("cashier1", "Faith", "Achieng", Role.CASHIER),
    ("cashier2", "Kevin", "Mutua", Role.CASHIER),
    ("accountant", "Grace", "Njeri", Role.ACCOUNTANT),
]

QTY_BY_UNIT = {
    "tablet": [6, 10, 12, 14, 20, 21, 30], "capsule": [6, 10, 14, 15, 21], "sachet": [1, 2, 4, 5],
    "bottle": [1, 1, 1, 2], "tube": [1, 1, 2], "box": [1, 1, 2], "pack": [1, 1, 2, 3],
    "kit": [1, 1, 2, 3, 5], "piece": [1, 1, 2],
}

FIRST = ["Mary", "John", "Peter", "Jane", "Samuel", "Esther", "David", "Lucy", "James", "Alice", "Joseph",
         "Mercy", "Daniel", "Ann", "Paul", "Rose", "Moses", "Beatrice", "Isaac", "Naomi"]
LAST = ["Mwangi", "Odhiambo", "Kiprop", "Wafula", "Njoroge", "Akinyi", "Mutiso", "Chebet", "Otieno", "Kariuki",
        "Wanjiku", "Barasa", "Ndungu", "Atieno", "Kimani", "Omondi", "Cheruiyot", "Nyaga", "Ouma", "Maina"]
AMEND_REASONS = ["Discount agreed with customer after the sale", "Price adjusted after customer complaint",
                 "Manager approved a goodwill discount"]
HOURS = list(range(8, 20))
HOUR_WEIGHTS = [3, 5, 6, 6, 5, 4, 4, 4, 5, 6, 5, 3]
AVG_LINES_PER_DAY = 50  # used to size stock levels


def months_ago(d, m):
    y, mo = divmod(d.year * 12 + d.month - 1 - m, 12)
    mo += 1
    return date(y, mo, min(d.day, calendar.monthrange(y, mo)[1]))


def money(x):
    return Decimal(x).quantize(Decimal("0.01"))


def build_catalogue(n):
    """Core medicines first (they sell most), then generated brand/strength variants up to n."""
    items = [(*m[:5], m[5] * 4) for m in MEDICINES][:n]
    seen = {m[0] for m in items}
    combos = []
    for generic, cat, unit, price, strengths in GENERICS:
        for i, strength in enumerate(strengths):
            for maker in [""] + MAKERS:
                name = f"{generic} {strength}" + (f" ({maker})" if maker else "")
                combos.append((name, generic, cat, unit, price * (1 + 0.35 * i), maker))
    random.shuffle(combos)
    for name, generic, cat, unit, price, maker in combos:
        if len(items) >= n:
            break
        if name in seen:
            continue
        seen.add(name)
        p = price * (random.uniform(0.85, 1.3) if maker else 1)
        p = int(round(p / 5) * 5) if p >= 50 else max(1, int(round(p)))
        items.append((name, generic, cat, unit, p, random.choice([0.1, 0.2, 0.3, 0.5, 0.8, 1, 1.5, 2])))
    if len(items) < n:
        raise CommandError(f"Can only generate {len(items)} medicines; add more entries to GENERICS.")
    return items


@contextmanager
def backdating():
    """Lets us write our own created_at / sold_at / received_date instead of 'now'."""
    fields = [(OTCSale, "sold_at"), (MedicineBatch, "received_date")]
    for m in (Supplier, Medicine, MedicineBatch, StockTransaction, OTCSale, OTCSaleItem,
              OTCSaleAmendment, SubscriptionRequest):
        fields.append((m, "created_at"))
    saved = []
    for model, name in fields:
        f = model._meta.get_field(name)
        saved.append((f, f.auto_now_add))
        f.auto_now_add = False
    try:
        yield
    finally:
        for f, v in saved:
            f.auto_now_add = v


class Command(BaseCommand):
    help = "Seed realistic demo data (default: 6 months of history ending today, 1500 medicines)."

    def add_arguments(self, p):
        p.add_argument("--months", type=int, default=6, help="Months of history (default 6)")
        p.add_argument("--medicines", type=int, default=1500, help="Number of medicines (default 1500)")
        p.add_argument("--flush", action="store_true", help="Delete existing sales/stock data first")
        p.add_argument("--seed", type=int, default=2026, help="Random seed (same seed = same data)")
        p.add_argument("--password", default="password123", help="Password for the demo staff accounts")
        p.add_argument("--shop-slug", default="demo-pharmacy", help="Shop to fill (created if missing)")
        p.add_argument("--shop-name", default="Medicore Pharmacy (Demo)", help="Name used when creating the shop")

    # ------------------------------------------------------------------
    def handle(self, *args, **o):
        if o["months"] < 1:
            raise CommandError("--months must be at least 1")
        if o["medicines"] < 1:
            raise CommandError("--medicines must be at least 1")
        random.seed(o["seed"])
        with platform_context():  # the shop itself is platform-level; the data below is tenant-scoped
            shop, _ = Shop.objects.get_or_create(slug=o["shop_slug"], defaults={"name": o["shop_name"]})
            for b in BUNDLES:  # make sure the bundle catalogue exists
                Bundle.objects.update_or_create(code=b["code"], defaults=b)
        with tenant_context(shop), transaction.atomic(), backdating():
            if Medicine.all_objects.exists() and not o["flush"]:
                raise CommandError(f"{shop.name} already has stock data. Re-run with --flush to replace it.")
            if o["flush"]:
                self.flush()
            self.run(shop, o["months"], o["password"], o["medicines"])

    def flush(self):
        for model in (OTCSaleAmendment, OTCSaleItem, OTCSale, StockTransaction, MedicineBatch,
                      Medicine, Supplier, SubscriptionRequest):
            model.all_objects.all().delete()
        self.stdout.write("Old demo data removed.")

    # ------------------------------------------------------------------
    def run(self, shop, months, password, n_meds):
        tz = timezone.get_current_timezone()
        now = timezone.localtime()
        today = now.date()
        start = months_ago(today, months)
        aware = lambda d, t=time(8, 0): timezone.make_aware(datetime.combine(d, t), tz)  # noqa: E731

        # ---- staff -------------------------------------------------------
        users = {}
        for username, first, last, role in STAFF:
            clash = User._base_manager.filter(username=username).exclude(shop=shop).first()
            if clash:
                raise CommandError(
                    f'Username "{username}" already belongs to another shop or a platform account. '
                    "Rename or remove it first (usernames are unique across all shops)."
                )
            u, _ = User.objects.get_or_create(username=username, defaults={"shop": shop})
            u.first_name, u.last_name, u.role = first, last, role
            u.email = f"{username}@medicore.test"
            u.phone = "07" + "".join(random.choices(string.digits, k=8))
            u.is_active = True
            # NOT a Django superuser: superusers have no shop and the API refuses them.
            # The shop owner is the SUPER_ADMIN *role*. Create platform staff with createsuperuser.
            u.set_password(password)
            u.save()
            users[username] = u
        seller_pool = [users["cashier1"], users["cashier2"], users["pharmacist"], users["admin"]]
        seller_w = [40, 35, 20, 5]

        # ---- shop & subscription ------------------------------------------
        cfg = ShopSettings.load()  # per-shop settings row for the current tenant
        cfg.name, cfg.address = shop.name, "Demo Street, Nairobi"
        cfg.phone, cfg.email, cfg.kra_pin = "0700 000 000", "shop@medicore.test", "P000000000X"
        cfg.save()
        # An active monthly bundle (unlimited sales) so the demo shop can sell. Skipped if it has one.
        if not BundlePurchase.unscoped.filter(shop=shop, status=PurchaseStatus.ACTIVE,
                                              expires_at__gt=now).exists():
            BundlePurchase.unscoped.create(
                shop=shop, bundle=Bundle.objects.get(code="BASIC"), source=PurchaseSource.ADMIN,
                starts_at=aware(start), expires_at=now + timedelta(days=25), sales_allowance_total=None)
        sub_requests = [
            SubscriptionRequest(plan="BASIC", months=6, amount=Decimal("9000"), phone="0712345678",
                                mpesa_reference="SK" + "".join(random.choices(string.ascii_uppercase + string.digits, k=8)),
                                status="APPROVED", requested_by=users["admin"], created_at=aware(start)),
            SubscriptionRequest(plan="BASIC", months=1, amount=Decimal("1500"), phone="0712345678",
                                mpesa_reference="SL" + "".join(random.choices(string.ascii_uppercase + string.digits, k=8)),
                                status="APPROVED", requested_by=users["admin"], created_at=aware(today - timedelta(days=5))),
        ]

        # ---- suppliers & medicines ----------------------------------------
        suppliers = [Supplier(name=n, phone=ph, email=f"orders@supplier{i}.test", address="Nairobi",
                              created_at=aware(start)) for i, (n, ph) in enumerate(SUPPLIERS, 1)]
        catalogue = build_catalogue(n_meds)
        total_w = sum(m[5] for m in catalogue)
        meds, plan = [], {}
        for name, generic, cat, unit, price, w in catalogue:
            avg_qty = sum(QTY_BY_UNIT[unit]) / len(QTY_BY_UNIT[unit])
            daily_units = w / total_w * AVG_LINES_PER_DAY * avg_qty
            reorder = max(5, ceil(daily_units * 7))                 # about a week's cover
            restock = max(reorder * 3, 24)
            restock = int(round(restock / 10) * 10) or 10
            med = Medicine(name=name, generic_name=generic, category=cat, unit=unit,
                           unit_price=money(price), insurance_price=money(price * Decimal("1.1")),
                           reorder_level=reorder, created_at=aware(start))
            meds.append(med)
            plan[med.id] = dict(weight=w, restock=restock, avg_qty=avg_qty)

        # some medicines are deliberately left to run down / expire soon (dashboard demo)
        k = max(5, len(meds) // 100)
        no_restock_late = {m.id for m in random.sample(meds, k)}
        short_dated = {m.id for m in random.sample([m for m in meds if m.id not in no_restock_late], k)}

        # ---- stock simulation (all in memory, saved in bulk at the end) -----
        batches, all_batches, txs = {m.id: [] for m in meds}, [], []
        used_numbers = set()
        pharmacist = users["pharmacist"]

        def receive(med, d, qty, expiry, label_prefix="B", hour=8):
            while True:
                number = f"{label_prefix}{d:%y%m}-{''.join(random.choices(string.hexdigits.upper()[:16], k=4))}"
                if (med.id, number) not in used_numbers:
                    used_numbers.add((med.id, number))
                    break
            dt = aware(d, time(hour, random.randint(0, 59)))
            b = MedicineBatch(medicine=med, supplier=random.choice(suppliers), batch_number=number,
                              quantity_received=qty, quantity_remaining=qty, expiry_date=expiry,
                              received_date=d, created_at=dt)
            batches[med.id].append(b)
            all_batches.append(b)
            txs.append(StockTransaction(medicine=med, batch=b, transaction_type=StockTransactionType.STOCK_IN,
                                        quantity=qty, reason="Stock received", performed_by=pharmacist, created_at=dt))
            return b

        for med in meds:  # opening stock
            if med.id in short_dated:
                expiry = today + timedelta(days=random.randint(12, 75))
            else:
                expiry = start + timedelta(days=30 * random.randint(10, 24))
            receive(med, start, plan[med.id]["restock"] * random.choice([1, 2]), expiry)

        def pick(med, d, qty):
            ok = [b for b in batches[med.id] if b.expiry_date >= d and b.quantity_remaining >= qty]
            return min(ok, key=lambda b: b.expiry_date) if ok else None

        cum_weights = list(accumulate(plan[m.id]["weight"] for m in meds))
        sales, items, amend_candidates = [], [], []
        daily_seq = {}
        cutoff_partial = today - timedelta(days=20)
        span = max((today - start).days, 1)

        d = start
        while d <= today:
            weekday = d.weekday()
            base = 8 if weekday == 6 else 14 if weekday == 5 else 22
            growth = 1 + 0.3 * ((d - start).days / span)           # business grows ~30% over the period
            payday = 1.25 if (d.day >= 26 or d.day <= 3) else 1.0
            n_sales = max(0, int(random.gauss(base * growth * payday, base * 0.2)))
            hours = [h for h in HOURS if d < today or h <= now.hour]
            hw = [w for h, w in zip(HOURS, HOUR_WEIGHTS) if h in hours]
            if not hours:
                n_sales = 0
            stamps = sorted(time(random.choices(hours, hw)[0], random.randint(0, 59), random.randint(0, 59))
                            for _ in range(n_sales))
            if d == today:
                stamps = [t for t in stamps if t <= now.time()]

            for t in stamps:
                lines, seen = [], set()
                for _ in range(random.choices([1, 2, 3, 4, 5], [35, 30, 20, 10, 5])[0]):
                    med = random.choices(meds, cum_weights=cum_weights)[0]
                    if med.id in seen:
                        continue
                    qty = random.choice(QTY_BY_UNIT[med.unit])
                    batch = pick(med, d, qty)
                    if not batch:
                        continue
                    seen.add(med.id)
                    line_total = med.unit_price * qty
                    if random.random() < 0.03:                      # cashier-negotiated price
                        line_total = money(round(float(line_total) * random.uniform(0.85, 0.97) / 5) * 5)
                    lines.append((med, batch, qty, money(line_total)))
                if not lines:
                    continue

                dt = timezone.make_aware(datetime.combine(d, t), tz)
                daily_seq[d] = daily_seq.get(d, 0) + 1
                number = f"OTC-{d:%Y%m%d}-{daily_seq[d]:04d}"
                subtotal = sum(l[3] for l in lines)
                discount = Decimal("0")
                if random.random() < 0.08:
                    discount = money(max(10, round(float(subtotal) * random.choice([0.05, 0.1]) / 10) * 10))
                    if discount >= subtotal:
                        discount = Decimal("0")
                total = subtotal - discount

                method = random.choices(["CASH", "MPESA", "CARD"], [55, 40, 5])[0]
                named = random.random() < 0.4
                paid = total
                if d >= cutoff_partial and random.random() < 0.07:   # recent unpaid balances
                    named = True
                    paid = money(max(0, round(float(total) * random.uniform(0.3, 0.7) / 10) * 10))
                elif method == "CASH" and random.random() < 0.6:
                    paid = money(ceil(total / 50) * 50)              # customer hands over a round amount
                ref = ""
                if method == "MPESA":
                    ref = random.choice("QRSTU") + "".join(random.choices(string.ascii_uppercase + string.digits, k=9))
                elif method == "CARD":
                    ref = "".join(random.choices(string.digits, k=6))

                sale = OTCSale(
                    sale_number=number,
                    customer_name=f"{random.choice(FIRST)} {random.choice(LAST)}" if named else "",
                    customer_phone=("07" + "".join(random.choices(string.digits, k=8))) if named else "",
                    subtotal=subtotal, discount=discount, total_amount=total, amount_paid=paid,
                    payment_method=method, reference_number=ref,
                    served_by=random.choices(seller_pool, seller_w)[0], sold_at=dt, created_at=dt)
                sales.append(sale)
                snap_items = []
                for med, batch, qty, line_total in lines:
                    batch.quantity_remaining -= qty
                    unit_price = (line_total / qty).quantize(Decimal("0.01"))
                    items.append(OTCSaleItem(sale=sale, medicine=med, batch=batch, quantity=qty,
                                             unit_price=unit_price, subtotal=line_total, created_at=dt))
                    txs.append(StockTransaction(medicine=med, batch=batch, transaction_type=StockTransactionType.STOCK_OUT,
                                                quantity=qty, reason=f"OTC sale {number}", performed_by=sale.served_by,
                                                created_at=dt))
                    snap_items.append({"medicine": str(med.id), "medicine_name": med.name, "quantity": qty,
                                       "unit_price": str(unit_price), "subtotal": str(line_total)})
                if paid >= total and d <= today - timedelta(days=1) and d >= today - timedelta(days=60):
                    amend_candidates.append((sale, snap_items))

            # month start: small stock-take corrections
            if d.day == 1:
                for med in random.sample(meds, 4):
                    cands = [b for b in batches[med.id] if b.quantity_remaining >= 4 and b.expiry_date >= d]
                    if cands:
                        b, q = random.choice(cands), random.randint(1, 3)
                        b.quantity_remaining -= q
                        txs.append(StockTransaction(medicine=med, batch=b, transaction_type=StockTransactionType.ADJUSTMENT,
                                                    quantity=-q, reason="Stock take - damaged / miscounted",
                                                    performed_by=pharmacist, created_at=aware(d, time(17, 0))))

            # end of day: restock anything at or below its reorder level
            for med in meds:
                if med.id in no_restock_late and d > today - timedelta(days=18):
                    continue
                live = sum(b.quantity_remaining for b in batches[med.id] if b.expiry_date >= d)
                if live <= med.reorder_level and random.random() < 0.9:
                    receive(med, d, plan[med.id]["restock"],
                            d + timedelta(days=30 * random.randint(10, 30)), hour=min(17, max(now.hour - 1, 0)) if d == today else 17)
            d += timedelta(days=1)

        # ---- a few expired batches still on the shelf (for the expiry report) -------
        for med in random.sample(meds, max(3, len(meds) // 100)):
            b = receive(med, start, 8, today - timedelta(days=random.randint(5, 25)), label_prefix="OLD")
            b.expiry_date = today - timedelta(days=random.randint(5, 25))

        # ---- audited corrections on some recent sales --------------------------------
        amendments = []
        for sale, snap_items in random.sample(amend_candidates, min(12, len(amend_candidates))):
            cut = money(random.choice([10, 20, 30, 50]))
            if cut >= sale.total_amount:
                continue
            snap = lambda s: {  # noqa: E731
                "customer_name": s.customer_name, "customer_phone": s.customer_phone,
                "payment_method": s.payment_method, "reference_number": s.reference_number,
                "discount": str(s.discount), "subtotal": str(s.subtotal), "total_amount": str(s.total_amount),
                "amount_paid": str(s.amount_paid), "items": snap_items}
            before = snap(sale)
            sale.discount += cut
            sale.total_amount -= cut
            sale.amount_paid = sale.total_amount
            when = min(sale.sold_at + timedelta(hours=random.randint(1, 3)), now)
            sale.amended_at = when
            amendments.append(OTCSaleAmendment(
                sale=sale, amended_by=random.choice([users["pharmacist"], users["admin"], users["accountant"]]),
                reason=random.choice(AMEND_REASONS), before=before, after=snap(sale), created_at=when))

        # ---- write everything ---------------------------------------------------------
        # bulk_create skips save(), so the tenant stamp never runs: attach the shop to every row here.
        for group in (suppliers, meds, all_batches, sales, items, txs, amendments, sub_requests):
            for obj in group:
                obj.shop = shop
        Supplier.objects.bulk_create(suppliers)
        Medicine.objects.bulk_create(meds, batch_size=1000)
        MedicineBatch.objects.bulk_create(all_batches, batch_size=1000)
        OTCSale.objects.bulk_create(sales, batch_size=1000)
        OTCSaleItem.objects.bulk_create(items, batch_size=1000)
        StockTransaction.objects.bulk_create(txs, batch_size=1000)
        OTCSaleAmendment.objects.bulk_create(amendments)
        SubscriptionRequest.objects.bulk_create(sub_requests)

        revenue = sum(s.total_amount for s in sales)
        low = sum(1 for m in meds if sum(b.quantity_remaining for b in batches[m.id] if b.expiry_date >= today) <= m.reorder_level)
        self.stdout.write(self.style.SUCCESS(
            f"\nSeeded shop \"{shop.name}\" ({shop.slug}): {start:%d %b %Y} -> {today:%d %b %Y}\n"
            f"  {len(meds)} medicines, {len(all_batches)} batches, {len(suppliers)} suppliers\n"
            f"  {len(sales)} sales ({len(items)} lines), revenue KES {revenue:,.0f}\n"
            f"  {len(txs)} stock movements, {len(amendments)} corrected sales\n"
            f"  {low} medicines at/below reorder level, {sum(1 for b in all_batches if b.quantity_remaining and b.expiry_date < today)} expired batches on hand\n"
            f"\nLogins (password: {password}):\n  " + "\n  ".join(f"{u:<11} {r}" for u, _, _, r in STAFF)))