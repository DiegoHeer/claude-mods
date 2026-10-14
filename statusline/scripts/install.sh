#!/usr/bin/env bash
# Installs the cship statusline: the line's files and the statusLine block in settings.json.
# Exit 0 = done, 1 = error (stderr), 10 = a choice is needed (one line per choice on stdout).
set -euo pipefail

PLUGIN_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
BIN="$HOME/.local/bin"
# shellcheck source=common.sh
. "$PLUGIN_ROOT/scripts/common.sh"
# shellcheck source=pins.sh
. "$PLUGIN_ROOT/scripts/pins.sh"

ALLOW_DOWNLOAD=false
ALLOW_REPLACE=false
REPLACING=''
CHOICES=()
DOWNLOADS=()

package_of() {
  case "$1" in
    sha256sum | tac) echo coreutils ;;
    *) echo "$1" ;;
  esac
}

package_manager() {
  local ID='' ID_LIKE=''
  # shellcheck disable=SC1090
  [ -r "${OS_RELEASE:-/etc/os-release}" ] && . "${OS_RELEASE:-/etc/os-release}"
  case " $ID $ID_LIKE " in
    *" fedora "* | *" rhel "*) echo dnf ;;
    *" debian "*) echo apt ;;
  esac
}

check_system_tools() {
  local tool package missing=() packages=() manager
  for tool in jq curl tar sha256sum tac; do
    command -v "$tool" >/dev/null || missing+=("$tool")
  done
  [ ${#missing[@]} -eq 0 ] && return
  for tool in "${missing[@]}"; do
    package=$(package_of "$tool")
    [[ " ${packages[*]} " == *" $package "* ]] || packages+=("$package")
  done
  manager=$(package_manager)
  if [ -n "$manager" ]; then
    die "Missing: ${missing[*]}. Install with: sudo $manager install ${packages[*]}"
  fi
  die "Missing: ${missing[*]}. Install them with your package manager, then run the install again."
}

check_settings() {
  if [ -e "$SETTINGS" ]; then
    jq -e 'type == "object"' "$SETTINGS" >/dev/null 2>&1 || die "$SETTINGS is not valid JSON. Fix it, then run the install again."
    CURRENT=$(cat "$SETTINGS")
  else
    CURRENT='{}'
  fi
  jq -e '.statusLine | . == null or type == "object"' <<<"$CURRENT" >/dev/null ||
    die "The statusLine in $SETTINGS is not an object. Fix it, then run the install again."
}

check_replace() {
  if jq -e '.statusLine == null' <<<"$CURRENT" >/dev/null || is_ours <<<"$CURRENT"; then return; fi
  REPLACING=$(jq -c '.statusLine' <<<"$CURRENT")
  $ALLOW_REPLACE && return
  CHOICES+=("replace $(jq -r '.statusLine.command // (.statusLine | tostring) | gsub("[\r\n]+"; " ")' <<<"$CURRENT")")
}

starship_version() {
  local output
  [ -e "$BIN/starship" ] || { echo none; return; }
  output=$("$BIN/starship" --version 2>/dev/null) || { echo unknown; return; }
  read -r _ output _ <<<"$output"
  [[ $output =~ ^[0-9]+(\.[0-9]+)*$ ]] && echo "$output" || echo unknown
}

# A newer starship may also run the user's shell prompt, so only an older one is replaced.
starship_is_recent() {
  [[ $1 =~ ^[0-9] ]] && [ "$(printf '%s\n' "$STARSHIP_VERSION" "$1" | sort -V | head -n 1)" = "$STARSHIP_VERSION" ]
}

check_downloads() {
  local have
  (PATH="$BIN:$PATH" command -v cship >/dev/null) || DOWNLOADS+=("cship none latest")
  have=$(starship_version)
  starship_is_recent "$have" || DOWNLOADS+=("starship $have $STARSHIP_VERSION")
  [ ${#DOWNLOADS[@]} -eq 0 ] && return
  ARCH=$(uname -m)
  case "$ARCH" in
    x86_64 | aarch64) ;;
    *) die "No cship or starship build for $ARCH. Install them by hand: https://github.com/stephenleo/cship and https://github.com/starship/starship" ;;
  esac
  $ALLOW_DOWNLOAD && return
  local entry
  for entry in "${DOWNLOADS[@]}"; do CHOICES+=("download $entry"); done
}

ask_choices() {
  [ ${#CHOICES[@]} -eq 0 ] && return
  printf '%s\n' "${CHOICES[@]}"
  exit 10
}

fetch() {
  curl -fsSL -o "$2" "$1" || die "Could not download $1. Nothing was installed."
}

# Downloads and checks every tool in a temp folder; nothing lands in ~/.local/bin yet.
stage_tools() {
  [ ${#DOWNLOADS[@]} -eq 0 ] && return
  local entry tool url sha
  WORK=$(mktemp -d)
  for entry in "${DOWNLOADS[@]}"; do
    tool=${entry%% *}
    if [ "$tool" = cship ]; then
      url="CSHIP_${ARCH}_URL"
      fetch "${!url}" "$WORK/cship"
    else
      url="STARSHIP_${ARCH}_URL" sha="STARSHIP_${ARCH}_SHA256"
      fetch "${!url}" "$WORK/starship.tar.gz"
      [ "$(sha256sum "$WORK/starship.tar.gz" | cut -d ' ' -f 1)" = "${!sha}" ] ||
        die "The starship download does not match its sha256. Nothing was installed."
      tar -xzf "$WORK/starship.tar.gz" -C "$WORK" starship 2>/dev/null ||
        die "Could not unpack the starship download. Nothing was installed."
    fi
    chmod +x "$WORK/$tool"
  done
}

# Makes the folders and the new settings file, so the steps after it only move files into place.
stage_changes() {
  mkdir -p "$HOME/.claude" "$HOME/.config" "$BIN" 2>/dev/null ||
    die "Could not create ~/.claude, ~/.config or ~/.local/bin. Nothing was installed."
  jq -e --argjson ours "$OURS" '.statusLine == $ours' <<<"$CURRENT" >/dev/null && return
  stage_settings --argjson ours "$OURS" '.statusLine = $ours' <<<"$CURRENT"
}

install_tools() {
  local entry tool
  for entry in "${DOWNLOADS[@]}"; do
    tool=${entry%% *}
    mv "$WORK/$tool" "$BIN/$tool"
    echo "Installed $tool ${entry##* } to ~/.local/bin."
  done
}

same_content() {
  [ "$(sha256sum <"$1")" = "$(sha256sum <"$2")" ]
}

copy_files() {
  local file source target
  for file in "${FILES[@]}"; do
    source="$PLUGIN_ROOT/files/${file##*/}" target="$HOME/$file"
    if [ ! -e "$MARKER" ] && [ -e "$target" ] && ! same_content "$source" "$target"; then
      cp "$target" "$target$FILE_BACKUP_SUFFIX"
      echo "Backed up your ~/$file to ~/$file$FILE_BACKUP_SUFFIX (uninstall puts it back)."
    fi
    cp "$source" "$target"
  done
  touch "$MARKER"
  echo "Copied the line's files to ~/.claude and ~/.config."
}

write_settings() {
  if [ -z "$STAGED" ]; then
    echo "settings.json already has the statusLine."
    return
  fi
  if [ -e "$SETTINGS" ]; then
    cp "$SETTINGS" "$INSTALL_BACKUP"
    echo "Backed up settings.json to ~/.claude/settings.json.statusline-backup."
  fi
  if [ -n "$REPLACING" ]; then
    printf '%s\n' "$REPLACING" >"$PREVIOUS"
    echo "Saved your old statusLine to ~/.claude/statusline-previous.json (uninstall puts it back)."
  elif jq -e '.statusLine == null' <<<"$CURRENT" >/dev/null; then
    # The statusLine was removed by hand, so a saved one from an older install is stale.
    rm -f "$PREVIOUS"
  fi
  commit_settings
  echo "Wrote the statusLine to settings.json."
}

parse_args() {
  local arg
  for arg in "$@"; do
    case "$arg" in
      --download) ALLOW_DOWNLOAD=true ;;
      --replace) ALLOW_REPLACE=true ;;
      *) die "Unknown option: $arg" ;;
    esac
  done
}

main() {
  parse_args "$@"
  check_system_tools
  check_settings
  check_replace
  check_downloads
  ask_choices
  stage_tools
  stage_changes
  install_tools
  copy_files
  write_settings
  echo "Start a new session to see the line."
}

main "$@"
