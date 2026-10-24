# 17. Deploying Tallyko for free

Everything here is **permanently free** (no trials): open-source software plus free tiers that don't expire.
The whole system is one Docker Compose file (`docker-compose.prod.yml`): PostgreSQL, Redis, the API, and Caddy
(serves the web app + API and gets free HTTPS certificates from Let's Encrypt). The email worker and the daily
subscription check run inside the API container; there are no other services. Diagram: [18_deployment](./diagrams/mermaid/18_deployment.mmd)
(draw.io: [`Tallyko_Docker_Deployment.drawio`](./diagrams/Tallyko_Docker_Deployment.drawio)).

## Option A — Shop PC on the local Wi-Fi (simplest, works without internet)

Best for a single shop. Billing keeps working when the internet is down because every device talks to the PC.

1. Any always-on Windows/Linux PC or mini-PC with 4 GB+ RAM. Install Docker Desktop (Windows) or Docker Engine (Linux).
2. Copy the project, then:
   ```bash
   cp .env.example .env
   # edit .env: DOMAIN=:80, set JWT_SECRET (openssl rand -hex 32) and POSTGRES_PASSWORD
   docker compose -f docker-compose.prod.yml up -d --build
   ```
3. Give the PC a fixed IP in your router (e.g. `192.168.1.20`). Tablets/phones on the same Wi-Fi open `http://192.168.1.20`.
   In the Android/iOS app, tap *Server* on the sign-in screen and enter `192.168.1.20`.
4. Backups: `scripts/backup_db.sh` (or `.ps1`) nightly to a USB drive or cloud folder.

Plain HTTP is acceptable only inside the shop LAN. Web Bluetooth and "Install app" need HTTPS — use Option B or a tunnel for those.

Optional remote access for free: **Tailscale** (free personal plan) puts your phone and the shop PC on a private network, so the owner can check reports from anywhere without exposing the server to the internet.

## Option B — Free cloud server with your own HTTPS address

**Oracle Cloud "Always Free"** gives a permanently free ARM VM (up to 4 CPUs / 24 GB RAM in the Ampere A1 shape) — far more than Tallyko needs. Sign-up asks for a card for identity verification; Always Free resources are not charged. Capacity in a region is sometimes temporarily unavailable — retry or pick another home region.

1. Create an Ubuntu VM (Ampere A1, 1–2 OCPU / 6–12 GB is plenty). In the VCN security list allow inbound TCP 80 and 443 (and UDP 443). On the VM: `sudo iptables -I INPUT -p tcp -m multiport --dports 80,443 -j ACCEPT` (Oracle images block them by default).
2. Install Docker: `curl -fsSL https://get.docker.com | sh`.
3. Free domain name: **DuckDNS** (free, permanent subdomains like `mydhaba.duckdns.org`) — point it at the VM's public IP. Or use a domain you own.
4. Deploy:
   ```bash
   git clone <your repo> tallyko && cd tallyko
   cp .env.example .env
   # edit .env: DOMAIN=mydhaba.duckdns.org, ACME_EMAIL, JWT_SECRET, POSTGRES_PASSWORD
   docker compose -f docker-compose.prod.yml up -d --build
   ```
   Caddy obtains the HTTPS certificate automatically within a minute. Open `https://mydhaba.duckdns.org`.
5. Updates: `git pull && docker compose -f docker-compose.prod.yml up -d --build` (migrations run automatically on start; they are forward-only so old app versions keep working during the switch).
6. Backups: cron `scripts/backup_db.sh` and copy the dump off the VM (e.g. to Google Drive with rclone — free).

All images used are multi-arch, so they run on Oracle's ARM VMs. The OCR engine (onnxruntime) ships ARM64 wheels too.

## Mobile apps pointing at your server

Set `APK_API_URL=https://mydhaba.duckdns.org/api/v1` in `.env` and build the APK (`docker compose --profile android run --rm android-build`). Users can still change the server on the sign-in screen.

## Checklist before going live

- `JWT_SECRET` is random and ≥32 chars (the API refuses to start in production otherwise), database password changed.
- `/docs` is disabled automatically in production.
- Fill in the company name and contact email placeholders in the privacy policy (`frontend/src/app/privacy.tsx`).
- Set up backups and test a restore once.
- Customer emails: set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD` and `SMTP_FROM_EMAIL` in `.env`. The production compose passes them to
  the backend; `PUBLIC_APP_URL` defaults to `https://$DOMAIN`. Without `SMTP_HOST`, emails are logged as `skipped`.
  Any SMTP works (Gmail app password, Brevo or Zoho free tiers).
- Create the first platform admin: `docker compose -f docker-compose.prod.yml exec backend python manage.py create:superadmin you@company.com`.
- Store submissions: follow [18_App_Store_And_Play_Compliance.md](./18_App_Store_And_Play_Compliance.md).
