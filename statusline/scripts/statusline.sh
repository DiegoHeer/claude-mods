#!/usr/bin/env bash
# Responsive cship statusline.
# Wide terminal  -> full layout  (folder + git branch on line 1, widgets on line 2)
# Narrow terminal -> compact layout (widgets only, one line)
#
# The mod sets COLUMNS to the terminal width before running this script.
export PATH="$HOME/.local/bin:$PATH"

HERE=$(cd "$(dirname "$0")" && pwd)
WIDTH=${COLUMNS:-80}
THRESHOLD=90   # below this many columns -> hide folder/git

input=$(cat)

if [ "$WIDTH" -lt "$THRESHOLD" ]; then
  CFG="$HERE/../config/cship-compact.toml"
else
  CFG="$HERE/../config/cship-full.toml"
fi

set -o pipefail
line=$(printf '%s' "$input" | cship --config "$CFG") || exit 1
cache=$(printf '%s' "$input" | bash "$HERE/cache-ttl.sh")

if [ -n "$cache" ]; then
  printf '%s │ %s\n' "$line" "$cache"
else
  printf '%s\n' "$line"
fi
