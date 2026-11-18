# Medicore POS

A point-of-sale and stock system for a pharmacy. It runs the counter (ring up a sale, take payment, print a receipt) and keeps the shelf honest (what is in stock, what is about to expire, what to reorder), then turns both into dashboards and reports for the owner.

Extracted from the Medicore HMIS: only the walk-in sale, pharmacy stock and staff-access logic were carried over. Patients, visits, invoices, labs, insurance and eTIMS were left behind.

- **Backend:** Django + Django REST Framework, one app called `api`, JWT login
- **Frontend:** React 18 + Vite, React Router, Recharts, jsPDF (receipts)

---

## 1. The problem

A small pharmacy usually runs on a notebook, a calculator and memory. That breaks in predictable ways:

| What goes wrong | What it costs |
|---|---|
| Stock is counted by eye, so nobody knows what is really on the shelf | Lost sales when something is "finished", cash tied up in overstock |
| Medicines expire unnoticed at the back of the shelf | Written-off stock, and a safety risk if one is sold |
| Prices, discounts and "I'll pay later" are decided at the till and never written down | Leakage, disputes, no idea who owes what |
| Cash, M-Pesa and card are mixed in one drawer | End-of-day reconciliation takes hours and never quite matches |
| Mistakes in a sale cannot be corrected without erasing the evidence | Staff cover up errors, or the owner stops trusting the numbers |
| The owner only learns how the day went when they ask | Decisions are made on feeling, not figures |

## 2. How this system solves it

1. **One sale screen.** Search a medicine, set the quantity, take payment, print the receipt. The system picks the batch and deducts the stock automatically.
2. **Stock that follows the sales.** Batches are sold **earliest-expiry-first (FEFO)**, so old stock leaves the shelf before it expires. Every movement (received, sold, adjusted, written off) is recorded in a ledger, so any quantity can be explained.
3. **Alerts you don't have to remember.** Low-stock and expiring-batch warnings appear on the dashboard and in the inventory and report pages.
4. **Honest corrections.** A processed sale is never silently edited. It is amended with a mandatory reason, the stock is restored and re-taken, and the *before* and *after* are saved. Cashiers can only correct their own sales from the same day.
5. **Payments you can reconcile.** Each sale records the method (cash / M-Pesa / card), the reference, the amount paid and any balance. Unpaid balances are listed and can be settled later; each settlement is audited.
6. **Numbers for the owner.** A live dashboard and sales, product and stock reports, exportable to CSV.
7. **Role-based access.** The owner, pharmacist, cashier and accountant each see only what their job needs.

---

## 3. Features

### Counter
- Walk-in sale screen (reused unchanged from the HMIS): medicine search, cart, discount, cashier-overridable line price, receipt PDF/print
- Quick-add a medicine with its first batch from the sale screen
- Stock-take: set the counted quantity and the system records the difference as an adjustment

### Pages
| Page | Route | Who | What it does |
|---|---|---|---|
| Dashboard | `/dashboard` | everyone (cashiers see only their own sales) | Today's sales, unpaid balances, low-stock and expiry counts, revenue trend, payment split, top sellers, recent sales |
| Walk-in sale (POS) | `/billing/walk-in-sale` | sellers | Ring up, amend and print sales |
| Payments | `/billing/payments` | sellers | Transactions by date/method/unpaid, totals billed / collected / outstanding, settle balances, CSV export |
| Inventory | `/inventory` | sellers view; owner and pharmacist edit | Medicines, low stock, expiring, batches, stock ledger; add, edit, receive and set stock |
| Suppliers | `/suppliers` | owner, pharmacist | Supplier directory (reused from HMIS) |
| Reports | `/reports`, `/reports/sales`, `/reports/products`, `/reports/stock` | owner, pharmacist, accountant | Sales by day / method / cashier, product performance, stock value and expiry |
| Settings | `/settings` | owner | Shop details printed on receipts, expiry-alert window |
| Staff | `/users` | owner | Add staff, change roles, deactivate accounts |
| Subscription | `/subscriptions` | everyone view; owner requests | Current plan, days left, renewal request with M-Pesa code |
| Profile | `/profile` | everyone | Edit own details, change password |

### Roles
| Role | Can do |
|---|---|
| `SUPER_ADMIN` (owner) | Everything, including staff, settings, subscription |
| `PHARMACIST` | Sell, edit medicines, receive and adjust stock, suppliers, shop-wide reports, amend any sale |
| `ACCOUNTANT` | Sell, view payments, shop-wide reports, amend any sale |
| `CASHIER` | Sell, take payments, amend **own sale from today only**; sees only own sales and figures |

The frontend hides what a role cannot use; the backend enforces the same rules (`api/permissions.py`). Treat the backend as the real gate.

---

## 4. Project structure

```
medicore_pos/
├── README.md
├── backend/                         Django project
│   ├── manage.py
│   ├── requirements.txt
│   ├── SETTINGS_SNIPPET.py          settings to add if you keep your own settings.py
│   ├── medicore_pos/                project package
│   │   ├── settings.py              DB, JWT, CORS, media
│   │   ├── urls.py                  /admin/ and /api/ -> api.urls
│   │   └── wsgi.py
│   └── api/                         the single app
│       ├── models.py                User/Role, Supplier, Medicine, MedicineBatch,
│       │                            StockTransaction, OTCSale/Item/Amendment,
│       │                            ShopSettings, Subscription(+Request)
│       ├── serializers.py
│       ├── views.py                 auth, stock, sales, dashboard, reports, settings, subscription
│       ├── urls.py                  router + function-view routes
│       ├── permissions.py           role sets and permission classes
│       ├── managers.py              soft-delete managers
│       ├── utils.py                 sale-number and QR-code helpers
│       ├── admin.py                 admin site; approve subscription requests here
│       └── management/commands/
│           └── seed_data.py         demo data (6 months of history)
└── frontend/                        React + Vite
    ├── index.html
    ├── package.json
    ├── vite.config.js
    ├── .env.example                 VITE_API_URL
    └── src/
        ├── main.jsx                 Router + Toast + Auth providers
        ├── App.jsx                  route table, role gating (`allow()`)
        ├── index.css                your global HMIS styles / CSS variables
        ├── styles/pos.css           styles for the new pages (reads your CSS variables)
        ├── services/api.js          axios client, token refresh, every endpoint
        ├── context/                 AuthContext, ToastContext
        ├── components/              ProtectedRoute, PageKit (Card, Modal, Tabs, charts helpers)
        │                            + copied from HMIS: MedicineSearch, ConfirmDialog,
        │                              DataTable, SkeletonLoader, ...
        ├── layouts/                 DashboardLayout (sidebar/topbar), AuthLayout
        ├── utils/                   roles.js, formatters.js
        └── pages/
            ├── auth/                Login, Unauthorized
            ├── dashboard/           Dashboard
            ├── billing/             Payments, WalkInSale (copied from HMIS)
            ├── inventory/           Inventory
            ├── pharmacy/            Suppliers (copied from HMIS)
            ├── reports/             Reports, SalesReport, ProductReport, StockReport
            ├── settings/            Settings, Users
            ├── support/             Subscriptions
            ├── profile/             Profile
            └── NotFound.jsx
```

"Copied from HMIS" files are not generated here: bring them across unchanged, plus anything they import (the error list from `npx vite build` tells you exactly what is missing).

---

## 5. Data model

```
User ──< OTCSale >── OTCSaleItem >── Medicine ──< MedicineBatch >── Supplier
              │                           │             │
              └──< OTCSaleAmendment       └──< StockTransaction (ledger) ──┘

ShopSettings (1 row)    Subscription (1 row) ──< SubscriptionRequest
```

- **Medicine** is the catalogue entry (price, unit, reorder level). Stock is *derived* from its batches, never typed in directly.
- **MedicineBatch** holds quantity and expiry. A sale takes from the earliest-expiring batch that has enough stock.
- **StockTransaction** is the append-only ledger: `STOCK_IN`, `STOCK_OUT`, `ADJUSTMENT`, `EXPIRED`.
- **OTCSale / OTCSaleItem** is the sale header and its lines. The line price can be overridden by the cashier.
- **OTCSaleAmendment** stores who corrected a sale, why, and JSON snapshots before and after.
- All business tables use UUID keys and **soft delete** (`is_deleted`); `Model.objects` hides deleted rows, `Model.all_objects` shows everything.

---

## 6. API overview

Base URL `/api/`. JWT bearer auth; `POST auth/login/` returns `access`, `refresh` and the user.

| Area | Endpoints |
|---|---|
| Auth | `auth/login/` · `auth/logout/` · `auth/refresh/` · `auth/me/` (GET, PATCH) · `auth/change-password/` |
| Staff | `users/` (owner only) |
| Medicines | `medicines/` · `medicines/autocomplete/?q=` · `medicines/quick-add/` · `medicines/{id}/set-stock/` · `medicines/{id}/branch-stock/` · `medicines/low-stock/` |
| Stock | `medicine-batches/` · `medicine-batches/expiring-soon/?days=` · `stock-transactions/` · `suppliers/` |
| Sales | `otc-sales/` (list, create) · `otc-sales/{id}/receipt/` · `otc-sales/{id}/amend/` · `otc-sales/{id}/amendments/` · `otc-sales/{id}/add-payment/` |
| Dashboard & reports | `dashboard/summary/` · `payments/summary/` · `reports/sales/` · `reports/products/` · `reports/stock/` |
| Shop & plan | `settings/shop/` (GET any, PATCH owner) · `subscription/` (GET, POST request) |

Errors come back as JSON with `detail` or per-field messages; insufficient stock returns **409**.

---

## 7. Getting started

### Backend
```bash
cd backend
python -m venv venv && source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
python manage.py makemigrations api
python manage.py migrate
python manage.py seed_data          # optional: 6 months of demo data
python manage.py createsuperuser    # only if you did not seed; then set role = SUPER_ADMIN in /admin
python manage.py runserver          # http://localhost:8000
```

### Frontend
```bash
cd frontend
cp .env.example .env                # VITE_API_URL=http://localhost:8000/api
npm install
npm run dev                         # http://localhost:5173
```

### Demo logins (after `seed_data`)
Password `Pass1234!` for `owner`, `pharmacist`, `cashier1`, `cashier2`, `accountant`.

`python manage.py seed_data --flush` replaces the demo sales and stock; `--months 9` makes a longer history.

---

## 8. Subscription flow

There is no payment gateway yet. The owner picks a plan on **Subscription**, pays by M-Pesa, and submits the confirmation code. A staff member with Django admin access opens **Subscription requests**, selects the request and runs **Approve**, which extends the plan from today (or from the current expiry if still running). Plan prices in `views.py` (`DEFAULT_PLANS`) are placeholders; change them or set `POS_PLANS` in settings.

---

## 9. Known limits and next steps

- **No buying cost.** Stock is valued at selling price and there is no profit report. Adding `cost_price` to each batch is the natural next step.
- **Subscription is informational.** An expired plan does not block the API yet.
- **Receipts** are generated in the browser (jsPDF). The QR code is created for sales made through the app; seeded sales have none.
- **Lists are not paginated.** Fine for a single shop; add DRF pagination when sales reach tens of thousands.
- **One shop.** The HMIS branch model was dropped; multi-branch would need a `Branch` foreign key on batches and sales again.
- **Tests.** There is no automated test suite yet. The most valuable first tests are sale creation (FEFO and stock deduction), amendment (stock restore and re-take) and the role rules.
- **Production.** Set a real `SECRET_KEY`, `DEBUG=False`, `ALLOWED_HOSTS`, restrict `CORS_ALLOWED_ORIGINS`, use PostgreSQL, and serve media files properly.