from pydantic import BaseModel
from typing import Optional

class UserSettings(BaseModel):
    user_id: str
    address: Optional[str] = ""
    exclusion_radius: float = 0.0
    transport_mode: str = "walking"
    is_handicapped: bool = False