from abc import ABC, abstractmethod

class Seeder(ABC):
    """A unit of seed data. Seeders must be idempotent: running one twice must not duplicate data."""

    #: name used on the command line: `python manage.py seed <name>`
    name: str = ""
    description: str = ""
    #: seeders that must run first (by name)
    depends_on: tuple[str, ...] = ()
    #: demo/sample data must never reach a production database
    allow_in_production: bool = False

    @abstractmethod
    async def run(self) -> str:
        """Seed the data; return a one-line summary for the console."""
