import pytest
from httpx import AsyncClient, ASGITransport
from unittest.mock import AsyncMock, MagicMock, patch
from app.main import app


@pytest.fixture
def mock_db():
    """Returns a mock db with a users collection."""
    mock_collection = MagicMock()
    mock_collection.find_one = AsyncMock(return_value=None)
    mock_collection.insert_one = AsyncMock(return_value=MagicMock(inserted_id="abc123"))

    mock_database = MagicMock()
    mock_database.__getitem__ = MagicMock(return_value=mock_collection)
    return mock_database, mock_collection


@pytest.fixture
def async_client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
