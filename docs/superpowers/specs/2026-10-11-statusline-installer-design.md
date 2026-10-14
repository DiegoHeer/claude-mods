# statusline installer: design

Date: 2026-10-11

## Intent

Diego's Claude Code statusline is a `statusLine` command in `~/.claude/settings.json`
that runs cship. On a new computer, getting it back means copying scripts and config
files by hand and installing cship and starship. This plugin turns that into one command.

A mod version was tried and dropped (closed PR #6): mods have no render spot above the
footer, and `classic.*` hooks are bypassed for user mods. So this plugin does not draw
anything. It only installs the normal `statusLine` setup.

## Goals

- A new `statusline` plugin in this marketplace with two slash commands:
  `/statusline:install` and `/statusline:uninstall`.
- After `/statusline:install` and a new session, the line looks and works exactly as it
  does on Diego's current machine (wide and compact layouts, cache countdown).
- The repo is the source of truth for the line's files. To change the look, Diego edits
  the files in the repo, pushes, updates the plugin, and runs `/statusline:install` again.

## Non-goals

- macOS. Linux only, x86_64 and aarch64.
- Automatic updates. After a plugin update, the user re-runs `/statusline:install`.
- A message or hint before install. Nothing runs until the user calls a command.
  The README tells the user to run `/statusline:install`.
- Cleaning up this machine's leftovers (`_disabled_statusLine` in settings.json,
  `~/.claude/statusline.sh`, `~/.claude/statusline-command.sh`).
- Removing cship or starship on uninstall.

## Anti-goals

- Never lose the user's settings. Every write to `~/.claude/settings.json` keeps all
  other keys, is atomic (temp file + `mv`), and has a backup taken first.
- Never silently replace a `statusLine` that is not ours.
- Never run sudo. When a system package is missing, print the exact command and stop.

## What the plugin holds

```
statusline/
  .claude-plugin/plugin.json
  commands/install.md
  commands/uninstall.md
  scripts/install.sh
  scripts/uninstall.sh
  files/cship-responsive.sh      -> ~/.claude/cship-responsive.sh
  files/cache-ttl.sh             -> ~/.claude/cache-ttl.sh
  files/cship-full.toml          -> ~/.config/cship-full.toml
  files/cship-compact.toml       -> ~/.config/cship-compact.toml
```

The four `files/` are copied unchanged from Diego's current machine
(`~/.claude/cship-responsive.sh`, `~/.claude/cache-ttl.sh`, `~/.config/cship-full.toml`,
`~/.config/cship-compact.toml`). Target paths are the same paths they use today, so the
scripts need no edits.

Add the plugin to `.claude-plugin/marketplace.json` and a section to `README.md`.

## The statusLine block written

```json
"statusLine": {
  "type": "command",
  "command": "bash \"$HOME/.claude/cship-responsive.sh\"",
  "padding": 0,
  "refreshInterval": 30
}
```

"Ours" means `statusLine.command` equals `bash "$HOME/.claude/cship-responsive.sh"`, or the
older unquoted `bash $HOME/.claude/cship-responsive.sh` (quoted so a HOME with a space works).

## /statusline:install

The command file tells Claude to run `scripts/install.sh` and to ask the user with
AskUserQuestion whenever the script reports a choice. The script does the work; Claude
only relays choices and the result.

Steps, in order:

1. **System tools.** Check `jq`, `curl`, `tar`, `sha256sum`, `tac`. If any is missing,
   stop and print the install command for the distro (`sudo dnf install ...`,
   `sudo apt install ...`, else a generic message). Nothing is changed.
2. **Existing statusLine.** Read `~/.claude/settings.json` (missing file = `{}`;
   invalid JSON = stop with an error, change nothing).
   - No `statusLine`, or ours: go on.
   - A different one: stop and report it. Claude shows the current command and asks
     `Replace` or `Cancel`. On `Replace`, Claude runs the script again with `--replace`.
3. **cship and starship.** Both live in `~/.local/bin` (`cship-responsive.sh` puts
   `~/.local/bin` first on `PATH`, so that copy wins). Claude asks once (one question
   for all tools that need a download, saying "install" or "upgrade from X") before
   anything downloads. If the user declines, the install stops and changes nothing:
   no files, no settings.
   - cship is not pinned. It needs a download only when no cship is found on
     `~/.local/bin` + `PATH`; any version found is kept. It comes from
     `https://github.com/stephenleo/cship/releases/latest/download/cship-<target>`,
     with no sha256 check (the latest build has no fixed fingerprint).
   - starship is pinned to v1.26.0 (the version on Diego's machine). It needs a
     download when `~/.local/bin/starship` is missing, broken, or older than 1.26.0,
     so a plugin update that bumps the pin upgrades it on the next re-run. A newer
     starship is kept (it may also run the user's shell prompt).
     It comes from the release tarball for `x86_64-unknown-linux-musl` or
     `aarch64-unknown-linux-musl` and is checked with sha256 before it is moved into
     place. Do not pipe `install.sh` to `sh`; the hash must be checked.
   - Other CPU: stop and print the cship and starship project links.
   - A starship download whose hash does not match is deleted, and the script stops.
   All downloads, folders and the new settings file are staged before anything moves
   into place, so a failed step leaves no half-done install.
4. **Files.** Copy the four `files/` to their targets (`mkdir -p` first), overwriting.
   On the first install (no `~/.claude/statusline-installed` marker), a different
   existing file is saved as `<file>.statusline-backup` first.
5. **Settings.** If settings.json will change:
   - copy it to `~/.claude/settings.json.statusline-backup` (overwrite an older one);
   - if a different `statusLine` is being replaced, save it to
     `~/.claude/statusline-previous.json` so uninstall can put it back;
   - write the block above with jq, atomically.
   If ours is already there, skip this step (re-run = just refresh files).
6. **Report.** One short message: what was installed or refreshed, where the backup is,
   and "Start a new session to see the line."

The script must be safe to run any number of times.

## /statusline:uninstall

1. Read settings.json. If `statusLine` is not ours, say so and change nothing.
2. Back up settings.json to `~/.claude/settings.json.statusline-uninstall-backup`, so the
   install backup (the settings from before install) is kept.
3. If `~/.claude/statusline-previous.json` exists, put that block back and delete the
   file. Otherwise remove the `statusLine` key.
4. Put back each `<file>.statusline-backup`; delete the other copied files and the marker.
5. Keep cship and starship. Say they stay in `~/.local/bin` and how to remove them.
6. Say "Start a new session."

No question is asked; running the command is the confirmation.

## Script interface (builder's call, within these rules)

- Plain bash, `set -euo pipefail`.
- `HOME` is the only root for all paths, so tests can point it at a temp folder.
- The command reports a choice to Claude through a distinct exit code plus one line on
  stdout that says what is needed. The exact codes and flags are the builder's call.

## Testing

- Tests use `bun test` (as `review-diff` does) and run the real scripts with
  `HOME` set to a temp folder.
- Downloads are faked by putting stub `curl` and `uname` scripts first on `PATH`.
- Cover at least: fresh install; re-run is a no-op for settings; different statusLine
  stops without changes; `--replace` saves the old block and uninstall restores it;
  invalid settings.json changes nothing; other keys survive; declining the download
  changes nothing; an old starship version is upgraded; any existing cship is kept; hash mismatch leaves no
  binary; missing `jq` prints a command and changes nothing; unknown CPU stops; uninstall
  when not ours changes nothing.
- One manual check on this machine: run `/statusline:install`, start a new session, and
  confirm the line and cache countdown show above the footer.

## Calls made without Diego (check these)

- Command names are `/statusline:install` and `/statusline:uninstall`, because plugin
  commands are namespaced like `/skills:install`.
- Starship is also pinned (v1.26.0, this machine's version) and hash-checked, instead of
  the `curl | sh` installer.
- Uninstall restores the statusLine that install replaced, and keeps cship and starship.
- One install backup and one uninstall backup, each overwritten by its own command.
- Missing `jq`/`curl`/`tar`/`sha256sum`/`tac` stops the install with a printed command.
