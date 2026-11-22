"""The fun facts (#126): only facts whose quote is really in the article are stored,
with no figure or absolute the quote doesn't hold (the Aviary's Chimney Swift, "can
only perch", is the case the absolute rule exists for); an article that yields
nothing is recorded as none and not asked again, while Wikipedia or the gateway
failing records nothing; and the step's part in the idle tick: last, on its own
failure clock, stopping for a job and for the budget. And the old lore (#131): the
paragraphs of a book that name a mineral, Pliny's through his own names, checked
and stored the same way as rows of kind "lore". A fake Wikipedia and a fake
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


# --- the old lore (#131) -------------------------------------------------------------------

GUTENBERG = (
    "The Project Gutenberg EBook of A Book\n\nThis eBook is for the use of anyone anywhere at no cost.\n\n"
    "*** START OF THIS PROJECT GUTENBERG EBOOK A BOOK ***\n\n"
    "CONTENTS\n\nI\n\nOn Stones\n\nAgate is listed in the contents.\n\n\n"
    "I\n\nOn Stones\n\n"
    "Agate\n\n"
    "The wearing of agate ornaments was even believed to be a cure for\ninsomnia and was thought to insure pleasant dreams.[41]\n\n"
    "[Illustration: AN AGATE CHARM.\n\nMade of Brazilian agate at Oberstein, Germany.]\n\n"
    "The ruby was thought to glow in the dark, and nothing more is said of it in this place.\n\n"
    "Rock-crystal balls were gazed into by seers, who claimed to behold the future in their depths.[42]\n\n"
    "Black tourmalines were said to draw ashes to themselves when warmed by the fire of a pipe.\n\n"
    "INDEX\n\nAgate, as a cure for insomnia and other ills of the night, 51, 52, 53, 54, 55\n\n"
    "FOOTNOTES:\n\n[41] Cardano on the agate, with a long note that runs well past sixty characters.\n\n"
    "*** END OF THIS PROJECT GUTENBERG EBOOK A BOOK ***\n\nSection 1. The agate of the licence, which is long enough to be a paragraph of its own.\n"
)
KUNZ_LIKE = dict(start=r"^I\n\nOn Stones", end=r"^\s*INDEX\s*$")

BOOK_37 = (
    "CHAP. 12.—THE SEVERAL KINDS OF AMBER: THE REMEDIES DERIVED FROM IT.\n\n\n"
    "Amber, too, is greatly in request for the imitation of the transparent precious stones, amethystos[3001] in particular.\n\n\n"
    "CHAP. 40.—AMETHYSTOS; FOUR VARIETIES OF IT. SOCONDION.\n\n\n"
    "We will now commence with another class of precious stones, those of a purple colour.\n\n"
    "The falsehoods of the magicians would persuade us that these stones are preventive of inebriety,[3002] and that it is from this that they have derived their name.\n\n"
    "Socondion[3003] is the name of a stone of which nothing further is recorded by the writers on these matters.\n\n"
    "A paragraph after the next stone's entry opened, which is no longer about the purple ones at all.\n\n\n"
    "CHAP. 54.—ACHATES; THE SEVERAL VARIETIES OF IT. ACOPOS; THE REMEDIES\nDERIVED FROM IT.\n\n\n"
    "(10.) Achates[3204] was a stone formerly in high esteem, but now\nheld in none. It was first found in Sicily.\n\n"
    "The magicians make other distinctions in reference to these stones: in Persia, they say, these stones are used for arresting tempests.\n\n"
    "Acopos[3217] is a stone like nitre in appearance, porous, and starred with drops of gold: it relieves lassitude.\n\n\n"
    "CHAP. 60.—HELIOTROPIUM. HÆMATITIS.\n\n\n"
    "Oica is a stone pleasing for its colours, and ostracias is similar in all respects to achates, except that the latter is unctuous.\n\n"
    "Hæmatitis[3300] is a stone of a blood-red colour, found in Æthiopia, and the magicians promise much from it.\n\n"
    "It reveals, they say, the treacherous designs of the barbarians, when it is carried upon the person.\n"
)


def _book(tmp_path, text=GUTENBERG, source="kunz", by_alias=False, **marks):
    path = tmp_path / f"{source}.txt"
    path.write_text(text, encoding="utf-8")
    marks = marks or KUNZ_LIKE
    return fun_facts.Book(source=source, path=path, author="An Author", work="A Book", year="1913", url=f"https://www.gutenberg.org/ebooks/{source}",
                          by_alias=by_alias, **marks)


def _lore_writer(ask):
    return fun_facts.Writer(key="k", model="anthropic/claude-haiku-5.5", effort="medium", prompt_version=1, system="SYSTEM", ask=ask,
                            lore_version=1, lore_system="LORE")


def test_a_books_body_drops_gutenbergs_boilerplate_the_front_matter_the_index_and_the_notes():
    body = fun_facts.book_body(GUTENBERG, **KUNZ_LIKE)
    assert body.lstrip().startswith("Agate\n") and body.rstrip().endswith("warmed by the fire of a pipe.")
    for gone in ("Project Gutenberg", "listed in the contents", "INDEX", "FOOTNOTES", "Section 1"):
        assert gone not in body
    assert fun_facts.book_body("No such chapter here.", **KUNZ_LIKE) == ""


def test_paragraphs_are_joined_lines_without_an_illustrations_caption():
    paras = fun_facts.paragraphs(fun_facts.book_body(GUTENBERG, **KUNZ_LIKE))
    assert paras[0] == "Agate"
    assert paras[1] == "The wearing of agate ornaments was even believed to be a cure for insomnia and was thought to insure pleasant dreams.[41]"
    assert not any("Illustration" in p or "Oberstein" in p for p in paras) and len(paras) == 5


def test_passages_name_the_mineral_by_title_by_a_household_name_and_by_a_synonym():
    paras = fun_facts.paragraphs(fun_facts.book_body(GUTENBERG, **KUNZ_LIKE))
    insomnia = "The wearing of agate ornaments was even believed to be a cure for insomnia and was thought to insure pleasant dreams."
    assert fun_facts.passages_for(paras, ["Agate"]) == insomnia  # the heading, the caption and the note's number are gone
    assert fun_facts.passages_for(paras, ["Tourmaline", "schorl"]).startswith("Black tourmalines were said")  # a plural
    assert fun_facts.passages_for(paras, ["Quartz", "rock-crystal"]).startswith("Rock-crystal balls were gazed into")
    assert fun_facts.passages_for(paras, ["Quartz", "rock crystal"]).startswith("Rock-crystal balls")  # a hyphen is a space
    assert fun_facts.passages_for(paras, ["Heliotrope (bloodstone)", "ruby"]).startswith("The ruby was thought")  # the title's parenthetical is no name
    assert fun_facts.passages_for(paras, ["Calcite"]) == "" and fun_facts.passages_for(paras, []) == ""
    assert fun_facts.passages_for(paras, ["Gate"]) == ""  # a whole word, not part of one


def test_passages_are_capped_at_a_paragraph_boundary():
    paras = [f"The agate of paragraph {i} was believed to do a great many things for its wearer, it is said." for i in range(10)]
    out = fun_facts.passages_for(paras, ["Agate"], limit=250)
    assert out.count("\n\n") == 1 and out.endswith("it is said.") and len(out) <= 250


def test_plinys_passages_are_the_stones_own_chapter_and_entry_not_a_passing_mention():
    paras = fun_facts.paragraphs(BOOK_37)
    amethyst = fun_facts.passages_for(paras, ["amethystos"], entries=True)
    assert amethyst == (
        "We will now commence with another class of precious stones, those of a purple colour.\n\n"
        "The falsehoods of the magicians would persuade us that these stones are preventive of inebriety, and that it is from this that they have derived their name."
    )  # not amber's remedies, not the chapter's heading, not Socondion or what follows it
    agate = fun_facts.passages_for(paras, ["achates"], entries=True)
    assert agate.startswith("(10.) Achates was a stone formerly in high esteem, but now held in none.")
    assert "arresting tempests" in agate and "Acopos" not in agate and "ostracias" not in agate
    # An entry outside a chapter of its own: the paragraph that opens with the name, and what continues it.
    hematite = fun_facts.passages_for(paras, ["hæmatitis"], entries=True)
    assert hematite.startswith("Hæmatitis is a stone of a blood-red colour") and hematite.endswith("carried upon the person.")
    assert fun_facts.passages_for(paras, ["smaragdus"], entries=True) == ""


def test_the_alias_table_loads_and_every_alias_maps_to_a_title():
    names = fun_facts.pliny_names()
    assert names["achates"] == "Agate" and names["amethystos"] == "Amethyst" and names["sarda"] == "Carnelian"
    assert names["crystal"] == "Quartz" and names["hæmatitis"] == "Hematite" and names["smaragdus"] == "Emerald"
    assert "_" not in names and all(k == k.casefold() and k.strip() and isinstance(v, str) and v[:1].isupper() for k, v in names.items())


def test_the_two_books_are_in_the_repo_with_their_markers_and_yield_the_passages_the_epic_counts():
    for book in fun_facts.BOOKS:
        text = book.path.read_text(encoding="utf-8")
        assert "PROJECT GUTENBERG EBOOK" in text and "\r" not in text
        assert len(fun_facts.book_paragraphs(book)) > 200
    pliny, kunz = (list(fun_facts.book_paragraphs(b)) for b in fun_facts.BOOKS)
    agate = fun_facts.passages_for(pliny, ["achates"], entries=True)
    assert "renders athletes invincible" in agate and "Acopos" not in agate
    assert "preventive of inebriety" in fun_facts.passages_for(pliny, ["amethystos"], entries=True)
    crystal = fun_facts.passages_for(pliny, ["crystal"], entries=True)
    assert "it is a kind of ice" in crystal and "very best cautery" in crystal  # chapters 9 ("CHAP. 9—", no stop) and 10
    assert "air-ship" in fun_facts.passages_for(kunz, ["Agate"])
    assert fun_facts.passages_for(kunz, ["Quartz", "rock-crystal"]) and fun_facts.passages_for(kunz, ["Calcite"]) == ""
    assert "Project Gutenberg" not in "".join(pliny + kunz)


def test_the_lore_prompt_loads_and_asks_for_beliefs():
    version, body = identify.load_prompt(fun_facts.LORE_PROMPT_PATH)
    assert version >= 1 and "ONLY the passages" in body and "as a belief" in body and '"facts"' in body and "character for character" in body
    who = fun_facts.writer(identify.settings({"AI_GATEWAY_API_KEY": "k"}))
    assert who.lore_system == body and who.lore_version == version and "as a belief" not in repr(who)


def test_what_a_book_may_call_a_mineral(tmp_path):
    conn = _db(tmp_path, "Tourmaline", "Quartz", "Agate")
    conn.execute("INSERT INTO wikipedia_pages (term, title, url, summary) VALUES ('schorl', 'Tourmaline', 'u', 's')")
    assert fun_facts.names_for(conn, "Tourmaline", fun_facts.KUNZ) == ["Tourmaline", "schorl", "tourmaline"]
    assert fun_facts.names_for(conn, "Quartz", fun_facts.KUNZ) == ["Quartz", "quartz", "rock-crystal"]
    assert fun_facts.names_for(conn, "Agate", fun_facts.PLINY) == ["achates"]
    assert fun_facts.names_for(conn, "Tourmaline", fun_facts.PLINY) == []


def test_a_lore_facts_quote_is_checked_against_its_passages_as_a_wikipedia_facts_is(tmp_path, caplog):
    book = _book(tmp_path)
    quote = "The wearing of agate ornaments was even believed to be a cure for insomnia and was thought to insure pleasant dreams."
    ask = Ask(answer(reply(
        ("Wearing agate was once believed to cure insomnia and bring pleasant dreams.", quote),
        ("Rubies were thought to glow in the dark.", "The ruby was thought to glow in the dark"),  # in the book, not in the agate's passages
        ("Agate was believed to be the only cure for insomnia.", quote),
    )))
    with caplog.at_level(logging.INFO, logger="jasper"):
        facts = fun_facts.lore_for("Agate", ["Agate"], book, _lore_writer(ask), fun_facts.paragraphs(fun_facts.book_body(GUTENBERG, **KUNZ_LIKE)))
    assert [f["text"] for f in facts] == ["Wearing agate was once believed to cure insomnia and bring pleasant dreams."]
    assert facts[0]["source"] == {"author": "An Author", "work": "A Book", "year": "1913", "url": "https://www.gutenberg.org/ebooks/kunz"}
    assert [r.getMessage() for r in caplog.records] == [
        "lore: Agate in kunz: dropped 'Rubies were thought to glow in the dark.' (its quote is not in the article)",
        "lore: Agate in kunz: dropped 'Agate was believed to be the only cure for insomnia.' (absolutes its quote doesn't say: only)",
    ]
    (_, body), = ask.bodies
    assert body["system"] == "LORE"
    assert body["messages"][0]["content"][0]["text"] == f"Stone: Agate\n\nPassages from A Book by An Author (1913):\n<<<\n{quote}\n>>>"


def test_a_lore_row_is_written_per_title_and_source_with_none_for_a_book_that_never_names_it_and_no_call(tmp_path):
    conn = _db(tmp_path, "Agate", "Calcite")
    kunz, pliny = _book(tmp_path), _book(tmp_path, BOOK_37, "pliny", by_alias=True, start=r"\A", end=r"\Z")
    quote = "The wearing of agate ornaments was even believed to be a cure for insomnia and was thought to insure pleasant dreams."
    ask = Ask(answer(reply(("In Persia, magicians said agates could stop a tempest.", "in Persia, they say, these stones are used for arresting tempests"))),
              answer(reply(("Wearing agate was once believed to cure insomnia.", quote))))
    assert fun_facts.write_lore(conn, _lore_writer(ask), float("inf"), Clock(), (pliny, kunz)) == [("pliny", 2, 1), ("kunz", 2, 1)]
    rows = _rows(conn)
    assert rows[("Calcite", "pliny")] == ("lore", []) and rows[("Calcite", "kunz")] == ("lore", [])
    assert [f["text"] for f in rows[("Agate", "pliny")][1]] == ["In Persia, magicians said agates could stop a tempest."]
    assert rows[("Agate", "kunz")][0] == "lore" and rows[("Agate", "kunz")][1][0]["source"]["work"] == "A Book"
    assert len(ask.bodies) == 2  # one call a book for the agate, none for the calcite
    assert fun_facts.write_lore(conn, _lore_writer(ask), float("inf"), Clock(), (pliny, kunz)) == [("pliny", 0, 0), ("kunz", 0, 0)]
    assert len(ask.bodies) == 2 and fun_facts.wanted(conn) == ["Agate", "Calcite"]  # Wikipedia's rows are another source's


def test_a_gateway_failure_writes_no_lore_row_and_a_writer_without_the_prompt_writes_none(tmp_path):
    conn = _db(tmp_path, "Agate")
    with pytest.raises(mindat.Unreachable, match="rate-limited"):
        fun_facts.write_lore(conn, _lore_writer(Ask(llm.Response(429, {}, 0.1))), float("inf"), Clock(), (_book(tmp_path),))
    assert _rows(conn) == {}
    assert fun_facts.write_lore(conn, _writer(Ask(answer(reply()))), float("inf"), Clock(), (_book(tmp_path),)) == [] and _rows(conn) == {}


def test_the_lore_stops_for_the_budget_and_goes_on_next_pass(tmp_path):
    conn, clock = _db(tmp_path, "Agate", "Calcite"), Clock()
    kunz = _book(tmp_path)
    who = _lore_writer(Ask(answer(reply()), clock=clock))
    assert fun_facts.write_lore(conn, who, 5, clock, (kunz, kunz)) == [("kunz", 1, 1)]  # the agate's answer took ten seconds
    assert set(_rows(conn)) == {("Agate", "kunz")}
    assert fun_facts.write_lore(conn, who, float("inf"), clock, (kunz,)) == [("kunz", 1, 1)]
    assert set(_rows(conn)) == {("Agate", "kunz"), ("Calcite", "kunz")}


def test_the_worker_writes_the_lore_after_the_facts_and_says_so_per_book(tmp_path, caplog):
    conn = _db(tmp_path, "Agate", "Calcite")
    wiki = Wiki({})
    with caplog.at_level(logging.INFO, logger="jasper"):
        worker.catch_up(conn, None, NOW, wiki, facts=_lore_writer(Ask(answer(reply()))))
    assert [r.getMessage() for r in caplog.records if "dropped" not in r.getMessage()] == [
        "fun facts written for 2 article(s), 2 with none",
        "lore written for 2 article(s) from pliny, 2 with none",
        "lore written for 2 article(s) from kunz, 2 with none",
    ]
    assert {k: v[0] for k, v in _rows(conn).items()} == {
        ("Agate", "wikipedia"): "fact", ("Calcite", "wikipedia"): "fact",
        ("Agate", "pliny"): "lore", ("Calcite", "pliny"): "lore", ("Agate", "kunz"): "lore", ("Calcite", "kunz"): "lore",
    }
