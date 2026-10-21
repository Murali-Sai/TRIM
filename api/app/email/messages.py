from app.email.layout import RenderedEmail, render_email


def verify_email(display_name: str, link: str) -> RenderedEmail:
    return render_email(
        "Confirm your email for TRIM",
        [
            f"Hi {display_name},",
            "Confirm your email address to keep using TRIM. Open this link within 1 hour:",
            link,
            "If you did not sign up for TRIM, you can ignore this email.",
        ],
    )


def reset_email(display_name: str, link: str) -> RenderedEmail:
    return render_email(
        "Reset your TRIM password",
        [
            f"Hi {display_name},",
            "Someone asked to reset the password for your TRIM account. "
            "To choose a new one, open this link within 1 hour:",
            link,
            "Resetting signs you out on every device.",
            "If you did not ask for this, ignore this email. Your password stays the same.",
        ],
    )


def checkin_email(display_name: str, week: str, lines: list[str], link: str) -> RenderedEmail:
    return render_email(
        f"Your TRIM check-in for the week of {week}",
        [
            f"Hi {display_name},",
            f"Here is how the week of {week} went.",
            *lines,
            f"See it in TRIM: {link}",
            "You get this because weekly check-in emails are on. Turn them off in Account.",
        ],
    )


def usage_alert_email(name: str, value: float, limit: float, unit: str) -> RenderedEmail:
    pct = round(100 * value / limit)
    return render_email(
        f"TRIM usage alert: {name} at {pct}%",
        [
            f"{name}: {round(value):,} of {round(limit):,} {unit} ({pct}%).",
            "This is the free-tier warning at 70%. Nothing has stopped yet. Check the provider's "
            "dashboard, and the steps in docs/DEPLOY.md, section 9.",
        ],
    )
