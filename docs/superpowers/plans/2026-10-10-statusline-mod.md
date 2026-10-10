# statusline mod Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port Diego's cship statusline (`~/.claude/cship-responsive.sh`) into a mod in this marketplace that stays hidden until `/statusline-install` sets it up, and that `/statusline-uninstall` turns off.

**Architecture:** The mod ships the existing bash scripts and cship configs. It builds the classic statusline JSON from `$.session.*` data, pipes it into the bundled script with `$.process.run`, turns the ANSI output into colored `Text` spans, and draws them in the `PromptHint` site. `$.store` remembers `active`, `welcomed` and `installedCship` across sessions.

**Tech Stack:** Claude Code mod API (plain `.js` modules, `.ts` tests via `claude-code/testing`), bash, cship, starship, jq.

**Spec:** No separate spec doc. The design decisions are in the "Decisions" section below, taken from the 2026-10-09/10 conversation.

## Decisions (the spec)

- Option 1: keep cship. The mod runs the bundled scripts; it does not re-implement cship.
- Before `/statusline-install` has run on this machine the mod draws nothing and shows no messages, except one toast on the first interactive session after the plugin is installed: `statusline: run /statusline-install to turn it on`.
- `/statusline-install` walks through the dependencies one at a time:
  - `cship`: download the release binary directly (never the cship installer: it writes `statusLine` into `~/.claude/settings.json` with no opt-out). Ask before downloading.
  - `starship`: run the starship installer into `~/.local/bin` (no sudo). Ask before installing.
  - `jq` and `secret-tool` (Linux only): need `sudo`, so the mod cannot install them. The command stops, lists the exact `! sudo …` command for this machine's package manager, and the person runs `/statusline-install` again. Every step skips what is already there.
  - When every dependency is present, the statusline turns on and stays on in every later session.
- `/statusline-uninstall` turns it off; if the mod downloaded cship, it offers to delete that binary too.
- Never two statuslines. The mod reads the merged settings with `$.settings.read()`:
  - `/statusline-install` stops first when any source has a `statusLine` key and names where it is; the mod never writes settings files.
  - At run time, while any source has `statusLine`, the mod draws nothing and runs nothing, silently; it re-checks on `classic.ConfigChange` and comes back when the key is gone.
- `$.ui.status` is not used: a live test showed it prints ANSI escapes as junk. `PromptHint` rendered colored `Text` correctly (verified on screen 2026-10-10).

## Global Constraints

- Mod folder: `statusline/` at the repo root, next to `branch-diff/`. Plugin name `statusline`, version `0.1.0`, author `{ "name": "Diego Heer" }`.
- Commands: `statusline-install`, `statusline-uninstall`.
- `$.store` keys: `active` (boolean), `welcomed` (boolean), `installedCship` (boolean).
- Refresh interval: 30 000 ms (matches the current `refreshInterval: 30`).
- Layout threshold: below 90 columns → compact config (unchanged from `cship-responsive.sh`).
- cship release URL: `https://github.com/stephenleo/cship/releases/latest/download/cship-<target>`, targets `x86_64-unknown-linux-musl`, `aarch64-unknown-linux-musl`, `x86_64-apple-darwin`, `aarch64-apple-darwin`.
- Install dir for cship and starship: `$HOME/.local/bin`.
- Match `branch-diff` style: ES modules in `.js`, tests in `.ts`, `tsconfig.json` extending `./.claude-plugin/types/tsconfig.json`.
- Per Diego's CLAUDE.md, build every task first, then pause for his review; make the per-task commits below only after his sign-off.
- Conventional Commits, one logical change per commit; end each commit with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. cship breaks after activation (binary deleted, config error, non-zero exit) → the last good line stays; no toast or log spam on every refresh (one `$.ui.log(…, { to: 'debug' })` per failure is fine). Test in Task 4.
2. Usage figures absent before the first response (`percent`, `tokens`, `cost` undefined, `rateLimits` empty) → the JSON carries `null`/omits the window and the script still runs. Test in Task 3.
3. A session.measure, a timer tick and a resize arrive together → at most one script run in flight; one more run after it when anything asked meanwhile. Test in Task 4.
4. Terminal resize across the 90-column line → exactly one re-run with the new `COLUMNS`; a render at the same width never triggers a run (no render↔refresh loop). Test in Task 4.
5. The person dismisses a dialog or picks Cancel mid-install → nothing downloaded after that point, `active` unchanged, the reply says so. Test in Task 5.

---

### Task 1: Mod scaffold with the bundled scripts and configs

**Files:**
- Create: `statusline/.claude-plugin/plugin.json`
- Create: `statusline/hooks/hooks.json` (`{ "description": "statusline hooks", "modules": ["./register.js"] }`)
- Create: `statusline/hooks/register.js` (empty `register` for now)
- Create: `statusline/tsconfig.json` (same as `branch-diff/tsconfig.json`)
- Create: `statusline/scripts/statusline.sh` from `~/.claude/cship-responsive.sh`
- Create: `statusline/scripts/cache-ttl.sh` copied from `~/.claude/cache-ttl.sh` unchanged
- Create: `statusline/config/cship-full.toml`, `statusline/config/cship-compact.toml` copied from `~/.config/` unchanged

**Interfaces:**
- Produces: `bash <root>/scripts/statusline.sh` reads statusline JSON on stdin, reads `COLUMNS` from the environment, prints one ANSI line. Paths resolve from the script's own dir: `HERE=$(cd "$(dirname "$0")" && pwd)`, configs at `$HERE/../config/`, cache script at `$HERE/cache-ttl.sh`.

- [ ] **Step 1:** Write the files. In `statusline.sh` the only changes from `cship-responsive.sh` are the three paths above.
- [ ] **Step 2:** Check the script against a real-shaped input:
  Run: `echo '{"cwd":"'$PWD'","model":{"id":"claude-opus-5-5","display_name":"Opus 5.5"},"workspace":{"current_dir":"'$PWD'"},"cost":{"total_cost_usd":0.42},"context_window":{"context_window_size":200000,"used_percentage":8}}' | COLUMNS=120 bash statusline/scripts/statusline.sh`
  Expected: one colored line with the folder, branch, `Opus 5.5`, `$0.42`, a context bar. With `COLUMNS=60`: no folder/branch.
- [ ] **Step 3:** Run `claude plugin validate ./statusline` → passes (author warning absent).
- [ ] **Step 4:** Commit: `feat(statusline): scaffold the mod with the bundled cship scripts and configs`

### Task 2: ANSI to text spans

**Files:**
- Create: `statusline/hooks/ansi.js`
- Test: `statusline/hooks/ansi.test.ts`

**Interfaces:**
- Produces: `parseAnsi(text: string): Span[][]` — one array of spans per output line (split on `\n`, trailing empty line dropped). `Span = { text: string, color?: string, backgroundColor?: string, bold?: true, dimColor?: true, italic?: true, underline?: true }`. Adjacent text with the same style is one span.

SGR codes handled: `0` reset; `1` bold; `2` dim; `3` italic; `4` underline; `22` bold+dim off; `23`; `24`; `39`/`49` default fg/bg; `30–37`/`40–47` → names `black red green yellow blue magenta cyan white`; `90–97`/`100–107` → xterm default hex (`#808080 #ff0000 #00ff00 #ffff00 #5c5cff #ff00ff #00ffff #ffffff`); `38;5;n`/`48;5;n` → xterm-256 hex; `38;2;r;g;b`/`48;2;r;g;b` → `#rrggbb` lowercase. Every other escape (non-SGR CSI, OSC up to BEL or `ESC \`) is dropped.

- [ ] **Step 1: Write the failing tests**
  - `truecolor bold`: `parseAnsi('\x1b[1;38;2;122;162;247mOpus\x1b[0m │ x')` → `[[{ text: 'Opus', color: '#7aa2f7', bold: true }, { text: ' │ x' }]]`
  - `256 color`: `'\x1b[38;5;196mred'` → `[[{ text: 'red', color: '#ff0000' }]]`
  - `basic and reset by 39`: `'\x1b[31ma\x1b[39mb'` → `[[{ text: 'a', color: 'red' }, { text: 'b' }]]`
  - `drops OSC and other CSI`: `'\x1b]8;;http://x\x07link\x1b]8;;\x07\x1b[2K!'` → `[[{ text: 'link!' }]]`
  - `two lines`: `'a\nb\n'` → `[[{ text: 'a' }], [{ text: 'b' }]]`
  - `real cship line`: feed the Task 1 Step 2 output (saved as a string constant) and assert the joined span text equals the line with escapes removed.
- [ ] **Step 2:** `claude plugin test ./statusline` → the new tests FAIL (`parseAnsi` not exported).
- [ ] **Step 3:** Implement `parseAnsi` in `statusline/hooks/ansi.js`.
- [ ] **Step 4:** `claude plugin test ./statusline` → PASS.
- [ ] **Step 5:** Commit: `feat(statusline): turn ANSI color codes into text spans`

### Task 3: Statusline JSON from session data

**Files:**
- Create: `statusline/hooks/payload.js`
- Test: `statusline/hooks/payload.test.ts`

**Interfaces:**
- Produces: `statusInput(facts: { sessionId: string, transcriptPath?: string, cwd: string, projectDir: string, model: string, usage: SessionUsage }): object` returning the classic statusline JSON (field names from https://code.claude.com/docs/en/statusline):
  `session_id`, `transcript_path`, `cwd`, `model: { id, display_name }`, `workspace: { current_dir, project_dir }`, `cost: { total_cost_usd }`, `context_window: { context_window_size, total_input_tokens, used_percentage, remaining_percentage }`, `rate_limits: { <kind>: { used_percentage, resets_at } }`.
- Produces: `displayName(model: string): string` — `claude-opus-5-5` → `Opus 5.5`, `claude-sonnet-5-5[1m]` → `Sonnet 5.5`; anything not shaped `claude-<family>-<major>-<minor>…` is returned as is.

Mapping: `usage.cost?.usd ?? 0`; `usage.context.window`; `usage.context.tokens ?? null`; `used_percentage = usage.context.percent ?? null`, `remaining_percentage = 100 - percent` or `null`; each `usage.rateLimits[i]` → key `kind`, `used_percentage = percentUsed`, `resets_at = Math.floor(Date.parse(resetsAt) / 1000)` (omit `resets_at` when `resetsAt` is absent); `rate_limits` omitted when the array is empty; `transcript_path` omitted when unknown.

- [ ] **Step 1: Write the failing tests**
  - `full figures`: usage `{ context: { window: 200000, tokens: 15500, percent: 8 }, rateLimits: [{ kind: 'five_hour', percentUsed: 23.5, resetsAt: '2025-02-01T16:00:00Z' }], cost: { usd: 0.01234 } }` → `context_window.used_percentage === 8`, `remaining_percentage === 92`, `rate_limits.five_hour` deep-equals `{ used_percentage: 23.5, resets_at: 1738425600 }`, `cost.total_cost_usd === 0.01234`.
  - `before the first response` (Review Focus 2): usage `{ context: { window: 200000 }, rateLimits: [] }` → `used_percentage === null`, `total_cost_usd === 0`, no `rate_limits` key.
  - `displayName`: the two examples above, plus `'Opus 5.5'` → `'Opus 5.5'`.
- [ ] **Step 2:** `claude plugin test ./statusline` → FAIL.
- [ ] **Step 3:** Implement both functions.
- [ ] **Step 4:** `claude plugin test ./statusline` → PASS.
- [ ] **Step 5:** Commit: `feat(statusline): build the statusline JSON from session usage`

### Task 4: Draw the line under the prompt once active

**Files:**
- Create: `statusline/hooks/line.js` — the refresh loop and the drawing
- Create: `statusline/hooks/settings.js` — `statusLineSources`
- Modify: `statusline/hooks/register.js` — wire the hooks
- Test: `statusline/hooks/line.test.ts`

**Interfaces:**
- Consumes: `parseAnsi` (Task 2), `statusInput` (Task 3), the script (Task 1).
- Produces (used by Task 5): `startLine($): void` (refresh now, then every 30 000 ms; no-op when already started), `stopLine($): Promise<void>` (cancel the timer, clear the drawn line), `isLineActive(): boolean`.

Behavior:
- `lineAtom = atom({ plugin: 'statusline', key: 'line' }, null)` holds `Span[][] | null`; `types/index.d.ts` declares it and `plugin.json` names `"types": "./types/index.d.ts"` (same pattern as branch-diff).
- `refresh($)`: if a run is in flight, mark `isDirty` and return; else run `['bash', `${$.plugin.root}/scripts/statusline.sh`]` with `{ stdin: JSON.stringify(statusInput(facts)), env: { COLUMNS: String(columns) }, cwd: await $.session.cwd() }`; exit 0 → `update($, lineAtom, () => parseAnsi(stdout))`; non-zero or reject → keep the last line, one `$.ui.log(…, { to: 'debug' })`. After the run, if `isDirty`, clear it and run once more.
- Facts: `sessionId = $.session.id()`, `model = $.session.model()`, `projectDir = $.session.root()`, `usage = $.session.usage()`; `transcriptPath` from the last `classic.SessionStart` input's `transcript_path` (it fires again after `/clear`).
- `columns` starts at 80. The `PromptHint` render hook reads `e.viewport.columns`; when it differs from the last run's `columns`, store it and call `refresh` (not awaited). Same width → no run.
- `ui.render` on `{ component: 'PromptHint' }`: not active or line `null` → `next(e)`. Else a `Box flexDirection="column"`, one `Text` per line holding one `Text` per span with the span's props.
- `session.measure` → `refresh` when active, then `next(e)`.
- In `register.js`, `session.start` reads `$.store.get('active') === true` and calls `startLine($)` when true.
- Other statusline guard: `hasOtherStatusLine = 'statusLine' in (await $.settings.read())`, read in `startLine` and again on every `classic.ConfigChange` (then `next(e)`). While true: the render hook returns `next(e)` and `refresh` returns without running. When it turns false, `refresh` once.
- Produces (used by Task 5): `statusLineSources($): Promise<string[]>` — for each `SettingsSource` (`user`, `project`, `local`, `flag`, `policy`) whose `$.settings.read({ source })` has `statusLine`, a place a person can find: `~/.claude/settings.json`, `<root>/.claude/settings.json`, `<root>/.claude/settings.local.json`, `the --settings flag`, `your organization's managed settings`. Put it in `statusline/hooks/settings.js`.

- [ ] **Step 1: Write the failing tests** (fake `process.run`, `session.*` and the store with `mock.store(on, { active: true })` / `mock.clock(on)`, as in `branch-diff/hooks/branch-diff.test.ts`; mount with `$.ui.mount({ plugin: 'statusline', surface: 'terminal', component: 'PromptHint', props: { isDraft: false, isWorking: false, hint: '? for shortcuts' } })`):
  - `inactive draws the engine's hint`: store `{}` → no `process.run` call; the mounted tree holds `'? for shortcuts'`.
  - `active draws cship's colors`: `process.run` answers `'\x1b[38;2;158;206;106m$0.42\x1b[0m'` → a `Text` with text `$0.42` and `color: '#9ece6a'`; the call's argv ends in `/scripts/statusline.sh` and its stdin parses to JSON with `session_id`.
  - `refreshes on measure and every 30s`: after `$.session.measure({...})` → 2 runs; `clock.advance(30000)` → 3 runs.
  - `keeps the last line when cship fails` (Review Focus 1): second run exits 1 → the first line is still drawn; no `ui.toast`.
  - `one run in flight` (Review Focus 3): hold the first run's answer; trigger measure twice → after release, exactly 2 runs total.
  - `re-runs once on resize` (Review Focus 4): mount at 120 columns then 120 again → 1 extra run; then 60 → its run has `env.COLUMNS === '60'`.
  - `hides while another statusline is set`: `settings.read` answers `{ statusLine: { type: 'command' } }` → no `process.run`, the mount shows the engine's hint, no toast. Then answer `{}` and raise `$.classic.ConfigChange({ source: 'user_settings' })` → one run and the cship line is drawn.
  - `statusLineSources`: `user` and `local` have the key → `['~/.claude/settings.json', '/repo/.claude/settings.local.json']`.
- [ ] **Step 2:** `claude plugin test ./statusline` → FAIL.
- [ ] **Step 3:** Implement `line.js`, the types file, and the wiring in `register.js`.
- [ ] **Step 4:** `claude plugin test ./statusline` and `claude plugin validate ./statusline` → PASS.
- [ ] **Step 5:** Commit: `feat(statusline): draw the cship line under the prompt once active`

### Task 5: /statusline-install and the welcome toast

**Files:**
- Create: `statusline/hooks/install.js`
- Modify: `statusline/hooks/register.js`
- Test: `statusline/hooks/install.test.ts`

**Interfaces:**
- Consumes: `startLine`, `isLineActive` (Task 4).
- Produces: `runInstall($): Promise<string>` — the command's reply text.

Behavior:
- `session.start`: register both commands (`statusline-install`: "Set up and turn on the cship statusline"; `statusline-uninstall`: "Turn off the cship statusline"). If `e.isInteractive`, `active` is not true and `welcomed` is not true → `$.ui.toast('statusline: run /statusline-install to turn it on')` and set `welcomed: true`.
- `has(tool)`: `$.process.run(['bash', '-c', 'PATH="$HOME/.local/bin:$PATH" command -v "$1"', '_', tool])` exit 0.
- Step 0, before any dialog: `statusLineSources($)` non-empty → reply `You already use a statusline (statusLine in <places joined with ", ">). Remove it there, then run /statusline-install again.` and stop.
- Steps in order, each skipped when `has` is true:
  1. `cship`: target from `uname -sm` (`Linux x86_64`, `Linux aarch64`, `Darwin x86_64`, `Darwin arm64`; anything else → reply `cship has no build for <uname>. Install it by hand: https://github.com/stephenleo/cship` and stop). Ask `Download cship to ~/.local/bin/cship?` with `['Download', 'Cancel']`. Run `['bash', '-c', 'mkdir -p "$HOME/.local/bin" && curl -fsSL -o "$HOME/.local/bin/cship" "$1" && chmod +x "$HOME/.local/bin/cship"', '_', url]` with `timeoutMs: 120000`; then set `installedCship: true`.
  2. `starship`: ask `Install starship to ~/.local/bin? (it draws the folder and git branch)` with `['Install', 'Cancel']`. Run `['bash', '-c', 'curl -fsSL https://starship.rs/install.sh | sh -s -- --yes --bin-dir "$HOME/.local/bin"']` with `timeoutMs: 300000`. Before writing this step, confirm both flags in the current https://starship.rs/install.sh.
  3. `jq` and (Linux only) `secret-tool`: collect the missing ones. Package manager = the first of `dnf`, `apt-get`, `pacman`, `brew` that `has`. Packages: `jq` → `jq`; `secret-tool` → `libsecret` (dnf, pacman, brew) or `libsecret-tools` (apt-get); `brew` takes no `sudo`. If any are missing, reply with `Run this, then /statusline-install again:\n! sudo dnf install jq libsecret` and stop (no package manager found → name the missing tools only).
- A failed download/install → reply with the step name and the first line of stderr; stop.
- Cancel or a dismissed dialog (`$.ui.ask` rejects) → reply `Install stopped. The statusline is still off.`; nothing after it runs.
- All present → `$.store.set('active', true)`, `startLine($)`. Reply `Statusline on.`
- Already active and all present → `Statusline is already on.`

- [ ] **Step 1:** Find how a test answers `$.ui.ask`: it is a `tool.call` of `AskUserQuestion` (see the `ui.ask` doc in the types). Write a `answerAsk(on, label)` helper in the test file that makes `$.ui.ask` resolve to `label`, and a variant that rejects, and check both with a one-line throwaway test.
- [ ] **Step 2: Write the failing tests**
  - `welcome once`: two `session.start`s with an empty store → exactly one toast with the exact text; `welcomed` is true. With `active: true` → no toast. `isInteractive: false` → no toast.
  - `downloads cship for this platform`: `uname -sm` → `Linux x86_64`; cship missing, others present; answer `Download` → a run whose last argv is `https://github.com/stephenleo/cship/releases/latest/download/cship-x86_64-unknown-linux-musl`; `installedCship` and `active` are true; reply starts with `Statusline on.`.
  - `lists the sudo command`: `dnf` present, `jq` and `secret-tool` missing → reply contains `! sudo dnf install jq libsecret`; `active` stays unset.
  - `apt names`: `apt-get` instead → reply contains `! sudo apt-get install jq libsecret-tools`.
  - `cancel stops everything` (Review Focus 5): answer `Cancel` at the cship step → no `curl` run; reply `Install stopped. The statusline is still off.`. Same with a dismissed dialog.
  - `stops on an existing statusline`: `settings.read({ source: 'user' })` has `statusLine` → reply is `You already use a statusline (statusLine in ~/.claude/settings.json). Remove it there, then run /statusline-install again.`; no `process.run`, no ask, `active` unset.
- [ ] **Step 3:** `claude plugin test ./statusline` → FAIL.
- [ ] **Step 4:** Implement.
- [ ] **Step 5:** `claude plugin test ./statusline` and `claude plugin validate ./statusline` → PASS.
- [ ] **Step 6:** Commit: `feat(statusline): add /statusline-install with a one-time welcome toast`

### Task 6: /statusline-uninstall

**Files:**
- Modify: `statusline/hooks/install.js` (add `runUninstall($): Promise<string>`)
- Modify: `statusline/hooks/register.js`
- Test: `statusline/hooks/install.test.ts`

Behavior:
- Not active → `Statusline is already off.`
- Ask `Turn off the statusline?` with `['Turn off', 'Cancel']`, or `['Turn off', 'Turn off and delete cship', 'Cancel']` when `installedCship` is true.
- `Turn off` → `active: false`, `stopLine($)`, reply `Statusline off. Run /statusline-install to turn it back on.`
- `Turn off and delete cship` → also `['rm', '-f', `${HOME}/.local/bin/cship`]` and delete `installedCship`.
- Cancel or dismissed → `Nothing changed.`

- [ ] **Step 1: Write the failing tests:** `already off`; `turn off clears the line` (after it the PromptHint mount shows the engine's hint again and `active === false`); `delete only what we installed` (no delete option without `installedCship`; with it, an `rm -f …/.local/bin/cship` run); `cancel changes nothing`.
- [ ] **Step 2:** `claude plugin test ./statusline` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `claude plugin test ./statusline` → PASS.
- [ ] **Step 5:** Commit: `feat(statusline): add /statusline-uninstall`

### Task 7: Marketplace entry, README, live check

**Files:**
- Modify: `.claude-plugin/marketplace.json` (add `{ "name": "statusline", "source": "./statusline", "description": "A cship statusline under the prompt, set up with /statusline-install" }`)
- Modify: `README.md` (install line `/plugin install statusline@claude-mods`; a `### statusline` section: what it shows, `/statusline-install`, `/statusline-uninstall`, the dependencies, "remove `statusLine` from `~/.claude/settings.json`"; add `statusline` to the Develop commands)

- [ ] **Step 1:** Write both changes.
- [ ] **Step 2:** Live check with `claude --plugin-dir ./statusline`. While the old `statusLine` setting still exists: one toast on first start; no mod line; `/statusline-install` names `~/.claude/settings.json` and stops. Then (Diego removes the key) `/statusline-install` turns it on; the colors and layout match the old line; resize under 90 columns switches to compact; `/statusline-uninstall` removes it. Confirm `$.session.model()` gives the name the old line showed (`Opus 5.5`).
- [ ] **Step 3:** Commit: `docs(statusline): add the mod to the marketplace and README`
