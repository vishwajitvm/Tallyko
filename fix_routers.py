import os

routers = [
    "tables", "kitchen", 
    "inventory", "crm", "analytics", "ai", "online_store"
]

for router in routers:
    filepath = f"c:/python/Tallyko/backend/app/api/{router}.py"
    if os.path.exists(filepath):
        with open(filepath, "r") as f:
            content = f.read()
        
        # Fix the syntax error
        content = content.replace(f"@{router}_endpoint = router.get(\"/\")", f"@router.get(\"/\")")
        
        with open(filepath, "w") as f:
            f.write(content)

print("Routers fixed.")
