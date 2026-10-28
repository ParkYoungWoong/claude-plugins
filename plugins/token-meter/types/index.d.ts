export type Turn = {
  id: string
  // 입력한 글: 프롬프트 줄과 같은 글, 명령이면 입력한 명령 줄(/goal ...)
  prompt: string
  // 이 턴을 시작한 입력 줄의 id: 화면은 줄을 이 id 로 그린다
  rowId?: string
  // 명령(/goal, 스킬 등)으로 시작한 턴: 명령 줄에는 그릴 자리가 없어 첫 답변 위에 입력 토큰을 둔다
  isCommand?: boolean
  // 턴 안에서 글을 쓴 첫 답변 줄과 마지막 답변 줄의 id
  firstReplyId?: string
  lastReplyId?: string
  // 이 입력이 컨텍스트에 실제로 더한 토큰(첫 요청 입력 - 직전 요청 입력과 출력)
  added?: number
  // 서버로 보낸 입력 토큰: 턴 안의 요청마다 보낸 전체 입력(캐시 포함)의 합
  sent?: number
  requests?: number
  // 이 입력을 실은 첫 요청에 서버가 응답을 시작한 시각(ms), 그때 프롬프트 캐시에 쓰여 있다
  cachedAt?: number
  output: number
  answer?: string
}

export type Step = { input: number; output: number }

export type Meter = { last: Step | null; turns: Turn[] }

declare module 'claude-code' {
  interface PluginState {
    'token-meter': { meter: Shaped<Meter> }
  }
}
