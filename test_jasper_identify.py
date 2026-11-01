"""The validator, the prompt and schema, the user message, the request payload,
the settings, the response readers, and what each response means for a job."""

import base64
import json
import sqlite3

import pytest

from jasper import db, identify, llm

HAIKU = identify.Role("identifier", "anthropic/claude-haiku-5.5", "medium")
FLASH = identify.Role("second opinion", "google/gemini-3.8-flash", "low")


def answer(**over):
    a = {
        "candidates": [
            {"name": "Galena", "variety": "", "kind": "mineral", "confidence": 0.82, "features": ["metallic grey", "cubic cleavage"]},
            {"name": "Sphalerite", "variety": "", "kind": "mineral", "confidence": 0.1, "features": ["resinous luster"]},
        ],
        "tests": [{"kind": "streak", "how": "Rub it on the back of a tile.", "expected": "Galena lead-grey, sphalerite pale brown."}],
        "label_text": "",
    }
    a.update(over)
    return a


def ok(result, cost=0.0009):
    """A 200 as the gateway sends it: a thinking block, the JSON text, the cost."""
    body = {
        "stop_reason": "end_turn",
        "content": [{"type": "thinking", "thinking": "hmm"}, {"type": "text", "text": json.dumps(result)}],
        "provider_metadata": {"gateway": {"cost": "0", "marketCost": str(cost)}},
    }
    return llm.Response(200, body, 5.0)


def err(status, message="nope"):
    return llm.Response(status, {"error": {"message": message}}, 0.4)


# --- the validator -------------------------------------------------------------


def test_a_clean_answer_comes_through_whole():
    a = identify.parse_answer(json.dumps(answer(label_text="  Galena, Joplin MO  ")))
    assert [(c.name, c.variety, c.kind, c.confidence) for c in a.candidates] == [
        ("Galena", None, "mineral", 0.82),
        ("Sphalerite", None, "mineral", 0.1),
    ]
    assert a.candidates[0].features == ["metallic grey", "cubic cleavage"]
    assert [(t.kind, t.how) for t in a.tests] == [("streak", "Rub it on the back of a tile.")]
    assert a.label_text == "Galena, Joplin MO"


def test_variety_whitespace_and_a_code_fence_are_tidied():
    cands = [{"name": " Quartz ", "variety": "Rose  Quartz", "kind": "Mineral", "confidence": 0.6, "features": [" pink ", ""]}]
    a = identify.parse_answer("```json\n" + json.dumps(answer(candidates=cands)) + "\n```")
    c = a.candidates[0]
    assert (c.name, c.variety, c.kind, c.features) == ("Quartz", "Rose Quartz", "mineral", ["pink"])
    assert a.label_text is None


@pytest.mark.parametrize(
    "text",
    [
        "I think it is galena.",
        "{not json}",
        json.dumps({"tests": [], "label_text": ""}),
        json.dumps(answer(candidates=[{"variety": "", "kind": "mineral", "confidence": 0.5, "features": []}])),
        json.dumps(answer(candidates=[{"name": "  ", "variety": "", "kind": "mineral", "confidence": 0.5, "features": []}])),
        json.dumps(answer(candidates=[{"name": "Galena", "variety": "", "confidence": 0.5, "features": []}])),
        json.dumps(answer(candidates=[{"name": "Galena", "variety": "", "kind": "gem", "confidence": 0.5, "features": []}])),
        json.dumps(answer(candidates=[{"name": "Galena", "variety": "", "kind": "mineral", "features": []}])),
        json.dumps(answer(candidates=[{"name": "Galena", "variety": "", "kind": "mineral", "confidence": "high", "features": []}])),
        json.dumps(answer(candidates=[{"name": "Galena", "variety": "", "kind": "mineral", "confidence": True, "features": []}])),
        json.dumps(answer(candidates=["Galena"])),
        json.dumps(answer(tests="streak")),
        json.dumps(answer(label_text=["a label"])),
    ],
    ids=["prose", "not json", "no candidates", "no name", "blank name", "no kind", "bad kind", "no confidence",
         "text confidence", "bool confidence", "candidate not an object", "tests not a list", "label not text"],
)
def test_missing_or_malformed_fields_are_an_invalid_answer(text):
    with pytest.raises(identify.InvalidAnswer):
        identify.parse_answer(text)


def test_a_test_off_the_list_is_dropped_and_the_rest_kept():
    tests = [
        {"kind": "heft", "how": "Weigh it in your hand.", "expected": "Galena is heavy."},
        {"kind": "streak", "how": "Rub it on a tile.", "expected": "Lead-grey."},
        {"kind": "magnet", "how": "", "expected": "Nothing."},
        {"kind": "glass", "how": "Scratch a bottle.", "expected": "Galena will not."},
    ]
    a = identify.parse_answer(json.dumps(answer(tests=tests)))
    assert [t.kind for t in a.tests] == ["streak", "glass"]


def test_confidence_is_clamped_to_zero_and_one():
    cands = [
        {"name": "Galena", "variety": "", "kind": "mineral", "confidence": 1.4, "features": []},
        {"name": "Hematite", "variety": "", "kind": "mineral", "confidence": -0.2, "features": []},
        {"name": "Magnetite", "variety": "", "kind": "mineral", "confidence": 1, "features": []},
    ]
    a = identify.parse_answer(json.dumps(answer(candidates=cands)))
    assert [c.confidence for c in a.candidates] == [1.0, 0.0, 1.0]


def test_an_empty_candidate_list_is_a_real_answer_naming_nothing():
    a = identify.parse_answer(json.dumps(answer(candidates=[], tests=[])))
    assert a.candidates == [] and a.tests == []


def test_at_most_three_candidates_and_three_tests_are_kept():
    cands = [{"name": n, "variety": "", "kind": "mineral", "confidence": 0.2, "features": []} for n in ("A", "B", "C", "D")]
    tests = [{"kind": k, "how": "h", "expected": "e"} for k in ("glass", "steel", "copper", "streak")]
    a = identify.parse_answer(json.dumps(answer(candidates=cands, tests=tests)))
    assert [c.name for c in a.candidates] == ["A", "B", "C"]
    assert [t.kind for t in a.tests] == ["glass", "steel", "copper"]


# --- the prompt and the schema -------------------------------------------------


def test_the_prompt_has_a_version_and_names_every_test_kind():
    version, body = identify.load_prompt()
    assert version >= 1
    assert not body.startswith("---")
    for kind in identify.TEST_KINDS:
        assert f"- {kind}:" in body


def test_a_prompt_without_front_matter_is_refused(tmp_path):
    p = tmp_path / "identify.md"
    p.write_text("You identify rocks.", encoding="utf-8")
    with pytest.raises(ValueError):
        identify.load_prompt(p)


def test_the_schemas_test_kinds_are_the_tables(tmp_path):
    item = identify.SCHEMA["properties"]["tests"]["items"]
    assert item["properties"]["kind"]["enum"] == list(identify.TEST_KINDS)
    conn = db.connect(tmp_path / "q.db")
    job = conn.execute("INSERT INTO jobs DEFAULT VALUES").lastrowid
    for rank, kind in enumerate(identify.TEST_KINDS, start=1):
        conn.execute("INSERT INTO suggested_tests (job_id, model, rank, kind, how, expected) VALUES (?, 'm', ?, ?, 'h', 'e')", (job, rank, kind))
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO suggested_tests (job_id, model, rank, kind, how, expected) VALUES (?, 'm', 99, 'heft', 'h', 'e')", (job,))
    cand = identify.SCHEMA["properties"]["candidates"]["items"]["properties"]["kind"]["enum"]
    assert cand == list(identify.CANDIDATE_KINDS)


# --- the user message ----------------------------------------------------------


def test_notes_and_test_answers_are_said_in_words_in_a_fixed_order():
    tests = json.dumps({"vinegar": "not_tried", "streak": "red-brown", "glass": "no"})
    text = identify.user_text("  Found on a Lake Superior beach.\n", tests)
    assert text == (
        "Photos of one specimen. The owner's notes:\nFound on a Lake Superior beach.\n"
        "The owner's test answers: Scratches glass: no. Streak: red-brown. Fizzes in vinegar: not tried."
    )


@pytest.mark.parametrize("value", [None, "", "not tried", "not_tried", "  Not Tried "])
def test_not_tried_is_said_as_such_never_as_no(value):
    assert identify.user_text(None, json.dumps({"magnet": value})).endswith("A magnet sticks to it: not tried.")


def test_yes_no_and_the_owners_own_words():
    text = identify.user_text(None, json.dumps({"steel": True, "copper": False, "uv": "glows green", "heft": "heavy"}))
    assert text.endswith(
        "A steel knife scratches it: yes. A copper coin scratches it: no. Glows under UV light: glows green. Heft: heavy."
    )


@pytest.mark.parametrize("tests", [None, "{}", "not json", "[]"])
def test_no_notes_and_no_tests(tests):
    assert identify.user_text(None, tests) == "Photos of one specimen. No notes from the owner."


# --- the request payload -------------------------------------------------------


@pytest.mark.parametrize("role", [HAIKU, FLASH], ids=["identifier", "second opinion"])
def test_the_payload_carries_the_photos_in_order_then_the_text_held_to_the_schema(role):
    body = llm.payload(role.model, role.effort, "SYSTEM", identify.SCHEMA, [b"first", b"second"], "Photos of one specimen.")
    assert body["model"] == role.model and body["system"] == "SYSTEM"
    assert body["max_tokens"] == llm.MAX_TOKENS
    content = body["messages"][0]["content"]
    assert [base64.standard_b64decode(c["source"]["data"]) for c in content[:2]] == [b"first", b"second"]
    assert all(c["type"] == "image" and c["source"]["media_type"] == "image/jpeg" for c in content[:2])
    assert content[2] == {"type": "text", "text": "Photos of one specimen."}
    assert body["output_config"] == {"effort": role.effort, "format": {"type": "json_schema", "schema": identify.SCHEMA}}
    assert set(body) == {"model", "max_tokens", "system", "messages", "output_config"}


# --- settings ------------------------------------------------------------------


def test_no_key_means_no_settings():
    assert identify.settings({}) is None
    assert identify.settings({"AI_GATEWAY_API_KEY": "  "}) is None


def test_the_roles_default_to_phase_0s_pair_and_efforts():
    cfg = identify.settings({"AI_GATEWAY_API_KEY": "secret-key"})
    assert [(r.name, r.model, r.effort) for r in cfg.roles] == [
        ("identifier", "anthropic/claude-haiku-5.5", "medium"),
        ("second opinion", "google/gemini-3.8-flash", "low"),
    ]
    assert cfg.prompt_version == identify.load_prompt()[0]
    assert "secret-key" not in repr(cfg)


def test_the_slugs_come_from_the_environment():
    cfg = identify.settings({"AI_GATEWAY_API_KEY": "k", "QUARRY_IDENTIFIER": "anthropic/claude-sonnet-5.5",
                             "QUARRY_SECOND_OPINION": " google/gemini-3.8-flash-lite "})
    assert [r.model for r in cfg.roles] == ["anthropic/claude-sonnet-5.5", "google/gemini-3.8-flash-lite"]
    assert [r.effort for r in cfg.roles] == ["medium", "low"]


def test_the_same_model_twice_is_refused():
    with pytest.raises(ValueError):
        identify.settings({"AI_GATEWAY_API_KEY": "k", "QUARRY_SECOND_OPINION": "anthropic/claude-haiku-5.5"})


def test_jasper_refuses_to_start_without_a_key(monkeypatch, tmp_path):
    from jasper import __main__ as jasper_main

    monkeypatch.delenv("AI_GATEWAY_API_KEY", raising=False)
    monkeypatch.setenv("QUARRY_DATA", str(tmp_path))
    monkeypatch.setenv("QUARRY_DB", str(tmp_path / "quarry.db"))
    assert jasper_main.main([]) == 2
    assert not (tmp_path / "quarry.db").exists()


@pytest.mark.parametrize(
    "slug, short",
    [("anthropic/claude-haiku-5.5", "haiku"), ("google/gemini-3.8-flash", "flash"), ("google/gemini-3.8-flash-lite", "flash-lite"), ("gpt-5", "gpt")],
)
def test_short_names_for_the_log(slug, short):
    assert identify.short_name(slug) == short


# --- reading a response --------------------------------------------------------


def test_reply_text_skips_thinking_and_refuses_a_cut_off_answer():
    assert llm.reply_text(ok(answer()).body) == json.dumps(answer())
    for stop in ("max_tokens", "refusal"):
        with pytest.raises(llm.LlmError):
            llm.reply_text({"stop_reason": stop, "content": [{"type": "text", "text": "{"}]})
    with pytest.raises(llm.LlmError):
        llm.reply_text({"stop_reason": "end_turn", "content": [{"type": "thinking", "thinking": "..."}]})


def test_market_cost_is_read_from_the_gateways_metadata():
    assert llm.market_cost({"provider_metadata": {"gateway": {"cost": "0", "marketCost": "0.0008648"}}}) == 0.0008648
    assert llm.market_cost({"provider_metadata": {"gateway": {"marketCost": 0.003}}}) == 0.003
    assert llm.market_cost({}) is None
    assert llm.market_cost({"provider_metadata": {"anthropic": {}}}) is None


def test_status_lines_say_what_to_fix():
    assert llm.status_line(401, {"error": {"message": "Invalid API key"}}) == (
        "the gateway refused the key (AI_GATEWAY_API_KEY) (401): Invalid API key"
    )
    assert llm.status_line(503, {}) == "the gateway answered a server error (503)"
    assert llm.status_line(0, {"error": {"message": "URLError: timed out"}}) == "ai-gateway.vercel.sh unreachable (URLError: timed out)"


# --- outcomes ------------------------------------------------------------------


def outcome(a, b):
    return identify.classify([identify.opinion(HAIKU, a), identify.opinion(FLASH, b)])


def test_both_models_naming_something_is_identified():
    out = outcome(ok(answer(label_text="Joplin")), ok(answer(label_text="Joplin, MO"), cost=0.003))
    assert out.status == "identified" and out.error is None
    assert out.label_text == "Joplin"
    assert out.cost_usd == pytest.approx(0.0039)


@pytest.mark.parametrize(
    "status, expected",
    [(429, "retry"), (500, "retry"), (502, "retry"), (503, "retry"), (0, "retry"), (408, "retry"),
     (401, "failed"), (403, "failed"), (402, "quota"), (400, "failed"), (404, "failed"), (413, "failed")],
)
def test_each_status_from_both_models(status, expected):
    out = outcome(err(status), err(status))
    assert out.status == expected
    assert out.error.startswith("haiku: ") and "; flash: " in out.error


def test_an_invalid_answer_from_both_is_retried_and_its_cost_kept():
    bad = ok({"candidates": [{"name": "Galena", "kind": "gem", "confidence": 0.5}], "tests": [], "label_text": ""})
    out = outcome(bad, bad)
    assert out.status == "retry"
    assert "invalid answer: candidate 1 (Galena): kind 'gem'" in out.error
    assert out.cost_usd == pytest.approx(0.0018)


def test_one_model_failing_still_identifies_on_the_other_opinion():
    out = outcome(ok(answer()), err(503))
    assert out.status == "identified"
    assert out.error == "flash: the gateway answered a server error (503): nope"
    assert [o.kind for o in out.opinions] == ["answer", "retry"]


def test_a_bad_key_with_no_answer_fails_for_good_but_an_answer_still_counts():
    assert outcome(err(401), err(503)).status == "failed"
    assert outcome(err(503), ok(answer())).status == "identified"
    assert outcome(ok(answer()), err(403)).status == "identified"


def test_a_spent_budget_from_either_sends_the_job_back():
    assert outcome(ok(answer()), err(402)).status == "quota"


def test_answers_that_name_nothing_are_rejected():
    empty = ok(answer(candidates=[], tests=[]))
    assert outcome(empty, empty).status == "rejected"
    assert outcome(empty, err(503)).status == "rejected"
    assert outcome(empty, ok(answer())).status == "identified"


def test_describe_for_the_log_line():
    named = identify.opinion(HAIKU, ok(answer(candidates=[{"name": "Quartz", "variety": "Amethyst", "kind": "mineral", "confidence": 0.7, "features": []}])))
    assert named.describe() == "haiku Quartz (Amethyst) 0.70"
    assert identify.opinion(FLASH, ok(answer(candidates=[]))).describe() == "flash nothing named"
    assert identify.opinion(FLASH, err(429)).describe() == "flash the gateway rate-limited the request (429): nope"
