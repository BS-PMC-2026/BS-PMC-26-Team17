from mongoengine import (
    Document, StringField, FloatField, IntField,
    BooleanField, DateTimeField
)


class ShelterTest(Document):
    # ── identity ───────────────────────────────────────────────────────────────
    name             = StringField(required=True)
    lat              = FloatField(required=True)
    lng              = FloatField(required=True)

    # ── location ───────────────────────────────────────────────────────────────
    city             = StringField(default="")
    address          = StringField(default="")
    neighborhood     = StringField(default="")
    alertZone        = StringField(default="לא ידוע")

    # ── shelter properties ────────────────────────────────────────────────────
    placeType        = StringField(default="")
    capacity         = IntField(default=0)
    reservedPlaces   = IntField(default=0)
    actualOccupancy  = IntField(default=0)
    isAccessible     = BooleanField(default=False)
    hasStairs        = BooleanField(default=False)
    entranceCode     = StringField(default="")

    # ── status ────────────────────────────────────────────────────────────────
    shouldBeOpen        = BooleanField(default=True)
    isActive            = BooleanField(default=True)
    isVisibleOnMap      = BooleanField(default=True)
    isArnonaDiscount    = BooleanField(default=False)
    petIssueReported    = BooleanField(default=False)
    isFull              = BooleanField(default=False)
    accessStatus        = StringField(default="unknown")
    cleanlinessStatus   = StringField(default="unknown")
    demographicPotential= IntField(default=0)

    # ── reports ───────────────────────────────────────────────────────────────
    lastReportAt     = DateTimeField(default=None)
    lastReportType   = StringField(default="")

    meta = {"collection": "ShelterTest"}
