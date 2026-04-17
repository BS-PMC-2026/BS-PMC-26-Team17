from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.core.database import db

router = APIRouter(prefix="/auth", tags=["auth"])



class RegisterRequest(BaseModel):
    email: str
    password: str
    name: str
    role: str  # admin or user
@router.post("/register")
async def register(body: RegisterRequest):
    existing_user = await db["users"].find_one({"email": body.email})

    if existing_user:
        raise HTTPException(status_code=400, detail="User already exists")

    new_user = {
        "email": body.email,
        "password": body.password,
        "name": body.name,
        "role": body.role
    }

    await db["users"].insert_one(new_user)

    return {"message": "User registered successfully"}

class LoginRequest(BaseModel):
    email: str
    password: str
@router.post("/login")
async def login(body: LoginRequest):
    user = await db["users"].find_one({"email": body.email})

    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if user["password"] != body.password:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    return {
        "message": "Login successful",
        "user": {
            "id": str(user["_id"]),
            "email": user["email"],
            "name": user.get("name", ""),   
        }
    }
