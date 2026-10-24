---
name: release
description: Cut a Tallyko release - bump the SemVer VERSION file, write changelog/vX.Y.Z.md, and add it to CHANGELOG.md. Use when the user asks to release, bump the version, tag, or update the changelog.
---

# Release Tallyko

`VERSION` at the repo root is the single source of truth (CI reads it to tag images and app bundles).

1. Decide the bump from the changes since the last release (`git log <last-tag-or-commit>..HEAD`):
   - **MAJOR** – breaking API change or breaking DB change
   - **MINOR** – backwards-compatible feature
   - **PATCH** – backwards-compatible fix
   Ask the user if it's ambiguous.
2. Write the new version to `VERSION` (just `X.Y.Z`, newline-terminated).
3. Create `changelog/vX.Y.Z.md` following `changelog/v1.0.0.md`:
   ```markdown
   # vX.Y.Z (YYYY-MM-DD)

   ## Features & Enhancements
   - **Area**: what changed, in user terms.

   ## Bug Fixes
   - ...
   ```
   Only list what actually changed — be honest about stubs/mocks.
4. Add a line at the **top** of the Release Index in `CHANGELOG.md` linking `./changelog/vX.Y.Z.md`
   (use relative links, not the old `file:///c:/python/...` ones).
5. Keep other version strings in step: `backend/app/main.py` (`FastAPI(version=...)` and `/health`),
   `frontend/app.json` `expo.version`, and the README badge.
6. Update the "Current state" heading date/version in `CLAUDE.md`.
7. Do not tag or push unless the user asks.
