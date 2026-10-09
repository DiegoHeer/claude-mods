// Reads the branch's diff from git: the base branch, the commit the branch
// split off at, and every changed file with its hunks. `git(args)` runs one
// git command and resolves to { exitCode, stdout, stderr }, never throwing.

export const WHOLE_FILE = 1000000
export const CHANGED_PARTS = 3
export const UNTRACKED_LIMIT = 50
const UNTRACKED_MAX_SIZE = '1m' // past this, git calls an untracked file binary instead of printing it

const DIFF = ['-c', 'core.quotePath=false', 'diff', '--no-ext-diff', '--no-textconv', '--no-renames']

const exists = async (git, ref) => (await git(['rev-parse', '--verify', '--quiet', ref + '^{commit}'])).exitCode === 0

// The branch this one forked from: `git config branch-diff.base` if set, else the
// remote's default, else origin/main, origin/master, main, master. Remote branches
// come first: a local main is often behind, or is the very branch being worked on.
async function detectBase(git) {
  const configured = (await git(['config', '--get', 'branch-diff.base'])).stdout?.trim()
  if (configured) return (await exists(git, configured)) ? { base: configured } : { error: 'branch-diff.base is set to ' + configured + ', which does not exist.' }
  const remote = await git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
  const remoteHead = remote.exitCode === 0 ? remote.stdout.trim() : ''
  // origin/HEAD is never updated by a fetch, so it can name a branch that is gone.
  const candidates = new Set([remoteHead, 'origin/main', 'origin/master', 'main', 'master'].filter(Boolean))
  for (const name of candidates) {
    if (await exists(git, name)) return { base: name }
  }
  return { error: 'No base branch found (looked for origin/HEAD, origin/main, origin/master, main, master). Set one with `git config branch-diff.base <branch>`.' }
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

// Files git does not track yet and does not ignore, each diffed against nothing,
// up to UNTRACKED_LIMIT of them. Paths are from the top of the repo, like `git diff`'s.
async function loadUntracked(git, contextLines) {
  const [listed, top] = await Promise.all([
    git(['ls-files', '-z', '--others', '--exclude-standard', '--full-name', ':/']),
    git(['rev-parse', '--show-toplevel']),
  ])
  // A nested repo is listed as its folder, ending in '/', and has no text to show.
  const paths = listed.exitCode === 0 ? listed.stdout.split('\0').filter((path) => path && !path.endsWith('/')) : []
  const topDir = top.stdout?.trim()
  if (paths.length === 0 || !topDir) return { files: [], hiddenCount: 0 }
  const shown = paths.slice(0, UNTRACKED_LIMIT)
  const files = await Promise.all(shown.map((path) => loadUntrackedFile(git, topDir, path, contextLines)))
  return { files, hiddenCount: paths.length - shown.length }
}

async function loadUntrackedFile(git, topDir, path, contextLines) {
  // --no-index exits 1 when the sides differ, which they always do here.
  const r = await git(['-C', topDir, '-c', 'core.bigFileThreshold=' + UNTRACKED_MAX_SIZE, ...DIFF, '--no-index', '-U' + contextLines, '--', '/dev/null', path])
  const isBinary = /^Binary files /m.test(r.stdout ?? '')
  // The diff holds only this file, and its header can quote the name, so it is not looked up by name.
  const [hunks = []] = isBinary ? [] : parseHunks(r.stdout ?? '').values()
  const added = hunks.reduce((n, h) => n + h.lines.filter((l) => l[0] === '+').length, 0)
  return { path, added, removed: 0, isBinary, hunks, isUntracked: true }
}

// Fills in each changed file's hunks and uncommitted tag, or returns git's error.
async function addHunks(git, files, forkPoint, contextLines) {
  if (files.length === 0) return null
  const [patch, uncommitted] = await Promise.all([git([...DIFF, '-U' + contextLines, forkPoint]), listUncommitted(git)])
  if (patch.exitCode !== 0) return patch.stderr.trim() || 'git diff failed'
  const hunksByPath = parseHunks(patch.stdout)
  for (const file of files) {
    file.hunks = hunksByPath.get(file.path) ?? []
    file.isUncommitted = uncommitted.has(file.path)
  }
  return null
}

// Every worktree of the repo, each `{ path, branch }`; branch is undefined on a detached HEAD.
export async function listWorktrees(git) {
  const r = await git(['worktree', 'list', '--porcelain'])
  if (r.exitCode !== 0) return []
  return r.stdout.split('\n\n').map(parseWorktree).filter((w) => w.path && !w.isBare)
}

function parseWorktree(block) {
  const fields = new Map(block.split('\n').filter(Boolean).map((line) => [line.split(' ', 1)[0], line.slice(line.indexOf(' ') + 1)]))
  return { path: fields.get('worktree'), branch: fields.get('branch')?.replace(/^refs\/heads\//, ''), isBare: fields.has('bare') }
}

// The deepest worktree holding the path, since worktrees can sit inside the main one.
export function worktreeHolding(worktrees, path) {
  const holders = worktrees.filter((w) => path === w.path || path.startsWith(w.path + '/'))
  return holders.sort((a, b) => b.path.length - a.path.length)[0]
}

// Everything the pane shows, or an error to show instead.
export async function loadBranchDiff(git, contextLines) {
  const { base, error } = await detectBase(git)
  if (!base) return { error }
  const forkPoint = await findForkPoint(git, base)
  if (!forkPoint) return { base, error: 'This branch shares no history with ' + base + '.' }

  const stat = await git([...DIFF, '--numstat', forkPoint])
  if (stat.exitCode !== 0) return { base, error: stat.stderr.trim() || 'git diff failed' }
  const files = parseNumstat(stat.stdout)
  const [hunksError, untracked] = await Promise.all([addHunks(git, files, forkPoint, contextLines), loadUntracked(git, contextLines)])
  if (hunksError) return { base, error: hunksError }
  return { base, files: [...files, ...untracked.files], untrackedHiddenCount: untracked.hiddenCount }
}
