// A run of text drawn in one style, cut from cship's ANSI output.
export type Span = {
  text: string
  color?: string
  backgroundColor?: string
  bold?: true
  dimColor?: true
  italic?: true
  underline?: true
}

declare module 'claude-code' {
  interface PluginState {
    statusline: { line: Span[][] | null; transcriptPath: string | null }
  }
}
