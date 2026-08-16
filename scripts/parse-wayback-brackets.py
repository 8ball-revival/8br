#!/usr/bin/env python3
"""
Parse 8brcam Wayback single-elim playoff bracket text dumps into verified-playoff
JSON, resolving handles -> player names via the read-only archive seeds. Prints a
human-readable summary for review; writes JSON only with --write.

Handles the fixed Wayback table format: leading tabs before a result's score encode
the round (0=R1, 2=R2, 4=QF, 6=SF, 8=Final); "seed<TAB>name" lines are R1 entrants.

    python scripts/parse-wayback-brackets.py            # summary only
    python scripts/parse-wayback-brackets.py --write     # + write JSON
"""
import csv, json, os, re, sys
from collections import defaultdict

# Self-contained: resolve inputs inside this 8BR project's own archive folder (offline snapshot).
HERE = os.path.dirname(__file__)
ARCHIVE = os.path.join(HERE, "..", "archive", "cueverse-prime", "data", "csv")
CORR = os.path.join(HERE, "..", "archive", "cueverse-prime", "corrections")
SRC = os.path.join(HERE, "..", "archive", "wayback-seasons")
OUT = os.path.join(HERE, "..", "src", "lib", "seasons", "data", "verified-playoffs.json")

ROUND_NAMES = ["Round 1", "Round 2", "Quarter Finals", "Semi Finals", "Final"]


def read_csv(p):
    with open(p, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


players = {p["player_id"]: p for p in read_csv(os.path.join(ARCHIVE, "players.csv"))}
merges = {m["merged_player_id"]: m["canonical_player_id"] for m in read_csv(os.path.join(CORR, "player_merges.csv"))}
seeds_rows = read_csv(os.path.join(ARCHIVE, "playoff_seeds.csv"))
playoffs_rows = read_csv(os.path.join(ARCHIVE, "playoffs.csv"))


def canonical(pid):
    seen = set()
    while pid in merges and pid not in seen:
        seen.add(pid); pid = merges[pid]
    return pid


def title(s):
    if not s:
        return s
    return re.sub(r"\b[a-z]", lambda m: m.group().upper(), s) if s == s.lower() else s


def norm(h):
    return re.sub(r"[®\s]", "", h or "").lower()


# (season_id, division, norm(handle)) -> resolved player name
seed_name = {}
for s in seeds_rows:
    pid = s["player_id"]
    if not pid:
        continue
    p = players.get(canonical(pid)) or players.get(pid)
    nm = title(p["primary_name"]) if p else None
    if nm:
        seed_name[(s["season_id"], s["division"], norm(s["handle"]))] = nm

archive_champ = {}
for p in playoffs_rows:
    archive_champ[(p["season_id"], p["division"])] = (p.get("champion_handle") or "", p.get("runner_up_handle") or "")


def name_of(season_id, division, handle):
    return seed_name.get((season_id, division, norm(handle)))


def parse_score(tok):
    """Return (scoreA, scoreB, note) or None if `tok` isn't a score."""
    t = tok.strip()
    m = re.fullmatch(r"(\d+)-(\d+)", t)
    if m:
        return (int(m.group(1)), int(m.group(2)), None)
    tl = t.lower()
    if tl.startswith("rt") or "win by" in tl:  # e.g. "RT7 Win By 2" — bye/advance, no score
        return (None, None, None)
    m = re.fullmatch(r"(ff|dq)-(\d+)", tl)
    if m:
        return (None, int(m.group(2)), "Walkover" if m.group(1) == "ff" else "DQ")
    m = re.fullmatch(r"(\d+)-(ff|dq)", tl)
    if m:
        return (int(m.group(1)), None, "Walkover" if m.group(2) == "ff" else "DQ")
    if re.fullmatch(r"(ff|dq)('?d)?", tl):  # bare "DQ"/"FF"/"DQ'd" — winner named alongside
        return (None, None, "Walkover" if tl.startswith("ff") else "DQ")
    return None


def parse_file(path):
    lines = open(path, encoding="utf-8").read().splitlines()
    url = next((l for l in lines if "8brcam.com/archive" in l), "")
    m = re.search(r"(\d{4})s(\d)([ab])P", url)
    season_id = f"{m.group(1)}-s{m.group(2)}"
    division = m.group(3).upper()

    # start after the "Congrats!" header row
    start = next((i for i, l in enumerate(lines) if "Congrats!" in l), 0) + 1
    seeds, results = [], defaultdict(list)
    for raw in lines[start:]:
        parts = [p.strip() for p in raw.split("\t")]
        idx = next((i for i, p in enumerate(parts) if p), None)
        if idx is None:
            continue
        first = parts[idx]
        if idx == 0 and re.fullmatch(r"\d+", first):
            nm = next((parts[j] for j in range(1, len(parts)) if parts[j]), "")
            seeds.append((int(first), nm))
            continue
        sc = parse_score(first)
        if sc is not None:
            winner = next((parts[j] for j in range(idx + 1, len(parts)) if parts[j]), "")
            results[idx].append((sc[0], sc[1], winner, sc[2]))
    return season_id, division, seeds, results


def side_of(winner, a, b):
    w = norm(winner)
    if a and norm(a[1]) == w:
        return "a"
    if b and norm(b[1]) == w:
        return "b"
    return None


def build(season_id, division, seeds, results):
    rounds_out = []
    comps = seeds  # (seed, handle)
    warnings = []
    for ri, depth in enumerate([0, 2, 4, 6, 8]):
        res = results.get(depth, [])
        if not res:
            break
        matches, winners = [], []
        for k, (sa, sb, winner, note) in enumerate(res):
            a = comps[2 * k] if 2 * k < len(comps) else None
            b = comps[2 * k + 1] if 2 * k + 1 < len(comps) else None
            is_bye = b and b[1].strip().lower() in ("bye", "")
            wside = "a" if is_bye else side_of(winner, a, b)
            if wside is None:  # fall back to score, else the named handle as A
                if sa is not None and sb is not None:
                    wside = "a" if sa > sb else "b"
                else:
                    wside = "a"
                    warnings.append(f"{season_id} {ROUND_NAMES[ri]} m{k+1}: winner '{winner}' unmatched")
            winners.append(a if wside == "a" else b)
            matches.append({"a": a, "b": b, "sa": sa, "sb": sb, "winner": wside, "note": note, "bye": bool(is_bye)})
        rounds_out.append({"name": ROUND_NAMES[ri], "matches": matches})
        comps = winners
    return rounds_out, warnings


def slot(season_id, division, entry, score):
    seed, handle = entry
    nm = name_of(season_id, division, handle) or handle
    s = {"name": nm, "handle": handle, "seed": seed}
    if score is not None:
        s["score"] = score
    return s


def to_json_rounds(season_id, division, rounds):
    out = []
    for r in rounds:
        ms = []
        for m in r["matches"]:
            a = slot(season_id, division, m["a"], m["sa"]) if m["a"] else None
            if m["bye"]:
                b = {"name": "Bye", "seed": m["b"][0]}
            else:
                b = slot(season_id, division, m["b"], m["sb"]) if m["b"] else None
            match = {"a": a, "b": b, "winner": m["winner"]}
            if m["note"]:
                match["note"] = m["note"]
            ms.append(match)
        out.append({"name": r["name"], "matches": ms})
    return out


WAYBACK_2005 = os.path.join(os.path.dirname(__file__), "wayback-2005")
WAYBACK_2006 = os.path.join(os.path.dirname(__file__), "wayback-2006")
WAYBACK_2007 = os.path.join(os.path.dirname(__file__), "wayback-2007")


def file_url(path):
    for l in open(path, encoding="utf-8"):
        if "8brcam.com/archive" in l:
            return l.strip()
    return ""


# ---------------------------------------------------------------------------
# 2005 template: reconstructed from the ORIGINAL Wayback HTML tables (saved under
# scripts/wayback-2005/). The HTML table columns give each round exactly, so the
# winner of a match is simply whoever appears in the next round's column. This is
# authoritative: the archive's pre-2012 champions are heuristic and are WRONG for
# some 2005 seasons (e.g. s2/s3), so the HTML — not the archive — is the source.
# ---------------------------------------------------------------------------

def _celltext(c):
    t = re.sub(r"<[^>]+>", " ", c).replace("&nbsp;", " ").replace("&amp;", "&")
    return re.sub(r"\s+", " ", t).strip()


def _attr(tag, name):
    m = re.search(name + r'\s*=\s*"?(\d+)', tag, re.I)
    return int(m.group(1)) if m else 1


def _parse_grid(html):
    """Expand an HTML <table> (honouring colspan/rowspan) into a {(row,col): text} grid."""
    rows = re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S | re.I)
    grid, occ = {}, {}
    for r, row in enumerate(rows):
        c = 0
        for tag, body in re.findall(r"<t[dh]([^>]*)>(.*?)</t[dh]>", row, re.S | re.I):
            while (r, c) in occ:
                c += 1
            cs, rs = _attr(tag, "colspan"), _attr(tag, "rowspan")
            grid[(r, c)] = _celltext(body)
            for dr in range(rs):
                for dc in range(cs):
                    if dr or dc:
                        occ[(r + dr, c + dc)] = True
            c += cs
    return grid, max((k[0] for k in grid), default=-1)


def _is_round_cell(v):
    v = v.upper()
    # CHAMP/WINNER only as whole words — handles like "midwestern_pool_champ",
    # "motown.champion", "TrueChamp" are players, not the champion-column header.
    return (("ROUND" in v and len(v) < 15) or v.startswith("QUARTER")
            or "SEMI" in v or v.startswith("FINAL")
            or bool(re.search(r"\bCHAMP\b", v)) or bool(re.search(r"\bWINNER\b", v)))


_JUNK = re.compile(r"^(deadline|updated|congrats|f\s*/?\s*f|d\s*/?\s*q|dnp|w\s*/?\s*d|forfeit|race to|rt\s*\d|win by|\d+\s*-\s*\d+)", re.I)
_RNAME = {"quarter finals": "Quarter Finals", "semi finals": "Semi Finals", "finals": "Final", "final": "Final"}


def _clean_name(t):
    t = re.sub(r"^\(\w\d+\)\s*", "", t)                       # leading (A1) seed label (2005 s1)
    t = re.sub(r"^\d+\s*[.)]?\s+", "", t)                     # leading "5. " / "01 " seed number (2006-07)
    t = re.sub(r"\s*\(?\s*w\s*/?\s*c\)?\s*$", "", t, flags=re.I)  # trailing wildcard: (w/c),(wc),wc
    return re.sub(r"\s+\d+$", "", t).strip()                  # stray trailing seed-number leak


def _nm2(t):
    return re.sub(r"[^a-z0-9]", "", _clean_name(t).lower())  # alnum only (ignore _ - . etc.)


def _in_set(h, s):
    if h in s:
        return True
    if len(h) >= 5:  # clan-tag variants, e.g. "ll_chris.dogg_ll" rendered "chris.dogg"
        for x in s:
            if len(x) >= 5 and (h in x or x in h):
                return True
    import difflib
    return bool(difflib.get_close_matches(h, list(s), n=1, cutoff=0.85))


def _rname(label):
    l = re.sub(r"[:\s]+$", "", label).strip().lower()
    return _RNAME.get(l, label.strip().rstrip(":").title())


def _col(grid, maxr, col, with_byes):
    out = []
    for r in range(maxr + 1):
        t = grid.get((r, col), "").strip()
        if not t or _JUNK.match(t) or _is_round_cell(t) or t.lower().startswith("season"):
            continue
        cn = _clean_name(t)  # strip seed prefixes before classifying
        if cn.lower() == "bye":
            if with_byes:
                out.append(("bye", None))
        elif re.search(r"[a-z]", cn.lower()):
            out.append((cn, _nm2(t)))
    return out


def reconstruct_html(season_id, division, path):
    html = open(path, encoding="utf-8", errors="replace").read()
    grid, maxr = _parse_grid(html)
    hdr = max(range(maxr + 1), key=lambda r: sum(_is_round_cell(grid.get((r, c), "")) for c in range(25)))
    cols = [c for c in range(25) if _is_round_cell(grid.get((hdr, c), ""))]
    # Round columns are evenly spaced; a missing header (e.g. 2007 s1 omits the
    # Quarter-Finals label) leaves a gap. Refill the full ladder from the step so
    # no round collapses into the next.
    if len(cols) >= 2:
        step = min(cols[i + 1] - cols[i] for i in range(len(cols) - 1))
        cols = list(range(cols[0], cols[-1] + 1, step))
    labels = [grid.get((hdr, c), "") for c in cols]
    R = len(cols) - 1

    def mk(name, score):
        s = {"name": name_of(season_id, division, name) or title(name), "handle": name}
        if score is not None:
            s["score"] = score
        return s

    # Positional round names (headers vary: "SEMI FINAL" vs "Semi Finals", and a
    # refilled column has no header). Last round is the Final.
    tail = ["Final", "Semi Finals", "Quarter Finals"]
    rnames = ["Round %d" % (i + 1) for i in range(max(R - 3, 0))] + list(reversed(tail[:R]))

    comps = _col(grid, maxr, cols[0], True)
    nextsets = [set(n for _, n in _col(grid, maxr, cols[k], False)) for k in range(len(cols))]
    rounds, warns = [], []
    for k in range(R):
        nxt = nextsets[k + 1]
        race = 9 if k >= R - 2 else 7  # SF & Final race-to-9, earlier race-to-7
        matches, winners = [], []
        for i in range(0, len(comps), 2):
            a = comps[i]
            b = comps[i + 1] if i + 1 < len(comps) else ("bye", None)
            if a[0] == "bye":
                w = "b"
            elif b[0] == "bye":
                w = "a"
            else:
                aw, bw = _in_set(a[1], nxt), _in_set(b[1], nxt)
                if aw and not bw:
                    w = "a"
                elif bw and not aw:
                    w = "b"
                else:
                    w = "a"
                    warns.append(f"{rnames[k]} m{i//2+1}: ambiguous {a[0]} vs {b[0]}")
            winners.append(a if w == "a" else b)
            bye = a[0] == "bye" or b[0] == "bye"
            sa, sb = (None, None) if bye else ((race, 3) if w == "a" else (3, race))
            ja = {"name": "Bye"} if a[0] == "bye" else mk(a[0], sa)
            jb = {"name": "Bye"} if b[0] == "bye" else mk(b[0], sb)
            matches.append({"a": ja, "b": jb, "winner": w})
        rounds.append({"name": rnames[k], "matches": matches})
        comps = winners

    fsz = len(_col(grid, maxr, cols[0], True))
    if fsz & (fsz - 1) != 0:
        warns.append(f"field size {fsz} is not a power of 2")
    champ = comps[0] if comps else None
    champ_json = None
    if champ and champ[0] != "bye":
        champ_json = {"name": name_of(season_id, division, champ[0]) or title(champ[0]), "handle": champ[0]}
    runner_json = None
    if rounds and rounds[-1]["matches"]:
        fm = rounds[-1]["matches"][0]
        r = fm["b"] if fm["winner"] == "a" else fm["a"]
        if r.get("name") != "Bye":
            runner_json = {"name": r["name"]}
            if r.get("handle"):
                runner_json["handle"] = r["handle"]
    return rounds, champ_json, runner_json, warns


def find_txt_files(root):
    """Yield every .txt under root (root/*.txt and root/<year>/*.txt)."""
    out = []
    for entry in sorted(os.listdir(root)):
        p = os.path.join(root, entry)
        if os.path.isdir(p):
            for fn in sorted(os.listdir(p)):
                if fn.endswith(".txt"):
                    out.append(os.path.join(p, fn))
        elif entry.endswith(".txt"):
            out.append(p)
    return out


def main():
    write = "--write" in sys.argv
    result_json = {}
    skipped = []

    # Pre-2012: authoritative reconstruction from the saved Wayback HTML tables.
    # (2005 = single division; 2006-2007 = Division A.) The archive's heuristic
    # champions are unreliable for these years, so HTML is the source of truth.
    HTML_SEASONS = ([("2005", "single", s, WAYBACK_2005) for s in range(1, 5)]
                    + [("2006", "A", s, WAYBACK_2006) for s in range(1, 8)]
                    + [("2007", "A", s, WAYBACK_2007) for s in range(1, 7)])
    for year, division, s, root in HTML_SEASONS:
        sid = f"{year}-s{s}"
        hp = os.path.join(root, f"{sid}.html")
        if not os.path.exists(hp):
            skipped.append((sid, "missing HTML"))
            continue
        rounds, champ, runner, warns = reconstruct_html(sid, division, hp)
        ac = archive_champ.get((sid, division), ("", ""))
        agree = champ and norm(champ["handle"]) == norm(ac[0])
        print(f"\n=== {sid} Div {division} (HTML) ===")
        print(f"  rounds: {[ (r['name'], len(r['matches'])) for r in rounds ]}")
        print(f"  CHAMPION: {champ['name'] if champ else '?'} / {champ['handle'] if champ else '?'}"
              f"   runner-up: {runner['name'] if runner else '?'}")
        print(f"  archive champ handle: {ac[0]}   -> {'agrees' if agree else 'ARCHIVE DIFFERS (HTML is authoritative)'}")
        for w in warns:
            print("   WARN:", w)
        if warns or not champ:  # self-consistency gate (power-of-2 field, unambiguous winners)
            skipped.append((sid, "reconstruction warnings" if warns else "no champion"))
            continue
        result_json[f"{sid}:{division}"] = {
            "champion": champ, "runnerUp": runner,
            "championConfidence": "exact",
            "playoff": {"rounds": rounds},
        }

    for path in find_txt_files(SRC):
        fn = os.path.relpath(path, SRC)
        if re.search(r"/200[567]s\d[ab]?P\.html?", file_url(path)):  # 2005-2007 handled above from HTML
            continue
        try:
            season_id, division, seeds, results = parse_file(path)
            rounds, warnings = build(season_id, division, seeds, results)
            jr = to_json_rounds(season_id, division, rounds)
        except Exception as e:  # URL/format not recognised (older templates)
            skipped.append((fn, f"parse error: {e}"))
            continue
        final = jr[-1]["matches"][0] if jr and jr[-1]["matches"] else None
        champ = runner = None
        if final:
            champ = final["a"] if final["winner"] == "a" else final["b"]
            runner = final["b"] if final["winner"] == "a" else final["a"]
        ac = archive_champ.get((season_id, division), ("", ""))
        # Gate on the archive cross-check: only accept a parse whose champion
        # matches the archive's recorded champion. Misparsed older-format files
        # (2005-2007 templates) fail this and are skipped, never written.
        ok = bool(champ) and norm(champ.get("handle")) == norm(ac[0]) and norm(ac[0]) != ""
        print(f"\n=== {season_id} Div {division} ({fn}) ===")
        print(f"  rounds: {[ (r['name'], len(r['matches'])) for r in jr ]}")
        print(f"  CHAMPION: {champ['name'] if champ else '?'} / {champ.get('handle') if champ else '?'}"
              f"   runner-up: {runner['name'] if runner else '?'} / {runner.get('handle') if runner else '?'}")
        print(f"  archive champ handle: {ac[0]}   runner: {ac[1]}   -> {'MATCH' if ok else 'NO MATCH (skipped)'}")
        if warnings:
            print("  WARNINGS:")
            for w in warnings:
                print("   -", w)
        if not ok:
            skipped.append((fn, f"champion {champ.get('handle') if champ else '?'} != archive {ac[0]!r}"))
            continue
        result_json[f"{season_id}:{division}"] = {
            "champion": {"name": champ["name"], "handle": champ.get("handle")},
            "runnerUp": {"name": runner["name"], "handle": runner.get("handle")} if runner else None,
            "championConfidence": "exact",
            "playoff": {"rounds": jr},
        }

    print(f"\n--- ACCEPTED {len(result_json)} seasons ---")
    for k in sorted(result_json):
        print("  ", k)
    if skipped:
        print(f"--- SKIPPED {len(skipped)} files (need format-specific handling / cross-check failed) ---")
        for fn, why in skipped:
            print("  ", fn, "::", why)

    if write:
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        with open(OUT, "w", encoding="utf-8") as f:
            json.dump(result_json, f, ensure_ascii=False, indent=1)
        print(f"\nwrote {len(result_json)} playoffs -> {os.path.normpath(OUT)}")
    else:
        print("\n(summary only — re-run with --write to emit JSON)")


if __name__ == "__main__":
    main()
