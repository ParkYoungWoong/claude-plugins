export type Entry = {
  id: string
  source: string
  english?: string
  status: 'pending' | 'done' | 'failed'
  reason?: string
  isHidden?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'prompt-translator': { entries: Shaped<Entry[]> }
  }
}
