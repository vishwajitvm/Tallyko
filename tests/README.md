# Top-Level E2E and Integration Tests

This folder holds cross-service integration and end-to-end (E2E) tests for the Tallyko ecosystem.

## Test Categorization

1. **Unit Tests (Inside Services):**
   * Located within `/backend/tests` and `/frontend/tests`.
   * These test code blocks (functions, classes, API routes, or React components) in isolation.
   * They do not depend on external running containers.

2. **Integration / E2E Tests (This Folder):**
   * Located here in `/tests`.
   * These test the full interaction between components. For example:
     * Syncing local database transactions from the Mobile App to the Backend API.
     * End-to-end auth and table ordering flows validating both proxy, cache, and database layers.
   * They require the full Docker Compose stack to be running in a test environment.
