# review-pr skill — design

## Intent

After a PR is open, Diego runs the same loop by hand across two sessions:
a new session runs `code-review` and `post-review-comments`, then the original
session runs `handle-pr-comments`. The new session exists for fresh eyes (a reviewer
not biased by writing the code) and a clean context. The findings must still land on
GitHub as PR comments.

`/review-pr` runs that whole loop from the original session, with one stop for Diego.

## Goals

- One command runs review → post → triage → fix → commit → push → reply.
- The review is done by a subagent: clean context, no view of how the code was written.
- Findings are posted on the PR as inline comments (a record on GitHub).
- Triage covers every root comment on the PR, not only the subagent's.
- Exactly one stop: Diego approves or tweaks the triage. After that it runs to the end.

## Non-goals

- No automatic start on PR creation. Diego runs the command. Going automatic later is
  one line in `~/.claude/CLAUDE.md` ("after you open a PR, run `/review-pr`").
- No second review round on the fix commits. One round, then stop.
- No CI watching inside the skill. Diego's global rules already cover that.

## Anti-goals

- The reviewer sees the writing session's context (that kills the fresh-eyes point).
- Fixes get pushed before Diego approves the triage.
- `handle-pr-comments` or `post-review-comments` change behaviour when run on their own.

## Approaches

- **A. New orchestrating skill that calls the existing skills** — picked. Small, reuses
  working skills, each skill still runs alone. Cost: three skills to keep in step.
- B. Grow `handle-pr-comments` with a `--review` option. One skill, but it does too much
  and its standalone use gets harder to follow.
- Ruled out: a mod (no screen part is needed) and a Workflow script (runs in the
  background, a mid-run approval stop does not fit).

## Decided

- Lives in `skills/library/review-pr/SKILL.md`, installed with `/skills:install`.
- Runs in the current session and worktree. The PR is the current branch's, or a
  number passed as argument.
- Step 1: dispatch one fresh subagent. It runs `code-review` on the PR, then
  `post-review-comments` to post the findings as one review with inline comments.
  It reports back the review URL and counts.
- Step 2: follow `handle-pr-comments` in the main session. Triage stop stays.
  The pre-commit stop (its step 9) is skipped: after triage approval it fixes,
  verifies, commits, pushes, replies and resolves without asking again.
- Location-agnostic: the needed skills may be installed globally (`~/.claude/skills/`),
  in the repo (`.claude/skills/`), or come from a plugin. The skill checks for them by
  name in the session's available skills, never by file path.
- If `handle-pr-comments` or `post-review-comments` is missing, stop before anything
  runs and propose installing them, as the README says: run `/skills:install` and pick
  the missing ones. If `/skills:install` is not there either, give the install commands
  for the `skills@claude-mods` plugin first.
- This overrides Diego's global "pause for review before committing" on purpose,
  only inside this flow. The skill says so in one line.

## Calls made by Claude (check these)

- Name: `/review-pr`.
- The skip of the pre-commit stop is an `--auto-push` argument added to
  `handle-pr-comments`. Without the argument it behaves as today. `/review-pr`
  passes it. This keeps the commit rules in one place.
- `code-review` runs at its own default effort level. A level passed to `/review-pr`
  is handed through.
- If the subagent finds nothing and the PR has no other open comments, stop and say
  the PR is clean. Skip triage.
- If the subagent fails to post, stop and show the error. Do not triage a half review.
- Add `review-pr` to the README's skills list, if the README lists skills.

## Left to the builder

- Exact subagent prompt wording (it must name the PR number, owner/repo, and tell the
  subagent to use the two skills, not to fix anything).
- Wording of the `--auto-push` change inside `handle-pr-comments`.
