"""Seeder registry.

    python manage.py seed                 # every seeder below, in order
    python manage.py seed demo_staff      # one seeder (its dependencies run first)
    python manage.py seed --list

To add one: create a module with a `Seeder` subclass (idempotent `run()`), then register it in SEEDERS.
"""
from app.core.config import settings
from app.db.seeders.base import Seeder
from app.db.seeders.demo_restaurant import DemoRestaurantSeeder
from app.db.seeders.demo_staff import DemoStaffSeeder
from app.db.seeders.demo_retail import DemoRetailSeeder
from app.db.seeders.platform_defaults import PlatformDefaultsSeeder
from app.db.seeders.demo_platform_admins import DemoPlatformAdminsSeeder
from app.db.seeders.demo_subscriptions import DemoSubscriptionsSeeder
from app.db.seeders.demo_cloud_kitchen import DemoCloudKitchenSeeder

SEEDERS: list[Seeder] = [PlatformDefaultsSeeder(), DemoPlatformAdminsSeeder(), DemoRestaurantSeeder(), DemoStaffSeeder(), DemoRetailSeeder(), DemoCloudKitchenSeeder(), DemoSubscriptionsSeeder()]
BY_NAME = {s.name: s for s in SEEDERS}

def resolve(names: list[str] | None) -> list[Seeder]:
    """Requested seeders plus their dependencies, in dependency order. Unknown names raise KeyError."""
    if not names:
        return list(SEEDERS)
    ordered: list[Seeder] = []
    def visit(name: str):
        seeder = BY_NAME[name]
        for dependency in seeder.depends_on:
            visit(dependency)
        if seeder not in ordered:
            ordered.append(seeder)
    for name in names:
        visit(name)
    return ordered

async def run_seeders(names: list[str] | None = None) -> list[tuple[str, str]]:
    results = []
    for seeder in resolve(names):
        if settings.ENVIRONMENT == "production" and not seeder.allow_in_production:
            results.append((seeder.name, "skipped (demo data is never seeded in production)"))
            continue
        results.append((seeder.name, await seeder.run()))
    return results
