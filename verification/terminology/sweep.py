"""
Rename the visible product type from Tournament to Cup.

Operates ONLY on prose: the inside of string literals and JSX text nodes. Identifiers, property
keys, type names, import specifiers and model accessors are left exactly as they are, because
renaming those is a schema migration that would change no word anybody reads.

Four things are deliberately protected:
  * import specifiers    — '@/lib/tournaments/live' is a module path, not a sentence;
  * historical slugs     — '/seasons/ego-tournament-1' names a real record and must never move;
  * lowercase keys       — 'tournaments' as a discriminant or a nav key is internal;
  * template expressions — `${h.counts.tournaments}` is code that happens to sit inside a string.

Route strings are handled separately: '/tournaments' is the OLD route and becomes '/cups', but only
when it is the whole path, so a slug that merely contains the word is untouched.
"""
import io
import re
import sys

FILES = sys.argv[1:]

PATH_LIKE = re.compile(r"^[@./]|^https?:")
KEY_LIKE = re.compile(r"^tournaments?$")
WORD = re.compile(r"(?<![A-Za-z0-9_])([Tt]ournaments?)(?![A-Za-z0-9_])")
EXPR = re.compile(r"\$\{[^}]*\}")
PLACEHOLDER = re.compile(r"@@EXPR(\d+)@@")

STRING = re.compile(
    r"'((?:\\.|[^'\\])*)'"
    r'|"((?:\\.|[^"\\])*)"'
    r"|`((?:\\.|[^`\\])*)`"
)

JSX_TEXT = re.compile(r"(>)([^<>{}'\"]*[Tt]ournaments?[^<>{}'\"]*)(<)")


def prose(text):
    """Replace the word in prose. Cup is a proper noun here, so it is always capitalised."""
    def sub(m):
        word = m.group(1)
        return "Cups" if word.lower().endswith("s") else "Cup"
    return WORD.sub(sub, text)


def fix_body(body):
    # A template literal's ${...} holds code, not prose. Hold each expression aside, rewrite the
    # text around it, then put the expressions back exactly as they were.
    if "${" in body:
        held = []

        def stash(m):
            held.append(m.group(0))
            return "@@EXPR" + str(len(held) - 1) + "@@"

        masked = EXPR.sub(stash, body)
        rewritten = fix_body(masked)
        return PLACEHOLDER.sub(lambda m: held[int(m.group(1))], rewritten)

    if PATH_LIKE.match(body):
        # A route or module path. Only the exact legacy route moves.
        return "/cups" if re.fullmatch(r"/tournaments/?", body) else body
    if KEY_LIKE.match(body):
        return body
    return prose(body)


def fix_line(line):
    stripped = line.lstrip()
    # Comments explain internals to developers; they render nowhere.
    if stripped.startswith("//") or stripped.startswith("*") or stripped.startswith("/*"):
        return line
    # Import statements are module paths in full.
    if re.match(r"\s*import\b", line) or "import(" in line:
        return line

    def on_string(m):
        for idx, quote in ((1, "'"), (2, '"'), (3, "`")):
            body = m.group(idx)
            if body is not None:
                return quote + fix_body(body) + quote
        return m.group(0)

    out = STRING.sub(on_string, line)
    out = JSX_TEXT.sub(lambda m: m.group(1) + prose(m.group(2)) + m.group(3), out)
    return out


changed = 0
for path in FILES:
    src = io.open(path, encoding="utf-8").read()
    new = "\n".join(fix_line(l) for l in src.split("\n"))
    if new != src:
        io.open(path, "w", encoding="utf-8", newline="").write(new)
        changed += 1
        print("updated", path)
print(str(changed) + " files updated")
