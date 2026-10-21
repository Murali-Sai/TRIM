"""Web Push for streak reminders (SPEC page 3, Reminders): the standard protocol with VAPID
keys via pywebpush. Free; works in Android and desktop browsers, and on iPhone once TRIM is
added to the Home Screen."""

import json
import logging
from dataclasses import dataclass
from typing import Literal, Protocol

from pywebpush import WebPushException, webpush

log = logging.getLogger(__name__)

Outcome = Literal["sent", "gone", "failed"]


@dataclass(frozen=True)
class Subscription:
    endpoint: str
    p256dh: str
    auth: str


@dataclass(frozen=True)
class PushMessage:
    title: str
    body: str
    url: str


class PushSender(Protocol):
    def send(self, sub: Subscription, message: PushMessage) -> Outcome: ...


class NoPush:
    """No VAPID keys configured: nothing is sent."""

    def send(self, sub: Subscription, message: PushMessage) -> Outcome:
        return "failed"


class WebPushSender:
    def __init__(self, private_key: str, subject: str) -> None:
        self._key = private_key
        self._claims = {"sub": subject}

    def send(self, sub: Subscription, message: PushMessage) -> Outcome:
        try:
            webpush(
                subscription_info={
                    "endpoint": sub.endpoint,
                    "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
                },
                data=json.dumps({"title": message.title, "body": message.body, "url": message.url}),
                vapid_private_key=self._key,
                vapid_claims=dict(self._claims),
                ttl=12 * 3600,
            )
        except WebPushException as e:
            status = e.response.status_code if e.response is not None else None
            # The browser dropped the subscription: forget it.
            if status in (404, 410):
                return "gone"
            # Never log the endpoint: it identifies a browser.
            log.warning("web push failed with status %s", status)
            return "failed"
        return "sent"
