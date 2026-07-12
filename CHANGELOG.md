# Changelog

All notable changes to the Tallyko project will be documented in versioned changelog files under the `/changelog` folder.

## Versioning Policy

Tallyko adheres strictly to [Semantic Versioning (SemVer)](https://semver.org/spec/v2.0.0.html) (`MAJOR.MINOR.PATCH`):
- **MAJOR** version bumps represent incompatible API changes or breaking DB modifications.
- **MINOR** version bumps represent backwards-compatible new features.
- **PATCH** version bumps represent backwards-compatible bug fixes and stability tweaks.

The **root [VERSION](file:///c:/python/Tallyko/VERSION)** file is the single source of truth for the active codebase version, and is read dynamically by the CI/CD pipeline to tag Docker images and native mobile app bundles.

## Release Index

- **[v1.0.0 (2026-07-12)](file:///c:/python/Tallyko/changelog/v1.0.0.md)** - Feature completion & Hardening: End-to-end POS, Inventory, KDS, Analytics, QR Menu. Implemented real Tesseract OCR for Menu AI. Hardened backend with proper async test lifecycles, global exception handling, and rate limiting. Replaced AsyncStorage with SecureStore for JWT tokens. Created CI/CD pipeline. Documented Bluetooth EAS Build constraints.
- **[v0.1.0 (2026-07-12)](file:///c:/python/Tallyko/changelog/v0.1.0.md)** - Scaffolding, architecture specs, and development environment setup.
