export type Entry = {
  id: string
  // 번역할 원문: 프롬프트는 화면의 프롬프트 줄과 같은 글, 명령은 인자
  source: string
  english?: string
  // waiting 은 화면이 아직 붙지 않아(데스크톱 앱이 세션을 열기 전) 번역을 미뤄 둔 상태
  status: 'waiting' | 'pending' | 'done' | 'failed'
  reason?: string
  isHidden?: boolean
  isForced?: boolean
  // 프롬프트 줄의 id: 화면이 그리는 글이 원문과 달라도 이것으로 짝을 맞춘다
  rowId?: string
  // 명령(/goal 등)이 시작한 턴의 첫 답변 줄 id: 명령 줄에는 그릴 자리가 없어 그 위에 붙인다
  replyId?: string
  isCommand?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'prompt-translator': { entries: Shaped<Entry[]> }
  }
}
