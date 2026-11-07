export type Touch = {
  abs: string
  isEdited: boolean
  isEditedThisTurn: boolean
  at: number
  turn: number
}

export type Now =
  | { kind: 'idle' }
  | { kind: 'thinking' }
  | { kind: 'reading' | 'editing'; abs: string }
  | { kind: 'running'; title: string; detail: string }
  | { kind: 'done'; edited: string[]; read: string[] }

export type Scope = 'turn' | 'session'

declare module 'claude-code' {
  interface PluginState {
    panel: {
      touched: Shaped<Touch[]>
      now: Shaped<Now>
      scope: Shaped<Scope>
      turn: Shaped<number>
      openDiffAbs: Shaped<string | null>
      isTreeOpen: Shaped<boolean>
      expanded: Shaped<string[]>
      showHidden: Shaped<boolean>
      showSizes: Shaped<boolean>
      seen: Shaped<Record<string, number>>
    }
  }
}
