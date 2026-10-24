---
name: verify-deploy
description: After a PR is merged and deployed, check that the change really works on the deployed environment and broke nothing near it. Proposes behavior checks, runs the ones Claude can after approval, and reports a verdict with a checklist. Use when the user says "verify the deploy", "check if PR 123 works", "is it working on staging", or runs /verify-deploy.
argument-hint: "[PR number] [--deploy] [--env <name>]"
---

# Verify Deploy

Check that a merged PR works where it was deployed: the change does what it should, and
nothing near it broke. Be direct. Every check proves behavior. No padding checks such as
"the page loads" or a bare "returns 200".

Do not fix failures. Propose next steps and stop.

## 1. Pick the scope

First check `gh auth status`. If `gh` is not logged in, ask the user to run
`! gh auth login`.

From the repo, decide the project kind: API server, web, mobile, or a mix. A mix uses
more than one guide.

Then, from `$ARGUMENTS`:

- A PR number: use it.
- No number: the last merged PR by the user. `gh pr list` sorts by creation date, so
  sort by merge date:
  `gh pr list --state merged --author @me --limit 20 --json number,title,mergedAt --jq 'sort_by(.mergedAt) | last'`.
  Show it and ask "this one?". If it returns nothing, stop and ask for a PR number.
- `--deploy`: every PR in one deploy. The target is `--env`, else the first environment
  in promotion order. The range is the previous deployed commit there up to the commit
  live there now ("Previous deployed commit" in `deploy-status.md`). Not for mobile
  repos: say "`--deploy` does not apply to mobile apps, they have no deploy" and offer a
  single-PR run.
- `--env <name>`: the target environment.

Read each PR: `gh pr view <n> --json title,body,mergeCommit,closingIssuesReferences`,
the linked issues, and `gh pr diff <n>`.

## 2. Make sure it is live

Read `deploy-status.md`. Find the environments and the target, decide if the target is
production, and check that the merge commit is live there.

- Not live, still deploying, or the deploy failed: stop. Say what is missing. The user
  re-runs later. Make no checks.
- With `--env`: if the merge is not live on that environment yet, that is "not live",
  even when it is live on another one.
- Not sure the target is a test environment: treat it as production. The proposal asks.
- Mobile: skip the live check; you build the app yourself after approval (`mobile.md`).
  Still decide if the backend the app will talk to is production, the same way.

## 3. Make the checks

Use the PR title, body, linked issue and diff. Write each check as a behavior with an
expected result.

- **Feature**: the new behavior works as the PR says. Add one edge case when the diff
  shows one.
- **Bug fix**: the bug is gone. Use the repro from the issue when there is one.
- **Side effects**: one or two checks on behavior next to the change, picked from the
  diff (callers of a changed function, other endpoints on a changed route, a screen that
  shares a changed component). A check for new errors in the logs counts as one of these.

Depth follows the diff. A config, copy or default-value change gets one light check and
no side-effect checks. A UI, API or data change gets the full set. Keep the list short.

With `--deploy`, make the checks per PR and keep them grouped by PR.

## 4. Find the tools

For each check, use the first that fits:

1. A test setup in the repo that covers it (Bruno, Postman, Playwright, Cypress, Maestro).
2. An installed skill that wraps the tool you need.
3. An MCP server in this session (for example a browser tool for web checks).
4. A CLI on this machine (`curl`, `kubectl`, `argocd`, `aws`, `gcloud`, `adb`, ...).

Details per area: API → `api.md`, web → `web.md`, mobile → `mobile.md`.

- Test each login with a cheap read-only command (`gcloud auth list`,
  `aws sts get-caller-identity`, `kubectl auth can-i get pods`, `gh auth status`).
  Not logged in: ask the user to run the login with `!`, for example
  `! gcloud auth login`. Then go on. If the user does not log in, the checks that need
  it go to the manual list.
- Missing tool: give the install command. Do not install it. The check goes to the
  manual list unless the user installs it.
- URLs, environment names, collection environments: find them in the repo. Ask when not
  found.

## 5. Propose

Show one list and wait for approval. Nothing runs before the user approves.

```
Target: <env> (<test environment | production | unclear, treated as production>) — PR #<n> <title>

1. <behavior> — via <test/skill/MCP/CLI> — needs: <login/install/nothing> [changes data]
2. ...

Manual (for you to do):
- <behavior> — why
```

- Unclear target: below the list, ask "Is <env> a test environment?" A yes moves the
  write checks back from the manual list; show the updated list for approval.
- Mobile target line: `Target: <emulator/simulator> at <merge-sha>, backend <env or default> (<test environment | production | unclear, treated as production>)`.
  List the build and device start as step 0; they run only after approval.
- `--deploy`: the header lists every PR; the checks sit under a `PR #<n>` heading each.
- Mark every check that writes data with `[changes data]`.
- Production: only read-only checks. Write checks go to the manual list.
- Checks that need a real device, a person's judgment, or access you cannot get go to
  the manual list from the start.

The user approves all, some, or none.

## 6. Run and report

Run the approved checks. Clean up test data you made. Then report:

```
<VERDICT> — PR #<n> on <env>

✅ <behavior> — <proof>
❌ <behavior> — saw <x>, expected <y>. Next: <1-2 causes or next steps>
⚠️ <behavior> — <manual | not run: why>. Steps: <exact steps>

Test data left: <none | what and where>
```

Verdict:

- `VERIFIED`: all checks passed, none left manual.
- `PARTLY VERIFIED`: none failed, some are manual or could not run.
- `FAILED`: one or more failed.

Proof is short: a status code with the key field, a screenshot path, a log line, a test
output line.

## Secrets

- Never show tokens, cookies, passwords or `Authorization` headers in the proposal or the
  report; replace them with `***`.
- Do not print env files or secrets (`cat` of a Bruno or `.env` file, `kubectl get secret`).
  Read only the keys you need, such as the base URL.
- Pass tokens to commands through an environment variable, not as literal text.
