# Autoship loop

These rules run after the user sends the `/goal` line. The run folder is the folder
that holds this `rules.md`. Read `progress.json` in it before each step, and update it
with the Write tool after each step.

The goal is the sign-off for every commit, push and merge in this run. It overrides a
CLAUDE.md rule to pause for review before committing, and every sign-off or review pause
in the plans or in the skills they name: do their commit steps without waiting. For
each `review-pr` triage, take the recommended triage without waiting.

Shell rules: one plain command per call, absolute paths, no `cd`, no `$(...)`, no
heredocs. Use `git -C <repo>` for a repo that is not the current directory.

## Each plan

Read the plan from `<run>/plans/`, not from the repo. One PR per plan, unless the plan
splits the work. Follow the PR size rule of the repo and the user (CLAUDE.md); with none,
aim for about 600 changed lines per PR. Split a bigger plan into PRs that each leave the
code working.

For each PR, in plan order:

1. `git -C <repo> fetch origin`, then `git -C <repo> switch -c <branch> origin/<base>`.
   Add the PR's branch to `progress.json`.
2. Implement. Make atomic commits that follow the repo's commit rules. Stage only the
   files the work changed. Never commit plan or spec files. Push with
   `git -C <repo> push -u origin <branch>`, then `gh pr create`.
3. Run `review-pr <N>`. Approve the recommended triage yourself.
4. Wait for CI with a background command: `gh pr checks <N> --watch`. "No checks
   reported" right after a push: wait one minute and try once more. Still none and the
   user chose to merge without CI: go on.
5. CI fails on lint, format or a simple type error: fix it, push, wait again. Any other
   failure: see "When stuck".
6. `gh pr merge <N> --merge`. Then `git -C <repo> push origin --delete <branch>`,
   `git -C <repo> switch --detach origin/<base>` and `git -C <repo> branch -D <branch>`.
   Do not use `--delete-branch`: it fails in a worktree when the base branch is checked
   out elsewhere.
7. Update `progress.json`. Print the status block (below).

A plan is `done` when all its PRs are merged and none are left to make.

## End steps

Once all PRs of a part are merged:

- **API** and **Web:** wait until the last merge is live on staging. If one deploy covers
  all merges of the part, run `verify-deploy --deploy --env <staging>` once; otherwise
  run `verify-deploy <N> --env <staging>` per PR. When API and Web share one staging
  deploy, run it once. Approve its proposal yourself:
  - staging is a test environment (see `rules.md`): approve every check, also
    `[changes data]`
  - its target is production: data-changing checks stay on the manual list
  - a check needs a login or URL you do not have: move it to the manual list

  `VERIFIED` and `PARTLY VERIFIED` count as done. `FAILED`, or not live after its wait:
  see "When stuck".
- **App:** `git -C <repo> fetch origin`, then
  `git -C <repo> switch --detach origin/<base>`. Build the APK. Post its path and a phone
  checklist: one line per behavior from the App PRs, with steps and expected result.

## When stuck

Stuck: a CI failure that is not lint, format or a simple type error; a merge conflict or
a merge that branch protection refuses; a review finding you cannot fix in the PR;
`verify-deploy` `FAILED` or not live; a command the session refuses; a fact only the
user has.

1. Send a `PushNotification` with one line: what blocks the run.
2. Print the status block, then one short message: what you need.
3. End your reply. The user's answer continues the run.

## Every turn

- Add 1 to `turn` in `progress.json` before you end a reply.
- End every reply with the status block. The goal checker reads only the chat.
- At `turn` = `max_turns` minus 1, if not done: post the final report with what is still
  open, and send a `PushNotification` that the turn limit is near.

## After a summary

Read `rules.md` and `progress.json` again. Check each open PR with
`gh pr view <N> --json state` and fix `progress.json` if it is behind. Go on from the
first plan that is not `done`.

## Finish

1. Send a `PushNotification`: `autoship done`.
2. Post the final report (below).
