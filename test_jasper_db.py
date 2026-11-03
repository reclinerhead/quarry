"""The schema applies cleanly, twice, migration steps run once each, and the constraints hold."""

import sqlite3

import pytest

from jasper import db

PHASE_1_TABLES = {"photos", "jobs", "candidates", "suggested_tests", "minerals", "specimens", "confirmations"}


def test_connect_creates_schema_at_latest_version(tmp_path):
    conn = db.connect(tmp_path / "nested" / "q.db")
    assert db.current_version(conn) == db.LATEST_VERSION >= db.BASELINE_VERSION
    tables = {r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert PHASE_1_TABLES <= tables
    assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    assert db.queued_jobs(conn) == 0


def test_apply_schema_is_idempotent(tmp_path):
    conn = db.connect(tmp_path / "q.db")
    conn.execute("INSERT INTO jobs DEFAULT VALUES")
    conn.commit()
    assert db.apply_schema(conn) == db.LATEST_VERSION
    assert db.apply_schema(conn) == db.LATEST_VERSION
    assert db.queued_jobs(conn) == 1
    assert conn.execute("SELECT COUNT(*) FROM schema_version").fetchone()[0] == len(db.MIGRATIONS) + 1


def test_migration_steps_run_once_in_order(tmp_path, monkeypatch):
    monkeypatch.setattr(
        db,
        "MIGRATIONS",
        [
            (2, "ALTER TABLE minerals ADD COLUMN mindat_id INTEGER"),
            (3, "CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY)"),
        ],
    )
    conn = db.connect(tmp_path / "q.db")
    assert db.current_version(conn) == 3
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(minerals)")}
    assert "mindat_id" in cols
    # A second apply is a no-op: the ALTER would fail if it ran again.
    assert db.apply_schema(conn) == 3
    assert [r["version"] for r in conn.execute("SELECT version FROM schema_version ORDER BY version")] == [1, 2, 3]


def test_a_version_2_database_takes_step_3_with_its_rows(tmp_path, monkeypatch):
    path = tmp_path / "q.db"
    monkeypatch.setattr(db, "MIGRATIONS", db.MIGRATIONS[:1])
    old = db.connect(path)
    assert db.current_version(old) == 2
    old.execute("INSERT INTO minerals (name) VALUES ('Quartz')")
    old.execute("INSERT INTO mindat_records (id, name, entrytype) VALUES (3337, 'Quartz', 'mineral')")
    old.commit()
    old.close()
    monkeypatch.undo()
    conn = db.connect(path)
    assert db.current_version(conn) == db.LATEST_VERSION
    assert tuple(conn.execute("SELECT name, mindat_id FROM minerals").fetchone()) == ("Quartz", None)
    assert tuple(conn.execute("SELECT name, detail, detail_at FROM mindat_records").fetchone()) == ("Quartz", None, None)


def test_a_version_3_database_takes_step_4_and_moves_also_on_it_into_the_notes(tmp_path, monkeypatch):
    path = tmp_path / "q.db"
    monkeypatch.setattr(db, "MIGRATIONS", db.MIGRATIONS[:2])
    old = db.connect(path)
    assert db.current_version(old) == 3
    quartz = old.execute("INSERT INTO minerals (name) VALUES ('Quartz')").lastrowid
    for associates, notes in (("on sphalerite", None), ("  ", "Kept as is."), ("with pyrite", "From the Tucson show."), (None, None)):
        old.execute("INSERT INTO specimens (mineral_id, associates, notes) VALUES (?, ?, ?)", (quartz, associates, notes))
    old.commit()
    old.close()
    monkeypatch.undo()
    conn = db.connect(path)
    assert db.current_version(conn) == 4
    rows = [tuple(r) for r in conn.execute("SELECT associates, notes FROM specimens ORDER BY id")]
    assert rows == [
        (None, "Also on it: on sphalerite"),
        ("  ", "Kept as is."),
        (None, "From the Tucson show.\nAlso on it: with pyrite"),
        (None, None),
    ]
    assert "parts" in {r["name"] for r in conn.execute("PRAGMA table_info(candidates)")}


def test_a_stones_parts_need_a_mineral_unless_it_sits_on_matrix(tmp_path):
    conn = db.connect(tmp_path / "q.db")
    pyrite = conn.execute("INSERT INTO minerals (name) VALUES ('Pyrite')").lastrowid
    quartz = conn.execute("INSERT INTO minerals (name) VALUES ('Quartz')").lastrowid
    stone = conn.execute("INSERT INTO specimens (mineral_id) VALUES (?)", (pyrite,)).lastrowid
    conn.execute("INSERT INTO specimen_parts (specimen_id, position, role, mineral_id) VALUES (?, 1, 'on', ?)", (stone, quartz))
    conn.execute("INSERT INTO specimen_parts (specimen_id, position, role, mineral_id) VALUES (?, 2, 'on', NULL)", (stone,))
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO specimen_parts (specimen_id, position, role, mineral_id) VALUES (?, 3, 'with', NULL)", (stone,))
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO specimen_parts (specimen_id, position, role, mineral_id) VALUES (?, 4, 'under', ?)", (stone, quartz))
    with pytest.raises(sqlite3.IntegrityError):  # a mineral still on a stone can't be deleted
        conn.execute("DELETE FROM minerals WHERE id = ?", (quartz,))
    conn.execute("DELETE FROM specimens WHERE id = ?", (stone,))
    assert conn.execute("SELECT COUNT(*) FROM specimen_parts").fetchone()[0] == 0


@pytest.mark.parametrize(
    "sql",
    [
        "INSERT INTO jobs (status) VALUES ('bogus')",
        "INSERT INTO minerals (name, kind) VALUES ('Quartz', 'gem')",
        "INSERT INTO suggested_tests (job_id, model, rank, kind, how, expected) VALUES (1, 'm', 1, 'lick', 'h', 'e')",
    ],
)
def test_enumerated_columns_are_constrained(tmp_path, sql):
    conn = db.connect(tmp_path / "q.db")
    conn.execute("INSERT INTO jobs DEFAULT VALUES")
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(sql)


def test_mineral_names_are_unique_ignoring_case(tmp_path):
    conn = db.connect(tmp_path / "q.db")
    conn.execute("INSERT INTO minerals (name) VALUES ('Fluorite')")
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO minerals (name) VALUES ('fluorite')")
    row = conn.execute("SELECT name FROM minerals WHERE name = 'FLUORITE'").fetchone()
    assert row["name"] == "Fluorite"


def test_confirmation_records_how_it_was_named(tmp_path):
    conn = db.connect(tmp_path / "q.db")
    job = conn.execute("INSERT INTO jobs (status) VALUES ('identified')").lastrowid
    mineral = conn.execute("INSERT INTO minerals (name) VALUES ('Galena')").lastrowid
    specimen = conn.execute("INSERT INTO specimens (mineral_id) VALUES (?)", (mineral,)).lastrowid
    conn.execute(
        "INSERT INTO confirmations (job_id, specimen_id, chosen_name, source, how, verdict)"
        " VALUES (?, ?, 'Galena', 'pill', 'suggestion', 'probably')",
        (job, specimen),
    )
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO confirmations (job_id, specimen_id, chosen_name, source, how, verdict)"
            " VALUES (?, ?, 'Galena', 'pill', 'hunch', 'probably')",
            (conn.execute("INSERT INTO jobs DEFAULT VALUES").lastrowid, specimen),
        )
