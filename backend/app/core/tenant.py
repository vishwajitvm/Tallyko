# Placeholder for Tenant database routing connection resolver

def get_tenant_db_connection(tenant_id: str) -> str:
    """
    Given a tenant_id, resolve their connection string from Global DB or cache.
    Placeholder returns default shared DB URL for now.
    """
    from app.core.config import settings
    return settings.DATABASE_URL
