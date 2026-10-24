# Changelog

All notable changes to Tallyko are documented in versioned files under [`changelog/`](./changelog).

## Versioning Policy

Tallyko follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html) (`MAJOR.MINOR.PATCH`):
- **MAJOR**: incompatible API changes or breaking database changes.
- **MINOR**: backwards-compatible features.
- **PATCH**: backwards-compatible fixes.

The root [`VERSION`](./VERSION) file is the single source of truth for the codebase version.

## Release Index

- **[v2.0.0 (2026-10-24)](./changelog/v2.0.0.md)** — Rebuild: new professional UI for web/Android/iOS, real GST billing engine with tax classes and dated rate changes, staff roles & permissions, offers & loyalty rewards with customer email, super admin console, offline billing with idempotent sync, real Bluetooth/ESC-POS printing, menu-from-photo OCR, aggregator (Swiggy/Zomato/ONDC/magicpin) order management, cloud-kitchen brands, loyalty, reports, enforced tenant isolation (JWT + PostgreSQL RLS), store-compliance work, Docker-based APK builds and free production deployment.
- **[v1.0.0 (2026-07-12)](./changelog/v1.0.0.md)** — Feature scaffolding (many features were mocked; superseded by 2.0.0).
- **[v0.1.0 (2026-07-12)](./changelog/v0.1.0.md)** — Scaffolding, architecture specs, and development environment setup.
