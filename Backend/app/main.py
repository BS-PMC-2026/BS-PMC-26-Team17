import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes import health, auth, shelters, reports, admin, settings, chat, buildings
from app.routes.MessageAll import geofence, broadcast
from app.core.database import client
from app.core.reservations import sweeper_loop


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        await client.admin.command("ping")
        print("✅ Connected to MongoDB Atlas!")
    except Exception as e:
        print(f"❌ MongoDB connection failed: {e}")

    # Kick off the reservation TTL sweeper. It runs forever in the
    # background, decrementing `reservedPlaces` on shelters as each
    # ShelterReservation row expires.
    sweeper_task = asyncio.create_task(sweeper_loop())
    try:
        yield
    finally:
        sweeper_task.cancel()
        try:
            await sweeper_task
        except (asyncio.CancelledError, Exception):
            pass


app = FastAPI(title="ToSafePlace API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    # allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(shelters.router)
app.include_router(reports.router)
app.include_router(admin.router)
app.include_router(geofence.router)
app.include_router(broadcast.router)
app.include_router(settings.router)
app.include_router(chat.router)
app.include_router(buildings.router)


@app.on_event("startup")
async def startup_db():
    try:
        await client.admin.command("ping")
        print("✅ Connected to MongoDB Atlas!")
    except Exception as e:
        print(f"❌ MongoDB connection failed: {e}")


@app.get("/")
def root():
    return {"message": "ToSafePlace API is running 🚀"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
