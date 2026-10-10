import { describe, expect, mock, test } from 'claude-code/testing'
import { START, fakeEngine } from './fake-engine.ts'
import { runInstall, runUninstall } from './install.js'

const ALL_TOOLS = ['cship', 'starship', 'jq', 'secret-tool', 'dnf']
const STOPPED = 'Install stopped. The statusline is still off.'
const CSHIP_URL = 'https://github.com/stephenleo/cship/releases/download/v1.8.1/cship-x86_64-unknown-linux-musl'
const CSHIP_SHA256 = 'f39e0423a2260b2886ba8952504f9f3e16acd4071834fa419ffef5e4cf84c506'

type FakeOpts = {
  tools?: string[]
  uname?: string
  answers?: string[]
  sources?: object
  store?: object
  failInstall?: boolean
  silentFail?: boolean
  timeout?: boolean
  rmFails?: boolean
}

// What runInstall reaches the engine through, answered from memory: `tools` are on PATH,
// `answers` are the person's picks in order (none left = the dialog is dismissed).
// `silentFail`: an install step exits 0 but the tool is still missing, as `curl | sh` does when curl fails.
// `timeout`: an install step's run rejects, as $.process.run does past its timeout.
function fakeIo(opts: FakeOpts = {}) {
  const tools = [...(opts.tools ?? ALL_TOOLS)]
  const answers = [...(opts.answers ?? [])]
  const store: Record<string, unknown> = { ...opts.store }
  const del = async (key: string) => {
    delete store[key]
  }
  const runs: string[][] = []
  const asks: string[] = []
  let isActivated = false
  const io = {
    run: async (argv: string[]) => {
      runs.push(argv)
      if (argv[0] === 'uname') return { exitCode: 0, stdout: `${opts.uname ?? 'Linux x86_64'}\n`, stderr: '' }
      if (argv[2]?.includes('command -v')) return { exitCode: tools.includes(argv[4]) ? 0 : 1, stdout: '', stderr: '' }
      if (argv[2] === 'rm -f "$HOME/.local/bin/cship"') {
        return opts.rmFails ? { exitCode: 1, stdout: '', stderr: 'rm: Operation not permitted\n' } : { exitCode: 0, stdout: '', stderr: '' }
      }
      if (opts.timeout) throw new Error('process.run: still running after 120000 ms')
      if (opts.failInstall) return { exitCode: 22, stdout: '', stderr: 'curl: (22) 404\nmore' }
      if (opts.silentFail) return { exitCode: 0, stdout: '', stderr: '' }
      tools.push(argv.includes(CSHIP_URL) ? 'cship' : 'starship')
      return { exitCode: 0, stdout: '', stderr: '' }
    },
    ask: async (question: string) => {
      asks.push(question)
      const answer = answers.shift()
      if (answer === undefined) throw new Error('dismissed')
      return answer
    },
    get: async (key: string) => store[key],
    set: async (key: string, value: unknown) => {
      store[key] = value
    },
    delete: del,
    readSource: async (source: string) => opts.sources?.[source] ?? {},
    root: async () => '/repo',
    activate: async () => {
      isActivated = true
    },
    deactivate: async () => {
      isActivated = false
    },
  }
  return { io, runs, asks, store, isActivated: () => isActivated }
}

describe('runUninstall', () => {
  test('already off', async () => {
    const fake = fakeIo()
    expect(await runUninstall(fake.io)).toBe('Statusline is already off.')
    expect(fake.asks).toHaveLength(0)
  })

  test('turn off', async () => {
    const fake = fakeIo({ store: { active: true }, answers: ['Turn off'] })
    await fake.io.activate()
    expect(await runUninstall(fake.io)).toBe('Statusline off. Run /statusline-install to turn it back on.')
    expect(fake.store.active).toBe(false)
    expect(fake.isActivated()).toBe(false)
    expect(fake.runs).toHaveLength(0)
  })

  test('offers to delete cship only when the mod installed it', async () => {
    const offered: unknown[] = []
    const fake = fakeIo({ store: { active: true }, answers: ['Turn off'] })
    fake.io.ask = async (question: string, options?: unknown) => (offered.push(options), 'Turn off')
    await runUninstall(fake.io)
    expect(offered).toEqual([['Turn off', 'Cancel']])
  })

  test('turn off and delete cship', async () => {
    const fake = fakeIo({ store: { active: true, installedCship: true }, answers: ['Turn off and delete cship'] })
    expect(await runUninstall(fake.io)).toBe('Statusline off, cship deleted. Run /statusline-install to turn it back on.')
    expect(fake.runs).toEqual([['bash', '-c', 'rm -f "$HOME/.local/bin/cship"']])
    expect(fake.store.installedCship).toBeUndefined()
    expect(fake.store.active).toBe(false)
  })

  test('a failed delete says so and keeps the offer', async () => {
    const fake = fakeIo({ store: { active: true, installedCship: true }, answers: ['Turn off and delete cship'], rmFails: true })
    expect(await runUninstall(fake.io)).toBe(
      'Statusline off. Could not delete cship: rm: Operation not permitted. Run /statusline-install to turn it back on.',
    )
    expect(fake.store.installedCship).toBe(true)
    expect(fake.store.active).toBe(false)
  })

  test('cancel changes nothing', async () => {
    for (const answers of [['Cancel'], []]) {
      const fake = fakeIo({ store: { active: true }, answers })
      expect(await runUninstall(fake.io)).toBe('Nothing changed.')
      expect(fake.store.active).toBe(true)
    }
  })
})

describe('runInstall', () => {
  test('downloads cship for this platform', async () => {
    const fake = fakeIo({ tools: ALL_TOOLS.filter((t) => t !== 'cship'), answers: ['Download'] })
    expect(await runInstall(fake.io)).toBe('Statusline on.')
    expect(fake.store).toEqual({ installedCship: true, active: true })
    expect(fake.isActivated()).toBe(true)
  })

  test('downloads a pinned cship and checks its sha256 before it lands', async () => {
    const fake = fakeIo({ tools: ALL_TOOLS.filter((t) => t !== 'cship'), answers: ['Download'] })
    await runInstall(fake.io)
    const download = fake.runs.find((argv) => argv.includes(CSHIP_URL))
    expect(download?.slice(-2)).toEqual([CSHIP_URL, CSHIP_SHA256])
    const script = download?.[2] ?? ''
    expect(script.indexOf('"$2"')).toBeGreaterThan(-1) // the checksum is compared
    expect(script.indexOf('"$2"')).toBeLessThan(script.indexOf('mv ')) // before the binary is moved into place
  })

  test('a download that times out is a failed step', async () => {
    const fake = fakeIo({ tools: ['starship', 'jq', 'secret-tool'], answers: ['Download'], timeout: true })
    expect(await runInstall(fake.io)).toBe('Could not install cship: process.run: still running after 120000 ms')
    expect(fake.store.active).toBeUndefined()
  })

  test('a platform cship has no build for', async () => {
    const fake = fakeIo({ tools: ['starship', 'jq'], uname: 'FreeBSD amd64' })
    expect(await runInstall(fake.io)).toBe('cship has no build for FreeBSD amd64. Install it by hand: https://github.com/stephenleo/cship')
    expect(fake.asks).toHaveLength(0)
  })

  test('installs starship into ~/.local/bin', async () => {
    const fake = fakeIo({ tools: ALL_TOOLS.filter((t) => t !== 'starship'), answers: ['Install'] })
    expect(await runInstall(fake.io)).toBe('Statusline on.')
    const script = fake.runs.find((argv) => argv[2]?.includes('starship.rs/install.sh'))?.[2]
    expect(script).toContain('--yes --bin-dir "$HOME/.local/bin"')
    expect(script).toContain('mkdir -p "$HOME/.local/bin" && ') // the starship installer needs the folder to exist
  })

  test('lists the sudo command for dnf', async () => {
    const fake = fakeIo({ tools: ['cship', 'starship', 'dnf'] })
    expect(await runInstall(fake.io)).toBe('Run this, then /statusline-install again:\n! sudo dnf install jq libsecret')
    expect(fake.store.active).toBeUndefined()
  })

  test('apt-get package names', async () => {
    const fake = fakeIo({ tools: ['cship', 'starship', 'apt-get'] })
    expect(await runInstall(fake.io)).toContain('! sudo apt-get install jq libsecret-tools')
  })

  test('brew takes no sudo', async () => {
    const fake = fakeIo({ tools: ['cship', 'starship', 'brew'] })
    expect(await runInstall(fake.io)).toContain('! brew install jq libsecret')
  })

  test('macOS needs no secret-tool', async () => {
    const fake = fakeIo({ tools: ['cship', 'starship', 'jq'], uname: 'Darwin arm64' })
    expect(await runInstall(fake.io)).toBe('Statusline on.')
  })

  test('no package manager found', async () => {
    const fake = fakeIo({ tools: ['cship', 'starship'] })
    expect(await runInstall(fake.io)).toBe('Install jq and secret-tool, then run /statusline-install again.')
  })

  test('cancel stops everything', async () => {
    const fake = fakeIo({ tools: ['jq', 'secret-tool'], answers: ['Cancel'] })
    expect(await runInstall(fake.io)).toBe(STOPPED)
    expect(fake.runs.some((argv) => argv[0] === 'bash' && argv[2]?.includes('curl'))).toBe(false)
    expect(fake.store.active).toBeUndefined()
  })

  test('a dismissed dialog stops everything', async () => {
    const fake = fakeIo({ tools: ['jq', 'secret-tool'] })
    expect(await runInstall(fake.io)).toBe(STOPPED)
    expect(fake.store.active).toBeUndefined()
  })

  test('a failed download names the step', async () => {
    const fake = fakeIo({ tools: ['starship', 'jq', 'secret-tool'], answers: ['Download'], failInstall: true })
    expect(await runInstall(fake.io)).toBe('Could not install cship: curl: (22) 404')
    expect(fake.store.active).toBeUndefined()
  })

  test('an install that exits 0 but leaves no tool is a failure', async () => {
    const fake = fakeIo({ tools: ALL_TOOLS.filter((t) => t !== 'starship'), answers: ['Install'], silentFail: true })
    expect(await runInstall(fake.io)).toBe('Could not install starship: it is still not on PATH after the install.')
    expect(fake.store.active).toBeUndefined()
  })

  test('the starship install fails when curl fails', async () => {
    const fake = fakeIo({ tools: ALL_TOOLS.filter((t) => t !== 'starship'), answers: ['Install'] })
    await runInstall(fake.io)
    expect(fake.runs.find((argv) => argv[2]?.includes('starship.rs'))?.[2]).toMatch(/^set -o pipefail; /)
  })

  test('stops on an existing statusline', async () => {
    const fake = fakeIo({ sources: { user: { statusLine: {} } } })
    expect(await runInstall(fake.io)).toBe(
      'You already use a statusline (statusLine in ~/.claude/settings.json). Remove it there, then run /statusline-install again.',
    )
    expect(fake.runs).toHaveLength(0)
    expect(fake.asks).toHaveLength(0)
  })

  test('already on', async () => {
    const fake = fakeIo({ store: { active: true } })
    expect(await runInstall(fake.io)).toBe('Statusline is already on.')
    expect(fake.isActivated()).toBe(false)
  })

  test('already on asks and probes nothing', async () => {
    const fake = fakeIo({ tools: [], store: { active: true } })
    expect(await runInstall(fake.io)).toBe('Statusline is already on.')
    expect(fake.runs).toHaveLength(0)
    expect(fake.asks).toHaveLength(0)
  })
})

const WELCOME = 'statusline: run /statusline-install to turn it on'

test('welcome once, after install', async ($, on) => {
  mock.store(on, {})
  mock.clock(on)
  const { toasts, commands } = fakeEngine(on)
  await $.session.start(START)
  expect(commands).toEqual(['statusline-install', 'statusline-uninstall'])
  await $.session.start(START)
  expect(toasts).toEqual([WELCOME])
})

test('no welcome when not interactive or already on', async ($, on) => {
  mock.store(on, { active: true })
  mock.clock(on)
  const { toasts } = fakeEngine(on)
  await $.session.start(START)
  await $.session.start({ ...START, isInteractive: false })
  expect(toasts).toEqual([])
})

test('/statusline-install answers through the command', async ($, on) => {
  mock.store(on, {})
  mock.clock(on)
  fakeEngine(on, { settings: { user: { statusLine: {} } } })
  await $.session.start(START)
  const { text } = await $.command.run({ command: 'statusline-install', args: '' } as never)
  expect(text).toContain('You already use a statusline')
})
