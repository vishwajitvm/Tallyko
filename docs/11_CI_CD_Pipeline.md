# CI/CD Pipeline

## 1. Automation Philosophy

To ensure reliability and prevent the "performance regressions after updates" flaw seen in competitors, Tallyko relies on an automated CI/CD (Continuous Integration / Continuous Deployment) pipeline. 

No developer is permitted to manually deploy code to production. All changes must pass through automated testing and build phases before being rolled out.

## 2. Pipeline Stages (GitHub Actions / GitLab CI)

The pipeline is triggered upon pushing to specific branches (`main` for production, `staging` for the test environment).

### Stage 1: Integration, Testing & Security Auditing
*   **Workflow file:** `.github/workflows/ci.yml` is executed on every push and pull request.
*   **Security Auditing:** Runs `pip-audit` for the Python backend and `npm audit` for the React Native frontend to catch vulnerable transitive dependencies.
*   **Linting & Formatting:** Enforces Python (PEP8/Black) and JavaScript/TypeScript (Prettier/ESLint) standards.
*   **Unit Tests:** Executes automated tests via `pytest` against the FastAPI backend, utilizing a dynamically injected `NullPool` database connection to ensure isolated test environments.

### Stage 2: Build & Package
*   **Backend:** Docker images for the API and Worker are built and tagged with the git commit hash.
*   **Mobile App:** Trigger cloud build services (like EAS Build for React Native or Fastlane) to compile the `.apk` (Android) and `.ipa` (iOS) files.
*   **Artifact Registry:** Docker images are pushed to a container registry (e.g., GitHub Packages or Docker Hub).

### Stage 3: Deployment (Backend)
*   **Staging:** Immediately deployed to the staging server.
*   **Production (Staged Rollout):** Deploys to production using a rolling update strategy via Docker Compose or Swarm, ensuring zero downtime.

## 3. Staged Rollout Strategy

To prevent system-wide outages from a bad update:

1.  Traefik routes 90% of traffic to the older API containers and 10% to the newly deployed container (Canary release).
2.  The pipeline monitors logs (via the tracing setup described in `09_Logging_And_Observability.md`) for 500 errors in the canary container.
3.  If error rates spike, the pipeline automatically aborts the rollout and routes 100% of traffic back to the old version.
4.  If successful, the rollout expands to 100% over a defined time window.

## 4. Pipeline Architecture Diagram

```mermaid
flowchart TD
    Developer[Developer Push to main]
    
    subgraph CI [Continuous Integration]
        Lint[Lint & Code Quality]
        Test[Unit & Integration Tests]
        Build[Build Docker Images]
        Registry[(Container Registry)]
    end
    
    subgraph CD [Continuous Deployment]
        DeployStaging[Deploy to Staging]
        DeployCanary[Deploy Canary to Prod (10%)]
        Monitor[Monitor Error Rates]
        RolloutFull[Full Production Rollout]
        Rollback[Automated Rollback]
    end

    Developer --> Lint
    Lint --> Test
    Test --> Build
    Build --> Registry
    Registry --> DeployStaging
    DeployStaging --> DeployCanary
    
    DeployCanary --> Monitor
    Monitor --"If Errors Spike"--> Rollback
    Monitor --"If Healthy"--> RolloutFull
```
