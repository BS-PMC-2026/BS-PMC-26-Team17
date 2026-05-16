"""
Resets demographicPotential = 0 on every document in ShelterTest.

Usage (from the Backend folder):
    python -m scraper.reset_demographic
"""

import asyncio
import os
import certifi
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()

MONGODB_URL = os.getenv("MONGODB_URL", "mongodb://localhost:27017")
DATABASE_NAME = os.getenv("DATABASE_NAME", "tosafe_place")
COLLECTION = "ShelterTest"


async def main():
    client = AsyncIOMotorClient(
        MONGODB_URL,
        tls=True,
        tlsCAFile=certifi.where(),
        tlsAllowInvalidCertificates=True,
    )
    col = client[DATABASE_NAME][COLLECTION]

    result = await col.update_many({}, {"$set": {"demographicPotential": 0}})
    print(f"Reset demographicPotential = 0 on {result.modified_count} documents.")

    client.close()


if __name__ == "__main__":
    asyncio.run(main())
