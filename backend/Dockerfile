# syntax=docker/dockerfile:1
# Tallyko API. Build target "dev" (default in docker-compose.yml) adds test tools and hot reload;
# target "prod" is the slim runtime image used by docker-compose.prod.yml.
FROM python:3.11-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# libgl1/libglib2.0-0: OpenCV runtime for RapidOCR; curl: container healthcheck
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install -r requirements.txt

FROM base AS dev
COPY requirements-dev.txt .
RUN pip install -r requirements-dev.txt
COPY . .
EXPOSE 8000
CMD ["sh", "-c", "python manage.py migrate && (python manage.py watch &) && uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"]

FROM base AS prod
RUN useradd --create-home --uid 10001 tallyko
COPY --chown=tallyko:tallyko . .
RUN mkdir -p /app/TraceNestLogs && chown tallyko:tallyko /app/TraceNestLogs
USER tallyko
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD curl -fsS http://localhost:8000/health || exit 1
# Migrations run on start so a fresh server is ready in one command
CMD ["sh", "-c", "python manage.py migrate && uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers ${WEB_CONCURRENCY:-2} --proxy-headers --forwarded-allow-ips='*'"]
