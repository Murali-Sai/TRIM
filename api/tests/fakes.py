"""Fakes for everything outside the process, so tests never call Turnstile, HIBP or Resend."""

import json
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from app.email.layout import RenderedEmail
from app.services.fooddata import (
    FoodCandidate,
    FoodSourceError,
    parse_fdc_food,
    parse_off_product,
)
from app.services.push import Outcome, PushMessage, Subscription
from app.services.registry import Services

FAKE_VAPID_PUBLIC = "BFakePublicKeyForTestsOnly"
FAKE_JOB_TOKEN = "job-token-for-tests"


@dataclass
class FakePush:
    """Records messages; endpoints in `gone` answer as dropped subscriptions."""

    sent: list[tuple[str, str]] = field(default_factory=list)
    gone: set[str] = field(default_factory=set)

    def send(self, sub: Subscription, message: PushMessage) -> Outcome:
        if sub.endpoint in self.gone:
            return "gone"
        self.sent.append((sub.endpoint, message.body))
        return "sent"


class FakeHumanCheck:
    def __init__(self) -> None:
        self.passes = True
        self.seen: list[tuple[str, str | None]] = []

    def verify(self, token: str, remote_ip: str | None) -> bool:
        self.seen.append((token, remote_ip))
        return self.passes


class FakeBreach:
    def __init__(self, breached: set[str] | None = None) -> None:
        self.breached = breached or set()

    def is_breached(self, password: str) -> bool:
        return password in self.breached


@dataclass
class SentEmail:
    to: str
    email: RenderedEmail

    def link_token(self) -> str:
        match = re.search(r"/(?:verify|reset)#token=([A-Za-z0-9_-]+)", self.email.text)
        assert match, "no token link in email"
        return match.group(1)


@dataclass
class MemoryOutbox:
    sent: list[SentEmail] = field(default_factory=list)
    fail: bool = False

    def send(self, to: str, email: RenderedEmail) -> None:
        from app.services.email import EmailSendError

        if self.fail:
            raise EmailSendError("fake failure")
        self.sent.append(SentEmail(to, email))


class FakeClock:
    def __init__(self, start: datetime | None = None) -> None:
        self.now = start or datetime(2026, 10, 17, 12, 0, tzinfo=UTC)

    def __call__(self) -> datetime:
        return self.now

    def advance(self, **kwargs: float) -> None:
        self.now += timedelta(**kwargs)


FIXTURES = Path(__file__).parent / "fixtures"


def load_fixture(name: str) -> Any:
    return json.loads((FIXTURES / name).read_text())


class FakeFoodSource:
    """Serves parsed fixture results; records each query; can be made to fail."""

    def __init__(self, results: list[FoodCandidate] | None = None) -> None:
        self.results = results or []
        self.fail = False
        self.calls: list[str] = []

    def search(self, query: str, limit: int) -> list[FoodCandidate]:
        self.calls.append(query)
        if self.fail:
            raise FoodSourceError("fake outage")
        return self.results[:limit]


def fdc_fixture() -> list[FoodCandidate]:
    foods = load_fixture("fdc_search_greek_yogurt.json")["foods"]
    return [c for c in (parse_fdc_food(f) for f in foods) if c is not None]


def off_fixture() -> list[FoodCandidate]:
    products = load_fixture("off_search_skyr.json")["products"]
    return [c for c in (parse_off_product(p) for p in products) if c is not None]


@dataclass
class Fakes:
    human: FakeHumanCheck = field(default_factory=FakeHumanCheck)
    breach: FakeBreach = field(default_factory=FakeBreach)
    outbox: MemoryOutbox = field(default_factory=MemoryOutbox)
    clock: FakeClock = field(default_factory=FakeClock)
    # Empty by default, so tests that do not search never see external foods.
    fdc: FakeFoodSource = field(default_factory=lambda: FakeFoodSource())
    off: FakeFoodSource = field(default_factory=lambda: FakeFoodSource())
    push: "FakePush" = field(default_factory=lambda: FakePush())

    def services(self) -> Services:
        return Services(
            human_check=self.human,
            breach=self.breach,
            email=self.outbox,
            clock=self.clock,
            fdc=self.fdc,
            off=self.off,
            push=self.push,
            vapid_public_key=FAKE_VAPID_PUBLIC,
            job_token=FAKE_JOB_TOKEN,
        )
