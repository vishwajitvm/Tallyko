# Tallyko

An all-in-one multi-vendor Restaurant & Retail Point of Sale (POS) system.

![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)

---

## 1. Architecture Overview

Tallyko is architected from day one as a true multi-tenant SaaS platform. 

Every vendor gets an isolated logical database space (either isolated via PostgreSQL Row-Level Security on a shared DB instance, or completely decoupled on a dedicated customer-hosted Postgres server).

Here is the high-level system topology showing clients, gateways, app layers, and database instances:

![Tallyko Master Architecture](./docs/diagrams/Tallyko_Master_Architecture.png)

*Note: Since the Draw.io CLI is not present in this build environment, the `.png` diagrams must be exported manually from the `.drawio` source files before they render in markdown.*

### Manual Diagram Export Instruction
To render the diagrams in this README, open each `.drawio` file located in `docs/diagrams/` (e.g., using [Draw.io](https://app.diagrams.net/)) and export them as PNGs:
- **Tallyko_Master_Architecture.drawio** &rarr; **Tallyko_Master_Architecture.png**
- **Tallyko_Docker_Deployment.drawio** &rarr; **Tallyko_Docker_Deployment.png**
- **Tallyko_Database_ERD.drawio** &rarr; **Tallyko_Database_ERD.png**

---

## 2. Tech Stack

| Layer | Component | Details | Links |
|---|---|---|---|
| **Backend** | Python / FastAPI | Modern, async-first REST API | [Justification](./docs/01_Tech_Stack_And_Justification.md) |
| **Frontend** | React Native | iOS + Android single codebase | [Architecture](./docs/06_Mobile_App_Architecture.md) |
| **Database** | PostgreSQL | Multi-tenant schema with RLS | [Multi-Vendor Strategy](./docs/03_Multi_Vendor_Architecture.md) |
| **Cache & Broker** | Redis | Rate-limiting, session store & task broker | [System Design](./docs/02_System_Architecture.md) |
| **Object Storage** | MinIO | S3-compatible, self-hosted file system | [Tech Stack Details](./docs/01_Tech_Stack_And_Justification.md) |
| **Reverse Proxy** | Traefik | SSL Termination & dynamic domain routing | [Deployment](./docs/08_Docker_And_Deployment.md) |
| **Logging** | `tracenest` | Structured JSON log generation | [Observability](./docs/09_Logging_And_Observability.md) |
| **Orchestration** | Docker Compose | Run everything anywhere in isolation | [Docker Strategy](./docs/08_Docker_And_Deployment.md) |

---

## 3. Folder Structure

```text
/Tallyko
  ├── .gitignore                   # Root level git rules
  ├── .env.example                 # Template for local environment vars
  ├── VERSION                      # Current system semver
  ├── docker-compose.yml           # Core Docker orchestration skeleton
  ├── CHANGELOG.md                 # Semver release list
  ├── README.md                    # Main documentation page (this file)
  ├── /docs                        # Detailed markdown specifications
  │   └── /diagrams                # Draw.io source diagrams (.drawio)
  ├── /backend                     # FastAPI server & tests
  │   ├── /app                     # API logic, core configs, and routers
  │   └── /tests                   # Pytest suite (unit & integration)
  ├── /frontend                    # React Native mobile codebase
  │   ├── /src                     # Functional feature stubs
  │   └── /tests                   # React Native frontend tests
  ├── /scripts                     # Environment initialization & run scripts
  ├── /tests                       # Top-level e2e / cross-service tests
  └── /changelog                   # Versioned changelog releases
```

---

## 4. Setup Instructions

To get the development environment running locally:

### Prerequisites
- Install **Docker** and **Docker Compose**.
- Install **Git**.

### Steps to Run
1. **Clone the repository:**
   ```bash
   git clone <repo-url>
   cd Tallyko
   ```
2. **Bootstrap the environment:**
   - **Windows (PowerShell):**
     ```powershell
     .\scripts\setup.ps1
     ```
   - **POSIX (Linux/macOS):**
     ```bash
     chmod +x scripts/*.sh
     ./scripts/setup.sh
     ```
3. **Start the containers:**
   - **Windows (PowerShell):**
     ```powershell
     .\scripts\dev.ps1
     ```
   - **POSIX (Linux/macOS):**
     ```bash
     ./scripts/dev.sh
     ```
4. **Access the API:**
   Once the containers start up, the backend API is reachable at `http://localhost:8000/docs`.

---

## 5. Docker Deployment Topology

The system runs entirely containerized under Docker Compose:

![Tallyko Docker Deployment](./docs/diagrams/Tallyko_Docker_Deployment.png)

---

## 6. Data Model (ERD)

Strict relational model mapping the schema design:

![Tallyko Database ERD](./docs/diagrams/Tallyko_Database_ERD.png)

---

## 7. Versioning & Changelog

- We strictly adhere to **Semantic Versioning (SemVer)** rules.
- Check the [CHANGELOG.md](file:///c:/python/Tallyko/CHANGELOG.md) to inspect releases, which points to individual log files in [/changelog](file:///c:/python/Tallyko/changelog).
- Bumping the version requires updating the [VERSION](file:///c:/python/Tallyko/VERSION) file.

---

## 8. Development & Workflow

- **Branching Policy:** Work should happen on feature branches (e.g. `feature/001-auth-setup`) and merge into `main` via PRs.
- **Testing:**
  - Backend: Run `pytest` inside the `backend` container.
  - Frontend: Run `npm run test` in `/frontend`.
- **Pre-commit:** Code must be formatted (Black/Prettier) before commit.

---

## 9. License

[To be decided / Placeholders for Licensing Terms]
