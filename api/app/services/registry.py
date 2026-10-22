from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime

import httpx

from app.config import Settings
from app.services.breach import BreachChecker, NoBreachCheck, PwnedPasswords
from app.services.email import EmailSender, OutboxSender, ResendSender, SmtpSender
from app.services.fooddata import FdcClient, FoodSource, NoFoodSource, OffClient
from app.services.push import NoPush, PushSender, WebPushSender
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
    fdc: FoodSource = field(default_factory=NoFoodSource)
    off: FoodSource = field(default_factory=NoFoodSource)
    push: PushSender = field(default_factory=NoPush)
    # Handed to browsers to subscribe; None means reminders cannot be turned on.
    vapid_public_key: str | None = None
    # The hourly job's shared secret (X-Job-Token); None refuses the job.
    job_token: str | None = None


def build_services(settings: Settings) -> Services:
    client = httpx.Client()
    email: EmailSender
    if settings.resend_api_key is not None:
        email = ResendSender(
            client, settings.resend_api_key.get_secret_value(), settings.email_from
        )
    elif settings.smtp_password is not None and settings.smtp_user is not None:
        email = SmtpSender(
            settings.smtp_host,
            settings.smtp_port,
            settings.smtp_user,
            settings.smtp_password.get_secret_value(),
            settings.email_from,
        )
    else:
        email = OutboxSender(settings.outbox_dir)
    return Services(
        human_check=Turnstile(client, settings.turnstile_secret.get_secret_value()),
        breach=PwnedPasswords(client) if settings.breach_check_enabled else NoBreachCheck(),
        email=email,
        fdc=(
            FdcClient(client, settings.fdc_api_key.get_secret_value())
            if settings.fdc_api_key is not None
            else NoFoodSource()
        ),
        off=OffClient(client, settings.off_user_agent),
        push=(
            WebPushSender(settings.vapid_private_key.get_secret_value(), settings.vapid_subject)
            if settings.vapid_private_key is not None
            else NoPush()
        ),
        vapid_public_key=settings.vapid_public_key,
        job_token=settings.job_token.get_secret_value() if settings.job_token else None,
    )
