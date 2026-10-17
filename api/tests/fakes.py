"""Fakes for everything outside the process, so tests never call Turnstile, HIBP or Resend."""

import re
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from app.email.layout import RenderedEmail
from app.services.registry import Services


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


@dataclass
class Fakes:
    human: FakeHumanCheck = field(default_factory=FakeHumanCheck)
    breach: FakeBreach = field(default_factory=FakeBreach)
    outbox: MemoryOutbox = field(default_factory=MemoryOutbox)
    clock: FakeClock = field(default_factory=FakeClock)

    def services(self) -> Services:
        return Services(
            human_check=self.human, breach=self.breach, email=self.outbox, clock=self.clock
        )
