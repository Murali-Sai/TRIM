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
