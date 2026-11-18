# api/managers.py
from django.db import models


class SoftDeleteManager(models.Manager):
    """Default manager: hides rows flagged as deleted."""

    def get_queryset(self):
        return super().get_queryset().filter(is_deleted=False)


class AllObjectsManager(models.Manager):
    """Returns everything, including soft-deleted rows."""
