import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LEGACY_COMMAND, makeHome, OURS, PLUGIN, readSettings, run, settingsPath, TARGETS, withTools, writeSettings } from './harness'

const OTHER = { type: 'command', command: 'bash ~/other.sh' }

function installed(settings: object, args: string[] = []): string {
  const home = makeHome()
  withTools(home)
  writeSettings(home, settings)
  expect(run(PLUGIN, 'install.sh', home, args).code).toBe(0)
  return home
}

describe('uninstall', () => {
  test('removes our block and the four files', () => {
    const home = installed({ theme: 'dark' })
    const { code, stdout } = run(PLUGIN, 'uninstall.sh', home)
    expect(code).toBe(0)
    const settings = readSettings(home)
    expect(settings).not.toHaveProperty('statusLine')
    expect(settings.theme).toBe('dark')
    for (const target of Object.values(TARGETS)) expect(existsSync(join(home, target))).toBe(false)
    expect(existsSync(join(home, '.local/bin/cship'))).toBe(true)
    expect(stdout).toContain('~/.local/bin')
    expect(stdout.trimEnd().endsWith('Start a new session.')).toBe(true)
  })

  test('puts back the replaced statusLine', () => {
    const home = installed({ statusLine: OTHER }, ['--replace'])
    expect(run(PLUGIN, 'uninstall.sh', home).code).toBe(0)
    expect(readSettings(home).statusLine).toEqual(OTHER)
    expect(existsSync(join(home, '.claude/statusline-previous.json'))).toBe(false)
  })

  test('a statusLine that is not ours is left alone', () => {
    const home = makeHome()
    writeSettings(home, { statusLine: OTHER })
    const before = readFileSync(settingsPath(home), 'utf8')
    const { code, stdout } = run(PLUGIN, 'uninstall.sh', home)
    expect(code).toBe(0)
    expect(stdout).toContain('not the one this plugin installed')
    expect(readFileSync(settingsPath(home), 'utf8')).toBe(before)
    expect(existsSync(join(home, '.claude/settings.json.statusline-backup'))).toBe(false)
  })

  test('invalid settings.json changes nothing', () => {
    const home = installed({})
    writeSettings(home, '{oops')
    expect(run(PLUGIN, 'uninstall.sh', home).code).toBe(1)
    for (const target of Object.values(TARGETS)) expect(existsSync(join(home, target))).toBe(true)
  })

  test('removes the old unquoted block too', () => {
    const home = makeHome()
    writeSettings(home, { statusLine: { ...OURS, command: LEGACY_COMMAND } })
    expect(run(PLUGIN, 'uninstall.sh', home).code).toBe(0)
    expect(readSettings(home)).not.toHaveProperty('statusLine')
  })

  test('a broken saved statusLine stops with a clear message', () => {
    const home = installed({ statusLine: OTHER }, ['--replace'])
    writeFileSync(join(home, '.claude/statusline-previous.json'), '{oops')
    const before = readFileSync(settingsPath(home), 'utf8')
    const { code, stderr } = run(PLUGIN, 'uninstall.sh', home)
    expect(code).toBe(1)
    expect(stderr).toContain('statusline-previous.json')
    expect(readFileSync(settingsPath(home), 'utf8')).toBe(before)
  })

  test('backs up before writing', () => {
    const home = installed({ theme: 'dark' })
    const before = readFileSync(settingsPath(home), 'utf8')
    run(PLUGIN, 'uninstall.sh', home)
    expect(readFileSync(join(home, '.claude/settings.json.statusline-backup'), 'utf8')).toBe(before)
  })
})
