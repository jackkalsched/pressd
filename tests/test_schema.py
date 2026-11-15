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
    for t in ("tasteoverlap", "tasteuser", "overlapsheet", "overlapevent", "songprediction", "contactinvite",
              "binreport", "binview", "bincover"):
        assert f"DELETE FROM {t}" in src


def test_delete_bins_order():
    import inspect
    from backend.routers.users import delete_own_account
    src = inspect.getsource(delete_own_account)
    assert src.index("DELETE FROM bintrack") < src.index("DELETE FROM binentry")
    assert "visibility = 'private'" in src
    assert "SET owner_id = NULL" in src


def test_user_bin_tables_are_registered():
    from sqlmodel import SQLModel
    import backend.models  # noqa: F401
    for t in ("bincover", "binreport", "binview"):
        assert t in SQLModel.metadata.tables
    assert list(SQLModel.metadata.tables["binview"].primary_key.columns.keys()) == ["bin_id", "user_id"]
    assert "cover_url" in SQLModel.metadata.tables["bin"].columns
