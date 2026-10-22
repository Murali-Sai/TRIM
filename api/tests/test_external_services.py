"""The real HIBP, Turnstile and Resend clients, run against recorded responses (httpx
MockTransport). No live calls."""

import hashlib
import json
import smtplib
from email.message import Message
from typing import ClassVar

import httpx
import pytest

from app.email.layout import render_email
from app.security.passwords import hash_password, needs_rehash, verify_password
from app.services.breach import PwnedPasswords
from app.services.email import EmailSendError, ResendSender, SmtpSender
from app.services.turnstile import Turnstile


def sha1_parts(password: str) -> tuple[str, str]:
    digest = hashlib.sha1(password.encode(), usedforsecurity=False).hexdigest().upper()
    return digest[:5], digest[5:]


def test_pwned_passwords_sends_only_prefix_and_padding() -> None:
    prefix, suffix = sha1_parts("password1234")
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        body = "\r\n".join(
            [
                "0018A45C4D1DEF81644B54AB7F969B88D65:1",
                f"{suffix}:4521",
                "FFFFF00000000000000000000000000000:0",
            ]
        )
        return httpx.Response(200, text=body)

    checker = PwnedPasswords(httpx.Client(transport=httpx.MockTransport(handler)))
    assert checker.is_breached("password1234") is True
    [req] = seen
    assert str(req.url) == f"https://api.pwnedpasswords.com/range/{prefix}"
    assert req.headers["Add-Padding"] == "true"
    assert suffix not in str(req.url)


def test_pwned_passwords_ignores_padding_rows() -> None:
    _, suffix = sha1_parts("unusual long passphrase")
    client = httpx.Client(
        transport=httpx.MockTransport(lambda r: httpx.Response(200, text=f"{suffix}:0"))
    )
    assert PwnedPasswords(client).is_breached("unusual long passphrase") is False


def test_pwned_passwords_fails_open_on_outage() -> None:
    client = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(503)))
    assert PwnedPasswords(client).is_breached("anything at all") is False


def test_turnstile_posts_secret_token_and_ip() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"success": True, "error-codes": []})

    check = Turnstile(httpx.Client(transport=httpx.MockTransport(handler)), "secret-1")
    assert check.verify("tok", "203.0.113.9") is True
    form = dict(x.split("=") for x in seen[0].content.decode().split("&"))
    assert form == {"secret": "secret-1", "response": "tok", "remoteip": "203.0.113.9"}


def test_turnstile_rejects_failed_or_unreachable() -> None:
    fail = httpx.MockTransport(
        lambda r: httpx.Response(
            200, json={"success": False, "error-codes": ["timeout-or-duplicate"]}
        )
    )
    assert Turnstile(httpx.Client(transport=fail), "s").verify("tok", None) is False
    down = httpx.MockTransport(lambda r: httpx.Response(500))
    assert Turnstile(httpx.Client(transport=down), "s").verify("tok", None) is False
    assert Turnstile(httpx.Client(transport=down), "s").verify("", None) is False


def test_resend_request_shape() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"id": "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794"})

    sender = ResendSender(
        httpx.Client(transport=httpx.MockTransport(handler)), "re_key", "TRIM <a@b.c>"
    )
    sender.send("to@example.com", render_email("Subject", ["Body"]))
    [req] = seen
    assert req.headers["Authorization"] == "Bearer re_key"
    assert req.headers["Idempotency-Key"]
    payload = json.loads(req.content)
    assert payload["to"] == ["to@example.com"]
    assert payload["from"] == "TRIM <a@b.c>"
    assert payload["subject"] == "Subject"
    assert "TRIM" in payload["html"]


def test_resend_error_does_not_include_message() -> None:
    client = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(422)))
    sender = ResendSender(client, "re_key", "x@y.z")
    try:
        sender.send("to@example.com", render_email("S", ["secret link token-abc"]))
    except EmailSendError as exc:
        assert "token-abc" not in str(exc)
        assert "422" in str(exc)
    else:
        raise AssertionError("expected EmailSendError")


class FakeSmtp:
    """Stands in for smtplib.SMTP_SSL: records the login and the message."""

    sent: ClassVar[list[tuple[str, int, tuple[str, str], Message]]] = []
    fail: ClassVar[Exception | None] = None

    def __init__(self, host: str, port: int, **_: object) -> None:
        self.host, self.port = host, port

    def __enter__(self) -> "FakeSmtp":
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def login(self, user: str, password: str) -> None:
        if FakeSmtp.fail is not None:
            raise FakeSmtp.fail
        self.auth = (user, password)

    def send_message(self, msg: Message) -> None:
        FakeSmtp.sent.append((self.host, self.port, self.auth, msg))


def test_smtp_sends_text_and_html(monkeypatch: pytest.MonkeyPatch) -> None:
    FakeSmtp.sent, FakeSmtp.fail = [], None
    monkeypatch.setattr(smtplib, "SMTP_SSL", FakeSmtp)
    sender = SmtpSender("smtp.gmail.com", 465, "me@gmail.com", "app-pass", "TRIM <me@gmail.com>")
    sender.send("to@example.com", render_email("Subject", ["Body"]))
    [(host, port, auth, msg)] = FakeSmtp.sent
    assert (host, port, auth) == ("smtp.gmail.com", 465, ("me@gmail.com", "app-pass"))
    assert msg["To"] == "to@example.com"
    assert msg["From"] == "TRIM <me@gmail.com>"
    assert msg["Subject"] == "Subject"
    assert msg["Message-ID"].endswith("@gmail.com>")
    types = [part.get_content_type() for part in msg.walk()]
    assert "text/plain" in types and "text/html" in types


def test_smtp_error_does_not_include_message(monkeypatch: pytest.MonkeyPatch) -> None:
    FakeSmtp.sent = []
    FakeSmtp.fail = smtplib.SMTPAuthenticationError(535, b"bad credentials")
    monkeypatch.setattr(smtplib, "SMTP_SSL", FakeSmtp)
    sender = SmtpSender("smtp.gmail.com", 465, "me@gmail.com", "app-pass", "me@gmail.com")
    with pytest.raises(EmailSendError) as info:
        sender.send("to@example.com", render_email("S", ["secret link token-abc"]))
    assert "token-abc" not in str(info.value)
    assert "app-pass" not in str(info.value)
    assert "535" in str(info.value)
    FakeSmtp.fail = None


def test_password_hashing_round_trip() -> None:
    h = hash_password("correct horse battery")
    assert h.startswith("$argon2id$v=19$m=19456,t=2,p=1$")
    assert verify_password(h, "correct horse battery")
    assert not verify_password(h, "wrong password!")
    assert not verify_password("not a hash", "x")
    assert not needs_rehash(h)
