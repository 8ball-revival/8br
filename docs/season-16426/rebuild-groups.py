# -*- coding: utf-8 -*-
"""Reconstruct the 198 double-round-robin group meetings of 8BRCAM Season 1 from the Challonge log.

Rules (as directed):
  * winner is named after "win for X over Y"; the winner's games are the LARGER of the two numbers,
    because Challonge prints the score in stored-slot order, not winner-first.
  * "Updated X's win over Y to A-B" / "Changed the outcome of A vs. B to ..." REPLACE the most recent
    report for that pair. They never create a third meeting.
  * a result reported 1-0 (or 0-1) is a FORFEIT: no score is stored, and it contributes nothing to
    the points differential.
  * every pairing has exactly two meetings. Meetings the log does not account for were ties, and a
    tie with no attributable score is stored 5-5.
"""
import io, json, re, sys, collections

SCRATCH = r'C:/Users/Cerebro/AppData/Local/Temp/claude/C--Users-Cerebro/952b661e-7486-446a-90b1-a109d310f71e/scratchpad'
DIAMOND = chr(0x1F48E)
DERRICK = DIAMOND + ' (Derrick)'

GROUPS = {
 'A': ['sixohtwo','Mr.Gaz','Adambuddy','fsm_brian','Claimed','SabreGirl','Black_Ball'],
 'B': ['neo','JC','jabronni16','mynameiseskimo','lilsparky67','Sterlo','Javi_8'],
 'C': ['Travis','Iantunstall','_Tarantula_69','o_aig_o','Cameron90','Bye_all_c_ya','THE_PFB'],
 'D': ['l_Mr_CC_l','S_U_K_I_O_O',DERRICK,'Black_Jesus','ArsH_','TrioTheLegend'],
 'E': ['Easyrun','Ogges','leighjohn__','Faisal','TRICK__D','spc_shogun','JEFE_122'],
}
# Challonge name -> CueVerse ID (the completed 34/34 mapping)
IDENT = {
 'sixohtwo':'sixohtwo','Mr.Gaz':'NoLimitGary','Adambuddy':'adambuddy','fsm_brian':'fsm_brian',
 'Claimed':'Bricycle','SabreGirl':'SabreGirl','Black_Ball':'Black_Ball',
 'neo':'Starkiller','JC':'IrateMusicfool','jabronni16':'i.am_the_zodiac','mynameiseskimo':'eskimo',
 'lilsparky67':'lilsparky67','Sterlo':'Sterlo_','Javi_8':'Javi_8',
 'Travis':'Travis','Iantunstall':'Iantunstall','_Tarantula_69':'FreakyLilspider','o_aig_o':'o_aig_o',
 'Cameron90':'Cam','Bye_all_c_ya':'Bye_all_c_ya','THE_PFB':'THE_PFB',
 'l_Mr_CC_l':'l_Mr_CC_l','S_U_K_I_O_O':'S_U_K_I_O_O',DERRICK:DIAMOND,'Black_Jesus':'Black_Jesus',
 'ArsH_':'ArsH_','TrioTheLegend':'mr.kapaw',
 'Easyrun':'easyrun','Ogges':'xlx_ogges_xlx','leighjohn__':'mr.spin','Faisal':'F_A_I_S_A_L',
 'TRICK__D':'TRICK__D','spc_shogun':'spc_shogun','JEFE_122':'JEFE_122',
}
# Challonge official W-L-T, used purely as a checksum on the reconstruction.
EXPECT = {
 'sixohtwo':(11,1,0),'Mr.Gaz':(9,2,1),'Adambuddy':(7,2,3),'fsm_brian':(5,4,3),'Claimed':(3,8,1),
 'SabreGirl':(3,9,0),'Black_Ball':(0,12,0),
 'neo':(8,2,2),'JC':(6,3,3),'jabronni16':(5,2,5),'mynameiseskimo':(5,2,5),'lilsparky67':(4,4,4),
 'Sterlo':(4,8,0),'Javi_8':(0,11,1),
 'Travis':(10,0,2),'Iantunstall':(8,1,3),'_Tarantula_69':(6,6,0),'o_aig_o':(5,5,2),'Cameron90':(4,6,2),
 'Bye_all_c_ya':(2,8,2),'THE_PFB':(0,9,3),
 'l_Mr_CC_l':(8,2,0),'S_U_K_I_O_O':(8,2,0),DERRICK:(7,3,0),'Black_Jesus':(4,6,0),'ArsH_':(1,7,2),
 'TrioTheLegend':(0,8,2),
 'Easyrun':(11,0,1),'Ogges':(6,2,4),'leighjohn__':(5,4,3),'Faisal':(5,5,2),'TRICK__D':(4,6,2),
 'spc_shogun':(3,6,3),'JEFE_122':(0,11,1),
}

group_of = {}
for g, ms in GROUPS.items():
    for m in ms:
        group_of[m] = g

def key(a, b):
    return ' :: '.join(sorted([a, b]))

# ── parse the log chronologically ───────────────────────────────────────────────────────────────
events = collections.OrderedDict()   # pair -> list of dicts (in order)
raw = io.open(SCRATCH + '/challonge/group-log.txt', encoding='utf-8').read().splitlines()

RE_WIN     = re.compile(r'^Reported a (\d+)-(\d+) win for (.+?) over (.+)$')
RE_UPDATE  = re.compile(r"^Updated (.+?)'s win over (.+?) to (\d+)-(\d+)$")
RE_CHANGED = re.compile(r'^Changed the outcome of (.+?) vs\. (.+?) to a (\d+)-(\d+) win for (.+)$')

# A "Changed the outcome" normally corrects the most recent report for that pair. Where the pair has
# TWO meetings the log does not say which one it corrects, so REASSIGN pins it to the right meeting.
# The entry is forced by Challonge's own W-L-T totals, never chosen -- see CORRECTIONS below.
REASSIGN = {192: 64}

unattributable_ties = 0
ignored = []
for line in raw:
    seq, txt = line.split('|', 1)
    if 'tie' in txt and '[missing]' in txt:
        unattributable_ties += 1
        continue
    m = RE_WIN.match(txt)
    if m:
        s1, s2, win, lose = int(m.group(1)), int(m.group(2)), m.group(3).strip(), m.group(4).strip()
        hi, lo = max(s1, s2), min(s1, s2)
        ff = (hi == 1 and lo == 0)
        events.setdefault(key(win, lose), []).append(
            {'seq': int(seq), 'winner': win, 'loser': lose, 'wg': hi, 'lg': lo, 'ff': ff, 'tie': False})
        continue
    m = RE_UPDATE.match(txt)
    if m:
        win, lose, s1, s2 = m.group(1).strip(), m.group(2).strip(), int(m.group(3)), int(m.group(4))
        hi, lo = max(s1, s2), min(s1, s2)
        k = key(win, lose)
        # An Update whose original report is absent from the log is the ONLY record of that meeting,
        # so it stands as the result rather than replacing something that was never written down.
        rec = {'seq': int(seq), 'winner': win, 'loser': lose, 'wg': hi, 'lg': lo,
               'ff': (hi == 1 and lo == 0), 'tie': False, 'replaced': True}
        if events.get(k): events[k][-1] = rec
        else: events.setdefault(k, []).append(rec)
        continue
    m = RE_CHANGED.match(txt)
    if m:
        a, b, s1, s2, win = m.group(1).strip(), m.group(2).strip(), int(m.group(3)), int(m.group(4)), m.group(5).strip()
        lose = a if win == b else b
        hi, lo = max(s1, s2), min(s1, s2)
        k = key(a, b)
        target = REASSIGN.get(int(seq))
        rec = {'seq': target if target is not None else int(seq), 'winner': win, 'loser': lose,
               'wg': hi, 'lg': lo, 'ff': (hi == 1 and lo == 0), 'tie': False, 'replaced': True}
        if target is not None:
            idx = next((i for i, e in enumerate(events.get(k, [])) if e['seq'] == target), None)
            assert idx is not None, 'reassign target %d not found for %s' % (target, k)
            events[k][idx] = rec
        elif events.get(k):
            events[k][-1] = rec
        else:
            events.setdefault(k, []).append(rec)
        continue
    ignored.append(txt)

# ── three corrections the log states but cannot attribute by itself ─────────────────────────────
#
# Each is FORCED by Challonge's own W-L-T totals, not chosen. The log records the change; it just
# does not say which match it applies to, and only one assignment reproduces the official standings.
#
#  seq 192  "Changed the outcome of THE_PFB vs. _Tarantula_69 to a 0-1 win for _Tarantula_69"
#           names the pair but not the meeting. THE_PFB finishes 0-9-3 -- zero wins -- so it must
#           overturn his win at seq 64, not the seq 186 meeting _Tarantula_69 already won.
#  seq 94   "Changed the outcome of [missing] to a 0-0 tie". Cameron90 needs one win fewer and
#           Bye_all_c_ya one loss fewer; their only shared match is seq 72. Score kept at 0-0.
#  seq 191  "Changed the outcome of [missing] to a 1-1 tie". o_aig_o needs one win fewer and
#           THE_PFB one loss fewer; their only shared match is seq 175. Score kept at 1-1.
CORRECTIONS = [
    {'kind': 'to_tie', 'seq': 72, 'hg': 0, 'ag': 0, 'source': 94},
    {'kind': 'to_tie', 'seq': 175, 'hg': 1, 'ag': 1, 'source': 191},
]
for c in CORRECTIONS:
    for k, evs in events.items():
        for i, e in enumerate(evs):
            if e['seq'] == c['seq']:
                evs[i] = {'seq': e['seq'], 'winner': None, 'loser': None, 'wg': None,
                          'lg': None, 'ff': False, 'tie': True, 'hg': c['hg'], 'ag': c['ag'],
                          'source': c['source']}

# ── build every required meeting ────────────────────────────────────────────────────────────────
meetings = []
problems = []
for g, ms in GROUPS.items():
    for i in range(len(ms)):
        for j in range(i + 1, len(ms)):
            a, b = ms[i], ms[j]
            k = key(a, b)
            evs = events.get(k, [])
            if len(evs) > 2:
                problems.append('%s has %d decisive reports' % (k, len(evs)))
                evs = evs[-2:]
            for slot in (1, 2):
                if slot <= len(evs):
                    e = evs[slot - 1]
                    if e.get('tie'):
                        meetings.append({'group': g, 'meeting': slot, 'home': a, 'away': b,
                                         'winner': None, 'loser': None, 'ff': False,
                                         'hg': e['hg'], 'ag': e['ag'], 'tie': True, 'src': e['seq']})
                        continue
                    meetings.append({'group': g, 'meeting': slot, 'home': a, 'away': b,
                                     'winner': e['winner'], 'loser': e['loser'],
                                     'ff': e['ff'],
                                     'hg': None if e['ff'] else (e['wg'] if e['winner'] == a else e['lg']),
                                     'ag': None if e['ff'] else (e['wg'] if e['winner'] == b else e['lg']),
                                     'tie': False, 'src': e['seq']})
                else:
                    meetings.append({'group': g, 'meeting': slot, 'home': a, 'away': b,
                                     'winner': None, 'loser': None, 'ff': False,
                                     'hg': 5, 'ag': 5, 'tie': True, 'src': None})

# ── checksum against Challonge's official W-L-T ────────────────────────────────────────────────
rec = collections.defaultdict(lambda: [0, 0, 0])
for m in meetings:
    if m['tie']:
        rec[m['home']][2] += 1
        rec[m['away']][2] += 1
    else:
        rec[m['winner']][0] += 1
        rec[m['loser']][1] += 1

print('log lines parsed      : %d' % len(raw))
print('unattributable ties   : %d  (no participants in the source; become inferred 5-5 meetings)' % unattributable_ties)
print('ignored admin lines   : %d  %s' % (len(ignored), ignored))
print('pairs with results    : %d' % len(events))
print('meetings built        : %d  (ties: %d, forfeits: %d, played: %d)'
      % (len(meetings), sum(1 for m in meetings if m['tie']),
         sum(1 for m in meetings if m['ff']),
         sum(1 for m in meetings if not m['tie'] and not m['ff'])))
if problems:
    print('STRUCTURAL PROBLEMS   : %s' % problems)

print('\n%-18s %-12s %-12s %s' % ('PLAYER', 'RECONSTRUCTED', 'CHALLONGE', ''))
bad = 0
for name in sorted(EXPECT, key=lambda n: (group_of[n], n.lower())):
    got = tuple(rec[name])
    exp = EXPECT[name]
    ok = got == exp
    if not ok:
        bad += 1
    disp = 'Derrick' if name == DERRICK else name
    print('%-18s %-12s %-12s %s' % (disp, '%d-%d-%d' % got, '%d-%d-%d' % exp, 'OK' if ok else '<<< MISMATCH'))
print('\nW-L-T mismatches: %d of %d' % (bad, len(EXPECT)))

json.dump(meetings, io.open(SCRATCH + '/challonge/meetings.json', 'w', encoding='utf-8'), ensure_ascii=False)
print('meetings written to challonge/meetings.json')
sys.exit(1 if (bad or problems) else 0)
