#!/usr/bin/env python3
"""
Generate src/lib/seasons/data/archive-seasons.json from the READ-ONLY CueVerse
archive CSVs. This is the single-source-of-truth transform: seasons -> divisions
-> groups (standings) + playoffs (bracket), with player ids resolved to a display
name via players.csv and the identity-merge corrections. Never writes to the
archive. Re-run whenever the archive is corrected.

    python scripts/build-archive-seasons.py
"""
import csv, json, os, re
from collections import defaultdict

# Self-contained: resolve inputs inside this 8BR project's own archive folder (offline snapshot).
HERE = os.path.dirname(__file__)
ARCHIVE = os.path.join(HERE, "..", "archive", "cueverse-prime", "data", "csv")
CORR = os.path.join(HERE, "..", "archive", "cueverse-prime", "corrections")
OUT = os.path.join(HERE, "..", "src", "lib", "seasons", "data", "archive-seasons.json")


def read_csv(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def int_or(v, default=0):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return default


def num_or(v, default=0):
    try:
        f = float(v)
        return int(f) if f == int(f) else round(f, 1)
    except (TypeError, ValueError):
        return default


def title(s):
    # Title-case all-lowercase names ("luis" -> "Luis") but leave names that
    # already carry their own casing (MJ, McTavish) untouched.
    if not s:
        return s
    if s == s.lower():
        return re.sub(r"\b[a-z]", lambda m: m.group().upper(), s)
    return s


players = {p["player_id"]: p for p in read_csv(os.path.join(ARCHIVE, "players.csv"))}

merges = {}  # merged_player_id -> canonical_player_id
for m in read_csv(os.path.join(CORR, "player_merges.csv")):
    merges[m["merged_player_id"]] = m["canonical_player_id"]


def canonical(pid):
    seen = set()
    while pid in merges and pid not in seen:
        seen.add(pid)
        pid = merges[pid]
    return pid


def name_for(pid, fallback_handle=None):
    if not pid:
        return title(fallback_handle) if fallback_handle else None
    cid = canonical(pid)
    p = players.get(cid) or players.get(pid)
    nm = (p["primary_name"] if p else None) or fallback_handle or pid
    return title(nm)


seasons = read_csv(os.path.join(ARCHIVE, "seasons.csv"))
divisions = read_csv(os.path.join(ARCHIVE, "season_divisions.csv"))
standings = read_csv(os.path.join(ARCHIVE, "group_standings.csv"))
playoffs = read_csv(os.path.join(ARCHIVE, "playoffs.csv"))
pmatches = read_csv(os.path.join(ARCHIVE, "playoff_matches.csv"))
seeds = read_csv(os.path.join(ARCHIVE, "playoff_seeds.csv"))

div_by_season = defaultdict(list)
for d in divisions:
    div_by_season[d["season_id"]].append(d)

standings_by_div = defaultdict(list)
for s in standings:
    standings_by_div[(s["season_id"], s["division"])].append(s)

playoff_by_div = {}
for p in playoffs:
    playoff_by_div[(p["season_id"], p["division"])] = p

pmatch_by_div = defaultdict(list)
for m in pmatches:
    pmatch_by_div[(m["season_id"], m["division"])].append(m)

seed_by_div = defaultdict(dict)
for s in seeds:
    seed_by_div[(s["season_id"], s["division"])][s["player_id"]] = s["seed"]

# Per-season handle each player actually used (the "ID"). Playoff seeds carry the
# exact season handle; group-only players fall back to the player's primary handle.
aliases_by_player = defaultdict(list)
for a in read_csv(os.path.join(ARCHIVE, "player_aliases.csv")):
    aliases_by_player[a["player_id"]].append(a)

seed_handle = {}  # (season_id, division, player_id) -> handle
for s in seeds:
    seed_handle[(s["season_id"], s["division"], s["player_id"])] = s["handle"]


def primary_handle(pid):
    p = players.get(pid) or players.get(canonical(pid))
    if p and p.get("primary_ym"):
        return p["primary_ym"]
    for a in aliases_by_player.get(pid, []):
        if "handle" in (a.get("alias_type") or ""):
            return a["alias"]
    return None


def handle_for(season_id, division, pid):
    if not pid:
        return None
    return seed_handle.get((season_id, division, pid)) or primary_handle(pid) or None


# Individual group-stage match results (for the group deep-dive: H2H, completed/
# remaining matches, group stats). Keyed by the group's id.
gmatches_by_gid = defaultdict(list)
for m in read_csv(os.path.join(ARCHIVE, "group_matches.csv")):
    gmatches_by_gid[m["group_id"]].append(m)


def build_groups(season_id, division):
    rows = standings_by_div.get((season_id, division), [])
    by_letter = defaultdict(list)
    gid_by_letter = {}
    for r in rows:
        by_letter[r["group_letter"]].append(r)
        gid_by_letter[r["group_letter"]] = r["group_id"]
    out = []
    for letter in sorted(by_letter):
        grp = by_letter[letter]
        grp.sort(key=lambda r: (-num_or(r["total"]), -num_or(r["wins"]), num_or(r["losses"])))

        matches = []
        for m in gmatches_by_gid.get(gid_by_letter.get(letter, ""), []):
            a_id, b_id = m["player_a_id"], m["player_b_id"]
            if not a_id or not b_id:
                continue
            winner = None
            if m["winner_id"]:
                winner = "a" if m["winner_id"] == a_id else ("b" if m["winner_id"] == b_id else None)
            matches.append({
                "a": {"name": name_for(a_id) or a_id, "handle": handle_for(season_id, division, a_id)},
                "b": {"name": name_for(b_id) or b_id, "handle": handle_for(season_id, division, b_id)},
                "scoreA": int_or(m["score_a"], None),
                "scoreB": int_or(m["score_b"], None),
                "winner": winner,
            })

        out.append({
            "letter": letter,
            "rows": [{
                "name": name_for(r["player_id"]) or r["player_id"],
                "handle": handle_for(season_id, division, r["player_id"]),
                "advanced": r["player_id"] in seed_by_div.get((season_id, division), {}),
                "played": int_or(r["played"]),
                "wins": int_or(r["wins"]),
                "losses": int_or(r["losses"]),
                "draws": int_or(r["draws"]),
                "points": num_or(r["total"]),
            } for r in grp],
            "matches": matches,
        })
    return out


def build_playoff(season_id, division):
    matches = pmatch_by_div.get((season_id, division), [])
    if not matches:
        return None
    seedmap = seed_by_div.get((season_id, division), {})
    by_round = defaultdict(list)
    for m in matches:
        by_round[int_or(m["round"], 0)].append(m)

    def slot(pid, score):
        if not pid:
            return None
        s = {"name": name_for(pid) or pid}
        h = handle_for(season_id, division, pid)
        if h:
            s["handle"] = h
        seed = seedmap.get(pid)
        if seed:
            s["seed"] = int_or(seed, None)
        if score is not None:
            s["score"] = score
        return s

    rounds = []
    for rnum in sorted(by_round):
        ms = sorted(by_round[rnum], key=lambda m: int_or(m["match_no"], 0))
        rname = ms[0]["round_name"] or f"Round {rnum}"
        out_matches = []
        for m in ms:
            a_id, b_id = m["player_a_id"], m["player_b_id"]
            sa = sb = None
            score = m["score"]
            if score and "-" in score:
                parts = score.split("-")
                if len(parts) == 2:
                    sa, sb = int_or(parts[0], None), int_or(parts[1], None)
            winner = None
            if m["winner_id"]:
                winner = "a" if m["winner_id"] == a_id else ("b" if m["winner_id"] == b_id else None)
            a, b = slot(a_id, sa), slot(b_id, sb)
            if a is None and b is None:
                continue  # skip empty placeholder matches
            out_matches.append({"a": a, "b": b, "winner": winner})
        if out_matches:
            rounds.append({"name": rname, "matches": out_matches})
    return {"rounds": rounds} if rounds else None


result = []
for s in seasons:
    sid, year, period = s["season_id"], int_or(s["year"]), int_or(s["period"])
    divs = []
    for d in sorted(div_by_season[sid], key=lambda d: d["division"]):
        division = d["division"]
        if division == "B":
            continue  # Div B purged from the site data (kept in the read-only archive)
        po = playoff_by_div.get((sid, division))
        champ = runner = conf = None
        recon = False
        if po:
            if po["champion_id"] or po["champion_handle"]:
                champ = {"name": name_for(po["champion_id"], po["champion_handle"])}
                ch = po["champion_handle"] or handle_for(sid, division, po["champion_id"])
                if ch:
                    champ["handle"] = ch
            if po["runner_up_id"] or po["runner_up_handle"]:
                runner = {"name": name_for(po["runner_up_id"], po["runner_up_handle"])}
                rh = po["runner_up_handle"] or handle_for(sid, division, po["runner_up_id"])
                if rh:
                    runner["handle"] = rh
            conf = po["champion_confidence"] or None
            recon = po["bracket_reconstructed"] == "True"
        divs.append({
            "division": division,
            "champion": champ,
            "runnerUp": runner,
            "championConfidence": conf,
            "bracketReconstructed": recon,
            "groups": build_groups(sid, division),
            "playoff": build_playoff(sid, division),
        })
    result.append({
        "seasonId": sid,
        "year": year,
        "period": period,
        "label": f"{year} Season {period}",
        "divisions": divs,
    })

result.sort(key=lambda x: (-x["year"], -x["period"]))

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=False, indent=1)

print(f"wrote {len(result)} seasons -> {os.path.normpath(OUT)}")
years = defaultdict(int)
for r in result:
    years[r["year"]] += 1
for y in sorted(years, reverse=True):
    print(f"  {y}: {years[y]} season(s)")
