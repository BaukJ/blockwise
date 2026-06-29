"""SES email sending. No-op (prints) when running locally."""
from __future__ import annotations

import boto3

from app.config import settings

_ses = None


def _client():
    global _ses
    if _ses is None:
        _ses = boto3.client("ses", region_name=settings.aws_region)
    return _ses


def send_email(to_email: str, subject: str, body: str) -> None:
    if settings.is_local:
        print(f"\n[email:dev] to={to_email} subject={subject}\n{body}\n")
        return
    _client().send_email(
        Source=settings.email_sender,
        Destination={"ToAddresses": [to_email]},
        Message={
            "Subject": {"Data": subject},
            "Body": {"Text": {"Data": body}},
        },
    )
