import { atom, read, update } from 'claude-code'
import type { ModelUsage, Register, StateDollar } from 'claude-code'

import type { Meter, Turn } from '../types'

const KEEP = 200
const HANGUL = /[ㄱ-ㆎ가-힣]/g
const PEOPLE = ['composer', 'bridge', 'sdk']

// 저장 형태가 바뀌면 태그를 올려 이전 버전이 남긴 값을 버린다
const meter = atom(
  { plugin: 'token-meter', key: 'meter' } as const,
  { last: null, turns: [] },
  { shape: 'meter-1' }
)

const change = ($: StateDollar, fn: (state: Meter) => Meter) => update($, meter, fn)

const patchTurn = (state: Meter, id: string, fn: (turn: Turn) => Turn): Turn[] =>
  state.turns.map(turn => (turn.id === id ? fn(turn) : turn))

// 2026-10-27 Opus 5.5 실측: 한글은 한 글자에 약 1.35토큰, 그 밖의 글자는 3.2자에 1토큰
const estimate = (text: string) => {
  const hangul = (text.match(HANGUL) ?? []).length
  const rest = [...text].length - hangul

  return Math.max(1, Math.round(hangul * 1.35 + rest / 3.2))
}

const inputOf = (usage: ModelUsage) =>
  usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens

const comma = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

const clock = (ms: number) => {
  const date = new Date(ms)

  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map(n => String(n).padStart(2, '0'))
    .join(':')
}

export const register: Register = on => {
  on('turn.start', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result

    const turn: Turn = { id: e.turnId, prompt: e.text, output: 0 }
    await change($, state => ({ ...state, turns: [turn, ...state.turns].slice(0, KEEP) }))

    return result
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)

    // 서버가 입력을 처리해 응답을 보내기 시작한 때(첫 조각이 온 때)를 캐시에 쓰인 시각으로 본다
    let respondedAt: number | undefined
    const stream = next(e)
    for await (const chunk of stream) {
      respondedAt ??= await $.clock.now()
      yield chunk
    }
    const result = await stream.result
    const usage = result.usage
    if (!usage) return result

    const cachedAt = respondedAt ?? (await $.clock.now())
    const input = inputOf(usage)
    await change($, state => {
      // 턴의 첫 요청 입력에서 직전 요청의 입력과 출력을 빼면 이번 입력이 더한 양이 남는다
      const added = e.index === 0 && state.last ? input - state.last.input - state.last.output : 0
      // 요청마다 시스템 프롬프트와 지난 대화 전체를 다시 보내므로 요청별 전체 입력을 더한다
      const turns = patchTurn(state, e.turnId, turn => ({
        ...turn,
        sent: (turn.sent ?? 0) + input,
        requests: (turn.requests ?? 0) + 1,
        cachedAt: turn.cachedAt ?? cachedAt,
        output: turn.output + usage.output_tokens,
        ...(added > 0 && { added })
      }))

      return { last: { input, output: usage.output_tokens }, turns }
    })

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result

    await change($, state => ({
      ...state,
      turns: patchTurn(state, e.turnId, turn => ({
        ...turn,
        answer: e.answer,
        output: e.usage?.output_tokens ?? turn.output
      }))
    }))

    return result
  })

  // 사람이 입력한 프롬프트 줄 밑: 입력한 글(어림), 이번 턴에 새로 들어간 양, 서버로 보낸 양
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const text = e.props.text
    if (!PEOPLE.includes(e.props.origin.kind) || text.startsWith('/')) return next(e)

    const turn = (await read($, meter)).turns.find(one => one.prompt === text)
    // 이름은 API 와 Claude Code 의 용어에 맞춘다: total input 은 input + cache read + cache write
    const parts = [`prompt ~${comma(estimate(text))}`]
    if (turn?.added) parts.push(`context ${comma(turn.added)}`)
    if (turn?.sent) parts.push(`total input ${comma(turn.sent)}`)
    // 서버로 보낸 양 옆 괄호에 요청 횟수와 서버가 캐시에 쓴 시각을 함께 둔다
    const count = turn?.requests ?? 0
    const notes = count ? [`${count} ${count === 1 ? 'request' : 'requests'}`] : []
    if (turn?.cachedAt) notes.push(`cached ${clock(turn.cachedAt)}`)
    const label = `${parts.join(' / ')} tokens${notes.length ? ` (${notes.join(', ')})` : ''}`
    const { Box, Text } = $.ui.resolve(e)
    const row = await next(e)

    return (
      <Box flexDirection="column">
        {row}
        <Box paddingLeft={2}>
          <Text dimColor>{label}</Text>
        </Box>
      </Box>
    )
  })

  // 턴의 마지막 답변 블록 밑: 그 턴의 모든 요청이 낸 출력 토큰(생각과 도구 호출 포함)
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const text = e.props.text.trim()
    if (e.props.isSummary || !text) return next(e)

    const turn = (await read($, meter)).turns.find(
      one => one.answer !== undefined && one.answer.trim().endsWith(text)
    )
    if (!turn) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const row = await next(e)

    return (
      <Box flexDirection="column">
        {row}
        <Box paddingLeft={2}>
          <Text dimColor>output {comma(turn.output)} tokens</Text>
        </Box>
      </Box>
    )
  })
}
