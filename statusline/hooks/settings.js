// Where a person finds each settings source, to tell them which file holds a statusLine.
const PLACES = {
  user: () => '~/.claude/settings.json',
  project: (root) => `${root}/.claude/settings.json`,
  local: (root) => `${root}/.claude/settings.local.json`,
  flag: () => 'the --settings flag',
  policy: () => "your organization's managed settings",
}

// `readSource(source)` resolves one source's settings, as `$.settings.read({ source })` does.
export async function statusLineSources(readSource, root) {
  const places = []
  for (const [source, place] of Object.entries(PLACES)) {
    if ('statusLine' in (await readSource(source))) places.push(place(root))
  }
  return places
}
