"""Outgoing email. Resend or SMTP (such as Gmail) in production; a local outbox folder in
development."""

import json
import logging
import smtplib
import ssl
import uuid
from datetime import UTC, datetime
from email.message import EmailMessage
from email.utils import make_msgid
from pathlib import Path
from typing import Protocol

import httpx

from app.email.layout import RenderedEmail

log = logging.getLogger(__name__)

RESEND_URL = "https://api.resend.com/emails"


class EmailSendError(Exception):
    pass


class EmailSender(Protocol):
    def send(self, to: str, email: RenderedEmail) -> None: ...


class ResendSender:
    def __init__(self, client: httpx.Client, api_key: str, from_addr: str) -> None:
        self._client = client
        self._api_key = api_key
        self._from = from_addr

    def send(self, to: str, email: RenderedEmail) -> None:
        try:
            res = self._client.post(
                RESEND_URL,
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "Idempotency-Key": str(uuid.uuid4()),
                },
                json={
                    "from": self._from,
                    "to": [to],
                    "subject": email.subject,
                    "html": email.html,
                    "text": email.text,
                },
                timeout=10.0,
            )
            res.raise_for_status()
        except httpx.HTTPError as exc:
            # The message may hold a token link, so only the status goes to the log.
            status = getattr(getattr(exc, "response", None), "status_code", None)
            raise EmailSendError(f"Resend request failed (status {status})") from None


class SmtpSender:
    """Sends over SMTP with implicit TLS (port 465), for example Gmail with an app password.

    Gmail allows about 500 recipients a day on a personal account and sends as the signed-in
    address, so TRIM_EMAIL_FROM should name that address.
    """

    def __init__(self, host: str, port: int, user: str, password: str, from_addr: str) -> None:
        self._host = host
        self._port = port
        self._user = user
        self._password = password
        self._from = from_addr

    def send(self, to: str, email: RenderedEmail) -> None:
        msg = EmailMessage()
        msg["From"] = self._from
        msg["To"] = to
        msg["Subject"] = email.subject
        msg["Message-ID"] = make_msgid(domain=self._from.rsplit("@", 1)[-1].strip("> "))
        msg.set_content(email.text)
        msg.add_alternative(email.html, subtype="html")
        try:
            with smtplib.SMTP_SSL(
                self._host, self._port, context=ssl.create_default_context(), timeout=10.0
            ) as smtp:
                smtp.login(self._user, self._password)
                smtp.send_message(msg)
        except (smtplib.SMTPException, OSError) as exc:
            # The message may hold a token link, so only the error type goes to the log.
            code = getattr(exc, "smtp_code", None)
            raise EmailSendError(f"SMTP send failed ({type(exc).__name__}, code {code})") from None


class OutboxSender:
    """Development only: writes each email to a JSON file instead of sending it.

    Links in emails carry tokens, which must never reach logs, so they go to disk.
    """

    def __init__(self, directory: str) -> None:
        self._dir = Path(directory)

    def send(self, to: str, email: RenderedEmail) -> None:
        self._dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%f")
        path = self._dir / f"{stamp}.json"
        path.write_text(
            json.dumps({"to": to, "subject": email.subject, "text": email.text, "html": email.html})
        )
        log.info("Email written to outbox: %s", path.name)
