"""Backoff, claiming order, what each outcome does to a job row, and run_once end to end with a fake model."""

import base64
import io
import json
import logging
from datetime import datetime, timedelta, timezone

import pytest
from PIL import Image

from jasper import db, identify, llm, queue, worker

NOW = datetime(2026, 11, 1, 15, 0, tzinfo=timezone.utc)
HAIKU = identify.Role("identifier", "anthropic/claude-haiku-5.5", "medium")
FLASH = identify.Role("second opinion", "google/gemini-3.8-flash", "low")
CFG = identify.Settings(key="k", roles=(HAIKU, FLASH), prompt_version=1, system="SYSTEM")


def test_backoff_doubles_from_thirty_seconds_to_480():
    assert [queue.backoff_seconds(n) for n in (1, 2, 3, 4, 5)] == [30, 60, 120, 240, 480]
    assert queue.backoff_seconds(12) == 480


def test_next_attempt_stops_at_five_attempts():
    assert queue.MAX_ATTEMPTS == 5
    assert queue.next_attempt_at(1, NOW) == NOW + timedelta(seconds=30)
    assert queue.next_attempt_at(queue.MAX_ATTEMPTS, NOW) is None


def _db(tmp_path):
    return db.connect(tmp_path / "q.db")


def _job(conn, created_at="2026-11-01T14:00:00.000Z", notes=None, tests="{}"):
    cur = conn.execute("INSERT INTO jobs (created_at, notes, tests) VALUES (?, ?, ?)", (created_at, notes, tests))
    conn.commit()
    return cur.lastrowid


def _row(conn, jid):
    return conn.execute("SELECT * FROM jobs WHERE id = ?", (jid,)).fetchone()


def _answer(name, confidence, label="", tests=("streak",)):
    return identify.Answer(
        candidates=[
            identify.Candidate(name, None, "mineral", confidence, ["metallic"]),
            identify.Candidate("Sphalerite", None, "mineral", 0.1, []),
        ],
        tests=[identify.SuggestedTest(k, f"how {k}", f"expected {k}") for k in tests],
        label_text=label or None,
    )


def _opinion(role, answer=None, status=200, error=None, cost=None):
    return identify.Opinion(role, status, answer, error, cost, 1.0)


def test_claim_takes_the_oldest_queued_job_and_marks_it_identifying(tmp_path):
    conn = _db(tmp_path)
    newer = _job(conn, "2026-11-01T14:59:00.000Z")
    older = _job(conn, "2026-11-01T14:00:00.000Z")
    row = queue.claim_next(conn, NOW)
    assert row["id"] == older and row["status"] == "identifying"
    assert queue.claim_next(conn, NOW)["id"] == newer
    assert queue.claim_next(conn, NOW) is None


def test_failed_jobs_come_back_only_after_their_backoff(tmp_path):
    conn = _db(tmp_path)
    jid = _job(conn)
    queue.claim_next(conn, NOW)
    queue.record_outcome(conn, jid, identify.Outcome("retry", error="haiku: 503; flash: 503"), NOW)
    job = _row(conn, jid)
    assert job["status"] == "failed" and job["attempts"] == 1 and job["finished_at"] is None
    assert job["next_attempt_at"] == queue.iso(NOW + timedelta(seconds=30))
    assert queue.claim_next(conn, NOW + timedelta(seconds=10)) is None
    assert queue.claim_next(conn, NOW + timedelta(seconds=31))["id"] == jid


def test_out_of_tries_stays_failed(tmp_path):
    conn = _db(tmp_path)
    jid = _job(conn)
    when = NOW
    for _ in range(queue.MAX_ATTEMPTS):
        assert queue.claim_next(conn, when)["id"] == jid
        queue.record_outcome(conn, jid, identify.Outcome("retry", error="503"), when)
        when += timedelta(hours=1)
    job = _row(conn, jid)
    assert job["attempts"] == queue.MAX_ATTEMPTS and job["next_attempt_at"] is None
    assert job["finished_at"] is not None
    assert queue.claim_next(conn, when) is None


def test_a_job_a_stopped_jasper_left_identifying_goes_back_without_an_attempt(tmp_path):
    conn = _db(tmp_path)
    jid = _job(conn)
    _job(conn, "2026-11-01T14:30:00.000Z")
    assert queue.claim_next(conn, NOW)["id"] == jid  # ... and then Jasper is killed
    assert queue.requeue_interrupted(conn) == 1
    job = _row(conn, jid)
    assert job["status"] == "queued" and job["attempts"] == 0
    assert queue.claim_next(conn, NOW)["id"] == jid  # still first in line
    assert queue.requeue_interrupted(conn) == 1


def test_identified_writes_each_models_candidates_tests_label_and_cost(tmp_path):
    conn = _db(tmp_path)
    jid = _job(conn)
    queue.claim_next(conn, NOW)
    out = identify.classify([
        _opinion(HAIKU, _answer("Galena", 0.82, label="Joplin, MO"), cost=0.0009),
        _opinion(FLASH, _answer("Galena", 0.9, tests=("copper", "magnet")), cost=0.0032),
    ])
    queue.record_outcome(conn, jid, out, NOW)
    job = _row(conn, jid)
    assert job["status"] == "identified" and job["error"] is None and job["attempts"] == 1
    assert job["label_text"] == "Joplin, MO" and job["finished_at"] == queue.iso(NOW)
    rows = conn.execute("SELECT model, rank, name, kind, confidence, features, cost_usd FROM candidates ORDER BY model, rank").fetchall()
    assert [tuple(r) for r in rows] == [
        (HAIKU.model, 1, "Galena", "mineral", 0.82, '["metallic"]', 0.0009),
        (HAIKU.model, 2, "Sphalerite", "mineral", 0.1, "[]", None),
        (FLASH.model, 1, "Galena", "mineral", 0.9, '["metallic"]', 0.0032),
        (FLASH.model, 2, "Sphalerite", "mineral", 0.1, "[]", None),
    ]
    assert conn.execute("SELECT SUM(cost_usd) FROM candidates WHERE job_id = ?", (jid,)).fetchone()[0] == pytest.approx(0.0041)
    tests = conn.execute("SELECT model, rank, kind, how FROM suggested_tests ORDER BY model, rank").fetchall()
    assert [tuple(r) for r in tests] == [
        (HAIKU.model, 1, "streak", "how streak"),
        (FLASH.model, 1, "copper", "how copper"),
        (FLASH.model, 2, "magnet", "how magnet"),
    ]


def test_one_opinion_is_written_with_the_others_failure_in_error(tmp_path):
    conn = _db(tmp_path)
    jid = _job(conn)
    queue.claim_next(conn, NOW)
    out = identify.classify([_opinion(HAIKU, _answer("Pyrite", 0.4), cost=0.001), _opinion(FLASH, status=503, error="server error (503)")])
    queue.record_outcome(conn, jid, out, NOW)
    job = _row(conn, jid)
    assert job["status"] == "identified" and job["error"] == "flash: server error (503)"
    assert {r[0] for r in conn.execute("SELECT model FROM candidates")} == {HAIKU.model}


def test_asking_again_replaces_the_old_candidates(tmp_path):
    conn = _db(tmp_path)
    jid = _job(conn)
    queue.claim_next(conn, NOW)
    queue.record_outcome(conn, jid, identify.classify([_opinion(HAIKU, _answer("Pyrite", 0.4)), _opinion(FLASH, _answer("Marcasite", 0.4))]), NOW)
    conn.execute("UPDATE jobs SET status = 'queued', attempts = 0, tests = '{\"steel\": \"no\"}' WHERE id = ?", (jid,))  # what #8 will do
    conn.commit()
    queue.claim_next(conn, NOW)
    queue.record_outcome(conn, jid, identify.classify([_opinion(HAIKU, _answer("Marcasite", 0.7, tests=())), _opinion(FLASH, _answer("Marcasite", 0.8, tests=()))]), NOW)
    names = [r[0] for r in conn.execute("SELECT name FROM candidates WHERE rank = 1 ORDER BY model")]
    assert names == ["Marcasite", "Marcasite"]
    assert conn.execute("SELECT COUNT(*) FROM suggested_tests").fetchone()[0] == 0


def test_rejected_clears_candidates_and_finishes_the_job(tmp_path):
    conn = _db(tmp_path)
    jid = _job(conn)
    queue.claim_next(conn, NOW)
    nothing = identify.Answer([], [], None)
    queue.record_outcome(conn, jid, identify.classify([_opinion(HAIKU, nothing), _opinion(FLASH, nothing)]), NOW)
    job = _row(conn, jid)
    assert job["status"] == "rejected" and job["finished_at"] == queue.iso(NOW)
    assert conn.execute("SELECT COUNT(*) FROM candidates").fetchone()[0] == 0


def test_quota_returns_the_job_to_the_queue_without_an_attempt(tmp_path):
    conn = _db(tmp_path)
    jid = _job(conn)
    queue.claim_next(conn, NOW)
    queue.record_outcome(conn, jid, identify.Outcome("quota", error="haiku: the gateway budget is spent (402)"), NOW)
    job = _row(conn, jid)
    assert job["status"] == "queued" and job["attempts"] == 0


def test_failed_for_good_is_never_claimed_again(tmp_path):
    conn = _db(tmp_path)
    jid = _job(conn)
    queue.claim_next(conn, NOW)
    queue.record_outcome(conn, jid, identify.Outcome("failed", error="haiku: the gateway refused the key (401)"), NOW)
    job = _row(conn, jid)
    assert job["status"] == "failed" and job["attempts"] == queue.MAX_ATTEMPTS and job["next_attempt_at"] is None
    assert queue.claim_next(conn, NOW + timedelta(days=1)) is None


# --- run_once, with a fake model ---------------------------------------------


def _photo(data, rel, colour, size=(1600, 1200)):
    src = data / rel
    src.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", size, colour).save(src, "JPEG")


def _gateway_answer(name, confidence, cost):
    result = {
        "candidates": [{"name": name, "variety": "", "kind": "mineral", "confidence": confidence, "features": ["metallic"]}],
        "tests": [{"kind": "streak", "how": "Rub it on a tile.", "expected": "Lead-grey."}],
        "label_text": "",
    }
    return llm.Response(200, {"stop_reason": "end_turn", "content": [{"type": "text", "text": json.dumps(result)}],
                              "provider_metadata": {"gateway": {"marketCost": str(cost)}}}, 3.0)


def _dominant(b64):
    with Image.open(io.BytesIO(base64.standard_b64decode(b64))) as im:
        r, g, b = im.convert("RGB").getpixel((10, 10))
    return "red" if r > max(g, b) else "blue" if b > max(r, g) else "other"


def test_run_once_asks_both_models_and_records_both_answers(tmp_path, caplog):
    conn = _db(tmp_path)
    data = tmp_path / "data"
    first, second = "photos/2026/11/a.jpg", "photos/2026/11/b.jpg"
    _photo(data, first, (200, 20, 20))
    _photo(data, second, (20, 20, 200), size=(900, 1400))
    jid = _job(conn, notes="From a rock shop in Joplin.", tests='{"glass": "no", "vinegar": "not_tried"}')
    conn.executemany("INSERT INTO photos (path, job_id) VALUES (?, ?)", [(first, jid), (second, jid)])
    conn.commit()

    seen = []

    def fake_ask(key, body):
        seen.append((key, body))
        if body["model"] == HAIKU.model:
            return _gateway_answer("Galena", 0.82, 0.0009)
        return _gateway_answer("Galena", 0.9, 0.0032)

    with caplog.at_level(logging.INFO, logger="jasper"):
        out = worker.run_once(conn, data, CFG, NOW, ask=fake_ask)
    assert out.status == "identified"

    by_model = {body["model"]: (key, body) for key, body in seen}
    assert set(by_model) == {HAIKU.model, FLASH.model}
    for role in (HAIKU, FLASH):
        key, body = by_model[role.model]
        assert key == "k" and body["system"] == "SYSTEM"
        assert body["output_config"] == {"effort": role.effort, "format": {"type": "json_schema", "schema": identify.SCHEMA}}
        content = body["messages"][0]["content"]
        assert [_dominant(c["source"]["data"]) for c in content[:2]] == ["red", "blue"]
        assert content[2]["text"] == (
            "Photos of one specimen. The owner's notes:\nFrom a rock shop in Joplin.\n"
            "The owner's test answers: Scratches glass: no. Fizzes in vinegar: not tried."
        )
        with Image.open(io.BytesIO(base64.standard_b64decode(content[0]["source"]["data"]))) as im:
            assert max(im.size) <= identify.LONG_SIDE

    for rel in (first, second):
        with Image.open(data / worker.thumb_path(rel)) as im:
            assert max(im.size) == identify.THUMB_SIDE
    rank1 = conn.execute("SELECT model, name, cost_usd FROM candidates WHERE rank = 1 ORDER BY model").fetchall()
    assert [tuple(r) for r in rank1] == [(HAIKU.model, "Galena", 0.0009), (FLASH.model, "Galena", 0.0032)]
    assert _row(conn, jid)["status"] == "identified"
    line = next(r for r in caplog.records if r.getMessage().startswith(f"job {jid} "))
    assert line.levelno == logging.INFO
    assert line.getMessage().startswith(f"job {jid} identified: haiku Galena 0.82 · flash Galena 0.90 · $0.0041 · ")
    assert line.getMessage().endswith(" s")

    assert worker.run_once(conn, data, CFG, NOW, ask=fake_ask) is None


def test_a_bad_key_fails_the_job_loudly_once(tmp_path, caplog):
    conn = _db(tmp_path)
    data = tmp_path / "data"
    _photo(data, "photos/x.jpg", (90, 90, 90))
    jid = _job(conn)
    conn.execute("INSERT INTO photos (path, job_id) VALUES ('photos/x.jpg', ?)", (jid,))
    conn.commit()

    def refused(key, body):
        return llm.Response(401, {"error": {"message": "Invalid API key"}}, 0.2)

    with caplog.at_level(logging.INFO, logger="jasper"):
        out = worker.run_once(conn, data, CFG, NOW, ask=refused)
        assert worker.run_once(conn, data, CFG, NOW + timedelta(hours=1), ask=refused) is None
    assert out.status == "failed"
    errors = [r.getMessage() for r in caplog.records if r.levelno == logging.ERROR]
    assert len(errors) == 1
    assert errors[0].startswith(f"job {jid} failed: haiku the gateway refused the key (AI_GATEWAY_API_KEY) (401)")
    assert _row(conn, jid)["attempts"] == queue.MAX_ATTEMPTS


def test_a_job_with_no_readable_photos_fails_without_a_call(tmp_path, caplog):
    conn = _db(tmp_path)
    data = tmp_path / "data"
    (data / "photos").mkdir(parents=True)
    (data / "photos" / "bad.jpg").write_bytes(b"not a picture")
    jid = _job(conn)
    conn.execute("INSERT INTO photos (path, job_id) VALUES ('photos/bad.jpg', ?)", (jid,))
    conn.commit()
    calls = []
    with caplog.at_level(logging.WARNING, logger="jasper"):
        out = worker.run_once(conn, data, CFG, NOW, ask=lambda k, b: calls.append(b))
    assert out.status == "failed" and calls == []
    assert _row(conn, jid)["error"] == "no readable photos"
    assert "photo photos/bad.jpg unreadable" in caplog.text
