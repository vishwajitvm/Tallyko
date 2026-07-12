from celery import Celery
from app.core.config import settings

celery_app = Celery(
    "tallyko_workers",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
)

@celery_app.task
def placeholder_background_task():
    return "Async worker task stub executed."
