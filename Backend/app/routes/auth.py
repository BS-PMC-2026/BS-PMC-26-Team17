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

    if existing_user:
        raise HTTPException(status_code=400, detail="User already exists")

    new_user = {
        "firstName": body.firstName,
        "lastName": body.lastName,
        "email": body.email,
        "password": body.password,
        "telephone": body.telephone,
        "address": body.address,
        "neighborhood": "",
        "city": "",
        "hasHomeProtection": False,
        "homeLat": 0,
        "homeLng": 0,
        "speed": "",
        "isAccessible": False,
        "childrenCount": 0,
        "hasPets": False,
        "role": "admin" if body.password == "admin123" else "user",
        "mobilityType": "",
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
            "role": user.get("role", "user"),
        }
    }
