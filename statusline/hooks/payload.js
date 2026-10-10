// The JSON a statusLine command reads on stdin (https://code.claude.com/docs/en/statusline),
// rebuilt from what the mod API reports, so the bundled cship script runs unchanged.

// The minor version is one or two digits, so a date suffix (claude-sonnet-4-20250514) is not read as one.
const MODEL_ID = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2})(?!\d))?/

export function displayName(model) {
  const match = MODEL_ID.exec(model)
  if (!match) return model
  const [, family, major, minor] = match
  return `${family[0].toUpperCase()}${family.slice(1)} ${minor ? `${major}.${minor}` : major}`
}

function rateLimits(limits) {
  const windows = {}
  for (const { kind, percentUsed, resetsAt } of limits) {
    windows[kind] = { used_percentage: percentUsed }
    if (resetsAt) windows[kind].resets_at = Math.floor(Date.parse(resetsAt) / 1000)
  }
  return windows
}

function contextWindow({ window, tokens, percent }) {
  return {
    context_window_size: window,
    total_input_tokens: tokens ?? null,
    used_percentage: percent ?? null,
    remaining_percentage: percent == null ? null : 100 - percent,
  }
}

export function statusInput({ sessionId, transcriptPath, cwd, projectDir, model, usage }) {
  return {
    session_id: sessionId,
    ...(transcriptPath && { transcript_path: transcriptPath }),
    cwd,
    model: { id: model, display_name: displayName(model) },
    workspace: { current_dir: cwd, project_dir: projectDir },
    cost: { total_cost_usd: usage.cost?.usd ?? 0 },
    context_window: contextWindow(usage.context),
    ...(usage.rateLimits.length > 0 && { rate_limits: rateLimits(usage.rateLimits) }),
  }
}
