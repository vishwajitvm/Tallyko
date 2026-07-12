import asyncio
from sqlalchemy.future import select
from app.core.tenant import SharedSessionLocal
from app.models.models import Product

async def main():
    async with SharedSessionLocal() as session:
        result = await session.execute(select(Product))
        products = result.scalars().all()
        for p in products:
            if p.name.startswith("Test Prod"):
                print(f"Deleting test product: {p.name}")
                await session.delete(p)
        await session.commit()
        print("Done deleting test products.")

if __name__ == "__main__":
    asyncio.run(main())
