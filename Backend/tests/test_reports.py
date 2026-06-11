"""Tests for the report submission endpoint (POST /reports) and listing (GET /reports).

The handler does three notable things we need to verify:
1. Inserts a report document with a sequential `number` and the right shape.
2. Computes `isVerified` based on haversine distance between the reporter
   and the shelter (true if within 50m).
3. Populates `reporterNumber` from the User collection by `userId`, falling
   back to the value sent in the request body if the user isn't found.
"""

import pytest
from unittest.mock import patch, MagicMock, AsyncMock
from bson import ObjectId


# A real-looking ObjectId we can hand back from inserts
INSERTED_ID = ObjectId("65a1b2c3d4e5f6a7b8c9d0e1")
SHELTER_ID = "65a1b2c3d4e5f6a7b8c9d0e2"
USER_ID = "65a1b2c3d4e5f6a7b8c9d0e3"


def make_async_iter(items):
    class AsyncIter:
        def __init__(self, data):
            self._iter = iter(data)
        def __aiter__(self):
            return self
        async def __anext__(self):
            try:
                return next(self._iter)
            except StopIteration:
                raise StopAsyncIteration
    return AsyncIter(items)


def _empty_async_iter():
    class _AsyncIter:
        def __aiter__(self):
            return self
        async def __anext__(self):
            raise StopAsyncIteration
    return _AsyncIter()


def build_db_mock(*, shelter=None, user=None, report_count=0):
    """Build a db mock that returns different collection mocks per name.

    - `db["Report"]` supports count_documents and insert_one
    - `db["ShelterTest"]` supports find_one (returns the given shelter)
    - `db["User"]` supports find_one (returns the given user) and find() yields nothing
    - `db["NotificationLog"]` is a no-op stub so the closed-shelter background
      task can run without crashing — its DB writes are irrelevant to these tests
    """
    report_coll = MagicMock()
    report_coll.count_documents = AsyncMock(return_value=report_count)
    report_coll.insert_one = AsyncMock(return_value=MagicMock(inserted_id=INSERTED_ID))

    shelter_coll = MagicMock()
    shelter_coll.find_one  = AsyncMock(return_value=shelter)
    # Verified closed/locked reports now flip the shelter's accessStatus.
    # AsyncMock so the awaited call in create_report doesn't crash and tests
    # can assert it was (or wasn't) called.
    shelter_coll.update_one = AsyncMock(return_value=MagicMock(matched_count=1))

    user_coll = MagicMock()
    user_coll.find_one = AsyncMock(return_value=user)
    # The notification task iterates over admins with `async for admin in db["User"].find(...)`
    user_coll.find = MagicMock(return_value=_empty_async_iter())

    notif_coll = MagicMock()
    notif_coll.find_one = AsyncMock(return_value=None)
    notif_coll.insert_one = AsyncMock(return_value=MagicMock(inserted_id="x"))

    def get_collection(name):
        return {
            "Report": report_coll,
            "ShelterTest": shelter_coll,
            "User": user_coll,
            "NotificationLog": notif_coll,
        }[name]

    db = MagicMock()
    db.__getitem__.side_effect = get_collection
    return db, report_coll


def base_body(**overrides):
    body = {
        "shelterId": SHELTER_ID,
        "userId": USER_ID,
        "reportCategory": "access",
        "reportType": "closed",
        "description": "Door was locked",
        "reporterLat": 32.0853,
        "reporterLng": 34.7818,
        "reporterNumber": "0500000000",
        "callbackNumber": "0511111111",
    }
    body.update(overrides)
    return body


# ── Happy path ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_report_returns_success(async_client):
    db, _ = build_db_mock(
        shelter={"_id": ObjectId(SHELTER_ID), "lat": 32.0853, "lng": 34.7818},
        user={"_id": ObjectId(USER_ID), "telephone": "0521234567"},
    )
    with patch("app.routes.reports.db", db):
        response = await async_client.post("/reports", json=base_body())

    assert response.status_code == 200
    data = response.json()
    assert data["message"] == "Report submitted successfully"
    assert data["reportId"] == str(INSERTED_ID)


@pytest.mark.asyncio
async def test_report_document_has_expected_shape(async_client):
    db, report_coll = build_db_mock(
        shelter={"_id": ObjectId(SHELTER_ID), "lat": 32.0853, "lng": 34.7818},
        user={"_id": ObjectId(USER_ID), "telephone": "0521234567"},
        report_count=4,
    )
    with patch("app.routes.reports.db", db):
        await async_client.post("/reports", json=base_body())

    # Grab the document we attempted to insert
    inserted = report_coll.insert_one.call_args.args[0]
    assert inserted["number"] == 5  # count + 1
    assert inserted["shelterId"] == SHELTER_ID
    assert inserted["userId"] == USER_ID
    assert inserted["reportCategory"] == "access"
    assert inserted["reportType"] == "closed"
    assert inserted["description"] == "Door was locked"
    assert inserted["status"] == "pending"
    assert inserted["forwardedAt"] is None
    assert inserted["resolvedAt"] is None
    assert inserted["handledBy"] is None
    assert "createdAt" in inserted
    assert "isVerified" in inserted


# ── isVerified logic ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_is_verified_true_when_reporter_within_50m(async_client):
    # Reporter at the exact same point as the shelter → distance 0
    db, report_coll = build_db_mock(
        shelter={"_id": ObjectId(SHELTER_ID), "lat": 32.0853, "lng": 34.7818},
        user={"_id": ObjectId(USER_ID), "telephone": "0521234567"},
    )
    with patch("app.routes.reports.db", db):
        await async_client.post("/reports", json=base_body(
            reporterLat=32.0853, reporterLng=34.7818,
        ))

    inserted = report_coll.insert_one.call_args.args[0]
    assert inserted["isVerified"] is True


@pytest.mark.asyncio
async def test_is_verified_false_when_reporter_far_from_shelter(async_client):
    # Shelter in Tel Aviv, reporter ~520m north — well beyond the 50m threshold
    db, report_coll = build_db_mock(
        shelter={"_id": ObjectId(SHELTER_ID), "lat": 32.0853, "lng": 34.7818},
        user={"_id": ObjectId(USER_ID), "telephone": "0521234567"},
    )
    with patch("app.routes.reports.db", db):
        await async_client.post("/reports", json=base_body(
            reporterLat=32.0900, reporterLng=34.7818,
        ))

    inserted = report_coll.insert_one.call_args.args[0]
    assert inserted["isVerified"] is False


@pytest.mark.asyncio
async def test_is_verified_false_when_reporter_coords_missing(async_client):
    db, report_coll = build_db_mock(
        shelter={"_id": ObjectId(SHELTER_ID), "lat": 32.0853, "lng": 34.7818},
        user={"_id": ObjectId(USER_ID), "telephone": "0521234567"},
    )
    with patch("app.routes.reports.db", db):
        await async_client.post("/reports", json=base_body(
            reporterLat=None, reporterLng=None,
        ))

    inserted = report_coll.insert_one.call_args.args[0]
    assert inserted["isVerified"] is False


@pytest.mark.asyncio
async def test_is_verified_false_when_shelter_has_no_coords(async_client):
    # Shelter exists but has no lat/lng fields → cannot compute distance
    db, report_coll = build_db_mock(
        shelter={"_id": ObjectId(SHELTER_ID), "name": "Shelter without coords"},
        user={"_id": ObjectId(USER_ID), "telephone": "0521234567"},
    )
    with patch("app.routes.reports.db", db):
        await async_client.post("/reports", json=base_body())

    inserted = report_coll.insert_one.call_args.args[0]
    assert inserted["isVerified"] is False


@pytest.mark.asyncio
async def test_is_verified_false_when_shelter_not_found(async_client):
    db, report_coll = build_db_mock(
        shelter=None,
        user={"_id": ObjectId(USER_ID), "telephone": "0521234567"},
    )
    with patch("app.routes.reports.db", db):
        await async_client.post("/reports", json=base_body())

    inserted = report_coll.insert_one.call_args.args[0]
    assert inserted["isVerified"] is False


# ── reporterNumber sourcing ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_reporter_number_pulled_from_user_table(async_client):
    """The phone in the DB takes priority over whatever the client sent."""
    db, report_coll = build_db_mock(
        shelter={"_id": ObjectId(SHELTER_ID), "lat": 32.0853, "lng": 34.7818},
        user={"_id": ObjectId(USER_ID), "telephone": "0521234567"},
    )
    with patch("app.routes.reports.db", db):
        # Client sends a different (stale) number — the DB value should win
        await async_client.post("/reports", json=base_body(reporterNumber="STALE"))

    inserted = report_coll.insert_one.call_args.args[0]
    assert inserted["reporterNumber"] == "0521234567"


@pytest.mark.asyncio
async def test_reporter_number_falls_back_to_body_when_user_missing(async_client):
    """If no user is found, fall back to what the client sent so we don't
    silently drop the reporter's phone."""
    db, report_coll = build_db_mock(
        shelter={"_id": ObjectId(SHELTER_ID), "lat": 32.0853, "lng": 34.7818},
        user=None,
    )
    with patch("app.routes.reports.db", db):
        await async_client.post("/reports", json=base_body(reporterNumber="0599999999"))

    inserted = report_coll.insert_one.call_args.args[0]
    assert inserted["reporterNumber"] == "0599999999"


@pytest.mark.asyncio
async def test_reporter_number_empty_when_user_missing_and_body_blank(async_client):
    db, report_coll = build_db_mock(
        shelter={"_id": ObjectId(SHELTER_ID), "lat": 32.0853, "lng": 34.7818},
        user=None,
    )
    with patch("app.routes.reports.db", db):
        await async_client.post("/reports", json=base_body(reporterNumber=""))

    inserted = report_coll.insert_one.call_args.args[0]
    assert inserted["reporterNumber"] == ""


# ── Validation ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_missing_required_field_returns_422(async_client):
    """FastAPI/Pydantic should reject a body that's missing shelterId."""
    bad = base_body()
    bad.pop("shelterId")
    response = await async_client.post("/reports", json=bad)
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_empty_description_is_allowed(async_client):
    db, report_coll = build_db_mock(
        shelter={"_id": ObjectId(SHELTER_ID), "lat": 32.0853, "lng": 34.7818},
        user={"_id": ObjectId(USER_ID), "telephone": "0521234567"},
    )
    with patch("app.routes.reports.db", db):
        response = await async_client.post("/reports", json=base_body(description=""))
    assert response.status_code == 200
    inserted = report_coll.insert_one.call_args.args[0]
    assert inserted["description"] == ""


# ── Notification trigger ────────────────────────────────────────────────────
# These assert the *trigger condition* — that the background task is queued
# for the right report types and not others. The orchestration of the
# notification itself (coalescing, admin filtering, push payload, log writes)
# lives in test_notifications.py.

@pytest.mark.asyncio
async def test_closed_report_triggers_notification(async_client):
    db, _ = build_db_mock(
        shelter={"_id": ObjectId(SHELTER_ID), "lat": 32.0853, "lng": 34.7818},
        user={"_id": ObjectId(USER_ID), "telephone": "0521234567"},
    )
    with patch("app.routes.reports.db", db), \
         patch("app.routes.reports._notify_admins_urgent_report") as notify_mock:
        await async_client.post(
            "/reports",
            json=base_body(reportCategory="access", reportType="closed"),
        )

    notify_mock.assert_called_once()
    args = notify_mock.call_args.args
    assert args[0] == SHELTER_ID
    assert args[1] == "closed"


@pytest.mark.asyncio
async def test_verified_locked_report_triggers_notification(async_client):
    """Locked reports require verification (the user must be within 50m).
    A verified one should both save AND trigger the notification."""
    db, _ = build_db_mock(
        shelter={"_id": ObjectId(SHELTER_ID), "lat": 32.0853, "lng": 34.7818},
        user={"_id": ObjectId(USER_ID), "telephone": "0521234567"},
    )
    with patch("app.routes.reports.db", db), \
         patch("app.routes.reports._notify_admins_urgent_report") as notify_mock:
        await async_client.post(
            "/reports",
            json=base_body(
                reportCategory="access",
                reportType="locked",
                reporterLat=32.0853,
                reporterLng=34.7818,  # exactly at the shelter → verified
            ),
        )

    notify_mock.assert_called_once()
    args = notify_mock.call_args.args
    assert args[0] == SHELTER_ID
    assert args[1] == "locked"


@pytest.mark.asyncio
async def test_unverified_locked_report_rejected_no_notification(async_client):
    """An unverified locked report is rejected at the gate — no save, no notify."""
    db, _ = build_db_mock(
        shelter={"_id": ObjectId(SHELTER_ID), "lat": 32.0853, "lng": 34.7818},
        user={"_id": ObjectId(USER_ID), "telephone": "0521234567"},
    )
    with patch("app.routes.reports.db", db), \
         patch("app.routes.reports._notify_admins_urgent_report") as notify_mock:
        response = await async_client.post(
            "/reports",
            json=base_body(
                reportCategory="access",
                reportType="locked",
                reporterLat=32.0900,  # ~520m away
                reporterLng=34.7818,
            ),
        )

    assert response.status_code == 400
    notify_mock.assert_not_called()


@pytest.mark.asyncio
async def test_non_urgent_report_does_not_trigger_notification(async_client):
    """Cleanliness, capacity, damage, etc. shouldn't bother the admins."""
    db, _ = build_db_mock(
        shelter={"_id": ObjectId(SHELTER_ID), "lat": 32.0853, "lng": 34.7818},
        user={"_id": ObjectId(USER_ID), "telephone": "0521234567"},
    )
    with patch("app.routes.reports.db", db), \
         patch("app.routes.reports._notify_admins_urgent_report") as notify_mock:
        await async_client.post(
            "/reports",
            json=base_body(reportCategory="cleanliness", reportType="dirty"),
        )

    notify_mock.assert_not_called()


@pytest.mark.asyncio
async def test_access_category_with_non_urgent_type_does_not_trigger(async_client):
    """Edge case: same `access` category but a type we don't escalate
    (e.g. `access_blocked`). No notification should fire."""
    db, _ = build_db_mock(
        shelter={"_id": ObjectId(SHELTER_ID), "lat": 32.0853, "lng": 34.7818},
        user={"_id": ObjectId(USER_ID), "telephone": "0521234567"},
    )
    with patch("app.routes.reports.db", db), \
         patch("app.routes.reports._notify_admins_urgent_report") as notify_mock:
        await async_client.post(
            "/reports",
            json=base_body(reportCategory="access", reportType="access_blocked"),
        )

    notify_mock.assert_not_called()


# ── Shelter accessStatus mutation ───────────────────────────────────────────
# A verified closed/locked report should flip the ShelterTest doc's
# accessStatus so the change is immediately visible to every other user
# (marker color on the map, shelter-details panel, pre-alarm filter).
# Unverified closed reports record the Report but must NOT mutate the
# shelter — otherwise anyone could mark random shelters as closed from
# the other side of the country.


@pytest.mark.asyncio
async def test_verified_closed_report_marks_shelter_as_closed(async_client):
    db, _ = build_db_mock(
        shelter={"_id": ObjectId(SHELTER_ID), "lat": 32.0853, "lng": 34.7818},
        user={"_id": ObjectId(USER_ID), "telephone": "0521234567"},
    )
    shelter_coll = db["ShelterTest"]
    with patch("app.routes.reports.db", db), \
         patch("app.routes.reports._notify_admins_urgent_report"):
        await async_client.post(
            "/reports",
            json=base_body(
                reportCategory="access",
                reportType="closed",
                reporterLat=32.0853,
                reporterLng=34.7818,  # at the shelter → verified
            ),
        )

    shelter_coll.update_one.assert_awaited_once()
    filter_arg, update_arg = shelter_coll.update_one.await_args.args
    assert filter_arg == {"_id": ObjectId(SHELTER_ID)}
    assert update_arg["$set"]["accessStatus"]   == "closed"
    assert update_arg["$set"]["lastReportType"] == "closed"
    assert "lastReportAt" in update_arg["$set"]


@pytest.mark.asyncio
async def test_verified_locked_report_marks_shelter_as_locked(async_client):
    db, _ = build_db_mock(
        shelter={"_id": ObjectId(SHELTER_ID), "lat": 32.0853, "lng": 34.7818},
        user={"_id": ObjectId(USER_ID), "telephone": "0521234567"},
    )
    shelter_coll = db["ShelterTest"]
    with patch("app.routes.reports.db", db), \
         patch("app.routes.reports._notify_admins_urgent_report"):
        await async_client.post(
            "/reports",
            json=base_body(
                reportCategory="access",
                reportType="locked",
                reporterLat=32.0853,
                reporterLng=34.7818,  # verified — locked requires this
            ),
        )

    shelter_coll.update_one.assert_awaited_once()
    _, update_arg = shelter_coll.update_one.await_args.args
    assert update_arg["$set"]["accessStatus"] == "locked"


@pytest.mark.asyncio
async def test_unverified_closed_report_does_not_mutate_shelter(async_client):
    """Closed reports CAN be unverified (they save + notify). But an
    unverified one mustn't flip the shelter's accessStatus — too easy
    to abuse from a distance."""
    db, _ = build_db_mock(
        shelter={"_id": ObjectId(SHELTER_ID), "lat": 32.0853, "lng": 34.7818},
        user={"_id": ObjectId(USER_ID), "telephone": "0521234567"},
    )
    shelter_coll = db["ShelterTest"]
    with patch("app.routes.reports.db", db), \
         patch("app.routes.reports._notify_admins_urgent_report"):
        await async_client.post(
            "/reports",
            json=base_body(
                reportCategory="access",
                reportType="closed",
                reporterLat=32.0900,  # ~520m away → unverified
                reporterLng=34.7818,
            ),
        )

    shelter_coll.update_one.assert_not_awaited()


@pytest.mark.asyncio
async def test_non_urgent_report_does_not_mutate_shelter(async_client):
    """Cleanliness / capacity / damage shouldn't flip accessStatus."""
    db, _ = build_db_mock(
        shelter={"_id": ObjectId(SHELTER_ID), "lat": 32.0853, "lng": 34.7818},
        user={"_id": ObjectId(USER_ID), "telephone": "0521234567"},
    )
    shelter_coll = db["ShelterTest"]
    with patch("app.routes.reports.db", db), \
         patch("app.routes.reports._notify_admins_urgent_report"):
        await async_client.post(
            "/reports",
            json=base_body(reportCategory="cleanliness", reportType="dirty"),
        )

    shelter_coll.update_one.assert_not_awaited()


# ── GET /reports ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_reports_returns_list(async_client):
    sample = {
        "_id": ObjectId("65a1b2c3d4e5f6a7b8c9d0a9"),
        "number": 1,
        "shelterId": SHELTER_ID,
        "userId": USER_ID,
        "reportCategory": "access",
        "reportType": "closed",
        "status": "pending",
        "isVerified": True,
    }
    with patch("app.routes.reports.db") as mock_db:
        mock_db.__getitem__.return_value.find.return_value.sort.return_value = (
            make_async_iter([sample])
        )
        response = await async_client.get("/reports")

    assert response.status_code == 200
    data = response.json()
    assert "reports" in data
    assert "count" in data
    assert data["count"] == 1
    # _id is exposed as "id"
    assert data["reports"][0]["id"] == "65a1b2c3d4e5f6a7b8c9d0a9"


@pytest.mark.asyncio
async def test_get_reports_empty(async_client):
    with patch("app.routes.reports.db") as mock_db:
        mock_db.__getitem__.return_value.find.return_value.sort.return_value = (
            make_async_iter([])
        )
        response = await async_client.get("/reports")

    assert response.status_code == 200
    data = response.json()
    assert data["count"] == 0
    assert data["reports"] == []


# ── PATCH /reports/{report_id} ───────────────────────────────────────────────

# IDs used only in PATCH / filter tests — kept separate from POST constants
REPORT_ID   = "65a1b2c3d4e5f6a7b8c9d0f1"
ADMIN_ID    = "65a1b2c3d4e5f6a7b8c9d0f2"
NON_ADMIN_ID = "65a1b2c3d4e5f6a7b8c9d0f3"


def build_patch_db_mock(*, user=None, update_matched=1):
    """Mock for PATCH /reports — needs User (admin check) and Report (update_one)."""
    user_coll = MagicMock()
    user_coll.find_one = AsyncMock(return_value=user)

    report_coll = MagicMock()
    report_coll.update_one = AsyncMock(
        return_value=MagicMock(matched_count=update_matched)
    )

    def get_collection(name):
        return {"User": user_coll, "Report": report_coll}.get(name, MagicMock())

    db = MagicMock()
    db.__getitem__.side_effect = get_collection
    return db, report_coll


@pytest.mark.asyncio
async def test_update_report_status_forwarded(async_client):
    """Admin can set status=forwarded; the value reaches the DB."""
    db, report_coll = build_patch_db_mock(
        user={"_id": ObjectId(ADMIN_ID), "role": "admin"},
    )
    with patch("app.routes.reports.db", db):
        response = await async_client.patch(f"/reports/{REPORT_ID}", json={
            "user_id": ADMIN_ID,
            "status": "forwarded",
            "forwardedAt": "2025-05-01T12:00:00",
        })
    assert response.status_code == 200
    assert response.json()["message"] == "Report updated"
    updates = report_coll.update_one.call_args.args[1]["$set"]
    assert updates.get("status") == "forwarded"


@pytest.mark.asyncio
async def test_update_report_status_done_with_meta(async_client):
    """Admin can set status=done with resolvedAt and handledBy; all values reach the DB."""
    db, report_coll = build_patch_db_mock(
        user={"_id": ObjectId(ADMIN_ID), "role": "admin"},
    )
    with patch("app.routes.reports.db", db):
        response = await async_client.patch(f"/reports/{REPORT_ID}", json={
            "user_id": ADMIN_ID,
            "status": "done",
            "resolvedAt": "2025-05-01T14:00:00",
            "handledBy": "Officer Cohen",
        })
    assert response.status_code == 200
    updates = report_coll.update_one.call_args.args[1]["$set"]
    assert updates.get("status") == "done"
    assert updates.get("resolvedAt") == "2025-05-01T14:00:00"
    assert updates.get("handledBy") == "Officer Cohen"


@pytest.mark.asyncio
async def test_update_report_non_admin_forbidden(async_client):
    """Regular user cannot update a report — expects 403."""
    db, _ = build_patch_db_mock(
        user={"_id": ObjectId(NON_ADMIN_ID), "role": "user"},
    )
    with patch("app.routes.reports.db", db):
        response = await async_client.patch(f"/reports/{REPORT_ID}", json={
            "user_id": NON_ADMIN_ID,
            "status": "forwarded",
        })
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_update_report_not_found(async_client):
    """PATCH on a non-existent report returns 404."""
    db, _ = build_patch_db_mock(
        user={"_id": ObjectId(ADMIN_ID), "role": "admin"},
        update_matched=0,
    )
    with patch("app.routes.reports.db", db):
        response = await async_client.patch(f"/reports/{REPORT_ID}", json={
            "user_id": ADMIN_ID,
            "status": "forwarded",
        })
    assert response.status_code == 404


# ── GET /reports?shelterId ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_reports_filtered_by_shelter_id(async_client):
    """GET /reports?shelterId=X passes shelterId in the DB query and returns matching reports."""
    sample = {
        "_id": ObjectId("65a1b2c3d4e5f6a7b8c9d0a9"),
        "shelterId": SHELTER_ID,
        "status": "pending",
        "reportCategory": "access",
    }
    with patch("app.routes.reports.db") as mock_db:
        mock_db.__getitem__.return_value.find.return_value.sort.return_value = (
            make_async_iter([sample])
        )
        response = await async_client.get(f"/reports?shelterId={SHELTER_ID}")

    assert response.status_code == 200
    data = response.json()
    assert data["count"] == 1
    # Verify the query that reached MongoDB contained the shelterId filter
    query = mock_db.__getitem__.return_value.find.call_args.args[0]
    assert query.get("shelterId") == SHELTER_ID
    assert data["reports"][0]["shelterId"] == SHELTER_ID
