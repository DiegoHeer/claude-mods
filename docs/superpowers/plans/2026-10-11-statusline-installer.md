# statusline installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `statusline` plugin whose `/statusline:install` and `/statusline:uninstall` commands set up and remove Diego's cship statusline as a normal `statusLine` command.

**Architecture:** Two bash scripts do all the work (`install.sh`, `uninstall.sh`). Two slash command files tell Claude to run them and relay choices with AskUserQuestion. The scripts report a needed choice with exit code 10 and one line per choice; Claude asks, then re-runs with flags.

**Tech Stack:** bash, jq, curl, tar, sha256sum; tests in `bun test` (`bun:test`, Bun 1.4).

**Spec:** `docs/superpowers/specs/2026-10-11-statusline-installer-design.md`

## Global Constraints

- Linux only, `uname -m` = `x86_64` or `aarch64`. Anything else stops with the cship and starship project links.
- Every path is under `$HOME`. Nothing reads or writes outside it (except `mktemp`).
- Never run sudo. A missing system tool prints the install command and stops.
- Writes to `~/.claude/settings.json` keep every other key, are atomic (temp file in the same folder + `mv`), and copy the old file to `~/.claude/settings.json.statusline-backup` first.
- All checks run before any change. A run that stops (error or exit 10) changes nothing.
- The block written, exactly:
  `{"type":"command","command":"bash \"$HOME/.claude/cship-responsive.sh\"","padding":0,"refreshInterval":30}`. "Ours" = `.statusLine.command` equals that command or the older unquoted `bash $HOME/.claude/cship-responsive.sh` (literal `$HOME`, not expanded).
- cship is not pinned: latest release, downloaded only when `~/.local/bin/cship` is missing, no sha256 check. starship is pinned to 1.26.0 and sha256-checked; values in Task 3.
- Scripts: `#!/usr/bin/env bash`, `set -euo pipefail`.

## Script contract (used by every task)

`install.sh [--replace] [--download]`

- exit 0: done. stdout = short report, last line `Start a new session to see the line.`
- exit 10: a choice is needed. stdout = one line per choice not already granted by a flag:
  - `replace <current .statusLine.command, or the JSON of .statusLine if it has no command>`
  - `download <tool> <installed version or none> <pinned version>`
- exit 1: error. stderr = one message for the user.

`uninstall.sh` (no flags): exit 0 always on a normal path, stdout = report; exit 1 on invalid settings.json.

## Review Focus

1. `~/.claude/settings.json` is a symlink (dotfiles repo) → the write goes through the link; it stays a symlink. Test in Task 1.
2. `$HOME` contains a space → install and uninstall work. Test in Task 1 (harness uses such a HOME in one case).
3. `~/.local/bin/starship --version` fails or prints junk → treated as "needs download" with installed version `unknown`. Test in Task 3.
4. A download fails part-way (curl error) → no binary lands, no files copied, settings unchanged. Test in Task 3.
5. Brand-new machine: `~/.claude/` and `~/.config/` don't exist → both are created and install succeeds. Test in Task 1.

---

### Task 1: Plugin skeleton, test harness, install happy path

**Files:**
- Create: `statusline/.claude-plugin/plugin.json` (name `statusline`, version `0.1.0`, author Diego Heer, description "Installs Diego's cship statusline as a statusLine command")
- Create: `statusline/files/cship-responsive.sh`, `statusline/files/cache-ttl.sh`, `statusline/files/cship-full.toml`, `statusline/files/cship-compact.toml` — copied byte-for-byte from `~/.claude/cship-responsive.sh`, `~/.claude/cache-ttl.sh`, `~/.config/cship-full.toml`, `~/.config/cship-compact.toml`
- Create: `statusline/scripts/install.sh`
- Create: `statusline/tests/harness.ts`, `statusline/tests/install.test.ts`

**Interfaces:**
- Produces (harness.ts):
  - `makeHome(opts?: { space?: boolean }): string` — temp HOME; `space` puts a space in the path.
  - `withTools(home: string, versions?: { cship?: string; starship?: string }): void` — writes fake `~/.local/bin/cship` / `starship` that print `cship <v>` / `starship <v>` for `--version` (defaults 1.8.1 / 1.26.0).
  - `pluginCopy(): string` — copies `statusline/` to a temp dir and returns its path (Task 3 overwrites its `scripts/pins.sh`).
  - `run(plugin: string, script: 'install.sh' | 'uninstall.sh', home: string, args?: string[], env?: { PATH?: string; FAKE_ARCH?: string; FAKE_DL?: string }): { code: number; stdout: string; stderr: string }` — runs `bash <plugin>/scripts/<script>` with `HOME=home`, PATH = `<stub bin>:` + real PATH unless overridden, `FAKE_ARCH` default `x86_64`.
  - `readSettings(home: string): any`, `writeSettings(home: string, value: unknown): void`
  - `OURS` constant = the block from Global Constraints.
- Produces (install.sh): steps as functions `check_settings`, `copy_files`, `write_settings`, called from a short `main`. Later tasks add `check_system_tools` (Task 2), `check_replace`/`--replace` (Task 4), `check_downloads`/`download_tools` (Task 3).

- [ ] **Step 1: Write the failing tests** in `install.test.ts`:
  - `fresh install copies the four files and writes the block`: `withTools`; no settings file; exit 0; the four targets equal the plugin's `files/`; `readSettings(home).statusLine` toEqual `OURS`; stdout names `settings.json.statusline-backup` only when a settings file existed before; stdout ends with `Start a new session to see the line.`
  - `creates ~/.claude and ~/.config on a brand-new machine`: HOME has only `.local/bin`; exit 0; both dirs exist.
  - `keeps other keys and backs up the old file`: settings `{"theme":"dark","hooks":{"Stop":[]}}`; after: `theme` and `hooks` unchanged; backup file equals the old content.
  - `re-run leaves settings alone`: run twice; second run's settings file mtime and content unchanged; no new backup written (delete backup after run 1, assert it is still absent after run 2).
  - `invalid settings.json changes nothing`: settings = `{oops`; exit 1; stderr mentions `settings.json`; no target files exist; settings still `{oops`.
  - `writes through a symlinked settings.json`: settings.json is a symlink to `<home>/dotfiles/settings.json`; after: still a symlink, target holds the block.
  - `works with a space in HOME`: `makeHome({ space: true })`; exit 0; block written.

- [ ] **Step 2: Run** `bun test statusline` — Expected: FAIL (install.sh missing).

- [ ] **Step 3: Implement `install.sh`** — `PLUGIN_ROOT` = parent of the script's dir. Missing settings = `{}`. Parse with `jq empty`. Resolve the write target with `readlink -f` so a symlink is written through. jq writes the block with `--arg`; temp file via `mktemp` in the target's folder, then `mv`. Skip backup and write when `.statusLine` already equals `OURS`.

- [ ] **Step 4: Run** `bun test statusline` — Expected: PASS 7/7.

- [ ] **Step 5: Commit** — `feat(statusline): install script copies files and writes statusLine`

### Task 2: System tool check

**Files:** Modify `statusline/scripts/install.sh`; Test `statusline/tests/install.test.ts`

**Interfaces:**
- Consumes: Task 1 harness (`run` with `env.PATH`).
- Produces: `check_system_tools` — first step of `main`.

- [ ] **Step 1: Write the failing tests:**
  - `missing jq prints the dnf command on Fedora and changes nothing`: PATH = a temp dir of symlinks to every tool the script needs except `jq`; env `OS_RELEASE=<temp file>` holding `ID=fedora`; exit 1; stderr contains `sudo dnf install jq`; no files, no settings.
  - `missing jq prints the apt command on Ubuntu`: `ID=ubuntu`, `ID_LIKE=debian`; stderr contains `sudo apt install jq`.
  - `unknown distro names the missing tools`: `ID=arch`; stderr contains `jq` and no `sudo`.
- [ ] **Step 2: Run** `bun test statusline` — Expected: the 3 new tests FAIL.
- [ ] **Step 3: Implement `check_system_tools`** — checks `jq curl tar sha256sum tac` with `command -v`; maps `sha256sum`/`tac` to package `coreutils`; reads `${OS_RELEASE:-/etc/os-release}`; `fedora`/`rhel` in ID or ID_LIKE → `dnf`, `debian` → `apt`. (`OS_RELEASE` is the only test seam; it defaults to the real file.)
- [ ] **Step 4: Run** `bun test statusline` — Expected: PASS 10/10.
- [ ] **Step 5: Commit** — `feat(statusline): stop with an install command when a system tool is missing`

### Task 3: cship and pinned starship downloads

**Files:**
- Create: `statusline/scripts/pins.sh`
- Modify: `statusline/scripts/install.sh`, `statusline/tests/harness.ts` (stub `curl`, stub `uname`, fixture builder)
- Test: `statusline/tests/install.test.ts`

`pins.sh` (exact values):
```bash
STARSHIP_VERSION=1.26.0
CSHIP_x86_64_URL=https://github.com/stephenleo/cship/releases/latest/download/cship-x86_64-unknown-linux-musl
CSHIP_aarch64_URL=https://github.com/stephenleo/cship/releases/latest/download/cship-aarch64-unknown-linux-musl
STARSHIP_x86_64_URL=https://github.com/starship/starship/releases/download/v1.26.0/starship-x86_64-unknown-linux-musl.tar.gz
STARSHIP_x86_64_SHA256=b7c232b0e8249d8e55a40beb79c5c43a7d370f3f9408bd215deb0170daeaadf3
STARSHIP_aarch64_URL=https://github.com/starship/starship/releases/download/v1.26.0/starship-aarch64-unknown-linux-musl.tar.gz
STARSHIP_aarch64_SHA256=dc30189378d2f2e287384e8a692d3f95ad1df64cf0e8c36aa9201516028aed6b
```
cship downloads as a bare binary. starship is a `.tar.gz` with `starship` at its root.

**Interfaces:**
- Consumes: Task 1 harness.
- Produces (harness.ts): stub `uname` prints `$FAKE_ARCH` for `-m`; stub `curl` copies `$FAKE_DL/<basename of URL>` to its `-o` path, or exits 22 when absent. `fixtures(plugin: string, versions?: {cship?: string; starship?: string}): string` — builds a fake cship binary and a starship tar.gz in a temp dir, rewrites `STARSHIP_*_SHA256` in `<plugin>/scripts/pins.sh` with the tarball's sha256 (URLs keep their real basenames), returns the dir for `FAKE_DL`.
- Produces (install.sh): `check_downloads` (after `check_settings`), `download_tools` (before `copy_files`), flag `--download`.

- [ ] **Step 1: Write the failing tests** (all with `FAKE_ARCH=x86_64` unless named):
  - `missing tools ask before download and change nothing`: no `~/.local/bin`; exit 10; stdout lines `download cship none latest` and `download starship none 1.26.0`; no files, no settings, no binaries.
  - `--download installs both and finishes`: exit 0; `~/.local/bin/cship` is the fixture; `~/.local/bin/starship --version` prints `starship 1.26.0`; block written.
  - `any existing cship is kept`: `withTools(home, { cship: '1.0.0' })`; exit 0, no `download cship` line; `~/.local/bin/cship` unchanged.
  - `an old starship is upgraded`: `withTools(home, { starship: '1.20.0' })`; exit 10 with `download starship 1.20.0 1.26.0` and no cship line; with `--download` → new version.
  - `a broken starship counts as unknown`: `~/.local/bin/starship` is `exit 1`; stdout has `download starship unknown 1.26.0`.
  - `a hash mismatch leaves no binary`: no tools; corrupt the starship fixture after `fixtures()`; `--download`; exit 1; stderr mentions `sha256`; neither binary in `~/.local/bin`; no files; no settings.
  - `a failed download changes nothing`: remove the starship fixture; `--download`; exit 1; neither binary in `~/.local/bin` (cship included — download both to temp first, move only when both pass); no files; no settings.
  - `aarch64 uses the aarch64 pins`: `FAKE_ARCH=aarch64`; the curl stub log (`$FAKE_DL/curl.log`) names `cship-aarch64-unknown-linux-musl`.
  - `an unknown CPU stops with links`: `FAKE_ARCH=riscv64`; exit 1; stderr contains `https://github.com/stephenleo/cship` and `https://github.com/starship/starship`.
- [ ] **Step 2: Run** `bun test statusline` — Expected: the 9 new tests FAIL.
- [ ] **Step 3: Implement** — source `pins.sh`; cship needs a download only when missing; starship version = second word of `~/.local/bin/starship --version`, `none` if missing, `unknown` if the call fails; download into one `mktemp -d`, check starship with `sha256sum`, extract starship with `tar -xzf`, `chmod +x`, then `mv` both into `~/.local/bin`; `trap` removes the temp dir.
- [ ] **Step 4: Run** `bun test statusline` — Expected: PASS 19/19.
- [ ] **Step 5: Commit** — `feat(statusline): install cship and a pinned, hash-checked starship`

### Task 4: Replace a different statusLine

**Files:** Modify `statusline/scripts/install.sh`; Test `statusline/tests/install.test.ts`

**Interfaces:**
- Consumes: Task 1 harness; Task 3 `--download` (exit 10 combines lines).
- Produces: `check_replace`, flag `--replace`, file `~/.claude/statusline-previous.json` (the replaced `.statusLine` value, as JSON) — read by Task 5.

- [ ] **Step 1: Write the failing tests:**
  - `a different statusLine stops and names it`: settings `statusLine.command` = `bash ~/other.sh`; exit 10; stdout line `replace bash ~/other.sh`; nothing changed.
  - `both choices come in one stop`: other statusLine and no tools; stdout has the `replace` line and both `download` lines.
  - `--replace saves the old block and writes ours`: exit 0; `statusline-previous.json` deep-equals the old `.statusLine`; settings has `OURS`.
  - `re-run after replace keeps the saved block`: run with `--replace`, then plain; `statusline-previous.json` unchanged.
- [ ] **Step 2: Run** `bun test statusline` — Expected: 4 new tests FAIL.
- [ ] **Step 3: Implement** — `check_replace` collects the choice like `check_downloads`; one place in `main` prints all pending choices and exits 10. Save the previous block only when it is not ours.
- [ ] **Step 4: Run** `bun test statusline` — Expected: PASS 23/23.
- [ ] **Step 5: Commit** — `feat(statusline): ask before replacing a different statusLine`

### Task 5: Uninstall script

**Files:** Create `statusline/scripts/uninstall.sh`, `statusline/tests/uninstall.test.ts`

**Interfaces:**
- Consumes: Task 1 harness, `OURS`; Task 4 `statusline-previous.json`.

- [ ] **Step 1: Write the failing tests:**
  - `removes our block and the four files`: after install, uninstall; exit 0; no `.statusLine` key; other keys kept; four targets gone; `~/.local/bin/cship` still there; stdout mentions `~/.local/bin` and ends `Start a new session.`
  - `puts back the replaced statusLine`: install with `--replace` over `bash ~/other.sh`; uninstall; `.statusLine` deep-equals the old block; `statusline-previous.json` gone.
  - `a statusLine that is not ours is left alone`: settings with another statusLine; exit 0; stdout says it is not ours; settings byte-identical; no backup written.
  - `invalid settings.json changes nothing`: exit 1; files untouched.
  - `backs up before writing`: backup equals the pre-uninstall settings.
- [ ] **Step 2: Run** `bun test statusline` — Expected: 5 new tests FAIL.
- [ ] **Step 3: Implement `uninstall.sh`** — share nothing with install.sh except copying its write pattern (backup, `readlink -f`, temp + `mv`); keep it a short `main` of named steps.
- [ ] **Step 4: Run** `bun test statusline` — Expected: PASS 28/28.
- [ ] **Step 5: Commit** — `feat(statusline): uninstall script restores the previous statusLine`

### Task 6: Slash commands, marketplace, README

**Files:**
- Create: `statusline/commands/install.md`, `statusline/commands/uninstall.md`
- Modify: `.claude-plugin/marketplace.json` (add `{"name":"statusline","source":"./statusline","description":"/statusline:install sets up Diego's cship statusline; /statusline:uninstall removes it"}`), `README.md` (install line + a `### statusline` section)

**Interfaces:**
- Consumes: the script contract above.

Command files follow `skills/commands/install.md` (frontmatter `description`, `allowed-tools: Bash(bash:*), AskUserQuestion`).

`install.md` tells Claude:
1. Run `bash "${CLAUDE_PLUGIN_ROOT}/scripts/install.sh"`.
2. Exit 10: one AskUserQuestion call, one question per stdout line. `replace X` → "Replace your current statusLine (`X`)?" with `Replace` / `Cancel`. All `download` lines → one question "Download to ~/.local/bin: cship latest (have: none), starship 1.26.0 (have: 1.20.0)?" with `Download` / `Cancel`. Any `Cancel` → say nothing was changed, stop. Else re-run with `--replace` and/or `--download` as granted.
3. Exit 1: show stderr as is, stop.
4. Exit 0: show stdout as a short list.

`uninstall.md`: run `bash "${CLAUDE_PLUGIN_ROOT}/scripts/uninstall.sh"`, show stdout or stderr.

README section: what it installs (the four files, their targets, cship latest if missing, starship 1.26.0, both in `~/.local/bin`), the backup path, "re-run `/statusline:install` after a plugin update", and what uninstall keeps.

- [ ] **Step 1: Write the files.**
- [ ] **Step 2: Run** `claude plugin validate ./statusline` — Expected: valid. Run `bun test statusline` — Expected: PASS 28/28.
- [ ] **Step 3: Commit** — `feat(statusline): add install and uninstall commands to the marketplace`
- [ ] **Step 4: Manual check (Diego):** `claude --plugin-dir ./statusline`, run `/statusline:install`, start a new session, confirm the line and cache countdown sit above the footer. Then `/statusline:uninstall` and `/statusline:install` once more.
