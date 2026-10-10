---
description: Install skills from the bundled library, globally or into this repo
allowed-tools: Bash(ls:*), Bash(test:*), Bash(git rev-parse:*), Bash(mkdir:*), Bash(cp:*), AskUserQuestion
---

Install skills from the library at `${CLAUDE_PLUGIN_ROOT}/library`. Each folder in it is one skill.

1. List the library: `ls ${CLAUDE_PLUGIN_ROOT}/library`. If it is empty, say so and stop.
2. Ask which skills to install with AskUserQuestion, `multiSelect: true`. One option per skill,
   with the `description` from its `SKILL.md` frontmatter, shortened to one line.
   A question holds at most 4 options, so split the skills over several questions (up to 4 per call).
3. Ask where to install with AskUserQuestion, single select:
   - `Global`: `~/.claude/skills/`, for every project
   - `This repo`: `.claude/skills/` at the git root of the current directory, for this repo only
4. For every picked skill whose folder already exists at the target, ask with AskUserQuestion
   whether to overwrite it or skip it. Batch these into as few calls as possible.
5. Copy each skill to install with `mkdir -p <target>` then `cp -r ${CLAUDE_PLUGIN_ROOT}/library/<skill> <target>/`.
   When overwriting, remove the old folder first so no stale files stay behind.
6. Report what was installed, skipped and where, in a short list.
   Installed skills load in the next session, or now via `/reload-plugins` if they don't show up.
   Do not commit anything.
