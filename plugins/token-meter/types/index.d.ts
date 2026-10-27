export type Turn = {
  id: string
  prompt: string
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
