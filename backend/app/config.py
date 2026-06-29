from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Public-facing domain. "localhost" disables email sending + secure cookies.
    domain: str = "blockwise.bauk.uk"

    # Auth / sessions
    secret_key: str = "dev-insecure-secret-change-me"
    access_token_expire_minutes: int = 1200  # 20 hours
    registration_token_expiry: int = 3600  # 1 hour
    cookie_name: str = "blockwise_access_token"

    # Google OAuth (optional locally)
    google_client_id: Optional[str] = None
    google_client_secret: Optional[str] = None

    # AWS / DynamoDB
    aws_region: str = "eu-west-1"
    dynamodb_host: Optional[str] = None  # set locally to http://dynamodb:8000
    table_prefix: str = "blockwise"

    # SES sender
    email_sender: str = "noreply@blockwise.bauk.uk"

    # Async solver job queue (worker Lambda). When unset locally we solve inline.
    solver_function_name: Optional[str] = None

    # Diagnostics / admin endpoints
    admin_endpoints_enabled: bool = False
    log_level: str = "INFO"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def is_local(self) -> bool:
        return self.domain == "localhost"

    @property
    def cookie_secure(self) -> bool:
        return not self.is_local


settings = Settings()
