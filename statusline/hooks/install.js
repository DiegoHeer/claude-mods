// /statusline-install: checks each tool the cship script needs, installs what it can
// without sudo (after asking), lists the sudo command for the rest, then turns the line on.
// `io` is how it reaches the engine; register.js builds it.

import { statusLineSources } from './settings.js'

const STOPPED = 'Install stopped. The statusline is still off.'
const AGAIN = '/statusline-install again'

const CSHIP_RELEASES = 'https://github.com/stephenleo/cship/releases/latest/download/cship-'
const CSHIP_TARGETS = {
  'Linux x86_64': 'x86_64-unknown-linux-musl',
  'Linux aarch64': 'aarch64-unknown-linux-musl',
  'Darwin x86_64': 'x86_64-apple-darwin',
  'Darwin arm64': 'aarch64-apple-darwin',
}
const DOWNLOAD_CSHIP =
  'mkdir -p "$HOME/.local/bin" && curl -fsSL -o "$HOME/.local/bin/cship" "$1" && chmod +x "$HOME/.local/bin/cship"'
const INSTALL_STARSHIP = 'set -o pipefail; mkdir -p "$HOME/.local/bin" && curl -fsSL https://starship.rs/install.sh | sh -s -- --yes --bin-dir "$HOME/.local/bin"'

// Package managers in the order tried, with how each installs and what it calls each tool.
const PACKAGE_MANAGERS = [
  { name: 'dnf', install: 'sudo dnf install', packages: { jq: 'jq', 'secret-tool': 'libsecret' } },
  { name: 'apt-get', install: 'sudo apt-get install', packages: { jq: 'jq', 'secret-tool': 'libsecret-tools' } },
  { name: 'pacman', install: 'sudo pacman -S', packages: { jq: 'jq', 'secret-tool': 'libsecret' } },
  { name: 'brew', install: 'brew install', packages: { jq: 'jq', 'secret-tool': 'libsecret' } },
]

class Stop extends Error {}

const firstLine = (text) => text.trim().split('\n')[0]

async function has(io, tool) {
  const { exitCode } = await io.run(['bash', '-c', 'PATH="$HOME/.local/bin:$PATH" command -v "$1"', '_', tool])
  return exitCode === 0
}

// Asks first; a Cancel or a dismissed dialog stops the install.
async function confirm(io, question, yes) {
  const answer = await io.ask(question, [yes, 'Cancel']).catch(() => 'Cancel')
  if (answer !== yes) throw new Stop(STOPPED)
}

async function installStep(io, tool, argv, timeoutMs) {
  const { exitCode, stderr } = await io.run(argv, { timeoutMs })
  if (exitCode !== 0) throw new Stop(`Could not install ${tool}: ${firstLine(stderr)}`)
  if (!(await has(io, tool))) throw new Stop(`Could not install ${tool}: it is still not on PATH after the install.`)
}

async function ensureCship(io, platform) {
  if (await has(io, 'cship')) return
  const target = CSHIP_TARGETS[platform]
  if (!target) throw new Stop(`cship has no build for ${platform}. Install it by hand: https://github.com/stephenleo/cship`)
  await confirm(io, 'Download cship to ~/.local/bin/cship?', 'Download')
  await installStep(io, 'cship', ['bash', '-c', DOWNLOAD_CSHIP, '_', CSHIP_RELEASES + target], 120000)
  await io.set('installedCship', true)
}

async function ensureStarship(io) {
  if (await has(io, 'starship')) return
  await confirm(io, 'Install starship to ~/.local/bin? (it draws the folder and git branch)', 'Install')
  await installStep(io, 'starship', ['bash', '-c', INSTALL_STARSHIP], 300000)
}

async function ensurePackages(io, platform) {
  const needed = platform.startsWith('Linux') ? ['jq', 'secret-tool'] : ['jq']
  const missing = []
  for (const tool of needed) if (!(await has(io, tool))) missing.push(tool)
  if (missing.length === 0) return
  for (const manager of PACKAGE_MANAGERS) {
    if (!(await has(io, manager.name))) continue
    const command = `${manager.install} ${missing.map((tool) => manager.packages[tool]).join(' ')}`
    throw new Stop(`Run this, then ${AGAIN}:\n! ${command}`)
  }
  throw new Stop(`Install ${missing.join(' and ')}, then run ${AGAIN}.`)
}

export async function runInstall(io) {
  const places = await statusLineSources(io.readSource, await io.root())
  if (places.length > 0) {
    return `You already use a statusline (statusLine in ${places.join(', ')}). Remove it there, then run ${AGAIN}.`
  }
  try {
    const platform = (await io.run(['uname', '-sm'])).stdout.trim()
    await ensureCship(io, platform)
    await ensureStarship(io)
    await ensurePackages(io, platform)
  } catch (error) {
    if (error instanceof Stop) return error.message
    throw error
  }
  if ((await io.get('active')) === true) return 'Statusline is already on.'
  await io.set('active', true)
  await io.activate()
  return 'Statusline on.'
}

const TURN_OFF = 'Turn off'
const TURN_OFF_AND_DELETE = 'Turn off and delete cship'

// Deletes cship only when this mod downloaded it; starship, jq and libsecret may serve other tools.
export async function runUninstall(io) {
  if ((await io.get('active')) !== true) return 'Statusline is already off.'
  const isOurCship = (await io.get('installedCship')) === true
  const options = isOurCship ? [TURN_OFF, TURN_OFF_AND_DELETE, 'Cancel'] : [TURN_OFF, 'Cancel']
  const answer = await io.ask('Turn off the statusline?', options).catch(() => 'Cancel')
  if (answer !== TURN_OFF && answer !== TURN_OFF_AND_DELETE) return 'Nothing changed.'
  await io.set('active', false)
  await io.deactivate()
  if (answer === TURN_OFF) return 'Statusline off. Run /statusline-install to turn it back on.'
  await io.run(['bash', '-c', 'rm -f "$HOME/.local/bin/cship"'])
  await io.delete('installedCship')
  return 'Statusline off, cship deleted. Run /statusline-install to turn it back on.'
}
