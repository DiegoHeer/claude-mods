// The markdown files a conversation wrote, rebuilt from its own history, so a
// resume, fork, /clear or switch shows that conversation's files.

const WRITING_TOOLS = ['Write', 'Edit']
const KEPT_CONVERSATIONS = 20 // bounds the store, which holds 4 MiB in all
const isMarkdown = (path) => typeof path === 'string' && path.toLowerCase().endsWith('.md')
// A call still in flight has no text yet: it may still be denied or fail.
const isAnswered = (use) => use.text !== undefined && !use.isError
const isDocWrite = (use) => WRITING_TOOLS.includes(use.tool) && isAnswered(use) && isMarkdown(use.input?.file_path)

// Newest first: every path in the order it was last written, a subagent's writes
// placed where that agent ran. readRows(agentId?) answers the main history, or that
// agent's; anything but an array (a refusal) counts as no rows.
export async function collectDocPaths(readRows) {
  const written = []
  // A forked agent's history holds the call that spawned it: each agent is read once.
  const seen = new Set()
  const rowsOf = async (agentId) => {
    const answer = await readRows(agentId)
    return Array.isArray(answer) ? answer : []
  }
  const readSpawned = async (uses) => {
    const spawned = [...new Set(uses.map((use) => use.agentId).filter((id) => id && !seen.has(id)))]
    spawned.forEach((id) => seen.add(id))
    return new Map(await Promise.all(spawned.map(async (id) => [id, await rowsOf(id)])))
  }
  const walk = async (rows) => {
    const uses = rows.flatMap((row) => row.toolUses ?? [])
    const agentRows = await readSpawned(uses)
    for (const use of uses) {
      if (agentRows.has(use.agentId)) await walk(agentRows.get(use.agentId))
      else if (isDocWrite(use)) written.push(use.input.file_path)
    }
  }
  await walk(await rowsOf())
  return [...new Set(written.reverse())]
}

// A compaction, or a history past the engine's row cap, drops early writes; the
// files known before stay, behind those the history still shows.
export const keepKnown = (written, known) => [...written, ...known.filter((path) => !written.includes(path))]

// The store keeps the latest conversations' files as [{ conversation, paths }], newest first.
const entriesOf = (recent) => (Array.isArray(recent) ? recent : [])
export const knownPaths = (recent, conversation) => entriesOf(recent).find((entry) => entry.conversation === conversation)?.paths ?? []
export const rememberPaths = (recent, conversation, paths) =>
  [{ conversation, paths }, ...entriesOf(recent).filter((entry) => entry.conversation !== conversation)].slice(0, KEPT_CONVERSATIONS)

const pathParts = (path) => path.split(/[\\/]/)
const baseName = (path) => pathParts(path).at(-1)
const withParent = (path) => pathParts(path).slice(-2).join('/')

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
