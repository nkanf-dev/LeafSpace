"""Synthetic import controls. Optional regeneration: Python + pypdf 6.10.0.
No real passwords, accounts, or external document content are involved.
The weak legacy PDF encryption is deliberate test data, not security guidance.
"""
from pathlib import Path
from pypdf import PdfReader, PdfWriter

root = Path(__file__).parent
for filename, user_password in [
    ("leafspace-password-required.pdf", "synthetic-reader"),
    ("leafspace-owner-only.pdf", ""),
]:
    writer = PdfWriter()
    writer.add_page(PdfReader(root / "leafspace-12-pages.pdf").pages[0])
    writer.encrypt(user_password, owner_password="synthetic-owner", algorithm="RC4-128")
    with (root / filename).open("wb") as output:
        writer.write(output)
