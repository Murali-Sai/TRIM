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
