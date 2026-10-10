# check-docs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/check-docs` pane that shows, as tabs, every `.md` file Write/Edit touched in the current conversation, and draws the selected one as live markdown.

**Architecture:** The tab list is rebuilt from the conversation's own history (`$.session.messages()`, plus each subagent's via `$.session.messages({ agentId })`) whenever the pane opens or something may have changed. That one rebuild covers resume, fork, `/clear` and switching conversations with no saved data. A debounced refresh runs after Write/Edit/Bash calls and on `classic.SessionStart`. The pane draws a tab row of Buttons and a `Markdown` element with the file read from disk.

**Tech Stack:** Claude Code mod API (plain JS hooks module, like `review-diff/`), tests via `claude-code/testing` run by `claude plugin test`.

**Spec:** `docs/superpowers/specs/2026-10-10-check-docs-design.md`

## Global Constraints

- Mod folder `check-docs/`; plugin name, command name and pane id are all `check-docs`; pane title `Check docs`.
- Follow `review-diff/` conventions: plain `.js` modules under `hooks/`, `hooks/hooks.json` → `["./register.js"]`, `tsconfig.json` extending `./.claude-plugin/types/tsconfig.json`, `author: { "name": "Diego Heer" }`, version `1.0.0`.
- A file counts when its path ends in `.md` (case-insensitive) and a `Write` or `Edit` call on it did not error, in the main loop or a subagent.
- Order: newest first, by the latest successful write/edit of that file.
- Keys: `n` next tab, `p` previous tab, both wrap. Hint text exactly `n next · p previous`.
- The selection never moves when a new file appears. With no valid selection, the newest tab is selected.
- Pane opens only from `/check-docs`; running it while open closes it.
- Every UI test loops over `['terminal', 'desktop'] as const`.
- `claude plugin validate ./check-docs` and `claude plugin test ./check-docs` pass at the end of each task.
- Do not commit until Diego has reviewed the whole change (his workflow). The commit steps name the atomic Conventional Commits to make after sign-off, in order.

## Review Focus

1. A file over the `Markdown` limit (100 000 chars) or over `fs.read`'s 4 MiB limit: the reader shows the first 100 000 chars plus the line `_File cut at 100 000 characters._`, or `This file could not be read.` — never a crash or a refused tree. (Task 2)
2. A file deleted after it was written: its tab stays and the reader shows `This file was deleted.` (Task 2)
3. Two files with the same basename: labels show `parent/name.md`, so tabs are told apart. (Task 1)
4. A subagent whose history the engine refuses (`{ deny }`): its writes are skipped; the main list still shows. (Task 1)
5. The same file written many times: one tab, placed by its latest write. (Task 1)

---

### Task 1: The doc list model

**Files:**
- Create: `check-docs/.claude-plugin/plugin.json`, `check-docs/hooks/hooks.json`, `check-docs/tsconfig.json`, `check-docs/types/index.d.ts`
- Create: `check-docs/hooks/register.js` (only `export function register(on) {}` for now)
- Create: `check-docs/hooks/docs.js`
- Test: `check-docs/hooks/docs.test.ts`

**Interfaces:**
- Produces, in `docs.js`:
  - `docPathsFromRows(rows: SessionMessage[], agentRowsOf: (agentId: string) => SessionMessage[]): string[]` — pure; absolute paths, newest first, no duplicates. Walk `rows` in order; for each `toolUses` entry: a successful `Write`/`Edit` (`!use.isError`) on a `.md` `input.file_path` counts at that position; an `Agent` use that names a spawned agent id splices in `agentRowsOf(id)`'s paths at that position (recursive). The latest position of a path wins. (Check `ToolUseSummary` in the typings for the field naming the spawned agent's id.)
  - `collectDocPaths($): Promise<string[]>` — calls `$.session.messages()` and, per agent, `$.session.messages({ agentId })`; a non-array answer counts as no rows. Then `docPathsFromRows`.
  - `tabLabels(paths: string[]): Map<string, string>` — basename, or `parent/basename` when two paths share a basename.
  - `stepPath(paths: string[], current: string | null, step: 1 | -1): string | null` — next/previous with wrap; `null` for an empty list; from a `current` not in the list, returns `paths[0]`.
- Produces, in `types/index.d.ts`: `PluginState['check-docs'] = { selected: string | null }`.

- [ ] **Step 1: Write the manifest files** per Global Constraints; description `A /check-docs pane with the markdown files written in this conversation, as tabs`.

- [ ] **Step 2: Write the failing tests in `docs.test.ts`**

Use small row builders: `write(path, isError?)`, `edit(path)`, `agent(id)` returning `SessionMessage`s.

- `orders newest first and keeps one tab per file`: rows write `/r/a.md`, write `/r/b.md`, edit `/r/a.md` → `['/r/a.md', '/r/b.md']`.
- `skips non-markdown files and failed calls`: write `/r/x.ts`, write `/r/c.md` with `isError`, write `/r/D.MD` → `['/r/D.MD']`.
- `merges subagent writes at the point the agent ran`: write `/r/a.md`, agent `s1` (writes `/r/spec.md`), write `/r/b.md` → `['/r/b.md', '/r/spec.md', '/r/a.md']`.
- `skips a subagent whose history is refused`: `collectDocPaths` with a `session.messages` stub answering `{ deny: 'no' }` for `agentId: 's1'` → only the main paths.
- `labels by basename, with the folder when names clash`: `['/r/specs/plan.md', '/r/plans/plan.md', '/r/notes.md']` → `specs/plan.md`, `plans/plan.md`, `notes.md`.
- `steps with wrap`: `stepPath(['a','b','c'], 'c', 1) === 'a'`, `stepPath(['a','b','c'], 'a', -1) === 'c'`, `stepPath([], null, 1) === null`, `stepPath(['a'], 'gone', 1) === 'a'`.

- [ ] **Step 3: Run** `claude plugin test ./check-docs` — Expected: FAIL (functions not defined).

- [ ] **Step 4: Implement `docs.js`** with the four functions above.

- [ ] **Step 5: Run** `claude plugin validate ./check-docs && claude plugin test ./check-docs` — Expected: PASS.

- [ ] **Step 6: Commit** `feat(check-docs): build the doc list from the conversation's history`

### Task 2: The pane and `/check-docs`

**Files:**
- Create: `check-docs/hooks/view.js`
- Modify: `check-docs/hooks/register.js`
- Test: `check-docs/hooks/check-docs.test.ts`

**Interfaces:**
- Consumes: `collectDocPaths`, `tabLabels`, `stepPath` from Task 1; atom `{ plugin: 'check-docs', key: 'selected' }`.
- Produces:
  - `drawPane({ Box, Text, Button, Markdown }, { paths, labels, selected, content, onSelect, onStep })` in `view.js`. `content` is `{ kind: 'text', text }`, `{ kind: 'deleted' }` or `{ kind: 'unreadable' }`.
  - `refresh($): Promise<void>` in `register.js` — reloads `paths` (module variable) and calls `$.ui.invalidate('ui.render')`. Task 3 calls it.
  - Element keys used by tests: tabs `tab-<path>`, buttons `next` (hotkey `n`) and `previous` (hotkey `p`), reader `reader`.

Behaviour:
- `session.start` registers command `check-docs` (description `Show this conversation's markdown files in a pane`).
- `command.run` `check-docs`: if `$.ui.panes()` lists `check-docs`, `$.ui.close`; else `refresh` then `$.ui.open({ id: 'check-docs', title: 'Check docs', focus: true, closeOnEscape: true })`.
- Render: tab row (`Box` row, `flexWrap: 'wrap'`); the selected tab is `variant: 'primary'`, others `dimColor`. Then the hint line (`next`/`previous` buttons, `plain`, giving `n next · p previous`). Then the full path, dim. Then the reader `Markdown`. The selected path is the atom's value if still in `paths`, else `paths[0]`. File text is read in the render via `$.fs.read`; a missing file (`$.fs.exists` false) → `This file was deleted.`; a read that rejects → `This file could not be read.`; text over 100 000 chars is cut as in Review Focus 1.
- With no paths: one line, `No markdown files written in this conversation yet.`
- `onSelect(path)` and `onStep(±1)` write the atom with `update` (never during render).

- [ ] **Step 1: Write the failing tests** (stub `command.register`, `ui.open`, `ui.close`, `ui.panes`, `session.messages`, `fs.read`, `fs.exists` like `review-diff.test.ts`'s `fakeGit`):
  - `opens with the newest file selected and drawn` (terminal, desktop): history writes `/r/a.md` then `/r/b.md`; `reader` text equals `/r/b.md`'s content; tabs `b.md`, `a.md` in that order.
  - `n and p move between tabs, wrapping`: press `next` → `a.md` shown; press `next` → `b.md`; press `previous` → `a.md`.
  - `pressing a tab selects it`.
  - `shows the hint`: finds text `n next · p previous`.
  - `running the command again closes the pane`: `ui.panes` lists `check-docs` → `ui.close` called with `{ id: 'check-docs' }`.
  - `says when nothing was written`: empty history → finds `No markdown files written in this conversation yet.`
  - `keeps a deleted file's tab`: `fs.exists` false → `This file was deleted.` and tab still there.
  - `cuts a huge file`: 150 000-char file → reader text length ≤ 100 000 + note, contains `_File cut at 100 000 characters._`.
  - `survives an unreadable file`: `fs.read` denies → `This file could not be read.`
- [ ] **Step 2: Run** `claude plugin test ./check-docs` — Expected: FAIL.
- [ ] **Step 3: Implement** `view.js` and the hooks in `register.js`.
- [ ] **Step 4: Run** validate + test — Expected: PASS.
- [ ] **Step 5: Commit** `feat(check-docs): open a pane with the conversation's markdown files as tabs`

### Task 3: Live refresh

**Files:**
- Modify: `check-docs/hooks/register.js`
- Test: `check-docs/hooks/check-docs.test.ts`

**Interfaces:**
- Consumes: `refresh($)` from Task 2.
- Produces: `refreshSoon($)` — debounced 300 ms with `$.clock.after`, as in review-diff.

Behaviour:
- `tool.call` on `['Write', 'Edit', 'Bash']`: `const result = await next(e)`; if the pane is up, `refreshSoon($)`; return `result`. (Bash only redraws; it never adds a tab, because tabs come from Write/Edit history.)
- `classic.SessionStart` (any `source`): if the pane is up, `refresh($)`; then `next(e)`. This covers `/clear` (empty list), resume and fork.
- `session.start` (hot reload or enable): also `refresh($)` when the pane is up.
- "Pane is up" = `(await $.ui.panes()).some(p => p.id === 'check-docs')`.

- [ ] **Step 1: Write the failing tests** (`mock.clock(on)`; the `session.messages` stub reads a mutable rows array):
  - `a new file gets a tab without moving the selection`: open on `/r/a.md`; push a write of `/r/new.md`; `$.tool.call({ tool: 'Write', file_path: '/r/new.md', content: '# New' })`; `clock.advance(300)` → tab `new.md` first, reader still shows `a.md`'s content.
  - `an edit redraws the selected file`: change the `fs.read` answer; `$.tool.call` Edit; advance → reader shows new text.
  - `a shell command redraws without adding a tab`: Bash call + changed file text → new text shown, tab count unchanged.
  - `/clear empties the tabs`: rows set to `[]`; `$.classic.SessionStart({ source: 'clear' })` → empty-state text.
  - `resume shows that conversation's tabs`: rows replaced; `$.classic.SessionStart({ source: 'resume' })` → the new tabs, newest selected.
- [ ] **Step 2: Run** `claude plugin test ./check-docs` — Expected: FAIL.
- [ ] **Step 3: Implement** the hooks and `refreshSoon`.
- [ ] **Step 4: Run** validate + test — Expected: PASS.
- [ ] **Step 5: Commit** `feat(check-docs): refresh the pane as Claude writes and when the conversation changes`

### Task 4: Publish in the marketplace

**Files:**
- Modify: `.claude-plugin/marketplace.json` — add `{ "name": "check-docs", "source": "./check-docs", "description": "A /check-docs pane with this conversation's markdown files, as tabs" }`.
- Modify: `README.md` — install line `/plugin install check-docs@claude-mods`; a `### check-docs` section under Mods (what it shows, which files count, `n`/`p`, refresh behaviour, tabs follow the conversation); `check-docs` lines in Develop.

- [ ] **Step 1: Edit both files.**
- [ ] **Step 2: Run** `claude plugin validate .` — Expected: marketplace valid, both plugins listed.
- [ ] **Step 3: Commit** `docs(check-docs): list check-docs in the marketplace and README`

Before those commits: `docs: add check-docs design and plan` (the spec and this plan).
