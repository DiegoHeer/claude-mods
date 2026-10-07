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

`/branch-diff` opens a pane with every file changed on this branch compared to its base
(`origin/HEAD`, else `main`, else `master`), committed and uncommitted work included,
drawn like a pull request's "Files changed" view.

- `f` switches between whole files and changed parts only
- `r` refreshes; the pane also refreshes on its own after Claude edits files or runs commands
- Press a file in the list to jump to it
- Files with uncommitted changes carry a `● uncommitted` tag

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
