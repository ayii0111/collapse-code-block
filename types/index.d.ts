export type Hunk = {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'collapse-edits': {
      isCollapsing: boolean
      isOpen: StateFamily<boolean>
    }
  }
}
