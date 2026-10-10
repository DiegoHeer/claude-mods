# check-docs — design

A Claude Code mod that shows the markdown files written in this session in a side pane,
so specs and plans can be read without opening another editor.

## Why

Claude Code sessions write specs and plans (for example under `docs/superpowers/specs/`
and `docs/superpowers/plans/`). Today, reading them means opening an editor next to the
terminal. The mod puts them in a pane inside the session, formatted and kept current.

## What it does

- `/check-docs` opens the pane. Running it again while the pane is open closes it.
  The pane never opens by itself.
- The pane holds one tab per `.md` file written or edited in this session.
  Newest tab is on the left. "Newest" means the most recent write or edit to that file.
- The selected tab's file fills the rest of the pane, drawn as formatted markdown
  (the engine's `Markdown` element). Long files scroll.
- When Claude changes a file, the pane redraws it. If the changed file is the selected
  one, the reader shows the new content.
- When a new `.md` file appears, it gets a tab, but the selection does not move.
  The person stays on what they picked.
- `n` selects the next tab and `p` the previous one; both wrap around. Pressing a tab
  also selects it. A hint line in the pane names these keys.
- Files written by subagents of this session count the same as the main session's.
- Tabs belong to the conversation:
  - `claude --resume` of this session brings the same tabs back.
  - Switching to another conversation (`/resume` inside the session, or a forked resume)
    shows that conversation's tabs.
  - `/clear` starts a new conversation, so the tabs start empty.

Layout (terminal):

```
┌ check-docs ───────────────────────────┐
│ [auth-design.md]  plan.md  notes.md   │
│ n next · p previous                   │
├───────────────────────────────────────┤
│ # Auth design                         │
│                                       │
│ ## Goals                              │
│ - Log in with SSO                     │
│ ...                                   │
└───────────────────────────────────────┘
```

## Which files count

Any file ending in `.md` (case-insensitive) that the `Write` or `Edit` tool wrote or
changed successfully in this session, in the main loop or in a subagent. This includes
files that existed before the session (an edited `README.md` gets a tab).

Not counted: files changed by `Bash` or other tools, and calls that failed or were denied.

## Goals

- Read the session's specs and plans without leaving Claude Code.
- Zero effort after `/check-docs`: tabs appear and content stays current by itself.

## Non-goals

- Editing files in the pane.
- Showing markdown files the session did not write (no folder browser).
- Rendering beyond what the engine's `Markdown` element draws (no diagrams, no images).

## Anti-goals

- The pane pops up unasked, or jumps away from the file being read.
- Content in the pane is stale after Claude changes the file.

## Constraints

- Lives in this repo as `check-docs/`, next to `review-diff/`, with its own
  `.claude-plugin/plugin.json`, and is added to `.claude-plugin/marketplace.json` and
  the README's Mods section.
- Follows review-diff's layout and conventions (hooks module, tests run by
  `claude plugin test`, `claude plugin validate` clean).
- Works on terminal and desktop surfaces; tests loop over both, as review-diff's do.
- Button hotkeys can only be one letter or digit; arrows scroll the pane. That is why
  tab keys are letters, not arrows.

## Builder's calls (decided by Claude, open to change)

- Keys `n`/`p` (person asked for letters or arrows; arrows are not available, see above).
- Tracking: a `tool.call` hook on `Write` and `Edit` that awaits `next(e)` and records
  the absolute path and a timestamp when the result is not an error.
- Content: read the file from disk (`$.fs`) when drawing, so the pane shows the file as
  it is, also after edits by other tools.
- Refresh: besides `Write`/`Edit`, the pane redraws after each `Bash` call (as
  review-diff does), so a tabbed file changed by a shell command is not stale. Files
  changed by `Bash` still do not get a new tab.
- A file that no longer exists keeps its tab, and the reader says it was deleted.
- Tab labels are the file's basename; when two tabs share a basename, add the parent
  folder. The full path shows above the content.
- With no files yet, the pane says no markdown files were written in this session yet.
- Many tabs: the tab row wraps or scrolls; the builder picks what the surface allows.
- Source of truth: the conversation's own history. When a conversation starts, resumes,
  forks or is switched to, the mod rebuilds the list from that conversation's successful
  `Write`/`Edit` records (`$.session.messages`). During the conversation it adds entries
  live from the `tool.call` hook. The list lives in `$.state` for drawing.
- Subagent writes: the main history holds only the `Agent` call, so the rebuild also
  reads each subagent's own history (`$.session.messages({ agentId })`) and merges its
  writes in at the point that agent ran.
- Compaction: a compaction (or a history past the engine's 4096-row cap) drops early
  writes from the history. So each refresh also keeps the files known before, saved in
  `$.store` under the conversation's session id, behind those the history still shows.
  A new conversation (`/clear`) has its own id, so it starts empty.
- Calls still in flight (no result yet, for example at a permission prompt) do not count.
- Selection: when nothing is selected yet (first open, or after resume), the newest tab
  is selected.

## Left to the builder

- Exact styling of the tab row and hint line.
- How the pane is sized and placed.
