from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

_INSECURE_SECRETS = {"", "super_secure_key_to_be_replaced", "generate_a_secure_random_key_here", "change_me"}

def _read_version() -> str:
    for candidate in (Path(__file__).resolve().parents[3] / "VERSION", Path("/app/VERSION")):
        if candidate.exists():
            return candidate.read_text().strip()
    return "0.0.0"

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    ENVIRONMENT: str = "development"
    APP_VERSION: str = _read_version()
    DATABASE_URL: str = "postgresql+asyncpg://postgres:password_to_change_in_prod@db:5432/tallyko_shared"
    REDIS_URL: str = "redis://cache:6379/0"
    JWT_SECRET: str = "super_secure_key_to_be_replaced"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 12  # one shop shift
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30
    # Comma-separated list of allowed browser origins; "*" allows all (fine for dev / same-origin deployments)
    CORS_ORIGINS: str = "*"
    # Only trust X-Forwarded-For when running behind our own reverse proxy (Caddy in docker-compose.prod.yml)
    TRUST_PROXY: bool = False
    # Business-day boundaries (daily token numbers, day-end report) use this timezone
    TIMEZONE: str = "Asia/Kolkata"
    MAX_UPLOAD_MB: int = 10
    # Outgoing email (customer rewards, offers, e-receipts). Any SMTP works: Gmail app password, Brevo/Zoho free
    # tiers, your own server. Development uses the Mailpit container (http://localhost:8025). Empty host = disabled.
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USERNAME: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_STARTTLS: bool = True
    SMTP_SSL: bool = False
    SMTP_FROM_EMAIL: str = "no-reply@tallyko.local"
    SMTP_FROM_NAME: str = "Tallyko"
    EMAIL_WORKER_ENABLED: bool = True
    # Daily 01:00 IST subscription check (signs out businesses whose subscription ended). One replica runs it per day.
    JOB_SCHEDULER_ENABLED: bool = True
    # Public web address of the app (links in emails, e.g. the online store)
    PUBLIC_APP_URL: str = "http://localhost:8081"

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()] or ["*"]

    def validate_for_production(self) -> None:
        if self.ENVIRONMENT == "production":
            if self.JWT_SECRET in _INSECURE_SECRETS or len(self.JWT_SECRET) < 32:
                raise RuntimeError("JWT_SECRET must be set to a random string of at least 32 characters in production")
            if "password_to_change_in_prod" in self.DATABASE_URL:
                raise RuntimeError("Set a real database password (POSTGRES_PASSWORD / DATABASE_URL) in production")

settings = Settings()
