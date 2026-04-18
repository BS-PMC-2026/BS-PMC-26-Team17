import pytest
from unittest.mock import patch, MagicMock


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


@pytest.mark.asyncio
async def test_get_shelters_returns_list(async_client):
    mock_shelter = {
        "name": "מקלט בן גוריון",
        "address": "בן גוריון 33",
        "area": "מרכז",
        "placeType": "public shelter",
        "capacity": 200,
        "accessStatus": "open",
        "isAccessible": True,
        "isFull": False,
        "hasStairs": False,
        "petIssueReported": False,
        "shouldBeOpen": True,
        "cleanlinessStatus": "clean",
    }

    with patch("app.routes.shelters.db") as mock_db:
        mock_db.__getitem__.return_value.find.return_value = make_async_iter([mock_shelter])
        response = await async_client.get("/shelters")
        assert response.status_code == 200
        data = response.json()
        assert "shelters" in data
        assert "count" in data
        assert isinstance(data["shelters"], list)


@pytest.mark.asyncio
async def test_filter_by_area(async_client):
    with patch("app.routes.shelters.db") as mock_db:
        mock_db.__getitem__.return_value.find.return_value = make_async_iter([])
        response = await async_client.get("/shelters?area=צפון")
        assert response.status_code == 200


@pytest.mark.asyncio
async def test_filter_by_status(async_client):
    with patch("app.routes.shelters.db") as mock_db:
        mock_db.__getitem__.return_value.find.return_value = make_async_iter([])
        response = await async_client.get("/shelters?status=open")
        assert response.status_code == 200


@pytest.mark.asyncio
async def test_search_by_name(async_client):
    with patch("app.routes.shelters.db") as mock_db:
        mock_db.__getitem__.return_value.find.return_value = make_async_iter([])
        response = await async_client.get("/shelters?search=מקלט")
        assert response.status_code == 200


@pytest.mark.asyncio
async def test_filter_by_city(async_client):
    with patch("app.routes.shelters.db") as mock_db:
        mock_db.__getitem__.return_value.find.return_value = make_async_iter([])
        response = await async_client.get("/shelters?city=Be'er Sheva")
        assert response.status_code == 200


@pytest.mark.asyncio
async def test_filter_by_place_type(async_client):
    with patch("app.routes.shelters.db") as mock_db:
        mock_db.__getitem__.return_value.find.return_value = make_async_iter([])
        response = await async_client.get("/shelters?place_type=school")
        assert response.status_code == 200


@pytest.mark.asyncio
async def test_no_results(async_client):
    with patch("app.routes.shelters.db") as mock_db:
        mock_db.__getitem__.return_value.find.return_value = make_async_iter([])
        response = await async_client.get("/shelters?search=doesnotexist")
        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 0
        assert data["shelters"] == []


@pytest.mark.asyncio
async def test_multiple_filters(async_client):
    with patch("app.routes.shelters.db") as mock_db:
        mock_db.__getitem__.return_value.find.return_value = make_async_iter([])
        response = await async_client.get("/shelters?area=צפון&status=open")
        assert response.status_code == 200


@pytest.mark.asyncio
async def test_returns_correct_count(async_client):
    shelters = [
        {"name": "מקלט א", "accessStatus": "open"},
        {"name": "מקלט ב", "accessStatus": "open"},
    ]
    with patch("app.routes.shelters.db") as mock_db:
        mock_db.__getitem__.return_value.find.return_value = make_async_iter(shelters)
        response = await async_client.get("/shelters")
        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 2
        assert len(data["shelters"]) == 2