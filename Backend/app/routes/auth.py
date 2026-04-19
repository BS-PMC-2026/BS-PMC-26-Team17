from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.core.database import db

router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterRequest(BaseModel):
    firstName: str
    lastName: str
    email: str
    password: str
    telephone: str
    address: str


@router.post("/register")
async def register(body: RegisterRequest):
    existing_user = await db["User"].find_one({"email": body.email})
    name: str
    speed: int  # 1=Slow, 2=Medium, 3=Fast
    address: str

@router.post("/register")
async def register(body: RegisterRequest):
    if body.speed not in (1, 2, 3):
        raise HTTPException(status_code=400, detail="Speed must be 1, 2, or 3")

    existing_user = await db["users"].find_one({"email": body.email})

    if existing_user:
        raise HTTPException(status_code=400, detail="User already exists")

    new_user = {
        "firstName": body.firstName,
        "lastName": body.lastName,
        "email": body.email,
        "password": body.password,
        "telephone": body.telephone,
        "address": body.address,
        # defaults — filled later in settings page
        "neighborhood": "",
        "city": "",
        "hasHomeProtection": False,
        "homeLat": 0,
        "homeLng": 0,
        "speed": "",
        "isAccessible": False,
        "childrenCount": 0,
        "hasPets": False,
        "role": "",
        "mobilityType": "",
        "name": body.name,
        "speed": body.speed,
        "address": body.address,
    }

    await db["User"].insert_one(new_user)

    return {"message": "User registered successfully"}


class LoginRequest(BaseModel):
    email: str
    password: str


@router.post("/login")
async def login(body: LoginRequest):
    user = await db["User"].find_one({"email": body.email})

    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if user["password"] != body.password:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    return {
        "message": "Login successful",
        "user": {
            "id": str(user["_id"]),
            "email": user["email"],
            "name": user.get("firstName", "") + " " + user.get("lastName", ""),
        }
    }
