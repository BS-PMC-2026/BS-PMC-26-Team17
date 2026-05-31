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


class ShelterReservation(Document):
    """
    A user's intent to head to a specific shelter during a specific Pikud
    HaOref alert. Created by POST /shelters/{id}/reserve.

    Why per-row instead of just bumping a counter:
      - lets the TTL sweeper decrement by exactly the right amount when it
        rolls back an expired reservation
      - lets us upsert by (userId, shelterId, alertId) so the same user
        changing their group size during the same alert updates one row
        instead of stacking duplicates
      - auditable: we know who reserved where during which event

    Lifecycle:
      created → (sweeper after expiresAt) → rolledBack
    """
    shelterId  = StringField(required=True)
    userId     = StringField(required=True)
    alertId    = StringField(required=True)
    alertKind  = StringField(default="siren")        # "early" | "siren"
    groupSize  = IntField(required=True, min_value=1, max_value=20)

    createdAt  = DateTimeField(required=True)
    expiresAt  = DateTimeField(required=True)        # createdAt + TTL window
    rolledBack = BooleanField(default=False)

    meta = {
        "collection": "ShelterReservation",
        "indexes": [
            # Upsert lookup
            {"fields": ["userId", "shelterId", "alertId"]},
            # Sweeper scan — finds expired but not-yet-rolled-back rows
            {"fields": ["expiresAt", "rolledBack"]},
        ],
    }
