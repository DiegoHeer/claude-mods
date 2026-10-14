#!/usr/bin/env bash
# Removes the cship statusline: puts back the statusLine and the files it replaced, deletes the rest.
# Keeps cship and starship in ~/.local/bin.
set -euo pipefail

PLUGIN_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
# shellcheck source=common.sh
. "$PLUGIN_ROOT/scripts/common.sh"

check_ours() {
  [ -e "$SETTINGS" ] || { echo "No settings.json, so no statusLine to remove. Nothing changed."; exit 0; }
  jq -e 'type == "object"' "$SETTINGS" >/dev/null 2>&1 || die "$SETTINGS is not valid JSON. Fix it, then run the uninstall again."
  if ! is_ours <"$SETTINGS"; then
    echo "The statusLine in settings.json is not the one this plugin installed. Nothing changed."
    exit 0
  fi
  if [ -e "$PREVIOUS" ] && ! jq -e . "$PREVIOUS" >/dev/null 2>&1; then
    die "$PREVIOUS is not valid JSON. Fix or delete it, then run the uninstall again."
  fi
}

restore_settings() {
  if [ -e "$PREVIOUS" ]; then
    stage_settings --slurpfile previous "$PREVIOUS" '.statusLine = $previous[0]' <"$SETTINGS"
  else
    stage_settings 'del(.statusLine)' <"$SETTINGS"
  fi
  cp "$SETTINGS" "$UNINSTALL_BACKUP"
  commit_settings
  if [ -e "$PREVIOUS" ]; then
    rm "$PREVIOUS"
    echo "Put back your old statusLine."
  else
    echo "Removed the statusLine."
  fi
  echo "Backed up settings.json to ~/.claude/settings.json.statusline-uninstall-backup."
}

remove_files() {
  local file target
  for file in "${FILES[@]}"; do
    target="$HOME/$file"
    if [ -e "$target$FILE_BACKUP_SUFFIX" ]; then
      mv "$target$FILE_BACKUP_SUFFIX" "$target"
      echo "Put back your own ~/$file."
    else
      rm -f "$target"
    fi
  done
  rm -f "$MARKER"
  echo "Removed the line's files from ~/.claude and ~/.config."
}

main() {
  check_ours
  restore_settings
  remove_files
  echo "cship and starship stay in ~/.local/bin. To remove them: rm ~/.local/bin/cship ~/.local/bin/starship"
  echo "Start a new session."
}

main "$@"
