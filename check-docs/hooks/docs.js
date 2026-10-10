// The markdown files a conversation wrote, rebuilt from its own history, so a
// resume, fork, /clear or switch shows that conversation's files with nothing saved.

const WRITING_TOOLS = ['Write', 'Edit']
const isMarkdown = (path) => typeof path === 'string' && path.toLowerCase().endsWith('.md')
// A call still in flight has no text yet: it may still be denied or fail.
const isAnswered = (use) => use.text !== undefined && !use.isError
const isDocWrite = (use) => WRITING_TOOLS.includes(use.tool) && isAnswered(use) && isMarkdown(use.input?.file_path)

// Newest first: every path in the order it was last written, a subagent's writes
// placed where that agent ran in its parent's history.
export function docPathsFromRows(rows, agentRowsOf) {
  const written = []
  const collect = (rows) => {
    for (const use of rows.flatMap((row) => row.toolUses ?? [])) {
      if (use.agentId) collect(agentRowsOf(use.agentId))
      else if (isDocWrite(use)) written.push(use.input.file_path)
    }
  }
  collect(rows)
  return [...new Set(written.reverse())]
}

// readRows(agentId?) answers the main history, or that agent's; anything but an
// array (a refusal) counts as no rows.
export async function collectDocPaths(readRows) {
  const agentRows = new Map()
  const rowsOf = async (agentId) => {
    const answer = await readRows(agentId)
    return Array.isArray(answer) ? answer : []
  }
  const readAgents = async (rows) => {
    for (const use of rows.flatMap((row) => row.toolUses ?? [])) {
      if (!use.agentId || agentRows.has(use.agentId)) continue
      const agentHistory = await rowsOf(use.agentId)
      agentRows.set(use.agentId, agentHistory)
      await readAgents(agentHistory)
    }
  }
  const rows = await rowsOf()
  await readAgents(rows)
  return docPathsFromRows(rows, (id) => agentRows.get(id) ?? [])
}

// A compaction, or a history past the engine's row cap, drops early writes; the
// files known before stay, behind those the history still shows.
export const keepKnown = (written, known) => [...written, ...known.filter((path) => !written.includes(path))]

const baseName =(path) => path.split('/').pop()
const withParent = (path) => path.split('/').slice(-2).join('/')

export function tabLabels(paths) {
  const count = new Map()
  for (const path of paths) count.set(baseName(path), (count.get(baseName(path)) ?? 0) + 1)
  return new Map(paths.map((path) => [path, count.get(baseName(path)) > 1 ? withParent(path) : baseName(path)]))
}

export function stepPath(paths, current, step) {
  if (paths.length === 0) return null
  const at = paths.indexOf(current)
  if (at === -1) return paths[0]
  return paths[(at + step + paths.length) % paths.length]
}
