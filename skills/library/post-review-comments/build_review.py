#!/usr/bin/env python3
"""Build a GitHub PR review payload from a list of findings.

Splits findings into on-diff (posted inline) and off-diff (rolled into the review
summary body so nothing is lost). Optionally drops findings that already exist as
inline comments. Emits the JSON payload for:

    gh api repos/{owner}/{repo}/pulls/{N}/reviews --input review.json

Why: the /reviews endpoint is all-or-nothing. One comment on a line that is not
part of the diff makes GitHub reject the whole review (422). So we validate every
finding against the actual diff *before* posting.
"""
import argparse
import json
import re
import sys

HUNK_RE = re.compile(r"^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@")


def parse_diff(diff_text):
    """Return {path: {"RIGHT": set(new_lines), "LEFT": set(old_lines)}}.

    RIGHT lines are added ('+') or context (' ') lines, numbered in the new file.
    LEFT lines are removed ('-') or context (' ') lines, numbered in the old file.
    """
    valid = {}
    path = None
    old_ln = new_ln = 0
    for raw in diff_text.splitlines():
        if raw.startswith("+++ "):
            # "+++ b/path" (or "+++ /dev/null" for deletions)
            p = raw[4:]
            if p.startswith("b/"):
                p = p[2:]
            path = None if p == "/dev/null" else p
            if path is not None:
                valid.setdefault(path, {"RIGHT": set(), "LEFT": set()})
            continue
        if path is None:
            continue
        m = HUNK_RE.match(raw)
        if m:
            old_ln = int(m.group(1))
            new_ln = int(m.group(2))
            continue
        if not raw:
            continue
        tag = raw[0]
        if tag == "+":
            valid[path]["RIGHT"].add(new_ln)
            new_ln += 1
        elif tag == "-":
            valid[path]["LEFT"].add(old_ln)
            old_ln += 1
        elif tag == " ":
            valid[path]["RIGHT"].add(new_ln)
            valid[path]["LEFT"].add(old_ln)
            old_ln += 1
            new_ln += 1
        # '\' (No newline at end of file) and other lines: ignore
    return valid


def is_on_diff(f, valid):
    path = f.get("path")
    side = (f.get("side") or "RIGHT").upper()
    line = f.get("line")
    if path not in valid or line is None:
        return False
    lines = valid[path].get(side, set())
    if line not in lines:
        return False
    start = f.get("start_line")
    if start is not None:
        start_side = (f.get("start_side") or side).upper()
        if start_side != side or start >= line or start not in lines:
            return False
    return True


def dedup_key(path, line, body):
    return (path, line, " ".join((body or "").split())[:80])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--diff-file", required=True)
    ap.add_argument("--findings-file", required=True)
    ap.add_argument("--commit-id", required=True)
    ap.add_argument("--existing-file", help="JSON array of {path,line,body} already posted")
    ap.add_argument("--summary-header", default="",
                    help="Optional text placed at the top of the review summary")
    ap.add_argument("--event", default="COMMENT", choices=["COMMENT", "PENDING", "REQUEST_CHANGES", "APPROVE"])
    args = ap.parse_args()

    with open(args.diff_file) as fh:
        valid = parse_diff(fh.read())
    with open(args.findings_file) as fh:
        findings = json.load(fh)

    seen = set()
    if args.existing_file:
        with open(args.existing_file) as fh:
            for e in json.load(fh):
                seen.add(dedup_key(e.get("path"), e.get("line"), e.get("body")))

    inline, off_diff = [], []
    dup = 0
    for f in findings:
        side = (f.get("side") or "RIGHT").upper()
        key = dedup_key(f.get("path"), f.get("line"), f.get("body"))
        if key in seen:
            dup += 1
            continue
        seen.add(key)
        if is_on_diff(f, valid):
            c = {"path": f["path"], "line": f["line"], "side": side, "body": f["body"]}
            if f.get("start_line") is not None:
                c["start_line"] = f["start_line"]
                c["start_side"] = (f.get("start_side") or side).upper()
            inline.append(c)
        else:
            off_diff.append(f)

    # Build the summary body.
    parts = []
    if args.summary_header.strip():
        parts.append(args.summary_header.strip())
    if off_diff:
        parts.append("Findings not on the changed lines:")
        for f in off_diff:
            loc = f.get("path", "?")
            if f.get("line") is not None:
                loc += f":{f['line']}"
            parts.append(f"- {loc} — {f.get('body', '').strip()}")
    if not parts:
        parts.append(f"Automated review: {len(inline)} inline comment(s).")
    body = "\n\n".join(parts)

    payload = {"commit_id": args.commit_id, "event": args.event, "body": body}
    if inline:
        payload["comments"] = inline

    print(json.dumps(payload, indent=2))
    print(
        f"inline={len(inline)} summary={len(off_diff)} duplicates_skipped={dup}",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
