# claude-mods

My [Claude Code mods](https://code.claude.com/docs/en/plugins/mods/overview), shared as a plugin marketplace.
Mods need Claude Code v2.1.287 or later.

## Install

In a Claude Code session:

```
/plugin marketplace add DiegoHeer/claude-mods
/plugin install review-diff@claude-mods
/plugin install check-docs@claude-mods
/plugin install skills@claude-mods
```

Update later with `/plugin marketplace update claude-mods`.

Upgrading from `branch-diff`: it was renamed, so the update won't carry it over. Run
`/plugin uninstall branch-diff@claude-mods`, then `/plugin install review-diff@claude-mods`.

## Mods

### review-diff

`/review-diff` opens a pane with every file changed on this branch compared to its base,
committed, uncommitted and untracked work included, drawn like a pull request's
"Files changed" view.

The base is `git config review-diff.base` if set, else `origin/HEAD`, else the first of
`origin/main`, `origin/master`, `main`, `master` that exists. To pin it for a repo:
`git config review-diff.base develop`.

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

### check-docs

`/check-docs` opens a pane with the markdown files written in this conversation, such as
specs and plans, one tab per file, newest first. The selected file is drawn as formatted
markdown. Run `/check-docs` again to close it.

A file counts when Claude, or one of its subagents, wrote or edited a `.md` file with the
Write or Edit tool.

- `n` goes to the next tab, `p` to the previous one; press a tab to pick it
- The pane refreshes on its own after Claude writes, edits or runs commands;
  a new file gets a tab without moving you off the one you are reading
- Tabs follow the conversation: a resume brings them back, `/clear` starts empty
- A deleted file keeps its tab; a file too long for the pane (about 100 000 characters) is cut

### skills

`/skills:install` copies skills from the plugin's `skills/library/` folder.
Claude asks which skills you want, then where: globally (`~/.claude/skills/`) or into
this repo (`.claude/skills/`). If a skill is already there, it asks to overwrite or skip.
Nothing is committed.

To add a skill to the library, put its folder (with `SKILL.md`) in `skills/library/`.

## Develop

```
claude plugin validate ./review-diff
claude plugin test ./review-diff
claude --plugin-dir ./review-diff

claude plugin validate ./check-docs
claude plugin test ./check-docs
claude --plugin-dir ./check-docs
```
