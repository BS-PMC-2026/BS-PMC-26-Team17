from fastapi import APIRouter

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health")
def health_check():
    return {"status": "ok", "service": "ToSafePlace API"}


@router.get("/ping")
def ping():
    return {"message": "pong 🏓", "app": "ToSafePlace"}
