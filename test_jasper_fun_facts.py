"""The fun facts (#126): only facts whose quote is really in the article are stored,
with no figure or absolute the quote doesn't hold (the Aviary's Chimney Swift, "can
only perch", is the case the absolute rule exists for); an article that yields
nothing is recorded as none and not asked again, while Wikipedia or the gateway
failing records nothing; and the step's part in the idle tick: last, on its own
failure clock, stopping for a job and for the budget. A fake Wikipedia and a fake
ask stand in for the network; the HTTP calls stay untested."""

import json
import logging
from datetime import datetime, timezone

import pytest

from jasper import db, fun_facts, identify, llm, mindat, worker

NOW = datetime(2026, 11, 21, 15, 0, tzinfo=timezone.utc)

ARTICLE = (
    "Amethyst is a violet variety of quartz.\n\n\n"
    "== History ==\n"
    "Ancient Greeks wore amethyst and carved drinking vessels from it in the belief that it would prevent intoxication. "
    "Amethyst was used as a gemstone by the ancient Egyptians. "
    "Until the 18th century, amethyst was included in the cardinal gemstones, but large deposits found in Brazil in 1902 lowered its value. "
    "Medieval European soldiers wore amethyst amulets as protection in battle.\n\n\n"
    "== Structure ==\n"
    "The colour comes from irradiation of iron impurities.\n\n\n"
    "== Gallery ==\n\n\n"
    "== See also ==\nList of minerals\n\n\n"
    "== References ==\n1. Somebody (2001). A book.\n"
)
GREEKS = "Ancient Greeks wore amethyst and carved drinking vessels from it in the belief that it would prevent intoxication."
EGYPT = "Amethyst was used as a gemstone by the ancient Egyptians."
BRAZIL = "Until the 18th century, amethyst was included in the cardinal gemstones, but large deposits found in Brazil in 1902 lowered its value."
SOLDIERS = "Medieval European soldiers wore amethyst amulets as protection in battle."
SWIFT = "Chimney swifts cannot perch; they cling to vertical surfaces with their small feet."
SRC = fun_facts.source_display("https://en.wikipedia.org/wiki/Amethyst")


def page(title="Amethyst", extract=ARTICLE, **extra):
    """The whole-article query's body as Wikipedia sends it (formatversion 2)."""
    url = f"https://en.wikipedia.org/wiki/{title.replace(' ', '_')}"
    return {"batchcomplete": True, "query": {"pages": [{"pageid": 1, "ns": 0, "title": title, "extract": extract, "fullurl": url, "canonicalurl": url, **extra}]}}


def reply(*pairs):
    return json.dumps({"facts": [{"fact": f, "quote": q} for f, q in pairs]})


def answer(text, status=200, stop="end_turn"):
    return llm.Response(status, {"stop_reason": stop, "content": [{"type": "text", "text": text}]}, 1.0)


class Clock:
    def __init__(self, t=0.0):
        self.t = t

    def __call__(self):
        return self.t


class Wiki:
    """Wikipedia's whole-article query: a body per title, a missing page for any other; fail answers a 503."""

    def __init__(self, pages=None, fail=False):
        self.pages = {"Amethyst": page()} if pages is None else pages
        self.fail = fail
        self.asked = []
        self.requests = 0

    def article(self, title):
        self.requests += 1
        self.asked.append(title)
        if self.fail:
            raise mindat.Unreachable("en.wikipedia.org answered 503")
        return self.pages.get(title) or {"query": {"pages": [{"title": title, "missing": True}]}}

    def query(self, title):  # the lead's query, for the worker's Wikipedia step
        self.requests += 1
        return {"query": {"pages": [{"title": title, "missing": True}]}}


class Ask:
    """A stand-in gateway: hands back canned responses in turn (the last one again) and records the bodies."""

    def __init__(self, *responses, clock=None):
        self.responses = list(responses)
        self.bodies = []
        self.clock = clock

    def __call__(self, key, body):
        self.bodies.append((key, body))
        if self.clock:
            self.clock.t += 10
        return self.responses[min(len(self.bodies), len(self.responses)) - 1]


def _writer(ask):
    return fun_facts.Writer(key="k", model="anthropic/claude-haiku-5.5", effort="medium", prompt_version=1, system="SYSTEM", ask=ask)


def _db(tmp_path, *titles):
    conn = db.connect(tmp_path / "q.db")
    for i, title in enumerate(titles):
        conn.execute("INSERT INTO wikipedia_pages (term, title, url, summary, fetched_at) VALUES (?, ?, ?, 'A lead.', ?)",
                     (title.lower(), title, f"https://en.wikipedia.org/wiki/{title}", f"2026-11-0{i + 1}T00:00:00.000Z"))
    conn.commit()
    return conn


def _rows(conn):
    return {(r["title"], r["source"]): (r["kind"], json.loads(r["facts"])) for r in conn.execute("SELECT * FROM fun_facts")}


# --- the article -----------------------------------------------------------------------


def test_the_article_is_its_title_url_and_whole_text():
    assert fun_facts.article_from(page()) == ("Amethyst", "https://en.wikipedia.org/wiki/Amethyst", ARTICLE.strip())


def test_a_missing_page_a_disambiguation_an_empty_extract_and_a_malformed_body_are_nothing_usable():
    assert fun_facts.article_from({"query": {"pages": [{"title": "Nope", "missing": True}]}}) is None
    assert fun_facts.article_from(page(pageprops={"disambiguation": ""})) is None
    assert fun_facts.article_from(page(extract="   ")) is None
    assert fun_facts.article_from({}) is None
    assert fun_facts.article_from({"query": {"pages": []}}) is None


@pytest.mark.parametrize("heading", ["See also", "References", "Notes", "Footnotes", "Further reading", "External links", "Bibliography", "Sources", "Gallery"])
def test_the_back_matter_is_dropped_at_each_heading(heading):
    out = fun_facts.trim_article(f"The lead.\n\n\n== Uses ==\nIt is used.\n\n\n== {heading} ==\nApparatus.\n\n\n== Uses again ==\nLost.")
    assert out == "The lead.\n\n\n== Uses ==\nIt is used."


def test_the_article_is_capped_at_a_paragraph_boundary_and_a_short_one_is_whole():
    text = "\n".join(f"Paragraph {i} " + "x" * 50 for i in range(10))
    out = fun_facts.trim_article(text, limit=200)
    assert len(out) <= 200 and out.endswith("x") and out.startswith("Paragraph 0")
    assert fun_facts.trim_article(text) == text
    assert "Brazil" in fun_facts.trim_article(ARTICLE) and "Somebody" not in fun_facts.trim_article(ARTICLE)


def test_the_prompt_names_the_mineral_and_carries_the_article():
    assert fun_facts.build_prompt("Amethyst", "TEXT") == "Mineral or rock: Amethyst\n\nArticle:\n<<<\nTEXT\n>>>"


def test_the_prompt_file_loads_with_its_version_and_its_rules():
    version, body = identify.load_prompt(fun_facts.PROMPT_PATH)
    assert version >= 1
    assert "ONLY the article" in body and "140 characters" in body and '"facts"' in body and "character for character" in body


# --- the answer --------------------------------------------------------------------------


def test_the_answer_is_parsed_with_a_fence_and_without():
    body = reply(("A fact.", "A quote."))
    assert fun_facts.parse_reply(body) == [("A fact.", "A quote.")]
    assert fun_facts.parse_reply(f"```json\n{body}\n```") == [("A fact.", "A quote.")]
    assert fun_facts.parse_reply(json.dumps({"facts": []})) == []


def test_half_items_are_skipped_and_a_malformed_answer_is_none():
    body = json.dumps({"facts": [{"fact": "A fact."}, {"quote": "Q."}, "loose", {"fact": "B.", "quote": "C."}]})
    assert fun_facts.parse_reply(body) == [("B.", "C.")]
    assert fun_facts.parse_reply("I could not find any facts.") is None
    assert fun_facts.parse_reply('{"facts": "none"}') is None
    assert fun_facts.parse_reply('{"facts": [') is None


# --- the check ---------------------------------------------------------------------------


def test_a_faithful_fact_passes():
    assert fun_facts.check_fact("Ancient Greeks carved amethyst cups, believing they kept the drinker sober.", GREEKS, ARTICLE) == []


def test_a_quote_the_article_never_says_fails():
    assert fun_facts.check_fact("Amethyst calms the mind.", "Amethyst is said to calm the mind.", ARTICLE) == ["its quote is not in the article"]


def test_quote_matching_forgives_whitespace_case_typography_and_an_ellipsis():
    assert fun_facts.quote_found("ancient greeks wore amethyst  and carved\ndrinking vessels from it in the belief that it would prevent intoxication.", ARTICLE)
    assert fun_facts.quote_found("Until the 18th century, amethyst was included in the cardinal gemstones ... lowered its value.", ARTICLE)
    assert fun_facts.quote_found("Until the 18th century… lowered its value.", ARTICLE)
    assert not fun_facts.quote_found("Until the 18th century ... raised its value.", ARTICLE)
    assert not fun_facts.quote_found("...", ARTICLE)
    assert fun_facts.normalize("the stone’s “name” – old") == "the stone's \"name\" - old"


def test_a_figure_the_quote_lacks_fails_and_a_spelled_one_counts():
    assert fun_facts.check_fact("Big finds in Brazil in 1902 made amethyst far cheaper.", BRAZIL, ARTICLE) == []
    assert fun_facts.check_fact("Big finds in Brazil in 1905 made amethyst far cheaper.", BRAZIL, ARTICLE) == ["figures its quote doesn't hold: 1905"]
    assert fun_facts.check_fact("Amethyst was a cardinal gem until the eighteenth century.", BRAZIL, ARTICLE) == []
    assert fun_facts.check_fact("Amethyst was a cardinal gem for nineteen centuries.", BRAZIL, ARTICLE) == ["figures its quote doesn't hold: 19"]
    assert fun_facts.figures("two crystals, twenty-three mines, 1,500 tons, one hundred and twelve") == {"23", "1500", "112"}


def test_the_swift_absolute_is_caught_and_one_the_quote_says_is_fine():
    assert fun_facts.check_fact("Chimney Swifts can only perch on horizontal surfaces.", SWIFT, SWIFT) == ["absolutes its quote doesn't say: only"]
    said = "It is the only mineral in the group that floats."
    assert fun_facts.check_fact("It's the only one in its group that floats.", said, said) == []


def test_the_minerals_own_name_is_never_an_absolute():
    quote = "The stone was carried by sailors."
    fact = "Sailors once carried first quartz to sea."
    assert fun_facts.check_fact(fact, quote, quote) == ["absolutes its quote doesn't say: first"]
    assert fun_facts.check_fact(fact, quote, quote, name="First quartz") == []
    assert fun_facts.check_fact("Only sailors carried first quartz.", quote, quote, name="First quartz") == ["absolutes its quote doesn't say: only"]


def test_a_long_fact_and_a_did_you_know_opener_fail():
    out = fun_facts.check_fact("Did you know " + "the Greeks carved cups from it " * 5, GREEKS, ARTICLE)
    assert any(o.startswith("longer than 140 characters") for o in out) and 'begins with "Did you know"' in out
    assert fun_facts.check_fact("x" * 140, GREEKS, ARTICLE) == []


def test_near_duplicates_either_side_of_the_threshold():
    a = "ancient greeks carved drinking cups from amethyst stone"
    assert fun_facts.near_duplicate(a, "Ancient Greeks carved drinking cups from amethyst.")  # 7 of 8 words shared
    assert fun_facts.near_duplicate("one two three four five", "one two three six seven eight") is False  # 3 of 8
    assert fun_facts.near_duplicate("one two three four five", "one two three four six")  # 4 of 6
    assert fun_facts.near_duplicate("", "anything") is False


def test_a_fact_id_is_stable_under_whitespace_case_and_typography():
    a = fun_facts.fact_id("The stone’s name.")
    assert a == fun_facts.fact_id("the  stone's\nname.") and len(a) == 10 and a != fun_facts.fact_id("Another fact.")


def test_selecting_keeps_passes_drops_repeats_and_caps_at_five():
    lead = "Amethyst is a violet variety of quartz."
    colour = "The colour comes from irradiation of iron impurities."
    pairs = [
        ("Ancient Greeks carved amethyst cups to stay sober.", GREEKS),
        ("Ancient Greeks carved amethyst cups to stay sober, they believed.", GREEKS),  # a repeat
        ("Amethyst calms the mind.", "Amethyst calms the mind."),  # unquoted
        ("The ancient Egyptians used amethyst as a gemstone.", EGYPT),
        ("Big deposits in Brazil made amethyst much cheaper.", BRAZIL),
        ("Medieval soldiers wore amethyst amulets into battle.", SOLDIERS),
        ("Amethyst is a violet kind of quartz.", lead),
        ("Iron gives the purple its colour.", colour),  # the sixth
    ]
    kept, rejected = fun_facts.select_facts(pairs, ARTICLE, "Amethyst", SRC)
    assert len(kept) == fun_facts.MAX_FACTS == 5
    assert kept[0] == {"id": fun_facts.fact_id(pairs[0][0]), "text": pairs[0][0], "quote": GREEKS,
                       "source": {"author": None, "work": "Wikipedia", "year": None, "url": "https://en.wikipedia.org/wiki/Amethyst"}}
    assert dict(rejected) == {
        pairs[1][0]: ["repeats an earlier fact"],
        "Amethyst calms the mind.": ["its quote is not in the article"],
        "Iron gives the purple its colour.": ["past the 5-fact cap"],
    }


# --- one article ---------------------------------------------------------------------------


def test_an_articles_facts_are_asked_of_the_identifier_with_the_trimmed_article_and_checked(caplog):
    ask = Ask(answer(reply(("Ancient Greeks carved amethyst cups to stay sober.", GREEKS), ("Amethyst calms the mind.", "Amethyst calms the mind."))))
    with caplog.at_level(logging.INFO, logger="jasper"):
        facts = fun_facts.facts_for("Amethyst", Wiki(), _writer(ask))
    assert [f["text"] for f in facts] == ["Ancient Greeks carved amethyst cups to stay sober."]
    assert facts[0]["source"] == SRC and facts[0]["quote"] == GREEKS
    assert [r.getMessage() for r in caplog.records] == ["fun facts: Amethyst: dropped 'Amethyst calms the mind.' (its quote is not in the article)"]
    (key, body), = ask.bodies
    assert key == "k" and body["model"] == "anthropic/claude-haiku-5.5" and body["system"] == "SYSTEM"
    assert body["output_config"] == {"effort": "medium", "format": {"type": "json_schema", "schema": fun_facts.SCHEMA}}
    (block,) = body["messages"][0]["content"]  # no images, the article as the text
    assert block["type"] == "text" and "Brazil in 1902" in block["text"] and "Somebody" not in block["text"]


def test_no_usable_article_is_none_without_a_model_call():
    ask = Ask(answer(reply()))
    assert fun_facts.facts_for("Nope", Wiki(), _writer(ask)) == []
    assert ask.bodies == []


def test_an_unshaped_answer_a_refusal_and_a_cut_off_are_recorded_with_none(caplog):
    with caplog.at_level(logging.WARNING, logger="jasper"):
        assert fun_facts.facts_for("Amethyst", Wiki(), _writer(Ask(answer("Sorry, no.")))) == []
        assert fun_facts.facts_for("Amethyst", Wiki(), _writer(Ask(answer("", stop="refusal")))) == []
        assert fun_facts.facts_for("Amethyst", Wiki(), _writer(Ask(answer('{"facts": [', stop="max_tokens")))) == []
    assert [r.getMessage() for r in caplog.records][0] == "fun facts: Amethyst: the answer wasn't the JSON asked for; recorded with none"
    assert len(caplog.records) == 3


def test_a_gateway_failure_is_unreachable_in_the_logs_words():
    with pytest.raises(mindat.Unreachable, match=r"the gateway budget is spent \(402\)"):
        fun_facts.facts_for("Amethyst", Wiki(), _writer(Ask(llm.Response(402, {}, 0.1))))
    with pytest.raises(mindat.Unreachable, match="unreachable"):
        fun_facts.facts_for("Amethyst", Wiki(), _writer(Ask(llm.Response(0, {"error": {"message": "TimeoutError"}}, 0.1))))


# --- the pass ------------------------------------------------------------------------------


def test_the_titles_wanted_are_each_article_once_in_fetch_order_minus_those_written(tmp_path):
    conn = _db(tmp_path, "Gneiss", "Amethyst")
    conn.execute("INSERT INTO wikipedia_pages (term, title) VALUES ('fossil coral', NULL)")
    conn.execute("INSERT INTO wikipedia_pages (term, title, url, summary) VALUES ('granite gneiss', 'Gneiss', 'u', 's')")
    assert fun_facts.wanted(conn) == ["Gneiss", "Amethyst"]
    conn.execute("INSERT INTO fun_facts (title, source, kind) VALUES ('Gneiss', 'wikipedia', 'fact')")
    conn.execute("INSERT INTO fun_facts (title, source, kind) VALUES ('Amethyst', 'kunz', 'lore')")  # another source's row is not Wikipedia's
    assert fun_facts.wanted(conn) == ["Amethyst"]


def test_a_row_is_written_per_article_with_none_for_one_that_yields_nothing_and_neither_is_asked_again(tmp_path):
    conn = _db(tmp_path, "Amethyst", "Gneiss")
    ask = Ask(answer(reply(("Ancient Greeks carved amethyst cups to stay sober.", GREEKS))))
    wiki = Wiki({"Amethyst": page(), "Gneiss": page("Gneiss", "Gneiss is a rock.")})
    assert fun_facts.write_facts(conn, wiki, _writer(Ask(answer(reply(("Ancient Greeks carved amethyst cups to stay sober.", GREEKS))), answer(reply()))), float("inf"), Clock()) == (2, 1)
    rows = _rows(conn)
    assert rows[("Gneiss", "wikipedia")] == ("fact", [])
    kind, facts = rows[("Amethyst", "wikipedia")]
    assert kind == "fact" and [f["text"] for f in facts] == ["Ancient Greeks carved amethyst cups to stay sober."]
    assert fun_facts.write_facts(conn, wiki, _writer(ask), float("inf"), Clock()) == (0, 0)
    assert wiki.asked == ["Amethyst", "Gneiss"] and ask.bodies == []
    conn.execute("DELETE FROM fun_facts WHERE title = 'Gneiss'")  # deleting a row asks again
    assert fun_facts.wanted(conn) == ["Gneiss"]


@pytest.mark.parametrize("wiki_down", [True, False])
def test_a_transport_failure_records_nothing_and_keeps_what_came_before(tmp_path, wiki_down):
    conn = _db(tmp_path, "Amethyst", "Gneiss")
    good = answer(reply(("Ancient Greeks carved amethyst cups to stay sober.", GREEKS)))
    wiki = Wiki({"Amethyst": page(), "Gneiss": page("Gneiss", "Gneiss is a rock.")})
    assert fun_facts.write_facts(conn, wiki, _writer(Ask(good)), 5, Clock()) == (2, 1)
    conn.execute("DELETE FROM fun_facts WHERE title = 'Gneiss'")
    conn.commit()
    with pytest.raises(mindat.Unreachable):
        fun_facts.write_facts(conn, Wiki(wiki.pages, fail=wiki_down), _writer(Ask(llm.Response(503, {}, 0.1))), float("inf"), Clock())
    assert set(_rows(conn)) == {("Amethyst", "wikipedia")}


def test_the_step_stops_for_the_budget_between_articles_and_the_next_pass_goes_on(tmp_path):
    conn, clock = _db(tmp_path, "Amethyst", "Gneiss", "Agate"), Clock()
    wiki = Wiki({t: page(t, ARTICLE) for t in ("Amethyst", "Gneiss", "Agate")})
    who = _writer(Ask(answer(reply(("Ancient Greeks carved amethyst cups to stay sober.", GREEKS))), clock=clock))
    # Each answer takes ten seconds; the budget is twenty, so the third article waits.
    assert fun_facts.write_facts(conn, wiki, who, mindat.IDLE_BUDGET_S, clock) == (2, 0)
    assert {t for t, _ in _rows(conn)} == {"Amethyst", "Gneiss"}
    assert fun_facts.write_facts(conn, wiki, who, clock() + mindat.IDLE_BUDGET_S, clock) == (1, 0)
    assert {t for t, _ in _rows(conn)} == {"Amethyst", "Gneiss", "Agate"}


def test_the_step_stops_for_a_job_and_keeps_what_it_wrote(tmp_path):
    conn, clock = _db(tmp_path, "Amethyst", "Gneiss"), Clock()
    wiki = Wiki({t: page(t, ARTICLE) for t in ("Amethyst", "Gneiss")})
    who = _writer(Ask(answer(reply(("Ancient Greeks carved amethyst cups to stay sober.", GREEKS)))))
    stop = mindat.stopping(clock, lambda: wiki.requests >= 1)
    assert fun_facts.write_facts(conn, wiki, who, float("inf"), stop) == (1, 0)
    assert {t for t, _ in _rows(conn)} == {"Amethyst"}


# --- the idle tick -------------------------------------------------------------------------


def test_the_worker_writes_the_facts_and_says_so_once(tmp_path, caplog):
    conn = _db(tmp_path, "Amethyst", "Gneiss")
    wiki = Wiki({"Amethyst": page(), "Gneiss": page("Gneiss", "Gneiss is a rock.")})
    who = _writer(Ask(answer(reply(("Ancient Greeks carved amethyst cups to stay sober.", GREEKS))), answer(reply())))
    with caplog.at_level(logging.INFO, logger="jasper"):
        assert worker.catch_up(conn, None, NOW, wiki, facts=who) == NOW + worker.CATCH_UP_EVERY
    assert [r.getMessage() for r in caplog.records] == ["fun facts written for 2 article(s), 1 with none"]
    caplog.clear()
    with caplog.at_level(logging.INFO, logger="jasper"):
        worker.catch_up(conn, None, NOW, wiki, facts=who)
    assert not caplog.records  # nothing left to write, nothing said


def test_a_gateway_failure_holds_only_the_facts_clock(tmp_path, caplog):
    conn = _db(tmp_path, "Amethyst")
    hosts = worker.Hosts.at(NOW)
    who = _writer(Ask(llm.Response(402, {}, 0.1)))
    with caplog.at_level(logging.WARNING, logger="jasper"):
        assert worker.catch_up(conn, None, NOW, Wiki(), hosts, who) == NOW + worker.CATCH_UP_EVERY
    assert caplog.records[-1].getMessage() == "catch-up stopped: the gateway budget is spent (402); next try in 1 minute"
    assert hosts.facts.next_at == NOW + worker.CATCH_UP_AFTER_FAILURE and hosts.wikipedia.next_at == NOW + worker.CATCH_UP_EVERY
    assert _rows(conn) == {}


def test_a_waiting_job_ends_the_step_before_its_first_article(tmp_path):
    conn = _db(tmp_path, "Amethyst")
    conn.execute("INSERT INTO jobs (status) VALUES ('queued')")
    conn.commit()
    wiki, ask = Wiki(), Ask(answer(reply()))
    worker.catch_up(conn, None, NOW, wiki, facts=_writer(ask))
    assert wiki.asked == [] and ask.bodies == [] and _rows(conn) == {}


def test_without_a_writer_the_pass_is_as_it_was(tmp_path):
    conn = _db(tmp_path, "Amethyst")
    wiki = Wiki()
    assert worker.catch_up(conn, None, NOW, wiki) == NOW + worker.CATCH_UP_EVERY
    assert wiki.asked == [] and _rows(conn) == {}


def test_the_writer_is_the_identifier_with_the_prompt_file_and_keeps_the_key_out_of_repr():
    cfg = identify.settings({"AI_GATEWAY_API_KEY": "secret-key", "QUARRY_IDENTIFIER": "anthropic/claude-haiku-5.5"})
    who = fun_facts.writer(cfg)
    assert who.model == "anthropic/claude-haiku-5.5" and who.effort == cfg.roles[0].effort and who.key == "secret-key"
    assert who.prompt_version == identify.load_prompt(fun_facts.PROMPT_PATH)[0] and "ONLY the article" in who.system
    assert "secret-key" not in repr(who) and who.ask is llm.ask


def test_the_whole_article_query_is_the_leads_without_exintro():
    from jasper import wikipedia
    p = wikipedia.article_params("Amethyst")
    assert "exintro" not in p and p["explaintext"] == 1 and p["titles"] == "Amethyst" and p["redirects"] == 1
    assert p["inprop"] == "url" and p["ppprop"] == "disambiguation" and p["maxlag"] == wikipedia.MAXLAG_S
