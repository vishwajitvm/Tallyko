# .claude/ — Claude Code project config for Tallyko

Project memory lives in the root `CLAUDE.md`. This folder holds reusable workflows.

## Skills (`.claude/skills/<name>/SKILL.md`)

Invoke with `/<name>` or let Claude pick them up from their description.

| Skill | Use it to |
|---|---|
| `add-feature` | Add or extend a feature end-to-end: spec → model → migration → schema → router → screen → test |
| `db-migration` | Create and apply an Alembic migration safely (forward-only, tenant_id, RLS) |
| `run-and-test` | Bring up the Docker stack, run backend/frontend tests, read tracenest logs |
| `release` | Bump `VERSION`, write `changelog/vX.Y.Z.md`, update `CHANGELOG.md` |

## Agents (`.claude/agents/<name>.md`)

| Agent | Use it to |
|---|---|
| `tenant-isolation-reviewer` | Review a diff for cross-tenant data leaks, missing auth/RBAC, and RLS gaps |
| `spec-sync-checker` | Compare code against `docs/` specs and list drift in either direction |

## Adding more

- Skill: create `.claude/skills/<kebab-name>/SKILL.md` with `name` and `description` frontmatter.
  The description decides when it triggers — say *when* to use it, not just what it does.
- Agent: create `.claude/agents/<kebab-name>.md` with `name`, `description`, optional `tools`.
- Add a row to the tables above.
