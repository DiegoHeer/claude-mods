---
name: autoship
description: "Ship the plans on autopilot: check everything, ask every open question in one round, then set a session goal that takes each plan through PR, review-pr, green CI and merge, then verify-deploy on staging for API and Web work and an APK with a phone checklist for App work. Use when someone says 'autoship', 'ship the plans', 'run the plans on autopilot', 'start the goal loop', or runs /autoship."
argument-hint: "[api] [app] [web] [--env <name>] [--max-turns <n>] [plan paths]"
user-invocable: true
---

# Autoship

Take the plans all the way to done while the user is away: PRs reviewed, CI green,
merged, and verified.

There is one stop: the question round, then the goal approval dialog. After that, work
alone. The goal approval is the sign-off for every commit, push and merge in this flow.
It overrides a CLAUDE.md rule to pause for review before committing, and every sign-off
or review pause written in the plans or in the skills they name: do their commit steps
without waiting. For each `review-pr` triage, take the recommended triage without
waiting.

Read `goal.md` in this folder before step 5.

## 1. Find the plans

From `$ARGUMENTS`, take the plan paths, the part flags (`api`, `app`, `web`), `--env`
and `--max-turns` (default 50). All are optional.

- Plan paths given: use them.
- None given: take the files in `docs/superpowers/plans/` that still have unticked
  `- [ ]` steps and no merged `autoship/<plan-name>` PR. The question round confirms
  them.
- No plans found: note it as a preflight failure.

Read each plan. Guess the parts it touches:

- **API**: a backend or API server, deployed to an environment.
- **Web**: a web app, deployed to an environment.
- **App**: an Android app. An iOS app counts as no part: the question round asks for
  its end step.

Part flags replace the guess.

The base branch is the repo's default branch:
`gh repo view --json defaultBranchRef --jq .defaultBranchRef.name`.

## 2. Preflight

Run every check before changing anything. If any fail, report all failures in one
message and stop. Set no goal. The user fixes them and runs `/autoship` again.

1. **Plans.** No plans found: ask for the plan paths.
2. **Needed skills.** `review-pr`, `handle-pr-comments` and `post-review-comments`
   must be in your available skills; `verify-deploy` too when API or Web is in the run,
   or when no plans were found. Check by name, not by file path. If one is missing, tell
   the user to run `/skills:install`, pick the missing skills, then run
   `/reload-plugins` or start a new session. If `/skills:install` is not available
   either, first give them:
   ```
   /plugin marketplace add DiegoHeer/claude-mods
   /plugin install skills@claude-mods
   ```
   Do not install anything yourself.
3. **GitHub CLI.** `gh auth status` must pass. Otherwise ask the user to run
   `! gh auth login`.
4. **CI.** The repo has CI that runs on PRs (`.github/workflows/` with a
   `pull_request` trigger). None: it goes into the question round.
5. **API and Web.** Find the staging environment name and URL in the repo (deploy
   workflows, Helm values, env files). `--env` overrides it. Not found: it goes into the
   question round. Find which CLIs the deploy uses (`kubectl`, `argocd`, `aws`,
   `gcloud`, ...) and test each login with a cheap read-only command. Not logged in:
   ask the user to run the login with `!`.
6. **App.** Find the Android build command (`./gradlew`, `flutter`, `expo` or `eas`)
   and check that its tools are on this machine: the command itself, `java`, and the
   Android SDK (`ANDROID_HOME` or `ANDROID_SDK_ROOT`). Missing: give the install
   command. Do not install it.

Then say once: the loop runs unattended only in auto mode. A goal does not change the
permission mode.

## 3. Ask once

Make one `AskUserQuestion` call, with up to 4 questions. Nothing starts before the
answers.

- Always: confirm the parts guess (`multiSelect: true`, one option each for API, App and
  Web, with the plans that made you guess it).
- No plan paths were given: confirm the plans and their order.
- API or Web in the run: confirm the staging environment, and that it is a test
  environment.
- App in the run: debug or release APK.
- No CI found: merge without CI, or stop.
- No part matched (for example, a docs-only plan): ask what the end step is and how you
  prove it.
- Anything else you are not sure of goes in this same call.

## 4. Check the answers

If an answer opens a new question, ask it now, in one more `AskUserQuestion` call.
Do not start with an open question.

## 5. Set the goal

Fill the condition template from `goal.md`. Show it. Then call `SetGoal` with the
condition and `ask_user: true`. The user's approval starts the loop. If they decline,
stop.

## 6. The loop

One PR per plan, unless the plan itself splits the work into PRs. For each PR, in plan
order:

1. `git fetch`, then create the branch `autoship/<plan-name>` (add `-2`, `-3` for a
   split plan) from `origin/<base>`.
2. Implement the plan. Commit, `git push -u`, `gh pr create`.
3. Run `review-pr <N>`. When it shows the triage, approve the recommended triage
   yourself and go on.
4. Wait for CI with a background command: `gh pr checks <N> --watch`. "No checks
   reported" right after a push: wait one minute and try once more.
5. CI fails on lint, format or a simple type error: fix it, push, wait again. Any other
   failure: follow "When stuck".
6. Merge: `gh pr merge <N> --merge --delete-branch`.
7. Print the status block from `goal.md`.

## 7. End steps

Do these once all PRs for that part are merged.

- **API** and **Web**: wait until the last merge is live on staging. If one deploy
  covers all merges of the part, run `verify-deploy --deploy --env <staging env>` once.
  Otherwise run `verify-deploy <N> --env <staging env>` for each PR of the part. When
  API and Web share one staging deploy, run it once for both. When it shows its
  proposal, approve it yourself:
  - Its target is a test environment, or the user said so in the question round:
    approve every check, also the ones marked `[changes data]`.
  - Its target is production: keep the data-changing checks on the manual list.
  - It needs a login or a URL you do not have: move that check to the manual list. Do
    not wait for an answer.

  `VERIFIED` and `PARTLY VERIFIED` count as done. `FAILED`, or not live after its wait:
  follow "When stuck".
- **App**: build the APK at the last merge commit, debug or release as the user chose.
  Post its path. Write a phone checklist: one line per behavior from the App PRs, with
  the steps and the expected result.

## 8. When stuck

Stuck means:

- a CI failure that is not lint, format or a simple type error
- a merge conflict, or a merge that branch protection refuses
- a review finding you cannot fix inside the PR, or `review-pr` stops with an error
- `verify-deploy` `FAILED`, or the merge is not live after its wait
- a fact only the user has

Then:

1. Call `PauseGoal` with the reason.
2. Send a `PushNotification` with one line: what blocks the loop.
3. Write in the chat what you need from the user, in one short message.

Do not use `AskUserQuestion` after the goal is set. An answer given through a question
tool does not resume the goal; a chat message does.

## 9. After a summary

If the conversation was summarized, call `GetGoal` and read `goal.md` again. Rebuild the
status per plan with `gh pr list --state all --head autoship/<plan-name> --json
number,state`. Go on from the first plan whose PR is not merged.

## 10. Finish

1. Send a `PushNotification` with one line: `autoship done`.
2. Post the final report from `goal.md`. It ends with a short checklist for the user:
   the main and critical items of the work, so they can verify it in a few minutes.

At turn `<max-turns>` minus 1, if not done: post the final report with what is still
open, and send a `PushNotification` that the turn limit is near.

## Rules

- Never run data-changing checks on production.
- Merge with merge commits only.
- Print the status block at the end of every turn. The goal checker sees only the chat.
  A turn is each time you end your reply; count them from the `SetGoal` call.
- Refer to other skills by name only, never by file path.
