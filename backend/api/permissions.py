# api/permissions.py
from rest_framework.permissions import BasePermission

from api.models import Role

# Who may do what.
SALE_ROLES = (Role.SUPER_ADMIN, Role.PHARMACIST, Role.CASHIER, Role.ACCOUNTANT)       # use the POS
MEDICINE_EDIT_ROLES = (Role.SUPER_ADMIN, Role.PHARMACIST)            # edit/add medicines, set stock
STOCK_ROLES = (Role.SUPER_ADMIN, Role.PHARMACIST)                    # receive batches, suppliers
SALE_AMEND_ANY_ROLES = (Role.SUPER_ADMIN, Role.ACCOUNTANT, Role.PHARMACIST)           # cashier: own sales, same day only


def has_role(*roles):
    """Builds a permission class that allows only the given roles."""

    class _HasRole(BasePermission):
        message = "You are not permitted to do this."

        def has_permission(self, request, view):
            u = request.user
            return bool(u and u.is_authenticated and u.role in roles)

    return _HasRole


IsAdmin = has_role(Role.SUPER_ADMIN)
CanViewReports = has_role(Role.SUPER_ADMIN, Role.ACCOUNTANT, Role.PHARMACIST, Role.CASHIER)
CanSell = has_role(*SALE_ROLES)
CanEditMedicine = has_role(*MEDICINE_EDIT_ROLES)
CanManageStock = has_role(*STOCK_ROLES)

# Shop-wide reports (sales, products, stock): owner, accountant, pharmacist.
# (CanViewReports above also admits cashiers, for the per-user scoped summary.)
CanViewShopReports = has_role(Role.SUPER_ADMIN, Role.ACCOUNTANT, Role.PHARMACIST)
