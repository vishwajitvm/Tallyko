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
flowchart TD
    subgraph VPS [VPS / Bare Metal Server]
        subgraph DockerNet [Docker Network]
            traefik[Traefik<br>Ports 80/443]
            
            subgraph AppGroup [App Services]
                api1[FastAPI 1]
                api2[FastAPI 2]
                worker[Celery Worker]
            end
            
            subgraph DataGroup [Data Services]
                pg[(PostgreSQL)]
                redis[(Redis)]
                minio[(MinIO)]
            end
            
            traefik --> api1
            traefik --> api2
            
            api1 --> pg
            api2 --> pg
            worker --> pg
            
            api1 --> redis
            api2 --> redis
            worker --> redis
            
            api1 --> minio
            api2 --> minio
            worker --> minio
        end
    end
```
