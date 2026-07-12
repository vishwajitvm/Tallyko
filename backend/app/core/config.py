from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    ENVIRONMENT: str = "development"
    DATABASE_URL: str = "postgresql://postgres:postgres@db:5432/tallyko_shared"
    REDIS_URL: str = "redis://cache:6379/0"
    MINIO_ENDPOINT: str = "storage:9000"
    JWT_SECRET: str = "placeholder_secret"

    class Config:
        env_file = ".env"

settings = Settings()
