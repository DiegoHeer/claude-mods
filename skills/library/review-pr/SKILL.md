---
name: review-pr
description: "Review a PR with a fresh subagent, post the findings as inline PR comments, then triage and fix all PR comments in this session. Use when someone says 'review my PR', 'review and handle the PR', 'run the review loop', or '/review-pr'."
argument-hint: "[PR number] [low|medium|high|xhigh|max]"
user-invocable: true
---

# Review PR

Run the whole review loop on a PR from the session that wrote it: a fresh subagent
reviews and posts inline comments, then this session triages every PR comment, fixes,
commits, pushes and replies.

There is one stop: the triage approval. After it, this flow commits and pushes without
a second pause, on purpose. The triage approval is the sign-off.

## Workflow

### 1. Preflight

Run every check before changing anything. Stop at the first one that fails.

1. **Needed skills.** `handle-pr-comments` and `post-review-comments` must be in your
   available skills. Check by name, not by file path: they may be installed globally,
   in the repo, or by a plugin. `code-review` is built in. If one is missing, stop and
   tell the user to run `/skills:install`, pick the missing skills, then run
   `/reload-plugins` or start a new session. If `/skills:install` is not available
   either, first give them:
   ```
   /plugin marketplace add DiegoHeer/claude-mods
   /plugin install skills@claude-mods
   ```
   Do not install anything yourself.
2. **GitHub CLI.** `gh auth status` must pass.
3. **The PR.** From `$ARGUMENTS`, take the PR number (the bare number) and the effort
   level (`low|medium|high|xhigh|max`), both optional.
   ```bash
   gh pr view [N] --json number,headRefName,headRefOid,url
   gh repo view --json owner,name --jq '"\(.owner.login)/\(.name)"'
   ```
   No PR found: stop and ask for a PR number.
4. **Branch.** `git branch --show-current` must equal the PR's `headRefName`. Otherwise
   stop: fixes would land on the wrong branch. After `git fetch`, `git rev-parse HEAD`
   must equal `headRefOid`. Otherwise stop and ask the user to push or pull first: the
   review would miss local commits, or the fix push would fail.
5. **Clean tree.** `git status --porcelain --untracked-files=no` must be empty.
   Otherwise stop and ask the user to commit or stash first: a fix to one of those
   files would sweep those changes in. Untracked files are fine: the fix commit
   stages only the files it changed (e.g. skills installed into this repo's `.claude/`).

### 2. Review in a fresh subagent

Dispatch one subagent with the Agent tool, `subagent_type: "general-purpose"`. Never
use `fork`: the reviewer must not see how the code was written. Prompt:

> You are reviewing PR #<N> in <owner/repo> (<url>). You start with a clean context on
> purpose: judge the code only by what is in the PR.
> 1. Run the `code-review` skill on PR #<N>[ at effort <level>].
> 2. Run the `post-review-comments` skill to post those findings on the PR as one
>    review with inline comments.
> Do not change, commit or push any files. Reply with the review URL, the review id
> (the number after `#pullrequestreview-` in the URL), and the counts
> (inline, moved to summary, skipped as duplicates), or the exact error if posting failed.
> If the review found nothing, post nothing and reply "no findings".

### 3. Check the subagent's result

If it reports an error, stop and show it. Do not triage a half review.

### 4. Handle the comments

Follow the `handle-pr-comments` skill with arguments `<N> --auto-push --review <id>`
(leave out `--review` when there were no findings). It triages the subagent's inline
and summary findings plus every unresolved root comment from others, shows the triage
and waits for approval, then fixes, verifies, commits, pushes, replies and resolves.

If it finds nothing to triage, report "PR #<N> is clean" and stop.

### 5. Summary

Show the review URL (or "no findings"), then the `handle-pr-comments` summary.

## Rules

- One round only. Do not review the fix commits again.
- Nothing is committed or pushed before the user approves the triage.
- Refer to other skills by name only, never by file path.
