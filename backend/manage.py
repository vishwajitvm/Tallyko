#!/usr/bin/env python
"""Tallyko management CLI. Run `python manage.py --help` (inside the backend container:
`docker compose exec backend python manage.py --help`, or use scripts/db.sh / scripts/db.ps1)."""
import sys

from app.db.cli import main

if __name__ == "__main__":
    sys.exit(main())
