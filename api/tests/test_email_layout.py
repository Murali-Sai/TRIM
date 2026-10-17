from app.email.layout import render_email


def test_email_starts_with_title_block() -> None:
    email = render_email("Verify your email", ["Hello there."])
    header = email.html.split("<main", 1)[0]
    assert "<header" in header
    assert ">TRIM</h1>" in header
    assert ">Track, Record, Inspect, Measure</p>" in header
    assert email.text.startswith("TRIM\nTrack, Record, Inspect, Measure\n\n")


def test_email_escapes_body_text() -> None:
    email = render_email("Hi", ["<script>alert(1)</script>"])
    assert "<script>" not in email.html
    assert "&lt;script&gt;" in email.html
