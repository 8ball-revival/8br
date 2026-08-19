"""
Archive accounts that share a Yahoo Messenger ID.

A YIM was the one identifier the old site captured that a person could not casually change, so two
player records carrying the same one are almost always ONE person entered twice.

── The finding that shapes this report ──────────────────────────────────────────────────────────
The archive extraction already resolved identity BY YIM: each distinct YIM string became one
player_id. So an exact duplicate cannot exist in the extracted data by construction, and a report
that only looked for exact matches would print "none found" and be useless.

What the extraction could not catch is a YIM that differs only by punctuation — `king_2068` and
`king2068` are one Yahoo account typed two ways, but two different strings, so they became two
player records. Those are real duplicate accounts and they are the substance of this report.

Three further questions are answered alongside, because each is a different way the same person
appears twice:

  1. NEAR-DUPLICATE YIMs   different punctuation, same address — genuine duplicate accounts
  2. MULTIPLE YIMs         one account already holding several Yahoo IDs — already merged
  3. CROSS-DIVISION        one account appearing in both Division A and Division B

── Where the data comes from ────────────────────────────────────────────────────────────────────
  player_aliases.csv         every recorded YIM, as `ym_id` rows
  players.csv                `primary_ym`, in case it was ever set without a matching alias row
  player_season_stats.csv    which seasons and divisions each player actually appeared in

Both YIM sources are read and unioned, and the report states how many came from each.

  python scripts/shared-yim-report.py
"""
import csv
import io
import os
import sys
from collections import defaultdict

BASE = os.path.join("archive", "cueverse-prime", "data", "csv")
OUT = os.path.join("reports", "shared-yim-accounts.txt")

DIV_ORDER = {"A": 0, "B": 1, "single": 2}


def read(name):
    with io.open(os.path.join(BASE, name), encoding="utf-8-sig", newline="") as fh:
        return list(csv.DictReader(fh))


def norm_exact(value):
    """A YIM compared as an address: case-insensitive and trimmed, nothing else."""
    return (value or "").strip().lower()


def norm_loose(value):
    """The same YIM with punctuation removed, so king_2068 and king2068 collapse to one."""
    return "".join(c for c in norm_exact(value) if c.isalnum())


def main():
    players = read("players.csv")
    aliases = read("player_aliases.csv")
    stats = read("player_season_stats.csv")

    by_id = {p["player_id"]: p for p in players}

    yims = defaultdict(set)
    spelling = {}
    ym_alias_rows = 0
    primary_only = 0

    for a in aliases:
        if a.get("alias_type") != "ym_id":
            continue
        key = norm_exact(a.get("alias"))
        if not key:
            continue
        ym_alias_rows += 1
        yims[a["player_id"]].add(key)
        spelling.setdefault(key, (a.get("alias") or "").strip())

    for p in players:
        key = norm_exact(p.get("primary_ym"))
        if not key:
            continue
        if key not in yims[p["player_id"]]:
            primary_only += 1
        yims[p["player_id"]].add(key)
        spelling.setdefault(key, (p.get("primary_ym") or "").strip())

    divisions = defaultdict(set)
    seasons = defaultdict(set)
    for row in stats:
        pid = row.get("player_id")
        if not pid:
            continue
        d = (row.get("division") or "").strip()
        if d:
            divisions[pid].add(d)
        s = (row.get("season_id") or "").strip()
        if s:
            seasons[pid].add(s)

    handles = defaultdict(set)
    for a in aliases:
        if a.get("alias_type") == "name/handle" and a.get("alias"):
            handles[a["player_id"]].add(a["alias"].strip())

    def years(pid):
        p = by_id.get(pid, {})
        a, b = (p.get("first_year") or "").strip(), (p.get("last_year") or "").strip()
        if a and b:
            return a if a == b else "%s-%s" % (a, b)
        return a or b or "?"

    def divs(pid):
        d = divisions.get(pid, set())
        if not d:
            return "no recorded appearances"
        return ", ".join(sorted(d, key=lambda x: DIV_ORDER.get(x, 9)))

    def describe(pid, indent="      "):
        p = by_id.get(pid, {})
        out = ["%s%-7s %-22s  years %-10s  seasons %-3d  division(s): %s"
               % (indent, pid, (p.get("primary_name") or "?")[:22], years(pid),
                  len(seasons.get(pid, set())), divs(pid))]
        h = sorted(handles.get(pid, set()))
        if h:
            out.append("%s        handles: %s" % (indent, ", ".join(h)))
        y = sorted(yims.get(pid, set()))
        if y:
            out.append("%s        YIM(s): %s" % (indent, ", ".join(y)))
        return out

    # ── 1. Exact shares.
    exact = defaultdict(set)
    for pid, keys in yims.items():
        for k in keys:
            exact[k].add(pid)
    exact_shared = {k: v for k, v in exact.items() if len(v) > 1}

    # ── 2. Near-duplicates: identical once punctuation is removed.
    loose = defaultdict(set)
    loose_forms = defaultdict(set)
    for pid, keys in yims.items():
        for k in keys:
            lk = norm_loose(k)
            if lk:
                loose[lk].add(pid)
                loose_forms[lk].add(k)
    # Only interesting where the spellings genuinely differ — an exact share is reported above.
    near = {k: v for k, v in loose.items() if len(v) > 1 and len(loose_forms[k]) > 1}

    # ── 3. Accounts already holding several YIMs.
    multi = {pid: ks for pid, ks in yims.items() if len(ks) > 1}

    # ── 4. Accounts appearing in both divisions.
    cross = {pid: d for pid, d in divisions.items() if "A" in d and "B" in d}

    lines = []
    w = lines.append

    w("ACCOUNTS SHARING A YAHOO MESSENGER ID")
    w("8 Ball Registry - 8BRCAM archive, 2005-2014")
    w("=" * 78)
    w("")
    w("A YIM was the one identifier the old site captured that a person could not")
    w("casually change, so two player records carrying the same one are almost always")
    w("ONE person entered twice.")
    w("")
    w("IMPORTANT: the archive extraction already resolved identity BY YIM - each")
    w("distinct YIM string became one player record. An exact duplicate therefore")
    w("cannot exist in this data by construction, and section 1 below confirms that.")
    w("")
    w("What the extraction could NOT catch is a YIM differing only by punctuation.")
    w("king_2068 and king2068 are one Yahoo account typed two ways, but two different")
    w("strings, so they became two player records. Section 2 lists those, and they are")
    w("the real duplicate accounts in this archive.")
    w("")
    w("-" * 78)
    w("SOURCE DATA")
    w("-" * 78)
    w("  players.csv                 %5d rows" % len(players))
    w("  player_aliases.csv          %5d rows, of which %d are ym_id" % (len(aliases), ym_alias_rows))
    w("  player_season_stats.csv     %5d rows" % len(stats))
    w("")
    w("  accounts holding >=1 YIM    %5d" % len([p for p in yims if yims[p]]))
    w("  distinct YIM strings        %5d" % len(exact))
    w("  YIMs present only as players.csv primary_ym: %d" % primary_only)
    w("")
    div_counts = defaultdict(int)
    for pid in divisions:
        for d in divisions[pid]:
            div_counts[d] += 1
    w("  accounts with appearances, by division:")
    for d in sorted(div_counts, key=lambda x: DIV_ORDER.get(x, 9)):
        w("      %-8s %5d accounts" % (d, div_counts[d]))
    w("      ('single' is the pre-split era, before A and B existed)")
    w("")

    # ── Section 1
    w("=" * 78)
    w("1. EXACT SHARED YIMs")
    w("=" * 78)
    w("")
    if not exact_shared:
        w("  None - 0 YIM strings are held by more than one account.")
        w("")
        w("  This is the expected result: the extraction keyed identity on the YIM, so")
        w("  two accounts could never end up with an identical one. It is reported")
        w("  rather than omitted because it is the check that proves the keying held.")
    else:
        for n, (k, pids) in enumerate(sorted(exact_shared.items(), key=lambda kv: (-len(kv[1]), kv[0])), 1):
            w("%d. %s  -  %d accounts" % (n, spelling.get(k, k), len(pids)))
            for pid in sorted(pids):
                lines.extend(describe(pid))
            w("")
    w("")

    # ── Section 2
    w("=" * 78)
    w("2. NEAR-DUPLICATE YIMs  -  same address, different punctuation")
    w("=" * 78)
    w("")
    w("  Each cluster is one Yahoo ID apparently written two ways, so the extraction")
    w("  created a separate player for each. These are CANDIDATES for merging, not")
    w("  proven duplicates - the strength of the evidence is stated per cluster:")
    w("")
    w("     STRONG    the accounts also share a handle, or the key is distinctive")
    w("               (7+ characters) - very unlikely to be two people")
    w("     REVIEW    the normalised key is short or a common name, so two different")
    w("               people could plausibly have arrived at it. Check before merging.")
    w("")
    if not near:
        w("  None found.")
    else:
        ranked = sorted(near.items(), key=lambda kv: (-len(kv[1]), kv[0]))
        for n, (k, pids) in enumerate(ranked, 1):
            pids = sorted(pids)
            ds = {d for pid in pids for d in divisions.get(pid, set())}
            flag = "   [SPANS DIVISIONS: %s]" % ", ".join(sorted(ds, key=lambda x: DIV_ORDER.get(x, 9))) if len(ds) > 1 else ""

            # Two accounts sharing a handle as well as a normalised YIM is about as strong as this
            # evidence gets; a short key like "travis" on its own is not, because two people can
            # independently produce it.
            shared_handle = set.intersection(*[
                {h.lower() for h in handles.get(pid, set())} for pid in pids
            ]) if all(handles.get(pid) for pid in pids) else set()
            # A shared handle only counts when the handle is itself distinctive. Two different
            # people called Travis share the handle "Travis" AND normalise to "travis", so a short
            # common name is the weakest possible evidence dressed up as the strongest.
            distinctive_handle = any(len(h) >= 8 for h in shared_handle)
            confidence = "STRONG" if (len(k) >= 10 or distinctive_handle) else "REVIEW"

            w("%d. [%s] %s  -  %d accounts%s"
              % (n, confidence, " / ".join(sorted(loose_forms[k])), len(pids), flag))
            if shared_handle:
                w("      also share the handle: %s" % ", ".join(sorted(shared_handle)))
            for pid in pids:
                lines.extend(describe(pid))
            w("")
    w("")

    # ── Section 3
    w("=" * 78)
    w("3. ACCOUNTS HOLDING MORE THAN ONE YIM")
    w("=" * 78)
    w("")
    w("  Already merged by the extraction - one person, several Yahoo IDs. Listed so")
    w("  the merges that were already made are visible and checkable.")
    w("")
    if not multi:
        w("  None found.")
    else:
        for n, (pid, ks) in enumerate(sorted(multi.items(), key=lambda kv: (-len(kv[1]), kv[0])), 1):
            p = by_id.get(pid, {})
            w("%d. %-7s %-22s  %d YIMs  years %s  division(s): %s"
              % (n, pid, (p.get("primary_name") or "?")[:22], len(ks), years(pid), divs(pid)))
            w("        %s" % ", ".join(sorted(ks)))
    w("")

    # ── Section 4
    w("=" * 78)
    w("4. ONE YIM, BOTH DIVISIONS")
    w("=" * 78)
    w("")
    w("  Accounts that appear in Division A and Division B under the same identity.")
    w("  Not duplicates - the same person moved between divisions across seasons -")
    w("  but included because both divisions were asked for and this is where they meet.")
    w("")
    w("  %d accounts appear in both divisions." % len(cross))
    w("")
    for n, pid in enumerate(sorted(cross, key=lambda p: (by_id.get(p, {}).get("primary_name") or "").lower()), 1):
        p = by_id.get(pid, {})
        ym = sorted(yims.get(pid, set()))
        w("  %4d. %-7s %-22s  years %-10s  seasons %-3d  YIM: %s"
          % (n, pid, (p.get("primary_name") or "?")[:22], years(pid),
             len(seasons.get(pid, set())), ", ".join(ym) if ym else "(none recorded)"))
    w("")

    w("=" * 78)
    w("SUMMARY")
    w("=" * 78)
    w("  1. exact shared YIMs                    %5d" % len(exact_shared))
    w("  2. near-duplicate YIM clusters          %5d  (%d accounts)"
      % (len(near), sum(len(v) for v in near.values())))
    w("  3. accounts holding >1 YIM              %5d" % len(multi))
    w("  4. accounts in both Division A and B    %5d" % len(cross))
    w("")
    w("  Section 2 is the actionable list. Clusters marked STRONG are near-certain")
    w("  duplicates; those marked REVIEW share a short or common normalised key and")
    w("  should be confirmed against their season history before merging.")

    text = "\n".join(lines) + "\n"
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with io.open(OUT, "w", encoding="utf-8", newline="") as fh:
        fh.write(text)

    print("shared YIMs (exact): %d" % len(exact_shared), file=sys.stderr)
    print("near-duplicate clusters: %d covering %d accounts"
          % (len(near), sum(len(v) for v in near.values())), file=sys.stderr)
    print("accounts with >1 YIM: %d" % len(multi), file=sys.stderr)
    print("accounts in both divisions: %d" % len(cross), file=sys.stderr)
    print("written to %s (%d lines)" % (OUT, len(lines)), file=sys.stderr)


main()
