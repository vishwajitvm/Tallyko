import os

routers = [
    "catalog", "billing", "tables", "kitchen", 
    "inventory", "crm", "analytics", "ai", "online_store"
]

router_template = """from fastapi import APIRouter

router = APIRouter(prefix="/{name}", tags=["{capitalized_name}"])

@{name}_endpoint = router.get("/")
def get_{name}():
    return {{"message": "{name} endpoint scaffolding"}}
"""

for router in routers:
    filepath = f"c:/python/Tallyko/backend/app/api/{router}.py"
    with open(filepath, "w") as f:
        f.write(router_template.format(name=router, capitalized_name=router.capitalize()))

print("Routers generated successfully.")
