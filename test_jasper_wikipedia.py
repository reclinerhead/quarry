"""Wikipedia's lead for each name (#92): what a query's answer means, which titles
are asked, the lead tidied, which terms a household asks for, a term asked once,
and the pass's part in the idle tick. A fake API stands in for Wikipedia; the
HTTP itself stays untested."""

import logging
from datetime import datetime, timezone

import pytest

from jasper import db, mindat, wikipedia, worker

NOW = datetime(2026, 11, 4, 15, 0, tzinfo=timezone.utc)


def article(title, extract, url=None, redirect_from=None, fragment=None, props=None):
    """A query body as Wikipedia sends it (formatversion 2): one page, with any redirect it followed."""
    body = {"batchcomplete": True, "query": {"pages": [{"pageid": 1, "ns": 0, "title": title, "extract": extract,
                                                        "fullurl": url or f"https://en.wikipedia.org/wiki/{title.replace(' ', '_')}",
                                                        "canonicalurl": url or f"https://en.wikipedia.org/wiki/{title.replace(' ', '_')}",
                                                        **({"pageprops": props} if props else {})}]}}
    if redirect_from:
        body["query"]["redirects"] = [{"from": redirect_from, "to": title, **({"tofragment": fragment} if fragment else {})}]
    return body


def missing(title):
    return {"batchcomplete": True, "query": {"pages": [{"ns": 0, "title": title, "missing": True}]}}


GNEISS = "Gneiss ( NYSE) is a common and widely distributed type of metamorphic rock. It is formed by high-temperature and high-pressure metamorphic processes.\n\nGneiss forms at higher temperatures and pressures than schist."
PYRITE = "The mineral pyrite ( PY-ryte), or iron pyrite, also known as fool&#39;s gold, is an iron sulfide with the chemical formula FeS2.\n\n\n\nPyrite is the most abundant sulfide mineral."

# What Wikipedia answered on 2026-11-03, by the title asked.
PAGES = {
    "Gneiss": article("Gneiss", GNEISS),
    "Pyrite": article("Pyrite", PYRITE),
    "Granite gneiss": article("Gneiss", GNEISS, redirect_from="Granite gneiss"),
    "Crazy lace agate": article("Agate", "Agate is a banded variety of chalcedony.", redirect_from="Crazy lace agate", fragment="Crazy lace agate"),
    "Fossil coral": article("Coral", "Corals are colonial marine invertebrates.", redirect_from="Fossil coral", fragment="Evolution"),
    "Dolomite": article("Dolomite", "Dolomite may refer to:\n\nDolomite (mineral), a carbonate mineral\nDolomite (rock), also known as dolostone",
                        props={"disambiguation": ""}),
    "Dolomite (mineral)": article("Dolomite (mineral)", "Dolomite is an anhydrous carbonate mineral."),
    "Jasper": article("Jasper", "Jasper is an aggregate of microgranular quartz."),
    "Jasper (rock)": article("Jasper", "Jasper is an aggregate of microgranular quartz."),
    "Potassium feldspar": article("Potassium feldspar", "Potassium feldspar may refer to:\n\nOrthoclase\nMicrocline\nSanidine"),
    "Amethyst": article("Amethyst", "Amethyst is a violet variety of quartz."),
    "Agate": article("Agate", "Agate is a banded variety of chalcedony."),
    "Obsidian": article("Obsidian", "Obsidian is a naturally occurring volcanic glass."),
    "Blank": article("Blank", ""),
}


class Clock:
    def __init__(self, t=0.0):
        self.t = t

    def __call__(self):
        return self.t


class FakeApi:
    """Wikipedia as the tests need it: a body per title, `missing` for any other; `fail` answers every query with a 503."""

    def __init__(self, pages=PAGES, fail=False, clock=None):
        self.pages = pages
        self.fail = fail
        self.clock = clock
        self.requests = 0
        self.asked = []

    def query(self, title):
        self.requests += 1
        self.asked.append(title)
        if self.clock:
            self.clock.t += 1
        if self.fail:
            raise mindat.Unreachable("en.wikipedia.org answered 503")
        return self.pages.get(title) or missing(title)


def _db(tmp_path):
    return db.connect(tmp_path / "q.db")


def _mineral(conn, name, kind="mineral"):
    mid = conn.execute("INSERT INTO minerals (name, kind) VALUES (?, ?)", (name, kind)).lastrowid
    conn.commit()
    return mid


def _stone(conn, mineral_id, variety=None):
    sid = conn.execute("INSERT INTO specimens (mineral_id, variety) VALUES (?, ?)", (mineral_id, variety)).lastrowid
    conn.commit()
    return sid


def _rows(conn):
    return {r[0]: (r[1], r[2]) for r in conn.execute("SELECT term, title, url FROM wikipedia_pages")}


def _fetch(conn, api, deadline=float("inf"), clock=None):
    return wikipedia.fetch_pages(conn, api, deadline, clock or (lambda: 0.0))


# --- what an answer means --------------------------------------------------------------


def test_an_article_is_kept_with_its_title_url_and_tidied_lead():
    page = wikipedia.parse_page(PAGES["Gneiss"])
    assert page == wikipedia.Page(
        title="Gneiss",
        url="https://en.wikipedia.org/wiki/Gneiss",
        summary="Gneiss is a common and widely distributed type of metamorphic rock. It is formed by high-temperature and high-pressure metamorphic processes.\n\n"
        "Gneiss forms at higher temperatures and pressures than schist.",
    )


def test_a_redirect_to_a_whole_article_is_kept_under_the_articles_title():
    assert wikipedia.parse_page(PAGES["Granite gneiss"]).title == "Gneiss"


def test_a_redirect_to_a_section_of_another_article_is_no_article():
    assert wikipedia.parse_page(PAGES["Fossil coral"]) == "missing"
    assert wikipedia.parse_page(PAGES["Crazy lace agate"]) == "missing"  # the stone reads Agate through its next term


def test_a_disambiguation_page_is_one_marked_or_one_whose_lead_says_may_refer_to():
    assert wikipedia.parse_page(PAGES["Dolomite"]) == "disambiguation"
    assert wikipedia.parse_page(PAGES["Potassium feldspar"]) == "disambiguation"  # a set index, unmarked
    # "may refer to" further down is not the lead's verdict.
    assert isinstance(wikipedia.parse_page(article("Jade", "Jade is a mineral.\n\nThe word may refer to two minerals.")), wikipedia.Page)


def test_a_missing_page_an_empty_lead_and_a_malformed_body_are_no_article():
    assert wikipedia.parse_page(missing("Potassium Feldspar")) == "missing"
    assert wikipedia.parse_page(PAGES["Blank"]) == "missing"
    assert wikipedia.parse_page({}) == "missing"
    assert wikipedia.parse_page({"query": {"pages": "none"}}) == "missing"
    assert wikipedia.parse_page({"query": {"pages": [{"title": "X", "extract": "X is."}]}}) == "missing"  # no URL


def test_the_lead_is_tidied():
    assert wikipedia.tidy(PYRITE) == "The mineral pyrite, or iron pyrite, also known as fool's gold, is an iron sulfide with the chemical formula FeS2.\n\nPyrite is the most abundant sulfide mineral."
    assert wikipedia.tidy("Quartz (; from German Quarz) is a mineral.") == "Quartz is a mineral."
    assert wikipedia.tidy("Calcite (English: /ˈkælˌsaɪt/) is a carbonate mineral.") == "Calcite is a carbonate mineral."
    assert wikipedia.tidy("Galena (/ɡəˈliːnə/), also called lead glance, is a sulfide.") == "Galena, also called lead glance, is a sulfide."
    assert wikipedia.tidy("A ratio (1/2 or 2/3) of iron.") == "A ratio (1/2 or 2/3) of iron."  # slashes alone are not the IPA
    assert wikipedia.tidy("Calcite () is a carbonate.") == "Calcite is a carbonate."
    assert wikipedia.tidy("Galena (also called lead glance) is a sulfide.") == "Galena (also called lead glance) is a sulfide."  # prose stays
    assert wikipedia.tidy("  one\n\n\n\n two  words \n") == "one\n\ntwo words"
    assert wikipedia.tidy("") == "" and wikipedia.tidy(None) == ""


# --- which titles --------------------------------------------------------------------


def test_a_term_is_asked_as_written_then_sentence_cased_each_once():
    assert wikipedia.titles("Potassium Feldspar") == ["Potassium Feldspar", "Potassium feldspar"]
    assert wikipedia.titles("Tiger's Eye") == ["Tiger's Eye", "Tiger's eye"]
    assert wikipedia.titles("Gneiss") == ["Gneiss"]
    assert wikipedia.titles(" crazy   lace  agate ") == ["crazy lace agate", "Crazy lace agate"]
    assert wikipedia.titles("  ") == []


def test_a_disambiguation_is_asked_again_as_a_mineral_then_a_rock():
    api = FakeApi()
    assert wikipedia.look_up(api, "Dolomite", float("inf"), lambda: 0.0).title == "Dolomite (mineral)"
    assert api.asked == ["Dolomite", "Dolomite (mineral)"]
    api = FakeApi()
    assert wikipedia.look_up(api, "Jasper", float("inf"), lambda: 0.0).title == "Jasper"
    assert api.asked == ["Jasper"]
    api = FakeApi({"Jasper": PAGES["Dolomite"], "Jasper (rock)": PAGES["Jasper (rock)"]})
    assert wikipedia.look_up(api, "Jasper", float("inf"), lambda: 0.0).title == "Jasper"
    assert api.asked == ["Jasper", "Jasper (mineral)", "Jasper (rock)"]


def test_a_name_that_misses_on_its_casing_is_asked_sentence_cased_and_a_set_index_is_no_article():
    api = FakeApi()
    assert wikipedia.look_up(api, "Potassium Feldspar", float("inf"), lambda: 0.0) is None
    # The set index is a disambiguation: "(mineral)" and "(rock)" are tried, then the other spelling is not.
    assert api.asked == ["Potassium Feldspar", "Potassium feldspar", "Potassium feldspar (mineral)", "Potassium feldspar (rock)"]


# --- which terms, asked once -----------------------------------------------------------


def test_every_name_and_variety_is_wanted_once_folded_minus_those_asked(tmp_path):
    conn = _db(tmp_path)
    q = _mineral(conn, "Quartz")
    _mineral(conn, "Gneiss", "rock")
    _stone(conn, q, "Agate, banded")
    _stone(conn, q, "amethyst")
    _stone(conn, q, "Agate, banded")
    _stone(conn, q, "Quartz")  # the mineral's own name as a variety adds nothing
    assert wikipedia.wanted(conn) == ["Quartz", "Gneiss", "Agate, banded", "Agate", "amethyst"]
    conn.execute("INSERT INTO wikipedia_pages (term, title, url, summary) VALUES ('agate', 'Agate', 'u', 's')")
    conn.execute("INSERT INTO wikipedia_pages (term) VALUES ('gneiss')")
    conn.commit()
    assert wikipedia.wanted(conn) == ["Quartz", "Agate, banded", "amethyst"]


def test_a_page_is_fetched_once_and_a_name_with_no_article_is_asked_once(tmp_path):
    conn, api = _db(tmp_path), FakeApi()
    g = _mineral(conn, "Gneiss", "rock")
    _mineral(conn, "Fossil coral", "other")
    _stone(conn, g, "Granite Gneiss")
    assert _fetch(conn, api) == (3, 1)
    assert _rows(conn) == {
        "gneiss": ("Gneiss", "https://en.wikipedia.org/wiki/Gneiss"),
        "fossil coral": (None, None),
        "granite gneiss": ("Gneiss", "https://en.wikipedia.org/wiki/Gneiss"),
    }
    assert api.asked == ["Gneiss", "Fossil coral", "Granite Gneiss", "Granite gneiss"]
    assert conn.execute("SELECT summary FROM wikipedia_pages WHERE term = 'granite gneiss'").fetchone()[0].startswith("Gneiss is a common")
    assert conn.execute("SELECT fetched_at FROM wikipedia_pages WHERE term = 'fossil coral'").fetchone()[0]
    assert _fetch(conn, api) == (0, 0) and api.requests == 4  # nothing left to ask


def test_a_failure_stores_nothing_and_stops_the_pass(tmp_path):
    conn = _db(tmp_path)
    _mineral(conn, "Gneiss", "rock")
    _mineral(conn, "Pyrite")
    with pytest.raises(mindat.Unreachable):
        _fetch(conn, FakeApi(fail=True))
    assert _rows(conn) == {}
    assert _fetch(conn, FakeApi()) == (2, 0)


def test_running_out_of_time_stops_quietly_and_the_next_pass_goes_on(tmp_path):
    conn, clock = _db(tmp_path), Clock()
    api = FakeApi(clock=clock)
    _mineral(conn, "Gneiss", "rock")
    _mineral(conn, "Dolomite")
    _mineral(conn, "Pyrite")
    # Each request takes a second; Dolomite needs two. The budget ends after two requests.
    assert _fetch(conn, api, deadline=2, clock=clock) == (1, 0)
    assert set(_rows(conn)) == {"gneiss"}
    assert _fetch(conn, api, deadline=float("inf"), clock=clock) == (2, 0)
    assert set(_rows(conn)) == {"gneiss", "dolomite", "pyrite"}


# --- the idle pass -------------------------------------------------------------------


def test_the_idle_pass_asks_wikipedia_last_and_stops_for_a_job(tmp_path):
    conn, clock = _db(tmp_path), Clock()
    wiki = FakeApi(clock=clock)
    _mineral(conn, "Gneiss", "rock")
    _mineral(conn, "Pyrite")
    assert mindat.idle(conn, None, clock=clock, wiki=wiki, should_stop=lambda: wiki.requests >= 1) == (0, 0, 0, 0, (1, 0))
    assert set(_rows(conn)) == {"gneiss"}
    assert mindat.idle(conn, None, clock=clock, wiki=wiki) == (0, 0, 0, 0, (1, 0))
    assert set(_rows(conn)) == {"gneiss", "pyrite"}


def test_the_worker_logs_the_pages_and_runs_without_a_mindat_key(tmp_path, caplog):
    conn = _db(tmp_path)
    _mineral(conn, "Gneiss", "rock")
    _mineral(conn, "Fossil coral", "other")
    with caplog.at_level(logging.INFO, logger="jasper"):
        assert worker.catch_up(conn, None, NOW, FakeApi()) == NOW + worker.CATCH_UP_EVERY
    assert [r.getMessage() for r in caplog.records] == ["wikipedia fetched 2 page(s), 1 with no article"]
    caplog.clear()
    with caplog.at_level(logging.INFO, logger="jasper"):
        assert worker.catch_up(conn, None, NOW, FakeApi()) == NOW + worker.CATCH_UP_EVERY
    assert not caplog.records  # nothing left to ask, nothing said
    _mineral(conn, "Pyrite")
    with caplog.at_level(logging.WARNING, logger="jasper"):
        assert worker.catch_up(conn, None, NOW, FakeApi(fail=True)) == NOW + worker.CATCH_UP_AFTER_FAILURE
    assert caplog.records[-1].getMessage().startswith("catch-up stopped: en.wikipedia.org answered 503")


def test_the_query_asks_for_the_lead_the_url_and_the_disambiguation_mark():
    p = wikipedia.params("Granite gneiss")
    assert p["titles"] == "Granite gneiss" and p["redirects"] == 1 and p["maxlag"] == wikipedia.MAXLAG_S
    assert p["prop"] == "extracts|info|pageprops" and p["exintro"] == 1 and p["explaintext"] == 1
    assert p["inprop"] == "url" and p["ppprop"] == "disambiguation" and p["formatversion"] == 2
    assert "quarry" in wikipedia.USER_AGENT
