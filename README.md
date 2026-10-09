# claude-mods

My [Claude Code mods](https://code.claude.com/docs/en/plugins/mods/overview), shared as a plugin marketplace.
Mods need Claude Code v2.1.287 or later.

## Install

In a Claude Code session:

```
/plugin marketplace add DiegoHeer/claude-mods
/plugin install branch-diff@claude-mods
```

Update later with `/plugin marketplace update claude-mods`.

## Mods

### branch-diff

`/branch-diff` opens a pane with every file changed on this branch compared to its base,
committed, uncommitted and untracked work included, drawn like a pull request's
"Files changed" view.

The base is `git config branch-diff.base` if set, else `origin/HEAD`, else the first of
`origin/main`, `origin/master`, `main`, `master` that exists. To pin it for a repo:
`git config branch-diff.base develop`.

Worktrees: the pane follows the worktree Claude last worked in (the one it entered
with `EnterWorktree`, or the one holding the last file it edited), else the session's.
When the repo has more than one worktree, a `worktree` picker in the header pins the
pane to any of them; pick `follow Claude` to go back to following. Review comments stay
with the worktree they were written in.

- `f` switches between whole files and changed parts only
- `r` refreshes; the pane also refreshes on its own after Claude edits files or runs commands
- `w` steps to the next worktree, then back to `follow Claude` (shown with two or more worktrees)
- Press a file in the list to jump to it
- Files with uncommitted changes carry a `● uncommitted` tag
- Untracked files (not ignored) show in full with a `● new, untracked` tag, up to 50 of them
  (files over 1 MB are listed as binary, not drawn)

Review comments (terminal and desktop, needs the mouse):

- Click a line to comment on it; drag or shift-click to pick several lines
- Type the comment and press Enter to keep it as a draft (`✎` marks its lines)
- `s` sends all drafts to Claude as one review message

## Develop

```
claude plugin validate ./branch-diff
claude plugin test ./branch-diff
claude --plugin-dir ./branch-diff
```
