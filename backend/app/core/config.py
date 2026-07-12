from pydantic_settings import BaseSettings
from pydantic import Field

class Settings(BaseSettings):
    ENVIRONMENT: str = Field("development", env="ENVIRONMENT")
    DATABASE_URL: str = Field("postgresql://postgres:password_to_change_in_prod@db:5432/tallyko_shared", env="DATABASE_URL")
    REDIS_URL: str = Field("redis://cache:6379/0", env="REDIS_URL")
    MINIO_ENDPOINT: str = Field("storage:9000", env="MINIO_ENDPOINT")
    MINIO_ACCESS_KEY: str = Field("minio_admin", env="MINIO_ACCESS_KEY")
    MINIO_SECRET_KEY: str = Field("minio_password_to_change", env="MINIO_SECRET_KEY")
    JWT_SECRET: str = Field("super_secure_key_to_be_replaced", env="JWT_SECRET")
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60

    # Variables passed from docker-compose / .env but not strictly used inside FastAPI
    POSTGRES_USER: str = "postgres"
    POSTGRES_PASSWORD: str = "password_to_change_in_prod"
    POSTGRES_DB: str = "tallyko_shared"
    MINIO_ROOT_USER: str = "minio_admin"
    MINIO_ROOT_PASSWORD: str = "minio_password_to_change"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

settings = Settings()
