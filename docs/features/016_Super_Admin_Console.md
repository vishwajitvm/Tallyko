# 016 · Super Admin Console (Tallyko platform)

The console is for the people who run Tallyko, not for shops. It contains **no orders, menus or billing**: only businesses, plans, payments and the GST library.

## Logins

Platform accounts have `platform_role` set on their global user. They sign in on the normal login screen and land on `/admin`.

| Role | Can |
|---|---|
| `super_admin` | Everything below |
| `support` | Read-only: look up businesses, plans, the tax library and the audit trail to help a customer |

The very first admin on a real server:

```bash
docker compose exec backend python manage.py create:superadmin you@company.com --name "Your Name"
```

This prompts for a password, or prints a generated one. In development, `manage.py seed` creates `superadmin@example.com`, `superadmin2@example.com`, `support@example.com` and `support2@example.com`, all with password `Demo@1234`.

Platform tokens carry no tenant: every business API (`/orders`, `/catalog`, …) answers 403 to them. Business tokens get 403 on `/platform/*`.

## What the super admin manages

- **Overview**:
  - active and suspended businesses;
  - new this month;
  - payments recorded this month;
  - renewals due in 7 days;
  - businesses by plan and by type.
- **Businesses**:
  - search and filter;
  - onboard a business for a customer (it gets a temporary owner password);
  - suspend or reactivate with a reason. Suspended businesses are blocked at the database-session level.
  - reset the owner's password;
  - internal notes.
- **Features per business**:
  - pick the plan;
  - then override single modules on or off, for example "Standard but with Swiggy/Zomato", or "Pro without staff accounts";
  - override limits such as `max_staff`.
- **Payments / subscriptions**:
  - record a payment: plan, months, amount, method (UPI / bank / cash / card / cheque / free) and reference.
  - Each subscription stores an immutable **snapshot** of the plan's features, limits and price, so later plan edits don't change what was sold.
  - Recording a payment reactivates a business that was suspended for non-payment.
- **Plans**: name, monthly price, included modules, limits.
- **GST library**:
  - platform tax presets with dated rate versions;
  - publishing a version schedules it for every business class that follows the preset.
- **Audit**: every platform action, with who did it and when.

## Subscriptions, demo, development access, devices

See [018](./018_Subscriptions_Demo_And_Sessions.md). In the console:

- **Per business:**
  - give or extend a free demo (7 / 14 / 30 days…);
  - switch on **Development access** (no expiry, until switched off);
  - record a payment with an offer code and a live price quote;
  - see signed-in devices and sign out one or all.
- **Payment requests:** owners' "I've paid" claims, which you approve (instant unlock) or reject (the owner sees why).
- **Subscription offers:** promotions on Tallyko plans, either % or ₹ off, or extra free days, optionally with a code.
- **Plans:** pricing options per duration (monthly / quarterly / yearly).
- **Settings:**
  - default demo length;
  - grace days;
  - reminder window;
  - the UPI and bank details owners see;
  - the daily 01:00 IST check (last run, next run, run now).

## API

All under `/api/v1/platform`:
- `/me`, `/overview`;
- `/businesses[/{id}]`, `/businesses/{id}/reset-owner-password`, `/businesses/{id}/subscriptions`;
- `/plans`;
- `/subscription-offers`, `/subscription-requests/{id}/approve|reject`;
- `/businesses/{id}/demo|development|sessions|sign-out|quote`, `/sessions/{id}/revoke`;
- `/settings`, `/jobs`, `/jobs/subscription-check`;
- `/tax/presets[/{key}/rates]`;
- `/audit`.

Writes require `super_admin` (`require_super_admin`).

## Notes

- Payments are recorded manually. There is no payment gateway, by design: no paid services.
- Selling plans inside the iOS app would need Apple In-App Purchase (App Store guideline 3.1). Keep billing outside the apps, as the console does.

## Diagrams

- Subscription states and the daily check: [10_subscription_lifecycle](../diagrams/mermaid/10_subscription_lifecycle.mmd), [11_daily_subscription_check](../diagrams/mermaid/11_daily_subscription_check.mmd) · draw.io: [`Tallyko_Subscriptions_Lifecycle.drawio`](../diagrams/Tallyko_Subscriptions_Lifecycle.drawio)
- Owner requests, archive and hard delete: [12_records_and_watch](../diagrams/mermaid/12_records_and_watch.mmd) · draw.io: [`Tallyko_Records_And_Audit.drawio`](../diagrams/Tallyko_Records_And_Audit.drawio)
- Platform tables: [16_erd_platform](../diagrams/mermaid/16_erd_platform.mmd)

Console writes run in system sessions (no tenant RLS) and every action is written to `platform_audit_logs`.
