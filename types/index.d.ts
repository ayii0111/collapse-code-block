export type Hunk = {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'collapse-code-block': {
      isCollapsing: boolean
      isOpen: StateFamily<boolean>
    }
  }
}
