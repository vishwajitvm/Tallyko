---
name: add-feature
description: Add a new Tallyko feature or extend an existing one end-to-end (spec, SQLAlchemy model, Alembic migration, Pydantic schema, FastAPI router, React Native screen, tests). Use when the user asks to build, implement, or extend a POS module such as billing, catalog, tables, KDS, inventory, CRM, analytics, QR menu, AI upload, or online store.
---

# Add or extend a Tallyko feature

Work through these steps in order. Skip a step only when it truly doesn't apply, and say so.

## 1. Read the spec first
- Find the spec in `docs/features/` (match by name; numbers drift from folder numbers — see the table in `CLAUDE.md`).
- Check `docs/14_Roadmap_And_Chronology.md` for build-order dependencies.
- If no spec exists, or the request contradicts it, draft/update the spec in the same change
  using the existing two-section format: *For the Business Owner* (what / why / examples / edge cases)
  and *For the Developer* (data model, endpoints, request/response, validation, multi-tenant notes,
  tracenest events, complexity, mermaid sequence diagram).

## 2. Data model — `backend/app/models/models.py`
- Tenant tables **must** have `tenant_id = Column(UUID(as_uuid=True), nullable=False, index=True)`.
- UUID primary keys (`default=uuid.uuid4`), money as `Numeric(10, 2)`, soft delete via `is_active` where it makes sense.
- Records that sync offline need `updated_at` and `deleted_at` (see `docs/07_Offline_Sync_Strategy.md`).
- Then run the `db-migration` skill.

## 3. Schema — `backend/app/schemas/<domain>.py`
- Separate `XCreate`, `XUpdate` (all optional), `XResponse` (`model_config = {"from_attributes": True}` / `orm_mode`).

## 4. Router — `backend/app/api/<domain>.py`
- `router = APIRouter(prefix="/<domain>", tags=["<Domain>"])`; mount in `app/main.py` under `/api/v1`.
- Dependencies for authenticated routes: `current_user: TokenData = Depends(get_current_user)` (or
  `Depends(RoleChecker([...]))`) plus `db=Depends(get_tenant_db)`; `tenant_id = current_user.tenant_id`.
- Public routes (QR menu, store) use `db=Depends(get_public_tenant_db)` with a `tenant_id: UUID` path param and expose only safe fields.
- Filter **every** query by `tenant_id` (RLS is the backstop, not the guard). Before inserting a row that points at
  another row by id from the request, verify that row belongs to the tenant — FK checks bypass RLS.
- Log with `logger = logging.getLogger("tallyko")`, prefix `[Domain]`.
- Rate-limit public / expensive endpoints with `await rate_limit(request, requests=N, window=60)`.
- Prefer the `{"success": true, "data": ...}` envelope for new routes; never break an existing `/api/v1` shape.
- Put multi-step business logic in `app/services/<domain>_service.py`.

## 5. Tests — `backend/tests/integration/test_<domain>.py`
- `@pytest.mark.asyncio` with the `client`, `tenant_a`, `tenant_b` fixtures from `tests/conftest.py`.
- Cover the happy path, validation errors, and **a cross-tenant access attempt** (tenant B must not see tenant A's rows).
- Add new protected routes to `PROTECTED_ROUTES` in `tests/integration/test_tenant_isolation.py`.

## 6. Frontend — `frontend/src/NNN_<feature>/<Name>Screen.js`
- Functional component; colours from `useTheme().colors`; Ionicons; 4/8pt spacing (`docs/08_Design_System.md`).
- Use the shared client in `src/services/api.js` for new code rather than raw axios + a local `API_URL`.
- Register the screen in `frontend/App.js` (tab + icon) if it is top-level.
- Keep taps minimal; large touch targets for POS flows.

## 7. Wrap up
- Update `CLAUDE.md` "Current state" / "Known gaps" if you changed what they describe.
- Run the `run-and-test` skill. Report what you could and could not verify.
