# Goal line, status block and final report

## Goal line

One line, so it can be copied and sent as one message. The goal checker reads only the
chat and runs nothing, so the line names visible proof: the final report. Keep it short;
the steps live in `rules.md`, which the line names, so they survive a summary.

Fill it per run. Drop the parts that are not in the run.

```
/goal Follow <run>/rules.md. Done when the autoship final report is posted and shows: every PR for <plan names> merged<, with green CI| (no CI, as agreed)>; <API:> verify-deploy VERIFIED or PARTLY VERIFIED on <staging>; <App:> the <debug|release> APK path and a phone checklist; the user's checklist of main items. No data-changing checks on production; merges use merge commits. Or stop after <max-turns> turns.
```

For a plan with another end step (agreed in the questions), name that end step and its
proof instead of the API and App parts.

## Status block

End every reply with it. Drop lines for parts not in the run.

```
autoship status — turn <n>/<max>
PR #<n> <repo> <title> — <open | in review | CI running | CI green | merged>
API verify: <pending | VERIFIED | PARTLY VERIFIED | FAILED> on <env>
Web verify: <pending | VERIFIED | PARTLY VERIFIED | FAILED> on <env>
APK: <pending | path>
Next: <one line>
```

## Final report

```
autoship done — <k> PRs merged
PR #<n> <repo> <title> — merged <sha7>
API: <verdict> on <env> (<count> manual)
Web: <verdict> on <env> (<count> manual)
APK: <path>
Phone checklist:
- [ ] <behavior> — steps: <...> — expect: <...>

Your checklist (main and critical items):
- [ ] <part>: <behavior> — how: <one line> — expect: <result>
```

List the manual items from `verify-deploy` under their part, with their steps.

Your checklist is short: 3 to 7 items over the whole run. Pick the main behavior of each
plan and anything critical: data changes, auth, payments, migrations, and every
`verify-deploy` manual item or failed check. Each item takes the user a few minutes. Do
not repeat checks that already passed with proof, unless the item is critical.
