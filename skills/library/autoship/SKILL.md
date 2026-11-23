---
name: autoship
description: "Set up an autopilot run for the plans: work out the details from the plans and the chat, ask only what is still open, write a run folder, and hand over one /goal line that takes each plan through PR, review-pr, green CI and merge, then verify-deploy on staging for API and Web work and an APK with a phone checklist for App work. Use when someone says 'autoship', 'ship the plans', 'run the plans on autopilot', 'start the goal loop', or runs /autoship."
argument-hint: "[api] [app] [web] [--env <name>] [--max-turns <n>] [plan paths]"
user-invocable: true
---

# Autoship

Set up the run, then hand over one `/goal` line. The user sends that line, and the loop
runs from `loop.md` until the work is merged and verified.

Start with this one line to the user: "I work out the details, ask only what I can't
find, then give you one `/goal` line. Send it, and you can leave."

Follow the "Shell rules" in `loop.md` (this folder) for every command, here too.

## 1. Work out the details

Find each value in this order: `$ARGUMENTS`, then the chat, then the plans, then the
repo. Only what is still open after that goes to step 3.

- **Plans.** Paths in `$ARGUMENTS`. Else the plan files written or named in this
  conversation. Else none: ask for the paths in step 3. Never pick plans by unticked
  `- [ ]` boxes: nobody ticks them.
- **Parts.** Per plan: API (a backend, deployed), Web (a web app, deployed), App (an
  Android app). An iOS app, or anything else, is no part: ask for its end step. Flags
  `api`, `app`, `web` replace the guess.
- **Repos.** The repo each plan changes, as an absolute path. A plan can name another
  repo, and so can the chat. Each repo gets its own base branch and branch style.
- **GitHub name** per repo (`owner/name`): `git -C <repo> remote get-url origin`.
- **Base branch** per repo:
  `gh repo view <owner/name> --json defaultBranchRef --jq .defaultBranchRef.name`.
- **Branch style** per repo: copy it from
  `gh pr list -R <owner/name> --state merged --limit 10 --json headRefName`. No clear
  style: `<type>/<plan-name>`.
- **Staging** for API and Web: `--env`, the chat, the plans, then the repo's deploy
  workflows, Helm values and env files.
- **Test environment:** staging counts as one when the chat or the plans say so, or when
  its whole name is `staging`, `stg`, `test`, `tst`, `dev` or `acc`. Anything else: ask.
  This decides whether data-changing checks run without asking.
- **APK type** for App: the chat or the plans. Not found: ask.
- **Turn limit:** `--max-turns`, else 50.

## 2. Check

Run every check. If any fail, report all failures in one message and stop. The user
fixes them and runs `/autoship` again.

1. **Skills.** `review-pr`, `handle-pr-comments` and `post-review-comments` are in your
   available skills; `verify-deploy` too when API or Web is in the run. Check by name.
   Missing: tell the user to run `/skills:install`, pick them, then run
   `/reload-plugins`. Do not install anything yourself.
2. **GitHub CLI.** `gh auth status` passes. Otherwise: `! gh auth login`.
3. **Clean tree**, per repo: `git -C <repo> status --porcelain --untracked-files=no` is
   empty. Otherwise ask the user to commit or stash first.
4. **CI**, per repo: `<repo>/.github/workflows/` has a workflow with a `pull_request`
   trigger. None: ask in step 3 whether to merge without CI.
5. **Logins** for API and Web: for each CLI the deploy uses (`kubectl`, `argocd`, `aws`,
   `gcloud`, ...), run a cheap read-only command. Not logged in: ask the user to run the
   login with `!`.
6. **App tools:** the build command (`./gradlew`, `flutter`, `expo` or `eas`), `java`,
   and `ANDROID_HOME` or `ANDROID_SDK_ROOT`. Missing: give the install command.

## 3. Ask what is still open

Nothing open: skip this step.

Otherwise make one `AskUserQuestion` call, up to 4 questions, most important first. If
more than 4 are open, ask the rest in one more call. Put your best guess first in each
question, marked "(Recommended)".

## 4. Write the run folder

Get the home path once with `echo $HOME`. The run folder is
`<home>/.claude/autoship/<YYYY-MM-DD>-<topic>/`. It sits outside every repo, so a
worktree session can write to it and no file in it gets committed.

Never overwrite a run folder. If the folder exists, read its `progress.json`:

- Same plans, not all `done`: this is a resume. Keep the folder, skip the writes below,
  and hand over its goal line again.
- Otherwise: add `-2` (or `-3`, ...) to the folder name.

1. Copy each plan file into `<run>/plans/` with the Write tool. Plans on a local branch
   vanish once the loop branches from `origin/<base>`; the copies stay.
2. Write `<run>/rules.md`: a table of every value from steps 1 and 3, then the full text
   of `loop.md`, then the "Status block" and "Final report" sections of `goal.md`, both
   from this folder.
3. Write `<run>/progress.json`:
   ```json
   {
     "turn": 0,
     "max_turns": 50,
     "plans": [
       {
         "file": "<run>/plans/orders-api.md",
         "repo": "/home/me/Projects/orders-api",
         "base": "main",
         "done": false,
         "prs": []
       }
     ],
     "verify": { "api": "pending", "web": "pending" },
     "apk": null
   }
   ```

## 5. Hand over

Show a short list of the values you worked out, each with where you found it. Then show
the goal line from `goal.md`, filled in, in a code block, on one line. End with:

"Check the values above. If one is wrong, tell me before you send the line. Otherwise
copy the line and send it as your next message. The loop starts then. Use auto mode, so
it does not stop at a permission prompt."

Stop here. Do not start the work before the user sends the line.
