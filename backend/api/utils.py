# api/utils.py
import io
import uuid

from django.core.files.base import ContentFile
from django.utils import timezone


def generate_otc_sale_number():
    """e.g. OTC-20261104-A1B2C3"""
    return f"OTC-{timezone.now():%Y%m%d}-{uuid.uuid4().hex[:6].upper()}"


def generate_qr_code(payload, filename):
    """
    Builds a QR PNG for `payload` and returns a ContentFile you can assign
    straight to an ImageField:  sale.qr_code = generate_qr_code(text, "name")
    Requires:  pip install qrcode[pil]
    """
    import qrcode

    img = qrcode.make(payload)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return ContentFile(buf.getvalue(), name=f"{filename}.png")
