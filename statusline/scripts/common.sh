# Names and helpers shared by install.sh and uninstall.sh.
SETTINGS="$HOME/.claude/settings.json"
INSTALL_BACKUP="$SETTINGS.statusline-backup"
UNINSTALL_BACKUP="$SETTINGS.statusline-uninstall-backup"
PREVIOUS="$HOME/.claude/statusline-previous.json"
# Present while the line's files are ours, so a re-install doesn't back them up as the user's.
MARKER="$HOME/.claude/statusline-installed"
FILE_BACKUP_SUFFIX=.statusline-backup
OURS='{"type":"command","command":"bash \"$HOME/.claude/cship-responsive.sh\"","padding":0,"refreshInterval":30}'
# Older installs wrote the command unquoted; it still counts as ours.
LEGACY_COMMAND='bash $HOME/.claude/cship-responsive.sh'
# Where each file in the plugin's files/ goes, relative to $HOME.
FILES=(.claude/cship-responsive.sh .claude/cache-ttl.sh .config/cship-full.toml .config/cship-compact.toml)

STAGED=''
WORK=''
trap 'rm -f "$STAGED"; [ -z "$WORK" ] || rm -rf "$WORK"' EXIT

die() {
  echo "$*" >&2
  exit 1
}

# Reads settings JSON on stdin; true when its statusLine is the one this plugin writes.
is_ours() {
  jq -e --argjson ours "$OURS" --arg legacy "$LEGACY_COMMAND" \
    '.statusLine | type == "object" and (.command == $ours.command or .command == $legacy)' >/dev/null
}

# Runs jq with the given args on stdin into a temp file next to the real settings file
# (through a symlink), so commit_settings can swap it in with one atomic mv.
stage_settings() {
  SETTINGS_TARGET=$(readlink -f "$SETTINGS")
  STAGED=$(mktemp "$(dirname "$SETTINGS_TARGET")/.settings.json.XXXXXX")
  if [ -e "$SETTINGS_TARGET" ]; then chmod --reference="$SETTINGS_TARGET" "$STAGED"; fi
  jq "$@" >"$STAGED"
}

commit_settings() {
  mv "$STAGED" "$SETTINGS_TARGET"
  STAGED=''
}
