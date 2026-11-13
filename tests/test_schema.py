from backend.routers.albums import _first_rating


def test_first_rating_only():
    from datetime import datetime, timezone
    assert _first_rating("listening", None, {"status": "rated"}) is True
    assert _first_rating("to_listen", None, {"status": "rated"}) is True
    assert _first_rating("rated", None, {"status": "rated"}) is False  # copy rated before the column, edited
    assert _first_rating("listening", datetime.now(timezone.utc), {"status": "rated"}) is False  # finished again
    assert _first_rating("listening", None, {"theme": 7}) is False


def test_delete_covers_new_tables():
    import inspect
    from backend.routers.users import delete_own_account
    src = inspect.getsource(delete_own_account)
    for t in ("tasteoverlap", "tasteuser", "overlapsheet", "overlapevent", "songprediction", "contactinvite"):
        assert f"DELETE FROM {t}" in src
