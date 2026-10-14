import { describe, expect, test } from 'bun:test'
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  BASE_PATH,
  fixtures,
  LEGACY_COMMAND,
  makeHome,
  osRelease,
  OURS,
  pathWithout,
  PLUGIN,
  pluginCopy,
  readSettings,
  run,
  settingsPath,
  STUBS,
  TARGETS,
  withTools,
  writeExecutable,
  writeSettings,
} from './harness'

const BACKUP = '.claude/settings.json.statusline-backup'

function targetsExist(home: string): boolean[] {
  return Object.values(TARGETS).map((target) => existsSync(join(home, target)))
}

describe('install', () => {
  test('fresh install copies the four files and writes the block', () => {
    const home = makeHome()
    withTools(home)
    const { code, stdout } = run(PLUGIN, 'install.sh', home)
    expect(code).toBe(0)
    for (const [file, target] of Object.entries(TARGETS)) {
      expect(readFileSync(join(home, target), 'utf8')).toBe(readFileSync(join(PLUGIN, 'files', file), 'utf8'))
    }
    expect(readSettings(home).statusLine).toEqual(OURS)
    expect(stdout).not.toContain('settings.json.statusline-backup')
    expect(stdout.trimEnd().endsWith('Start a new session to see the line.')).toBe(true)
  })

  test('creates ~/.claude and ~/.config on a brand-new machine', () => {
    const home = makeHome()
    withTools(home)
    expect(run(PLUGIN, 'install.sh', home).code).toBe(0)
    expect(statSync(join(home, '.claude')).isDirectory()).toBe(true)
    expect(statSync(join(home, '.config')).isDirectory()).toBe(true)
  })

  test('keeps other keys and backs up the old file', () => {
    const home = makeHome()
    withTools(home)
    writeSettings(home, { theme: 'dark', hooks: { Stop: [] } })
    const before = readFileSync(settingsPath(home), 'utf8')
    const { code, stdout } = run(PLUGIN, 'install.sh', home)
    expect(code).toBe(0)
    const after = readSettings(home)
    expect(after.theme).toBe('dark')
    expect(after.hooks).toEqual({ Stop: [] })
    expect(readFileSync(join(home, BACKUP), 'utf8')).toBe(before)
    expect(stdout).toContain('settings.json.statusline-backup')
  })

  test('re-run leaves settings alone', () => {
    const home = makeHome()
    withTools(home)
    writeSettings(home, { theme: 'dark' })
    expect(run(PLUGIN, 'install.sh', home).code).toBe(0)
    rmSync(join(home, BACKUP))
    const content = readFileSync(settingsPath(home), 'utf8')
    const mtime = statSync(settingsPath(home)).mtimeMs
    expect(run(PLUGIN, 'install.sh', home).code).toBe(0)
    expect(readFileSync(settingsPath(home), 'utf8')).toBe(content)
    expect(statSync(settingsPath(home)).mtimeMs).toBe(mtime)
    expect(existsSync(join(home, BACKUP))).toBe(false)
  })

  test('invalid settings.json changes nothing', () => {
    const home = makeHome()
    withTools(home)
    writeSettings(home, '{oops')
    const { code, stderr } = run(PLUGIN, 'install.sh', home)
    expect(code).toBe(1)
    expect(stderr).toContain('settings.json')
    expect(targetsExist(home)).toEqual([false, false, false, false])
    expect(readFileSync(settingsPath(home), 'utf8')).toBe('{oops')
  })

  test('writes through a symlinked settings.json', () => {
    const home = makeHome()
    withTools(home)
    mkdirSync(join(home, 'dotfiles'))
    writeSettings(home, {})
    const real = join(home, 'dotfiles/settings.json')
    writeFileSync(real, '{"theme":"dark"}')
    rmSync(settingsPath(home))
    symlinkSync(real, settingsPath(home))
    expect(run(PLUGIN, 'install.sh', home).code).toBe(0)
    expect(lstatSync(settingsPath(home)).isSymbolicLink()).toBe(true)
    expect(JSON.parse(readFileSync(real, 'utf8')).statusLine).toEqual(OURS)
  })

  test('works with a space in HOME', () => {
    const home = makeHome({ space: true })
    withTools(home)
    expect(run(PLUGIN, 'install.sh', home).code).toBe(0)
    expect(readSettings(home).statusLine).toEqual(OURS)
  })

  test('the installed command runs with a space in HOME', () => {
    const home = makeHome({ space: true })
    withTools(home)
    expect(run(PLUGIN, 'install.sh', home).code).toBe(0)
    const line = Bun.spawnSync(['bash', '-c', readSettings(home).statusLine.command], {
      env: { HOME: home, PATH: process.env.PATH!, COLUMNS: '120' },
      stdin: Buffer.from('{}'),
    })
    expect(line.stderr.toString()).toBe('')
    expect(line.exitCode).toBe(0)
  })

  test('the old unquoted block counts as ours', () => {
    const home = makeHome()
    withTools(home)
    writeSettings(home, { statusLine: { ...OURS, command: LEGACY_COMMAND } })
    expect(run(PLUGIN, 'install.sh', home).code).toBe(0)
    expect(readSettings(home).statusLine).toEqual(OURS)
  })

  test("backs up the user's own copy of a line file", () => {
    const home = makeHome()
    withTools(home)
    mkdirSync(join(home, '.config'))
    writeFileSync(join(home, '.config/cship-full.toml'), 'mine')
    expect(run(PLUGIN, 'install.sh', home).code).toBe(0)
    expect(readFileSync(join(home, '.config/cship-full.toml.statusline-backup'), 'utf8')).toBe('mine')
  })

  test('re-install does not back up its own files', () => {
    const home = makeHome()
    withTools(home)
    run(PLUGIN, 'install.sh', home)
    writeFileSync(join(home, '.config/cship-full.toml'), 'older plugin version')
    expect(run(PLUGIN, 'install.sh', home).code).toBe(0)
    expect(existsSync(join(home, '.config/cship-full.toml.statusline-backup'))).toBe(false)
  })

  test('a statusLine that is not an object stops with a clear message', () => {
    const home = makeHome()
    withTools(home)
    writeSettings(home, { statusLine: 'foo' })
    const { code, stderr } = run(PLUGIN, 'install.sh', home)
    expect(code).toBe(1)
    expect(stderr).toContain('statusLine')
    expect(stderr).not.toContain('jq: error')
  })
})

describe('system tools', () => {
  const NO_JQ = pathWithout('jq')

  function installWithoutJq(release: string) {
    const home = makeHome()
    withTools(home)
    writeSettings(home, { theme: 'dark' })
    return { home, ...run(PLUGIN, 'install.sh', home, [], { PATH: NO_JQ, OS_RELEASE: osRelease(release) }) }
  }

  test('missing jq prints the dnf command on Fedora and changes nothing', () => {
    const { home, code, stderr } = installWithoutJq('ID=fedora\n')
    expect(code).toBe(1)
    expect(stderr).toContain('sudo dnf install jq')
    expect(targetsExist(home)).toEqual([false, false, false, false])
    expect(readSettings(home)).toEqual({ theme: 'dark' })
  })

  test('missing jq prints the apt command on Ubuntu', () => {
    const { stderr } = installWithoutJq('ID=ubuntu\nID_LIKE=debian\n')
    expect(stderr).toContain('sudo apt install jq')
  })

  test('unknown distro names the missing tools', () => {
    const { code, stderr } = installWithoutJq('ID=arch\n')
    expect(code).toBe(1)
    expect(stderr).toContain('jq')
    expect(stderr).not.toContain('sudo')
  })
})

describe('replace', () => {
  const OTHER = { type: 'command', command: 'bash ~/other.sh' }
  const PREVIOUS = '.claude/statusline-previous.json'

  function withOther() {
    const home = makeHome()
    withTools(home)
    writeSettings(home, { theme: 'dark', statusLine: OTHER })
    return home
  }

  test('a different statusLine stops and names it', () => {
    const home = withOther()
    const before = readFileSync(settingsPath(home), 'utf8')
    const { code, stdout } = run(PLUGIN, 'install.sh', home)
    expect(code).toBe(10)
    expect(stdout.trim()).toBe('replace bash ~/other.sh')
    expect(readFileSync(settingsPath(home), 'utf8')).toBe(before)
    expect(targetsExist(home)).toEqual([false, false, false, false])
  })

  test('both choices come in one stop', () => {
    const home = makeHome()
    writeSettings(home, { statusLine: OTHER })
    const plugin = pluginCopy()
    const { code, stdout } = run(plugin, 'install.sh', home, [], { FAKE_DL: fixtures(plugin) })
    expect(code).toBe(10)
    expect(stdout.trim().split('\n')).toEqual([
      'replace bash ~/other.sh',
      'download cship none latest',
      'download starship none 1.26.0',
    ])
  })

  test('--replace saves the old block and writes ours', () => {
    const home = withOther()
    expect(run(PLUGIN, 'install.sh', home, ['--replace']).code).toBe(0)
    expect(JSON.parse(readFileSync(join(home, PREVIOUS), 'utf8'))).toEqual(OTHER)
    expect(readSettings(home).statusLine).toEqual(OURS)
  })

  test('a command with a newline stays on one line', () => {
    const home = makeHome()
    withTools(home)
    writeSettings(home, { statusLine: { type: 'command', command: 'bash a\nb' } })
    const { code, stdout } = run(PLUGIN, 'install.sh', home)
    expect(code).toBe(10)
    expect(stdout.trim().split('\n')).toEqual(['replace bash a b'])
  })

  test('a statusLine removed by hand forgets the saved one', () => {
    const home = withOther()
    run(PLUGIN, 'install.sh', home, ['--replace'])
    writeSettings(home, { theme: 'dark' })
    expect(run(PLUGIN, 'install.sh', home).code).toBe(0)
    expect(existsSync(join(home, PREVIOUS))).toBe(false)
  })

  test('re-run after replace keeps the saved block', () => {
    const home = withOther()
    run(PLUGIN, 'install.sh', home, ['--replace'])
    const saved = readFileSync(join(home, PREVIOUS), 'utf8')
    expect(run(PLUGIN, 'install.sh', home).code).toBe(0)
    expect(readFileSync(join(home, PREVIOUS), 'utf8')).toBe(saved)
  })
})

describe('downloads', () => {
  function setup(opts: { tools?: Parameters<typeof withTools>[1] } = {}) {
    const home = makeHome()
    const plugin = pluginCopy()
    const dl = fixtures(plugin)
    if (opts.tools) withTools(home, opts.tools)
    const install = (args: string[] = [], arch = 'x86_64') => run(plugin, 'install.sh', home, args, { FAKE_DL: dl, FAKE_ARCH: arch })
    return { home, plugin, dl, install, bin: join(home, '.local/bin') }
  }

  function version(path: string): string {
    return Bun.spawnSync([path, '--version']).stdout.toString().trim()
  }

  function nothingChanged(home: string) {
    expect(existsSync(join(home, '.local/bin/cship'))).toBe(false)
    expect(existsSync(join(home, '.local/bin/starship'))).toBe(false)
    expect(targetsExist(home)).toEqual([false, false, false, false])
    expect(existsSync(settingsPath(home))).toBe(false)
  }

  test('missing tools ask before download and change nothing', () => {
    const { home, install } = setup()
    const { code, stdout } = install()
    expect(code).toBe(10)
    expect(stdout.trim().split('\n')).toEqual(['download cship none latest', 'download starship none 1.26.0'])
    nothingChanged(home)
  })

  test('--download installs both and finishes', () => {
    const { home, install, bin } = setup()
    expect(install(['--download']).code).toBe(0)
    expect(version(join(bin, 'cship'))).toBe('cship 9.9.9')
    expect(version(join(bin, 'starship'))).toBe('starship 1.26.0')
    expect(readSettings(home).statusLine).toEqual(OURS)
  })

  test('any existing cship is kept', () => {
    const { install, bin } = setup({ tools: { cship: '1.0.0' } })
    const { code, stdout } = install()
    expect(code).toBe(0)
    expect(stdout).not.toContain('download cship')
    expect(version(join(bin, 'cship'))).toBe('cship 1.0.0')
  })

  test('an old starship is upgraded', () => {
    const { install, bin } = setup({ tools: { starship: '1.20.0' } })
    const asked = install()
    expect(asked.code).toBe(10)
    expect(asked.stdout.trim().split('\n')).toEqual(['download starship 1.20.0 1.26.0'])
    expect(install(['--download']).code).toBe(0)
    expect(version(join(bin, 'starship'))).toBe('starship 1.26.0')
  })

  test('a newer starship is kept', () => {
    const { install, bin } = setup({ tools: { starship: '1.27.0' } })
    expect(install().code).toBe(0)
    expect(version(join(bin, 'starship'))).toBe('starship 1.27.0')
  })

  test('starship junk version output counts as unknown', () => {
    const { install, bin } = setup({ tools: {} })
    writeExecutable(join(bin, 'starship'), 'echo "starship garbage"')
    expect(install().stdout).toContain('download starship unknown 1.26.0')
  })

  test('a cship elsewhere on PATH is kept', () => {
    const { home, dl } = setup()
    const other = makeHome()
    writeExecutable(join(other, 'cship'), 'echo "cship 1.0.0"')
    withTools(home)
    rmSync(join(home, '.local/bin/cship'))
    const { code, stdout } = run(PLUGIN, 'install.sh', home, [], { FAKE_DL: dl, PATH: `${other}:${STUBS}:${BASE_PATH}` })
    expect(stdout).not.toContain('download cship')
    expect(code).toBe(0)
  })

  test('a later step failing leaves no binary behind', () => {
    const { home, install } = setup()
    writeFileSync(join(home, '.config'), 'a file, not a folder')
    expect(install(['--download']).code).not.toBe(0)
    expect(existsSync(join(home, '.local/bin/cship'))).toBe(false)
    expect(existsSync(join(home, '.local/bin/starship'))).toBe(false)
    expect(existsSync(settingsPath(home))).toBe(false)
  })

  test('a broken starship counts as unknown', () => {
    const { install, bin } = setup({ tools: {} })
    writeExecutable(join(bin, 'starship'), 'exit 1')
    expect(install().stdout).toContain('download starship unknown 1.26.0')
  })

  test('a hash mismatch leaves no binary', () => {
    const { home, dl, install } = setup()
    appendFileSync(join(dl, 'starship-x86_64-unknown-linux-musl.tar.gz'), 'tampered')
    const { code, stderr } = install(['--download'])
    expect(code).toBe(1)
    expect(stderr).toContain('sha256')
    nothingChanged(home)
  })

  test('a starship download that is not a tarball installs nothing', () => {
    const { home, plugin, dl, install } = setup()
    const tarball = join(dl, 'starship-x86_64-unknown-linux-musl.tar.gz')
    writeFileSync(tarball, 'not a tarball')
    const sha = new Bun.CryptoHasher('sha256').update(readFileSync(tarball)).digest('hex')
    const pins = join(plugin, 'scripts/pins.sh')
    writeFileSync(pins, readFileSync(pins, 'utf8').replace(/^STARSHIP_x86_64_SHA256=.*$/m, `STARSHIP_x86_64_SHA256=${sha}`))
    const { code, stderr } = install(['--download'])
    expect(code).toBe(1)
    expect(stderr).toContain('Nothing was installed')
    nothingChanged(home)
  })

  test('a failed download changes nothing', () => {
    const { home, dl, install } = setup()
    rmSync(join(dl, 'starship-x86_64-unknown-linux-musl.tar.gz'))
    expect(install(['--download']).code).toBe(1)
    nothingChanged(home)
  })

  test('aarch64 uses the aarch64 builds', () => {
    const { dl, install } = setup()
    expect(install(['--download'], 'aarch64').code).toBe(0)
    const log = readFileSync(join(dl, 'curl.log'), 'utf8')
    expect(log).toContain('cship-aarch64-unknown-linux-musl')
    expect(log).toContain('starship-aarch64-unknown-linux-musl.tar.gz')
  })

  test('an unknown CPU stops with links', () => {
    const { home, install } = setup()
    const { code, stderr } = install(['--download'], 'riscv64')
    expect(code).toBe(1)
    expect(stderr).toContain('https://github.com/stephenleo/cship')
    expect(stderr).toContain('https://github.com/starship/starship')
    nothingChanged(home)
  })
})
