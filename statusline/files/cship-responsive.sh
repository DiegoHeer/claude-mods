#!/usr/bin/env bash
# Responsive cship statusline.
# Wide terminal  -> full layout  (folder + git branch, then widgets, one line)
# Narrow terminal -> compact layout (widgets only, one line)
#
# Claude Code sets COLUMNS to the terminal width before running this script
# (tput/stty cannot read it here, so COLUMNS is the only reliable source).
export PATH="$HOME/.local/bin:$PATH"

WIDTH=${COLUMNS:-80}
THRESHOLD=90   # below this many columns -> hide folder/git

input=$(cat)

if [ "$WIDTH" -lt "$THRESHOLD" ]; then
  CFG="$HOME/.config/cship-compact.toml"
else
  CFG="$HOME/.config/cship-full.toml"
fi

line=$(printf '%s' "$input" | cship --config "$CFG")
cache=$(printf '%s' "$input" | bash "$HOME/.claude/cache-ttl.sh")

if [ -n "$cache" ]; then
  printf '%s │ %s\n' "$line" "$cache"
else
  printf '%s\n' "$line"
fi
