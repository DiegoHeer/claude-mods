---
name: post-review-comments
description: Use when code-review findings already exist in the conversation and need to go onto a GitHub PR as inline comments — "post these inline", "post the review", "comment these on the PR", "leave inline comments". Companion to any review flow; it only posts, it does not review.
---

# Post Review Comments

## Overview

Take the review findings already in this conversation and post them onto a GitHub
PR as **one review with inline comments**. This skill only *posts*. It does not
generate the review — the findings come from whatever review already happened
(the `/code-review` plugin, a manual review, the built-in `code-review` skill).

**Core mechanic:** `gh api repos/{owner}/{repo}/pulls/{N}/reviews --input review.json`
creates a single review carrying many inline comments plus a summary body.

## When to Use

- Findings exist in the chat and the user says "post them inline" / "post the review".
- You just reviewed a PR and want the notes on the code, not in the terminal.

**Not for:** doing the review itself, or replying to existing review threads
(that is `handle-pr-comments`).

## The Critical Gotcha

The `/reviews` endpoint is **all-or-nothing**: if ONE comment points at a line
that is not part of the diff, GitHub returns `422` and **rejects the entire
review**. So you MUST split findings into "on-diff → inline" vs
"off-diff → summary text" BEFORE posting. The helper script does this for you.

Facts that make a line valid:
- Comment on an **added or context** line → `side: "RIGHT"`, use the new-file line number.
- Comment on a **removed** line → `side: "LEFT"`, use the old-file line number.
- Multi-line comment → add `start_line` (+ `start_side`), with `start_line < line`, same side.
- `commit_id` MUST be the PR **head** SHA.
- Each comment `body` must be non-empty.

## Workflow

1. **Identify the PR and repo.**
   ```bash
   gh pr view --json number,headRefOid,headRepositoryOwner,headRepository
   ```
   If not on a PR branch, ask the user for the PR number and use `gh pr view <N> --json ...`.
   Capture: `PR` (number), `OWNER/REPO` (the base repo, e.g. `DiegoHeer/realty-alerts`),
   and `HEAD_SHA` (`headRefOid`).

2. **Get the diff** (the source of truth for which lines are commentable):
   ```bash
   gh pr diff <PR> > /tmp/pr.diff
   ```

3. **Write the findings to JSON.** Turn the findings in the conversation into a
   JSON array. One object per finding.

   **Where `line` comes from:** for a `RIGHT` comment it is simply the line number
   in the **current file** (the PR head version) — the same number you saw when you
   read the file during review. Do NOT hand-count hunk headers. For a `LEFT`
   comment (a deleted line) it is the line number in the old file. The helper only
   *validates* these against the diff; it does not invent them, so put the real
   number here.
   ```json
   [
     {"path": "src/auth.ts", "line": 72, "side": "RIGHT",
      "body": "OAuth error not handled — the callback throws on a denied grant."},
     {"path": "src/util.ts", "start_line": 20, "line": 23, "side": "RIGHT",
      "body": "This block duplicates `normalize()` above; extract it."}
   ]
   ```
   `side` defaults to `RIGHT` if omitted. Keep each body short: the finding + the why, no emojis.

4. **Optional — avoid duplicates.** Fetch existing inline comments and pass them
   in so already-posted findings are skipped:
   ```bash
   gh api repos/{OWNER}/{REPO}/pulls/<PR>/comments --paginate \
     --jq '[.[] | {path, line: (.line // .original_line), body}]' > /tmp/existing.json
   ```

5. **Build the review payload** with the helper. It splits findings into inline
   vs off-diff, rolls off-diff ones into the summary, and drops duplicates.
   `<skill-dir>` is this skill's base directory, shown when the skill loads
   ("Base directory for this skill"); it differs per install (global, repo, plugin):
   ```bash
   python3 <skill-dir>/build_review.py \
     --diff-file /tmp/pr.diff \
     --findings-file /tmp/findings.json \
     --commit-id <HEAD_SHA> \
     --existing-file /tmp/existing.json \
     > /tmp/review.json
   ```
   Add `--summary-header "..."` to put a one-line preamble above the review body
   (e.g. "Automated review of the OAuth changes."). Omit it and the body is just
   the off-diff findings, or a short default if there are none.
   It prints a one-line summary to stderr: how many inline, how many moved to the
   summary, how many skipped as duplicates.

6. **Post the review** (posts immediately, `event=COMMENT`):
   ```bash
   gh api repos/{OWNER}/{REPO}/pulls/<PR>/reviews --input /tmp/review.json \
     --jq '{id, state, url: .html_url}'
   ```

7. **Report to the user:** "Posted N inline, M in the summary. Review: <url> (id <id>)".
   If the call still 422s, read the error, fix the offending finding (usually a
   wrong line/side), and re-run step 5–6 — never post a half-review.

## Quick Reference

| Need | Field |
|------|-------|
| Comment on new/added or unchanged line | `side: "RIGHT"`, new-file line number |
| Comment on a deleted line | `side: "LEFT"`, old-file line number |
| Comment on a range | `start_line` + `line`, same `side`, `start_line < line` |
| Which commit | `commit_id` = PR head SHA (`headRefOid`) |
| Post now vs draft | `event: "COMMENT"` posts; `event: "PENDING"` leaves a draft |

## Common Mistakes

- **Posting with `-f`.** `comments` is an array — `-f` can't express it. Always
  build a JSON file and use `--input`.
- **Using the merge/base SHA as `commit_id`.** Must be the PR head (`headRefOid`),
  or every comment is off-diff.
- **Guessing commentable lines.** Don't. Parse the actual diff (the helper does).
- **Losing off-diff findings.** They go in the summary body, never dropped.
- **Re-posting on re-run.** Pass `--existing-file` so duplicates are skipped.

See `<skill-dir>/build_review.py` for the payload builder.
