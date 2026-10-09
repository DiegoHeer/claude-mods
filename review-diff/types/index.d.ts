// A row by the line number it keeps after a refresh: its new line, else its old one.
export type RowRef = { side: 'new' | 'old'; no: number }

// A review comment kept until it is sent: the lines it is on, and what it says.
export type Draft = {
  id: number
  path: string
  from: RowRef
  to: RowRef
  label: string
  snippet: string
  text: string
  worktree?: string // the worktree's folder; absent when git listed none
}

declare module 'claude-code' {
  interface PluginState {
    'review-diff': { drafts: Draft[] }
  }
}
