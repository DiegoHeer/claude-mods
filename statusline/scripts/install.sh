#!/usr/bin/env bash
# Installs the cship statusline: the line's files and the statusLine block in settings.json.
# Exit 0 = done, 1 = error (stderr), 10 = a choice is needed (one line per choice on stdout).
set -euo pipefail

PLUGIN_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SETTINGS="$HOME/.claude/settings.json"
BACKUP="$SETTINGS.statusline-backup"
OURS='{"type":"command","command":"bash \"$HOME/.claude/cship-responsive.sh\"","padding":0,"refreshInterval":30}'
# Older installs wrote the command unquoted; it still counts as ours.
LEGACY_COMMAND='bash $HOME/.claude/cship-responsive.sh'
BIN="$HOME/.local/bin"
# shellcheck source=pins.sh
. "$PLUGIN_ROOT/scripts/pins.sh"

PREVIOUS="$HOME/.claude/statusline-previous.json"

ALLOW_DOWNLOAD=false
ALLOW_REPLACE=false
REPLACING=''
CHOICES=()
DOWNLOADS=()

die() {
  echo "$*" >&2
  exit 1
}

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
  jq -e --argjson ours "$OURS" --arg legacy "$LEGACY_COMMAND" \
    '.statusLine == null or .statusLine.command == $ours.command or .statusLine.command == $legacy' <<<"$CURRENT" >/dev/null && return
  REPLACING=$(jq -c '.statusLine' <<<"$CURRENT")
  $ALLOW_REPLACE && return
  CHOICES+=("replace $(jq -r '.statusLine.command // (.statusLine | tostring)' <<<"$CURRENT")")
}

starship_version() {
  local output
  [ -e "$BIN/starship" ] || { echo none; return; }
  output=$("$BIN/starship" --version 2>/dev/null) || { echo unknown; return; }
  read -r _ output _ <<<"$output"
  echo "${output:-unknown}"
}

check_downloads() {
  local have
  [ -x "$BIN/cship" ] || DOWNLOADS+=("cship none latest")
  have=$(starship_version)
  [ "$have" = "$STARSHIP_VERSION" ] || DOWNLOADS+=("starship $have $STARSHIP_VERSION")
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

# Downloads everything into a temp folder first, so a failed or tampered download installs nothing.
download_tools() {
  [ ${#DOWNLOADS[@]} -eq 0 ] && return
  local entry tool url sha
  WORK=$(mktemp -d)
  trap 'rm -rf "$WORK"' EXIT
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
  done
  mkdir -p "$BIN"
  for entry in "${DOWNLOADS[@]}"; do
    tool=${entry%% *}
    chmod +x "$WORK/$tool"
    mv "$WORK/$tool" "$BIN/$tool"
    echo "Installed $tool ${entry##* } to ~/.local/bin."
  done
}

copy_files() {
  mkdir -p "$HOME/.claude" "$HOME/.config"
  cp "$PLUGIN_ROOT/files/cship-responsive.sh" "$PLUGIN_ROOT/files/cache-ttl.sh" "$HOME/.claude/"
  cp "$PLUGIN_ROOT/files/cship-full.toml" "$PLUGIN_ROOT/files/cship-compact.toml" "$HOME/.config/"
  echo "Copied the line's files to ~/.claude and ~/.config."
}

write_settings() {
  if jq -e --argjson ours "$OURS" '.statusLine == $ours' <<<"$CURRENT" >/dev/null; then
    echo "settings.json already has the statusLine."
    return
  fi
  local target tmp
  target=$(readlink -f "$SETTINGS")
  if [ -e "$SETTINGS" ]; then
    cp "$SETTINGS" "$BACKUP"
    echo "Backed up settings.json to ~/.claude/settings.json.statusline-backup."
  fi
  if [ -n "$REPLACING" ]; then
    printf '%s\n' "$REPLACING" >"$PREVIOUS"
    echo "Saved your old statusLine to ~/.claude/statusline-previous.json (uninstall puts it back)."
  elif jq -e '.statusLine == null' <<<"$CURRENT" >/dev/null; then
    # The statusLine was removed by hand, so a saved one from an older install is stale.
    rm -f "$PREVIOUS"
  fi
  tmp=$(mktemp "$(dirname "$target")/.settings.json.XXXXXX")
  [ -e "$target" ] && chmod --reference="$target" "$tmp"
  jq --argjson ours "$OURS" '.statusLine = $ours' <<<"$CURRENT" >"$tmp"
  mv "$tmp" "$target"
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
  download_tools
  copy_files
  write_settings
  echo "Start a new session to see the line."
}

main "$@"
