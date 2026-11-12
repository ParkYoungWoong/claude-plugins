export type Turn = {
  id: string
  // 세션에서 몇 번째로 시작한 턴인지(1부터)
  number?: number
  // 입력한 글: 프롬프트 줄과 같은 글, 명령이면 입력한 명령 줄(/goal ...)
  prompt: string
  // 이 턴을 시작한 입력 줄의 id: 화면은 줄을 이 id 로 그린다
  rowId?: string
  // 명령(/goal, 스킬 등)으로 시작한 턴: 명령 줄에는 그릴 자리가 없어 그려진 첫 답변 위에 입력 토큰을 둔다
  isCommand?: boolean
  // 턴 안에서 글을 쓴 답변 줄(앞에서부터 20개)과 마지막 답변 줄의 id 와 글
  // (데스크톱 앱은 줄 id 대신 글로 짝을 맞춘다)
  replies?: { id: string; text: string }[]
  lastReplyId?: string
  lastReplyText?: string
  // 이 입력이 컨텍스트에 실제로 더한 토큰(첫 요청 입력 - 직전 요청 입력과 출력)
  added?: number
  // 서버로 보낸 입력 토큰: 턴 안의 요청마다 보낸 전체 입력(캐시 포함)의 합
  sent?: number
  // sent 가운데 프롬프트 캐시에서 읽은 토큰(요청별 cache_read_input_tokens 의 합)
  cacheRead?: number
  // sent 가운데 프롬프트 캐시에 새로 쓴 토큰(요청별 cache_creation_input_tokens 의 합)
  cacheWrite?: number
  // 요청마다 그 요청의 모델 정가로 매긴 비용의 합(Cost), 정가를 모르는 모델의 요청이 있으면 그 모델 id
  cost?: Cost
  unpriced?: string
  requests?: number
  // 이 입력을 실은 첫 요청에 서버가 응답을 시작한 시각(ms), 그때 프롬프트 캐시에 쓰여 있다
  cachedAt?: number
  output: number
  answer?: string
}

// 비용은 10억분의 1달러 단위의 정수로 쌓는다(소수를 더하면 끝자리가 흔들린다)
// 캐시 쓰기는 보존 시간(5분 1.25배, 1시간 2배)을 그릴 때 정하므로 기본 입력 단가로 매긴 값을 둔다
export type Cost = { input: number; cacheRead: number; cacheWriteBase: number; output: number }

export type Step = { input: number; output: number }

// isSubscription: 세션이 사용량 한도 창을 알려 온 구독 로그인(Claude Code 는 캐시를 1시간 동안 둔다)
// count: 지금까지 시작한 턴의 수(턴 번호를 매긴다)
// opened: 펼친 터미널 줄, openedCards: 펼친 데스크톱 카드(턴 id:input 또는 턴 id:output). 둘 다 접힌 채로 시작한다
export type Meter = {
  last: Step | null
  turns: Turn[]
  isSubscription?: boolean
  count?: number
  opened?: string[]
  openedCards?: string[]
  // 방금 복사 단추를 누른 데스크톱 카드와 그 결과(잠시 보였다가 지운다)
  copied?: { key: string; isCopied: boolean }
}

declare module 'claude-code' {
  interface PluginState {
    'token-meter': { meter: Shaped<Meter> }
  }
}
