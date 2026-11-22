# Goal, status block and final report

## Why the condition looks like this

- The goal checker only reads the chat. It runs no commands and opens no files. So the
  condition asks for proof that Claude prints: the status block, verdicts, the APK path.
- One end state, with the check named in it. A vague condition loops for a long time.
- A turn limit, so a stuck loop ends.
- The condition is at most 4,000 characters. The steps stay in `SKILL.md`, not in the
  condition.

## Condition template

Fill it per run. Drop the API, Web or App line when that part is not in the run.

```
Every PR for the plans <plan files> is merged into <base> with green CI, shown in the latest autoship status block.
API: verify-deploy reported VERIFIED or PARTLY VERIFIED on <staging env> for all API PRs.
Web: verify-deploy reported VERIFIED or PARTLY VERIFIED on <staging env> for all Web PRs.
App: a <debug|release> APK was built at the last merge commit, its path is shown, and a phone checklist is posted.
The autoship final report is posted, with the user's checklist of main and critical items.
Constraints: no data-changing checks on production; merges use merge commits.
Or stop after <max-turns> turns.
```

When the question round set a different end step (for example, for a docs-only plan),
replace the API, Web and App lines with one line that names that end step and its proof.

## Status block

Print it after every PR step and at the end of every turn. Drop lines for parts not in
the run.

```
autoship status — turn <n>/<max>
PR #<n> <title> — <open | in review | CI running | CI green | merged>
API verify: <pending | VERIFIED | PARTLY VERIFIED | FAILED> on <env>
Web verify: <pending | VERIFIED | PARTLY VERIFIED | FAILED> on <env>
APK: <pending | path>
Next: <one line>
```

## Final report

```
autoship done — <k> PRs merged
PR #<n> <title> — merged <sha7>
API: <verdict> on <env> (<count> manual)
Web: <verdict> on <env> (<count> manual)
APK: <path>
Phone checklist:
- [ ] <behavior> — steps: <...> — expect: <...>

Your checklist (main and critical items):
- [ ] <part>: <behavior> — how: <one line> — expect: <result>
```

List the manual items from `verify-deploy` under their part, with their steps.

The user's checklist is short: 3 to 7 items over the whole run. Pick the main
behavior of each plan and anything critical: data changes, auth, payments, migrations,
and every `verify-deploy` manual item or failed check. Each item is something the user
can do in a few minutes. Do not repeat checks that already passed with proof, unless
the item is critical.
