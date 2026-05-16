from pydantic import BaseModel
from typing import Optional

class UserSettings(BaseModel):
    user_id: str
    address: Optional[str] = ""
    home_lat: Optional[float] = None
    home_lng: Optional[float] = None
    exclusion_radius: float = 0.0
    transport_mode: str = "walking"
    is_handicapped: bool = False


class ReportCreate(BaseModel):
    shelterId: str
    userId: str
    reportCategory: str
    reportType: str
    description: Optional[str] = ""
    reporterLat: Optional[float] = None
    reporterLng: Optional[float] = None
    reporterNumber: str
    callbackNumber: Optional[str] = ""