---
description: Install Diego's cship statusline (files, cship, starship, and the statusLine setting)
allowed-tools: Bash(bash:*), AskUserQuestion
---

Install the statusline with the bundled script. The script does all the work; you only relay choices.

1. Run `bash "${CLAUDE_PLUGIN_ROOT}/scripts/install.sh"`.
2. If it exits with code 10, it needs choices. Each stdout line is one choice:
   - `replace <current>`: ask "Replace your current statusLine (`<current>`)?" with `Replace` / `Cancel`.
   - `download <tool> <have> <want>`: put all download lines in one question,
     e.g. "Download to ~/.local/bin: cship latest (have: none), starship 1.26.0 (have: 1.20.0)?",
     with `Download` / `Cancel`.
   Ask all questions in one AskUserQuestion call. If any answer is `Cancel`, say nothing was
   changed and stop. Otherwise run the script again with `--replace` and/or `--download`,
   for the choices that were granted.
3. If it exits with any other non-zero code, show its stderr as is and stop.
4. If it exits with code 0, show its stdout as a short list.
