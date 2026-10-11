#!/usr/bin/env bash
# Removes the cship statusline: puts back the statusLine it replaced and deletes the line's files.
# Keeps cship and starship in ~/.local/bin.
set -euo pipefail

SETTINGS="$HOME/.claude/settings.json"
BACKUP="$SETTINGS.statusline-backup"
PREVIOUS="$HOME/.claude/statusline-previous.json"
OURS_COMMAND='bash "$HOME/.claude/cship-responsive.sh"'
LEGACY_COMMAND='bash $HOME/.claude/cship-responsive.sh'
FILES=(.claude/cship-responsive.sh .claude/cache-ttl.sh .config/cship-full.toml .config/cship-compact.toml)

die() {
  echo "$*" >&2
  exit 1
}

check_ours() {
  [ -e "$SETTINGS" ] || { echo "No settings.json, so no statusLine to remove. Nothing changed."; exit 0; }
  jq -e 'type == "object"' "$SETTINGS" >/dev/null 2>&1 || die "$SETTINGS is not valid JSON. Fix it, then run the uninstall again."
  if ! jq -e --arg ours "$OURS_COMMAND" --arg legacy "$LEGACY_COMMAND" \
    '.statusLine | type == "object" and (.command == $ours or .command == $legacy)' "$SETTINGS" >/dev/null; then
    echo "The statusLine in settings.json is not the one this plugin installed. Nothing changed."
    exit 0
  fi
  if [ -e "$PREVIOUS" ] && ! jq -e . "$PREVIOUS" >/dev/null 2>&1; then
    die "$PREVIOUS is not valid JSON. Fix or delete it, then run the uninstall again."
  fi
}

restore_settings() {
  local target tmp
  target=$(readlink -f "$SETTINGS")
  cp "$SETTINGS" "$BACKUP"
  tmp=$(mktemp "$(dirname "$target")/.settings.json.XXXXXX")
  chmod --reference="$target" "$tmp"
  if [ -e "$PREVIOUS" ]; then
    jq --slurpfile previous "$PREVIOUS" '.statusLine = $previous[0]' "$SETTINGS" >"$tmp"
    mv "$tmp" "$target"
    rm "$PREVIOUS"
    echo "Put back your old statusLine. Backup: ~/.claude/settings.json.statusline-backup."
  else
    jq 'del(.statusLine)' "$SETTINGS" >"$tmp"
    mv "$tmp" "$target"
    echo "Removed the statusLine. Backup: ~/.claude/settings.json.statusline-backup."
  fi
}

remove_files() {
  local file
  for file in "${FILES[@]}"; do rm -f "$HOME/$file"; done
  echo "Deleted the line's files from ~/.claude and ~/.config."
}

main() {
  check_ours
  restore_settings
  remove_files
  echo "cship and starship stay in ~/.local/bin. To remove them: rm ~/.local/bin/cship ~/.local/bin/starship"
  echo "Start a new session."
}

main "$@"
