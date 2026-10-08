// Reads the branch's diff from git: the base branch, the commit the branch
// split off at, and every changed file with its hunks. `git(args)` runs one
// git command and resolves to { exitCode, stdout, stderr }, never throwing.

export const WHOLE_FILE = 1000000
export const CHANGED_PARTS = 3

const DIFF = ['-c', 'core.quotePath=false', 'diff', '--no-ext-diff', '--no-textconv', '--no-renames']

// The branch this one forked from: the remote's default, else main, else master.
async function detectBase(git) {
  const remote = await git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
  if (remote.exitCode === 0 && remote.stdout.trim()) return remote.stdout.trim()
  for (const name of ['main', 'master']) {
    const found = await git(['rev-parse', '--verify', '--quiet', name])
    if (found.exitCode === 0) return name
  }
  return null
}

async function findForkPoint(git, base) {
  const r = await git(['merge-base', base, 'HEAD'])
  return r.exitCode === 0 ? r.stdout.trim() : null
}

function parseNumstat(stdout) {
  return stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [added, removed, ...rest] = line.split('\t')
      const isBinary = added === '-'
      return { path: rest.join('\t'), added: isBinary ? 0 : Number(added), removed: isBinary ? 0 : Number(removed), isBinary, hunks: [] }
    })
}

// Hunks per file path, from `git diff -p` output. Lines keep their marker.
function parseHunks(stdout) {
  const byPath = new Map()
  let hunks = null
  let oldPath = null
  for (const line of stdout.split('\n')) {
    if (line.startsWith('diff --git ')) {
      hunks = null
    } else if (line.startsWith('--- ')) {
      oldPath = line.slice(6).replace(/\t$/, '')
    } else if (line.startsWith('+++ ')) {
      // git ends the name with a tab when it holds a space.
      const path = (line === '+++ /dev/null' ? oldPath : line.slice(6)).replace(/\t$/, '')
      hunks = []
      byPath.set(path, hunks)
    } else if (hunks && line.startsWith('@@ -')) {
      const [, oldStart, newStart] = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)/) ?? []
      if (oldStart) hunks.push({ oldStart: Number(oldStart), newStart: Number(newStart), lines: [] })
    } else if (hunks?.length && /^[ +-]/.test(line)) {
      hunks.at(-1).lines.push(line[0] + stripControlChars(line.slice(1)))
    }
  }
  return byPath
}

// The pane refuses control characters; tabs are the one kind code needs.
function stripControlChars(text) {
  return text.replace(/[\p{Cc}\p{Cf}]/gu, (c) => (c === '\t' ? c : ''))
}

// Paths that differ from the last commit, staged or not. A failed call tags nothing.
async function listUncommitted(git) {
  const r = await git([...DIFF, '--name-only', 'HEAD'])
  return new Set(r.exitCode === 0 ? r.stdout.split('\n').filter(Boolean) : [])
}

// Everything the pane shows, or an error to show instead.
export async function loadBranchDiff(git, contextLines) {
  const base = await detectBase(git)
  if (!base) return { error: 'No base branch found (looked for origin/HEAD, main, master).' }
  const forkPoint = await findForkPoint(git, base)
  if (!forkPoint) return { base, error: 'This branch shares no history with ' + base + '.' }

  const stat = await git([...DIFF, '--numstat', forkPoint])
  if (stat.exitCode !== 0) return { base, error: stat.stderr.trim() || 'git diff failed' }
  const files = parseNumstat(stat.stdout)
  if (files.length === 0) return { base, files }

  const patch = await git([...DIFF, '-U' + contextLines, forkPoint])
  if (patch.exitCode !== 0) return { base, error: patch.stderr.trim() || 'git diff failed' }
  const hunksByPath = parseHunks(patch.stdout)
  const uncommitted = await listUncommitted(git)
  for (const file of files) {
    file.hunks = hunksByPath.get(file.path) ?? []
    file.isUncommitted = uncommitted.has(file.path)
  }
  return { base, files }
}
