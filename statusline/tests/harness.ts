import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

export const PLUGIN = resolve(import.meta.dir, '..')

export const OURS = {
  type: 'command',
  command: 'bash "$HOME/.claude/cship-responsive.sh"',
  padding: 0,
  refreshInterval: 30,
}

export const LEGACY_COMMAND = 'bash $HOME/.claude/cship-responsive.sh'

export const TARGETS: Record<string, string> = {
  'cship-responsive.sh': '.claude/cship-responsive.sh',
  'cache-ttl.sh': '.claude/cache-ttl.sh',
  'cship-full.toml': '.config/cship-full.toml',
  'cship-compact.toml': '.config/cship-compact.toml',
}

export function makeHome(opts: { space?: boolean } = {}): string {
  return mkdtempSync(join(tmpdir(), opts.space ? 'statusline home-' : 'statusline-'))
}

export function writeExecutable(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`)
  chmodSync(path, 0o755)
}

export function withTools(home: string, versions: { cship?: string; starship?: string } = {}): void {
  const bin = join(home, '.local/bin')
  writeExecutable(join(bin, 'cship'), `echo "cship ${versions.cship ?? '1.8.1'}"`)
  writeExecutable(join(bin, 'starship'), `echo "starship ${versions.starship ?? '1.26.0'}"`)
}

export function pluginCopy(): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'statusline-plugin-')), 'statusline')
  cpSync(PLUGIN, dir, { recursive: true })
  return dir
}

export const STUBS = mkdtempSync(join(tmpdir(), 'statusline-stubs-'))
writeExecutable(join(STUBS, 'uname'), '[ "${1:-}" = -m ] && { echo "$FAKE_ARCH"; exit 0; }\nexec /usr/bin/uname "$@"')
writeExecutable(
  join(STUBS, 'curl'),
  [
    'out=""; url=""',
    'while [ $# -gt 0 ]; do case "$1" in -o) out=$2; shift 2 ;; -*) shift ;; *) url=$1; shift ;; esac; done',
    'echo "$url" >>"$FAKE_DL/curl.log"',
    'src="$FAKE_DL/${url##*/}"',
    '[ -f "$src" ] || exit 22',
    'cp "$src" "$out"',
  ].join('\n'),
)

const ARCHES = ['x86_64', 'aarch64']

export function fixtures(plugin: string, versions: { cship?: string; starship?: string } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'statusline-dl-'))
  const build = mkdtempSync(join(tmpdir(), 'statusline-build-'))
  writeExecutable(join(build, 'starship'), `echo "starship ${versions.starship ?? '1.26.0'}"`)
  let pins = readFileSync(join(plugin, 'scripts/pins.sh'), 'utf8')
  for (const arch of ARCHES) {
    writeExecutable(join(dir, `cship-${arch}-unknown-linux-musl`), `echo "cship ${versions.cship ?? '9.9.9'}"`)
    const tarball = join(dir, `starship-${arch}-unknown-linux-musl.tar.gz`)
    Bun.spawnSync(['tar', '-czf', tarball, '-C', build, 'starship'])
    const sha = new Bun.CryptoHasher('sha256').update(readFileSync(tarball)).digest('hex')
    pins = pins.replace(new RegExp(`^STARSHIP_${arch}_SHA256=.*$`, 'm'), `STARSHIP_${arch}_SHA256=${sha}`)
  }
  writeFileSync(join(plugin, 'scripts/pins.sh'), pins)
  return dir
}

// The real PATH minus folders holding a real cship or starship, so tests only see fake ones.
export const BASE_PATH = process.env
  .PATH!.split(':')
  .filter((dir) => !existsSync(join(dir, 'cship')) && !existsSync(join(dir, 'starship')))
  .join(':')

type Env = { PATH?: string; FAKE_ARCH?: string; FAKE_DL?: string; OS_RELEASE?: string }

export function run(plugin: string, script: 'install.sh' | 'uninstall.sh', home: string, args: string[] = [], env: Env = {}) {
  const result = Bun.spawnSync(['bash', join(plugin, 'scripts', script), ...args], {
    env: {
      HOME: home,
      PATH: env.PATH ?? `${STUBS}:${BASE_PATH}`,
      FAKE_ARCH: env.FAKE_ARCH ?? 'x86_64',
      ...(env.FAKE_DL && { FAKE_DL: env.FAKE_DL }),
      ...(env.OS_RELEASE && { OS_RELEASE: env.OS_RELEASE }),
    },
  })
  return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() }
}

export function pathWithout(...tools: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'statusline-path-'))
  for (const name of readdirSync('/usr/bin')) {
    if (!tools.includes(name)) symlinkSync(join('/usr/bin', name), join(dir, name))
  }
  return dir
}

export function osRelease(content: string): string {
  const file = join(mkdtempSync(join(tmpdir(), 'statusline-os-')), 'os-release')
  writeFileSync(file, content)
  return file
}

export function settingsPath(home: string): string {
  return join(home, '.claude/settings.json')
}

export function readSettings(home: string): any {
  return JSON.parse(readFileSync(settingsPath(home), 'utf8'))
}

export function writeSettings(home: string, value: unknown): void {
  mkdirSync(join(home, '.claude'), { recursive: true })
  writeFileSync(settingsPath(home), typeof value === 'string' ? value : JSON.stringify(value, null, 2))
}
