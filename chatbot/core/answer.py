"""Ask the Atlas: answer(query, mode) for the chatbot panel (Contract 2, contracts/answer.schema.md).

Retrieval and ranking are deterministic. The query is matched against the Atlas's own
vocabulary (offers, tags, founder stages, categories, places), and every result, reason and
doubt is built from atlas.json fields, so the same query ranks the same way in both modes and
nothing outside atlas.json can appear. A model, when one is configured, only maps an unusual
question onto that same vocabulary; it never names an organization.
"""
import json
import math
import os
import re
import sys
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
ATLAS_URL = "https://the-open-accelerator.com/ecosystem/?entry={}"
MAX_RESULTS = 8
FAILED = "Something went wrong: needs review."


def _load_env():
    """Read KEY=VALUE lines from the repo's .env without overriding the real environment."""
    path = REPO / ".env"
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_env()


def _path(var, default):
    p = Path(os.environ.get(var) or default)
    return p if p.is_absolute() else REPO / p


# ---------- data, cached until the file changes ----------

_cache = {}


def _cached(path, loader):
    key = str(path)
    stamp = path.stat().st_mtime if path.exists() else None
    hit = _cache.get(key)
    if hit and hit[0] == stamp:
        return hit[1]
    value = loader(path)
    _cache[key] = (stamp, value)
    return value


def _load_atlas(path):
    data = json.loads(path.read_text(encoding="utf-8"))["data"]
    return {"data": data, "by_id": {d["id"]: d for d in data}}


def atlas():
    return _cached(_path("ATLAS_PATH", "chatbot/data/atlas.json"), _load_atlas)


def _load_links(path):
    """Contract 1 rows, cleaned: unknown ids, missing source or quote, bad status and
    self-links are dropped; a repeated (from, to) pair keeps its last row."""
    if not path.exists():
        return []
    try:
        rows = json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return []
    by_id = atlas()["by_id"]
    kept = {}
    for r in rows if isinstance(rows, list) else []:
        if not isinstance(r, dict):
            continue
        f, t = r.get("from_id"), r.get("to_id")
        if f not in by_id or t not in by_id or f == t:
            continue
        if not r.get("source_url") or not r.get("quote"):
            continue
        if r.get("status") not in ("approved", "pending", "rejected"):
            continue
        kept[(f, t)] = r
    return list(kept.values())


def links():
    return _cached(_path("LINKS_PATH", "contracts/sample-proposed-links.json"), _load_links)


# ---------- the six doubts (exact wording from Contract 2) ----------

def _check_size(d):
    return next((f[1] for f in d.get("facts") or [] if f and f[0] == "Check size"), None)


def doubts(d, mode, approved_from):
    out = []
    if d.get("approx"):
        out.append("approximate pin")
    if d.get("lastVerified"):
        out.append(f"last verified {d['lastVerified']}")
    if d.get("cat") == "startup" and not d.get("stages"):
        out.append("no stage listed")
    if not d.get("links") and not (mode == "after" and d["id"] in approved_from):
        out.append("no connections")
    if "funding" in (d.get("offers") or []) and not _check_size(d):
        out.append("no check size listed")
    ab = d.get("applyBy")
    if ab == "rolling":
        out.append("applications rolling")
    elif ab:
        out.append(f"deadline passed {ab}" if ab < date.today().isoformat() else f"apply by {ab}")
    return out


def connections(d, mode, link_rows):
    by_id = atlas()["by_id"]
    out = [{"to_id": x, "relation": "listed", "status": "atlas", "source_url": ATLAS_URL.format(d["id"]),
            "quote": None, "new": False} for x in d.get("links") or [] if x in by_id]
    if mode == "after":
        for status in ("approved", "pending"):
            for r in link_rows:
                if r["from_id"] == d["id"] and r["status"] == status:
                    out.append({"to_id": r["to_id"], "relation": r.get("relation") or "related", "status": status,
                                "source_url": r["source_url"], "quote": r["quote"], "new": True})
    return out


# ---------- the vocabulary a question is read against ----------

OFFERS = {
    "funding": r"invest(?:or|ors|ment|ments|ing)?|vcs?|venture capital|capital|funding|funders?|money|cheques?|checks?|backers?|raise|raising|fundrais\w*",
    "grants": r"grants?|non-?dilutive|equity[- ]free|prizes?|free money|sbir|stipends?",
    "space": r"office(?: space)?|desks?|lab space|wet[- ]?labs?|workspace|co-?working|makerspace|bench space|place to work|space",
    "compute": r"compute|gpus?|gpu clusters?|hpc|cloud credits|computing power|compute time|inference credits",
    "mentorship": r"mentors?|mentorship|mentoring|advice|advis[eo]rs?|coach(?:ing|es)?|guidance|feedback|office hours",
    "community": r"communit(?:y|ies)|meetups?|network(?:ing)?|peers|people to meet|meet (?:other )?founders|events?",
    "talent": r"talent|hir(?:e|ing)|recruit(?:ing|ment)?|engineers?|interns?|internships?|co-?founders?|teammates?|developers?",
    "customers": r"customers?|pilots?|buyers?|design partners?|first users|sales|distribution|clients?",
}
OFFER_LABEL = {"funding": "funding", "grants": "equity-free money", "space": "space", "compute": "compute",
               "mentorship": "mentorship", "community": "community", "talent": "talent",
               "customers": "customers and pilots"}

STAGES = {
    1: r"just an idea|idea stage|an idea|curious|exploring|getting started|new to (?:ai|boston|massachusetts|the state)|beginner",
    2: r"validat(?:e|ing|ion)|prototype|mvp|test(?:ing)? (?:the|my) idea|customer discovery",
    3: r"build stage|building (?:a|the|my) (?:team|prototype|product)",
    4: r"pre-?seed|seed(?: stage| round)?|first (?:round|check|cheque)|raising|fundrais\w*",
    5: r"series [a-d]|scal(?:e|ing) up|scaling|growth stage|later stage|expan(?:d|ding|sion)",
}
STAGE_NAME = {1: "Spark", 2: "Validate", 3: "Build", 4: "Fund", 5: "Scale"}

TAGS = {
    "healthcare": r"health\w*|medical|medtech|med-tech|clinical|hospitals?|patients?",
    "biotech": r"bio\w*|life sciences?|pharma\w*|drug discovery",
    "fintech": r"fintech|financ(?:e|ial)|banking|payments?|insurtech",
    "climate": r"climate|clean ?tech|clean energy|energy|sustainab\w*|carbon|decarboni\w*",
    "robotics": r"robot\w*|drones?|autonomous|automation",
    "education": r"ed-?tech|educat\w*|schools?|teaching",
    "security": r"security|cyber\w*",
    "defense": r"defen[cs]e|dual[- ]use|military",
    "generative AI": r"gen ?ai|generative|llms?|large language models?|foundation models?|chatbots?|ai agents?|agentic",
    "AI safety": r"ai safety|alignment|interpretability|responsible ai",
    "open source": r"open[- ]source",
    "deep tech": r"deep[- ]tech|hard[- ]tech|tough[- ]tech|frontier tech",
    "enterprise": r"enterprise|b2b|saas",
    "consumer": r"consumer|b2c",
    "industrial": r"industrial|manufactur\w*|factor(?:y|ies)|logistics|supply chain",
    "infrastructure": r"infra(?:structure)?|mlops|dev ?tools|developer tools",
    "edge AI": r"edge ai|on-?device|embedded",
    "ML": r"machine learning|ml",
    "research": r"research\w*|academic|phd",
    "students": r"students?|undergrad\w*",
    "diverse founders": r"women|female founders?|underrepresented|diverse founders?|bipoc|minorit(?:y|ies)",
    "pre-seed": r"pre-?seed",
    "equity-free": r"equity[- ]free|non-?dilutive",
    "incubator": r"incubat\w*",
    "lab space": r"lab space|wet[- ]?labs?|bench space",
    "coworking": r"co-?working|desks?",
    "hackathons": r"hackathons?",
    "venture studio": r"(?:venture|startup) studios?",
    "co-living": r"co-?living|housing",
    "MIT spinout": r"spin-?outs?|spun out",
    "policy": r"policy|regulat\w*",
    "MIT": r"mit", "Harvard": r"harvard", "Tufts": r"tufts", "Northeastern": r"northeastern",
    "BU": r"boston university", "BC": r"boston college", "Babson": r"babson",
}

CATS = {
    "vc": r"vcs?|venture capital(?:ists?| firms?)?|venture firms?|investors?|investment firms?",
    "angel": r"angels?|angel (?:groups?|investors?|networks?)|investors?",
    "accel": r"accelerators?|incubators?|startup programs?",
    "university": r"universit(?:y|ies)|research (?:labs?|cent(?:er|re)s?|institutes?)|university labs?",
    "corporate": r"corporate labs?|corporations?|big tech",
    "startup": r"(?<!for )startups|ai companies",
    "community": r"communit(?:y|ies)|meetups?",
    "event": r"events?|conferences?|summits?|hackathons?|pitch (?:nights?|competitions?)",
    "gov": r"government|state (?:programs?|agenc\w+|funding)|public (?:funding|agenc\w+)|agenc(?:y|ies)",
    "space": r"coworking spaces?|innovation hubs?|hubs",
    "student": r"student (?:groups?|clubs?|orgs?|organi[sz]ations?)|clubs?",
}

# Query place → substrings of an entry's loc. Only places that appear in the data.
PLACES = {
    "cambridge": ["Cambridge", "Kendall", "Harvard Sq", "Central Square"],
    "kendall": ["Kendall"], "harvard square": ["Harvard Sq"],
    "boston": ["Boston", "Seaport", "Fort Point", "Back Bay", "Allston", "Charlestown", "Dorchester", "Fenway",
               "Downtown"],
    "seaport": ["Seaport", "Fort Point"], "fort point": ["Fort Point"], "back bay": ["Back Bay"],
    "allston": ["Allston"], "somerville": ["Somerville"], "waltham": ["Waltham", "Bay Colony"],
    "worcester": ["Worcester"], "amherst": ["Amherst"], "holyoke": ["Holyoke"], "medford": ["Medford"],
    "burlington": ["Burlington"], "wilmington": ["Wilmington"], "watertown": ["Watertown"],
    "newton": ["Newton"], "wellesley": ["Wellesley"], "brookline": ["Brookline"], "westford": ["Westford"],
    "westborough": ["Westborough"], "north reading": ["North Reading"], "devens": ["Devens"],
    "fall river": ["Fall River"], "chestnut hill": ["Chestnut Hill"], "charlestown": ["Charlestown"],
    "dorchester": ["Dorchester"], "fenway": ["Fenway"], "bedford": ["Bedford"],
}
# Massachusetts places with no Atlas entries. Coordinates are approximate city centres, used
# only to order the nearest alternatives; the answer says so.
GAP_PLACES = {
    "new bedford": (41.636, -70.934), "springfield": (42.102, -72.590), "lowell": (42.633, -71.316),
    "pittsfield": (42.450, -73.245), "berkshires": (42.400, -73.250), "cape cod": (41.700, -70.300),
    "hyannis": (41.653, -70.288), "northampton": (42.325, -72.641), "lawrence": (42.707, -71.163),
    "brockton": (42.083, -71.018), "quincy": (42.253, -71.002), "lynn": (42.467, -70.950),
    "framingham": (42.279, -71.416), "plymouth": (41.958, -70.667), "salem": (42.520, -70.897),
    "lexington": (42.447, -71.225), "andover": (42.658, -71.137), "nantucket": (41.284, -70.100),
}
BOSTON = (42.3601, -71.0589)
OUT_OF_STATE = (r"providence|rhode island|new york|nyc|manhattan|brooklyn|san francisco|bay area|silicon valley|"
                r"palo alto|new hampshire|nashua|connecticut|hartford|new haven|vermont|maine|seattle|austin|"
                r"chicago|los angeles|london|toronto|montreal|new jersey|philadelphia")
CONTACT = r"e-?mails?|phone(?: numbers?)?|cell(?: phone)?|contact (?:info|information|details)|linkedin|home address|whatsapp"
PERSON = r"who (?:is|are|runs|leads|founded|started)|ceo|cto|founders? of|partners? at|people at|employees|staff"
OPEN_NOW = r"open now|accepting applications|applications open|open to apply|apply now|deadline|rolling"

STOP = set("""a an the and or but if then so to of in on at by for with from into about over under near around
i im i'm we we're our my me us you your they them their it its this that these those there here
is are was were be been being am do does did have has had can could would should will may might must
need needs needing want wants wanting looking look find finding get getting help helps helping please
some any anything something someone anyone who what where which when how why best good great top more most
very really just also like such other others new early stage stages startup startups company companies founder
founders team org orgs organization organizations organisation organisations list show tell give recommend
options option places place people work working build building make making support resources thing things
massachusetts mass boston area atlas ai near local based tech technology now today currently""".split())

_WORD = r"(?<![a-z0-9]){}(?![a-z0-9])"


def _find(pattern, text):
    return [m.span() for m in re.finditer(_WORD.format(f"(?:{pattern})"), text)]


def _haversine(a, b):
    r = math.pi / 180
    h = math.sin((b[0] - a[0]) * r / 2) ** 2 + math.cos(a[0] * r) * math.cos(b[0] * r) * math.sin((b[1] - a[1]) * r / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


_GENERIC = set("ventures venture capital partners vc labs lab group fund funds inc the of at boston cambridge ma "
               "institute center centre university ai and for".split())


def _alias_cache():
    """Ways a question can name an entry: its full name, the name without a parenthesis or
    generic words, and its id. Short or common-word aliases are skipped."""
    key = ("aliases", id(atlas()))
    if key not in _cache:
        common = STOP | set(OFFERS) | {t.lower() for t in TAGS} | set(PLACES) | {
            "atlas", "trust", "engine", "material", "matrix", "battery", "foundry", "unusual", "january",
            "converge", "pillar", "underscore", "launchpad", "harvard", "tufts", "northeastern", "seed"}
        out = []
        for d in atlas()["data"]:
            name = d["name"].lower()
            plain = re.sub(r"\s*\(.*?\)", "", name).strip()
            forms = {name, plain}
            core = " ".join(w for w in re.findall(r"[a-z0-9.&'-]+", plain) if w not in _GENERIC)
            if len(core) >= 5 and core not in common:
                forms.add(core)
            if len(d["id"]) >= 4 and d["id"] not in common and not d["id"].isdigit():
                forms.update({d["id"], d["id"].replace("-", " ")})
            out += [(f, d["id"]) for f in forms if len(f) >= 3 and f not in common]
        _cache[key] = sorted(out, key=lambda x: -len(x[0]))
    return _cache[key]


def parse(query):
    """Read a question into slots from the Atlas vocabulary. Everything here is a reading of
    the question, not a fact about any organization."""
    t = re.sub(r"\s+", " ", (query or "").lower().replace("’", "'")).strip()
    taken = []

    def grab(pattern):
        spans = [s for s in _find(pattern, t) if not any(a < s[1] and s[0] < b for a, b in taken)]
        taken.extend(spans)
        return bool(spans)

    intent = {"offers": [], "tags": [], "stages": [], "cats": [], "place": None, "gap": None, "region": None,
              "out_of_state": None, "open_only": False, "contact": False, "person": False, "orgs": [], "terms": []}
    m = re.search(_WORD.format(f"(?:{OUT_OF_STATE})"), t)
    if m:
        intent["out_of_state"] = m.group(0)
    intent["contact"] = grab(CONTACT)
    intent["person"] = grab(PERSON)
    for alias, eid in _alias_cache():
        if eid not in intent["orgs"] and grab(re.escape(alias)):
            intent["orgs"].append(eid)
    if grab(r"west of worcester|western mass(?:achusetts)?|western ma"):
        intent["region"] = "west"
    elif grab(r"outside (?:of )?(?:greater )?boston|beyond boston|outside the boston area"):
        intent["region"] = "outside"
    for name in sorted(GAP_PLACES, key=len, reverse=True):
        if grab(re.escape(name)):
            intent["gap"] = name
            break
    if not intent["gap"]:
        for name in sorted(PLACES, key=len, reverse=True):
            if grab(re.escape(name)):
                intent["place"] = name
                break
    intent["open_only"] = grab(OPEN_NOW)
    # Categories, stages and "seed" may share words with offers and tags ("investors" is both a
    # category and funding), so they are matched without claiming text, and their words are only
    # set aside afterwards so they don't come back as free-text terms.
    shared = []
    for cat, pat in CATS.items():
        spans = _find(pat, t)
        if spans:
            intent["cats"].append(cat)
            shared += spans
    for tag, pat in TAGS.items():
        if grab(pat):
            intent["tags"].append(tag)
    seed = _find(r"seed", t)
    if seed and "pre-seed" not in intent["tags"]:
        intent["tags"].append("seed")
        shared += seed
    for n, pat in STAGES.items():
        spans = _find(pat, t)
        if spans:
            intent["stages"].append(n)
            shared += spans
    for offer, pat in OFFERS.items():
        if grab(pat):
            intent["offers"].append(offer)
    taken += shared
    leftover = re.sub(r"[^a-z0-9 -]", " ", "".join(" " if any(a <= i < b for a, b in taken) else ch
                                                     for i, ch in enumerate(t)))
    intent["terms"] = [w for w in dict.fromkeys(leftover.split()) if len(w) >= 4 and w not in STOP][:5]
    return intent


def _slots(intent):
    return bool(intent["offers"] or intent["tags"] or intent["stages"] or intent["cats"] or intent["place"]
                or intent["gap"] or intent["region"] or intent["open_only"])


def _apply_open(d):
    ab = d.get("applyBy")
    return ab == "rolling" or (bool(ab) and ab >= date.today().isoformat())


def _in_place(d, place):
    loc = d.get("loc", "").lower()
    return any(s.lower() in loc for s in PLACES[place])


def _mentions(d, term):
    text = " ".join([d["name"], d.get("desc", ""), d.get("why", ""), " ".join(d.get("tags") or [])]).lower()
    return re.search(r"(?<![a-z0-9])" + re.escape(term), text) is not None


def _join(words):
    words = list(words)
    return words[0] if len(words) == 1 else ", ".join(words[:-1]) + " and " + words[-1]


def _first_sentence(text, limit=180):
    text = (text or "").strip()
    s = re.split(r"(?<=[.!?])\s", text, maxsplit=1)[0]
    return s if len(s) <= limit else s[:limit].rsplit(" ", 1)[0] + "…"


def rank(intent):
    """Ranked entries with their matched fields, plus notes on what the Atlas doesn't cover."""
    data = atlas()["data"]
    notes = []
    cands = list(data)
    hard = []
    if intent["cats"]:
        hard.append(("cats", lambda d: d["cat"] in intent["cats"]))
    if intent["place"]:
        hard.append(("place", lambda d: _in_place(d, intent["place"])))
    if intent["region"] == "west":
        hard.append(("region", lambda d: d["lng"] < -71.9))
    elif intent["region"] == "outside":
        hard.append(("region", lambda d: _haversine(BOSTON, (d["lat"], d["lng"])) > 25))
    if intent["open_only"]:
        hard.append(("open", _apply_open))
    filtered = [d for d in cands if all(f(d) for _, f in hard)]
    dropped = []
    while not filtered and hard:
        dropped.append(hard.pop(0)[0] if hard[0][0] != "cats" or len(hard) == 1 else hard.pop(0)[0])
        filtered = [d for d in cands if all(f(d) for _, f in hard)]
    cands = filtered
    if "place" in dropped:
        notes.append(f"No entries in {intent['place'].title()} match all of that, so these are from across the state.")
    if "cats" in dropped:
        notes.append("No entry of that kind matches, so these include other kinds of organization.")
    if "open" in dropped:
        notes.append("None of these list an open application right now.")
    if intent["gap"]:
        notes.append(f"No entries in {intent['gap'].title()} are listed in the Atlas. The closest are below, "
                     f"nearest first (distances from the city centre, approximate).")

    scored = []
    offers_band = 0
    if intent["offers"]:
        offers_band = max((sum(o in (d.get("offers") or []) for o in intent["offers"]) for d in cands), default=0)
        missing = [o for o in intent["offers"] if not any(o in (d.get("offers") or []) for d in cands)]
        if missing:
            notes.append(f"No entry here offers {_join(OFFER_LABEL[o] for o in missing)}.")
    for d in cands:
        om = [o for o in intent["offers"] if o in (d.get("offers") or [])]
        if intent["offers"] and offers_band and len(om) < offers_band:
            continue
        tm = [x for x in intent["tags"] if x in (d.get("tags") or [])]
        sm = [s for s in intent["stages"] if s in (d.get("stages") or [])]
        xm = [w for w in intent["terms"] if _mentions(d, w)]
        score = 4 * len(om) + 3 * len(tm) + 2 * len(sm) + len(xm)
        soft = intent["offers"] or intent["tags"] or intent["stages"] or intent["terms"]
        if soft and score == 0:
            continue
        km = _haversine(GAP_PLACES[intent["gap"]], (d["lat"], d["lng"])) if intent["gap"] else 0
        scored.append({"d": d, "score": score, "om": om, "tm": tm, "sm": sm, "xm": xm, "km": km})
    want_tags = [x for x in intent["tags"] if not any(x in (s["d"].get("tags") or []) for s in scored)]
    if want_tags and scored:
        notes.append(f"Nothing here is tagged {_join(want_tags)}, so these match the rest of your question.")
    scored.sort(key=lambda s: (-s["score"], s["km"], -len(s["om"] + s["tm"] + s["sm"]),
                               -int((s["d"].get("lastVerified") or "0").replace("-", "")),
                               bool(s["d"].get("approx")), s["d"]["name"].lower()))
    return scored, notes


def _why(s, intent):
    d = s["d"]
    parts = []
    if s["om"]:
        parts.append("offers " + _join(OFFER_LABEL[o] for o in s["om"]))
    if s["tm"]:
        parts.append("tagged " + _join(s["tm"]))
    if s["sm"]:
        parts.append("serves the " + _join(STAGE_NAME[n] for n in s["sm"]) + " stage")
    if intent["place"] or intent["gap"] or intent["region"]:
        parts.append("located in " + d["loc"])
    if s["xm"]:
        parts.append("mentions " + _join(f'"{w}"' for w in s["xm"]))
    lead = (parts[0][0].upper() + "; ".join(parts)[1:] + ".") if parts else ""
    return (lead + " " + _first_sentence(d.get("why") or d.get("desc"))).strip()


def _result(d, why, mode, link_rows, approved_from):
    return {"id": d["id"], "name": d["name"], "why": why, "atlas_url": ATLAS_URL.format(d["id"]),
            "connections": connections(d, mode, link_rows), "doubts": doubts(d, mode, approved_from)}


def answer(query, mode="after"):
    """Contract 2. Never raises: on any error it returns no results and a plain note."""
    mode = mode if mode in ("before", "after") else "after"
    try:
        return _answer(query or "", mode)
    except Exception:
        return {"query": query, "mode": mode, "results": [], "not_found": FAILED}


def _answer(query, mode):
    by_id = atlas()["by_id"]
    link_rows = [r for r in links() if r["status"] != "rejected"]
    approved_from = {r["from_id"] for r in link_rows if r["status"] == "approved"}
    intent = parse(query)
    notes, rows = [], []

    if intent["out_of_state"]:
        return {"query": query, "mode": mode, "results": [],
                "not_found": f"The Atlas covers Massachusetts only, so it has nothing in {intent['out_of_state'].title()}. "
                             "Try a Massachusetts city, or leave the place out."}
    if intent["contact"] or intent["person"]:
        notes.append("The Atlas lists organizations, not people, so it holds no names or contact details. "
                     "Each organization's page links to its own website.")

    if intent["orgs"] and not (intent["offers"] or intent["tags"] or intent["stages"] or intent["cats"]):
        for eid in intent["orgs"][:MAX_RESULTS]:
            d = by_id[eid]
            rows.append(_result(d, _first_sentence(d.get("desc")) + (" " + _first_sentence(d.get("why")) if d.get("why") else ""),
                                mode, link_rows, approved_from))
    elif _slots(intent) or intent["terms"]:
        scored, rank_notes = rank(intent)
        notes += rank_notes
        for s in scored[:MAX_RESULTS]:
            rows.append(_result(s["d"], _why(s, intent), mode, link_rows, approved_from))
        if not rows:
            said = [f'"{w}"' for w in intent["terms"]]
            notes.append((f"Nothing in the Atlas mentions {', '.join(said[:-1]) + ' or ' + said[-1] if len(said) > 1 else said[0]}. "
                          if intent["terms"] else "Nothing in the Atlas matches that. ")
                         + "Try a need such as funding, space, mentors, talent, compute or customers, a sector, or a city.")
    elif not notes:
        notes.append("I couldn't match that to anything the Atlas records. Try a need such as funding, space, "
                     "mentors, talent, compute or customers, a sector, or a city.")

    rows = [r for r in rows if r["id"] in by_id]  # the no-invented-orgs check
    not_found = " ".join(dict.fromkeys(notes)) or None
    if not rows and not not_found:
        not_found = "Nothing in the Atlas matches that."
    return {"query": query, "mode": mode, "results": rows, "not_found": not_found}


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a not in ("--before", "--after")]
    print(json.dumps(answer(" ".join(args), "before" if "--before" in sys.argv else "after"), indent=1, ensure_ascii=False))
