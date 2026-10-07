// A review comment kept until it is sent: the lines it is on, and what it says.
export type Draft = {
  id: number
  path: string
  side: 'new' | 'old'
  first: number
  last: number
  label: string
  snippet: string
  text: string
}

declare module 'claude-code' {
  interface PluginState {
    'branch-diff': { drafts: Draft[] }
  }
}
