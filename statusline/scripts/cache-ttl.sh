#!/usr/bin/env bash
# Prompt-cache countdown for the statusline.
# Reads Claude Code statusline JSON on stdin, prints e.g. "cache 42m" or "cache cold".
# The cache TTL resets on every request, so expiry = last assistant reply + TTL.
# TTL (5m or 1h) is read from the cache_creation split in the transcript usage.

transcript=$(jq -r '.transcript_path // empty')
[ -f "$transcript" ] || exit 0

recent=$(tac "$transcript" | grep -m 50 '"type":"assistant"')
[ -n "$recent" ] || exit 0

read -r last_ts ttl < <(printf '%s\n' "$recent" | jq -rs '
  (map(select(.message.usage)) ) as $msgs
  | ($msgs[0].timestamp // "") as $ts
  | ($msgs | map(.message.usage.cache_creation // {})
           | map(select((.ephemeral_1h_input_tokens // 0) > 0 or (.ephemeral_5m_input_tokens // 0) > 0))
           | first) as $c
  | (if ($c.ephemeral_1h_input_tokens // 0) > 0 then 3600 else 300 end) as $ttl
  | "\($ts) \($ttl)"')
[ -n "$last_ts" ] || exit 0

left=$(( $(date -d "$last_ts" +%s) + ttl - $(date +%s) ))

GREEN=$'\e[38;2;158;206;106m'; YELLOW=$'\e[38;2;224;175;104m'; RED=$'\e[1;38;2;247;118;142m'; RESET=$'\e[0m'

if [ "$left" -le 0 ]; then
  printf '%scache cold%s' "$RED" "$RESET"
elif [ "$left" -lt 60 ]; then
  printf '%scache <1m%s' "$YELLOW" "$RESET"
else
  color=$GREEN
  [ "$left" -lt $(( ttl / 4 )) ] && color=$YELLOW
  printf '%scache %dm%s' "$color" $(( left / 60 )) "$RESET"
fi
