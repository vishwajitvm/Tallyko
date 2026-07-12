# Docker & Deployment

## 1. Constraint Driven Infrastructure

A hard constraint for Tallyko is that **everything runs in Docker via Docker Compose**. There are no "install locally" instructions. Developers and production environments run identical setups, minimizing "works on my machine" bugs. 

All tooling must be 100% free and open-source. No vendor-locked DBaaS or proprietary PAAS solutions.

## 2. Docker Compose Layout

The infrastructure is defined by a `docker-compose.yml` file orchestration.

### The Services:

1.  **`proxy` (Traefik):**
    *   Listens on ports 80 and 443.
    *   Handles SSL termination via Let's Encrypt.
    *   Routes traffic based on hostnames (`api.tallyko.com`, `tenant-a.tallyko.com`).
2.  **`api` (FastAPI / Uvicorn):**
    *   The core backend application. Can be scaled out (`docker-compose up --scale api=3`).
    *   Stateless; depends on Postgres and Redis.
3.  **`worker` (Celery / ARQ):**
    *   Runs the exact same Python image as the API, but executes the background task queue instead of the web server.
4.  **`db` (PostgreSQL):**
    *   The shared tenant database and global configuration database.
    *   Persists data to a Docker Volume (`db_data`).
5.  **`cache` (Redis):**
    *   In-memory data store for rate-limiting, session data, and the Celery message broker.
6.  **`storage` (MinIO):**
    *   S3-compatible object storage for files, images, and backups.
    *   Persists data to a Docker Volume (`minio_data`).

## 3. Environment Management

Deployment relies heavily on `.env` files. The `docker-compose.yml` file is environment-agnostic, pulling configuration at runtime.

Example configuration variables:
*   `DATABASE_URL=postgresql://user:pass@db:5432/tallyko`
*   `REDIS_URL=redis://cache:6379/0`
*   `ENVIRONMENT=production`
*   `JWT_SECRET=super_secure_key`

## 4. Multi-Vendor Database Provisioning (Dockerized)

When an enterprise vendor requests a **Dedicated Database**, the deployment process leverages Docker:

1.  A new Postgres container block is added to a supplementary `docker-compose.tenantX.yml` file (or deployed via a simple orchestration script).
2.  The container is spun up and joined to the internal Docker network.
3.  A CI/CD job runs Alembic migrations against this new container.
4.  The new `DATABASE_URL` is inserted into the Global Database's routing table for that specific `tenant_id`.

## 5. Deployment Architecture Diagram

```mermaid
architecture-beta
    group vps(VPS / Bare Metal Server)
    
    group dockernet(Docker Network) in vps
    
    service traefik(Traefik\nPorts 80/443) in dockernet
    
    group appgroup(App Services) in dockernet
    service api1(FastAPI 1) in appgroup
    service api2(FastAPI 2) in appgroup
    service worker(Celery Worker) in appgroup
    
    group datagroup(Data Services) in dockernet
    service pg(PostgreSQL) in datagroup
    service redis(Redis) in datagroup
    service minio(MinIO) in datagroup
    
    traefik:B --> T:api1
    traefik:B --> T:api2
    
    api1:R --> L:pg
    api2:R --> L:pg
    worker:R --> L:pg
    
    api1:R --> L:redis
    api2:R --> L:redis
    worker:R --> L:redis
    
    api1:R --> L:minio
    api2:R --> L:minio
    worker:R --> L:minio
```
