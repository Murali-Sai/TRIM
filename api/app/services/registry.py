from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime

import httpx

from app.config import Settings
from app.services.breach import BreachChecker, NoBreachCheck, PwnedPasswords
from app.services.email import EmailSender, OutboxSender, ResendSender
from app.services.turnstile import HumanCheck, Turnstile


def utc_now() -> datetime:
    return datetime.now(UTC)


@dataclass
class Services:
    """Everything that talks to the outside world or the clock, swappable in tests."""

    human_check: HumanCheck
    breach: BreachChecker
    email: EmailSender
    clock: Callable[[], datetime] = field(default=utc_now)


def build_services(settings: Settings) -> Services:
    client = httpx.Client()
    email: EmailSender
    if settings.resend_api_key is not None:
        email = ResendSender(
            client, settings.resend_api_key.get_secret_value(), settings.email_from
        )
    else:
        email = OutboxSender(settings.outbox_dir)
    return Services(
        human_check=Turnstile(client, settings.turnstile_secret.get_secret_value()),
        breach=PwnedPasswords(client) if settings.breach_check_enabled else NoBreachCheck(),
        email=email,
    )
