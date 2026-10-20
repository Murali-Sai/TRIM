"""Shared email layout.

Every email (verify, reset, weekly check-in) starts with the TRIM title block.
"""

from dataclasses import dataclass
from html import escape

PRODUCT_NAME = "TRIM"
FULL_FORM = "Track, Record, Inspect, Measure"

# Inline styles only, since many mail clients drop <style> blocks. Colors match the web light theme.
_TITLE_BLOCK_HTML = (
    '<header style="padding:24px 0 16px;text-align:center;">'
    '<h1 style="margin:0;font-size:32px;line-height:40px;font-weight:700;color:#111113;">'
    f"{PRODUCT_NAME}</h1>"
    '<p style="margin:0;font-size:14px;line-height:20px;color:#55555c;white-space:nowrap;">'
    f"{FULL_FORM}</p>"
    "</header>"
)


@dataclass(frozen=True)
class RenderedEmail:
    subject: str
    html: str
    text: str


def render_email(subject: str, paragraphs: list[str]) -> RenderedEmail:
    """Wraps plain-text paragraphs (escaped here) in the branded layout, with a text alternative."""
    body = "".join(
        f'<p style="margin:0 0 16px;font-size:16px;line-height:24px;color:#111113;">{escape(p)}</p>'
        for p in paragraphs
    )
    html = (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        f"<title>{escape(subject)}</title></head>"
        '<body style="margin:0;background:#f6f6f7;'
        'font-family:Fira Sans,Segoe UI,Arial,sans-serif;">'
        '<div style="max-width:560px;margin:0 auto;padding:0 16px 32px;">'
        f"{_TITLE_BLOCK_HTML}"
        '<main style="background:#ffffff;border:1px solid #d9d9de;'
        'border-radius:8px;padding:24px;">'
        f"{body}</main></div></body></html>"
    )
    text = "\n\n".join([f"{PRODUCT_NAME}\n{FULL_FORM}", *paragraphs])
    return RenderedEmail(subject=subject, html=html, text=text)
