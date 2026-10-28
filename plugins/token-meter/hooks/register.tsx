import { atom, read, update } from 'claude-code'
import type {
  ElementTable,
  ModelUsage,
  Register,
  RenderElement,
  RenderNode,
  RenderSurface,
  StateDollar
} from 'claude-code'

import type { Meter, Turn } from '../types'

const KEEP = 200
const HANGUL = /[ㄱ-ㆎ가-힣]/g
const PEOPLE = ['composer', 'bridge', 'sdk']
// 데스크톱 앱이 프로젝트 폴더 없이 시작한 세션의 첫 메시지 앞에 붙이는 안내는 화면에 없는 글이다
const REMINDER = /^(?:<system-reminder>[\s\S]*?<\/system-reminder>\n?)+/
// 슬래시 명령 줄: 입력한 그대로(/goal ...)나 엔진의 기록 형태(<command-name>...)로 온다
const COMMAND_ROW = /^(?:\/|<command-)/
const COMMAND_NAME = /<command-name>\/?([^<]*)<\/command-name>/
const COMMAND_ARGS = /<command-args>([\s\S]*?)<\/command-args>/

// 저장 형태가 바뀌면 태그를 올려 이전 버전이 남긴 값을 버린다
const meter = atom(
  { plugin: 'token-meter', key: 'meter' } as const,
  { last: null, turns: [] },
  { shape: 'meter-1' }
)

type Input = { uuid: string; door: string; text: string }

// 지난 턴이 시작된 뒤 쌓인 입력 줄(프롬프트 줄, 명령 줄): 다음 턴이 시작되면 그 턴의 글과 맞춰 본다
let inputs: Input[] = []
// 지금 도는 메인 루프의 턴
let running: string | undefined

const change = ($: StateDollar, fn: (state: Meter) => Meter) => update($, meter, fn)

const patchTurn = (state: Meter, id: string, fn: (turn: Turn) => Turn): Turn[] =>
  state.turns.map(turn => (turn.id === id ? fn(turn) : turn))

const textOf = (content: readonly { type: string; text?: unknown }[]) =>
  content
    .filter(block => block.type === 'text')
    .map(block => String(block.text ?? ''))
    .join('\n')

// 턴을 시작한 입력 줄: 턴의 글과 같은 줄을 찾고, 명령이면 그 앞의 명령 줄(<command-name>)을 쓴다
// 명령은 턴의 글이 명령 줄일 때도(스킬) 명령의 출력 줄일 때도(/goal) 있다
const startedBy = (rows: Input[], text: string) => {
  const index = rows.findLastIndex(row => row.text === text)
  const row = rows[index]
  if (!row || row.door === 'prompt') return row && { rowId: row.uuid }

  const echo = rows.slice(0, index + 1).findLast(one => COMMAND_NAME.test(one.text))
  const name = echo?.text.match(COMMAND_NAME)?.[1]
  if (!echo || name === undefined) return undefined
  const args = echo.text.match(COMMAND_ARGS)?.[1] ?? ''

  return { rowId: echo.uuid, typed: args ? `/${name} ${args}` : `/${name}` }
}

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

// 입력한 글(어림), 이번 턴에 새로 들어간 양, 서버로 보낸 양
// 이름은 API 와 Claude Code 의 용어에 맞춘다: total input 은 input + cache read + cache write
const promptLabel = (text: string, turn: Turn | undefined) => {
  const parts = [`prompt ~${comma(estimate(text))}`]
  if (turn?.added) parts.push(`context ${comma(turn.added)}`)
  if (turn?.sent) parts.push(`total input ${comma(turn.sent)}`)
  // 서버로 보낸 양 옆 괄호에 요청 횟수와 서버가 캐시에 쓴 시각을 함께 둔다
  const count = turn?.requests ?? 0
  const notes = count ? [`${count} ${count === 1 ? 'request' : 'requests'}`] : []
  if (turn?.cachedAt) notes.push(`cached ${clock(turn.cachedAt)}`)

  return `${parts.join(' / ')} tokens${notes.length ? ` (${notes.join(', ')})` : ''}`
}

// 엔진이 그린 답변(engine 노드) 바로 위에 줄을 끼워, 다른 Mod 가 맨 위에 붙인 줄(번역)보다 아래에 온다
// 토큰 수 한 줄: 데스크톱 앱은 입력 말풍선처럼 오른쪽 끝에 붙이고, 그 밖(터미널 등)은 두 칸 들여 쓴다
const lineOf = ({ Box, Text }: ElementTable, surface: RenderSurface, text: string) =>
  surface === 'desktop' ? (
    <Box flexDirection="row" justifyContent="flex-end">
      <Text dimColor>{text}</Text>
    </Box>
  ) : (
    <Box paddingLeft={2}>
      <Text dimColor>{text}</Text>
    </Box>
  )

const aboveEngine = (tree: RenderElement, stack: (row: RenderElement) => RenderElement) => {
  let isPlaced = false
  const visit = (node: RenderNode): RenderNode => {
    if (isPlaced || typeof node === 'string') return node
    if (node.type === 'engine') {
      isPlaced = true
      return stack(node)
    }
    if (node.type !== 'Box' || !node.children) return node
    return { ...node, children: node.children.map(visit) }
  }
  const placed = visit(tree) as RenderElement

  return isPlaced ? placed : stack(tree)
}

export const register: Register = on => {
  on('turn.start', async ($, e, next) => {
    const rows = e.agentId === undefined ? inputs : []
    if (e.agentId === undefined) inputs = []
    const result = await next(e)
    if (e.agentId !== undefined) return result

    // 명령은 턴의 글이 엔진의 기록 형태라 입력한 명령 줄(/goal ...)을 쓴다
    const input = startedBy(rows, e.text)
    const turn: Turn = {
      id: e.turnId,
      prompt: input?.typed ?? e.text.replace(REMINDER, ''),
      output: 0,
      ...(input && { rowId: input.rowId }),
      ...(input?.typed !== undefined && { isCommand: true })
    }
    running = e.turnId
    await change($, state => ({ ...state, turns: [turn, ...state.turns].slice(0, KEEP) }))

    return result
  })

  // 화면은 줄을 id 로 그리므로 입력 줄과 턴 안에서 글을 쓴 답변 줄의 id 를 적어 둔다
  on('session.append', async ($, e, next) => {
    const text = textOf(e.message.content)
    if (e.agentId === undefined && (e.door === 'prompt' || e.door === 'command')) {
      inputs = [...inputs, { uuid: e.uuid, door: e.door, text }].slice(-20)
    } else if (e.agentId === undefined && e.door === 'response' && running) {
      const turnId = running
      if (text.trim()) {
        await change($, state => ({
          ...state,
          turns: patchTurn(state, turnId, turn => ({
            ...turn,
            firstReplyId: turn.firstReplyId ?? e.uuid,
            lastReplyId: e.uuid
          }))
        }))
      }
    }

    return next(e)
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

    if (running === e.turnId) running = undefined
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

  // 사람이 입력한 프롬프트 줄 밑에 입력 토큰을 붙인다
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const text = e.props.text
    if (!PEOPLE.includes(e.props.origin.kind) || COMMAND_ROW.test(text)) return next(e)

    // 줄 id 로 찾고, id 를 모르는 턴(작업 중에 보내 나중에 시작된 입력 등)만 글로 찾는다
    const { turns } = await read($, meter)
    const turn =
      turns.find(one => one.rowId === e.requestId) ??
      turns.find(one => one.rowId === undefined && one.prompt === text)
    if (turn?.isCommand) return next(e)

    const ui = $.ui.resolve(e)
    const { Box } = ui
    const row = await next(e)

    return (
      <Box flexDirection="column">
        {row}
        {lineOf(ui, e.surface, promptLabel(text, turn))}
      </Box>
    )
  })

  // 명령이 시작한 턴의 첫 답변 위에는 입력 토큰을, 턴의 마지막 답변 밑에는 출력 토큰을 붙인다
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const text = e.props.text.trim()
    if (!text) return next(e)

    const { turns } = await read($, meter)
    // 명령 줄(/goal ...)은 Mod 가 그릴 수 있는 자리가 아니어서 그 턴의 첫 답변 위에 둔다
    const asked = turns.find(one => one.isCommand && one.firstReplyId === e.requestId)
    // 그 턴의 모든 요청이 낸 출력 토큰(생각과 도구 호출 포함)
    const isDone = (turn: Turn) => turn.answer !== undefined && !e.props.isSummary
    const ended =
      turns.find(one => isDone(one) && one.lastReplyId === e.requestId) ??
      turns.find(
        one => isDone(one) && one.lastReplyId === undefined && one.answer?.trim().endsWith(text)
      )
    if (!asked && !ended) return next(e)

    const ui = $.ui.resolve(e)
    const { Box } = ui
    const row = await next(e)
    const tree = asked
      ? aboveEngine(row, reply => (
          <Box flexDirection="column">
            {lineOf(ui, e.surface, promptLabel(asked.prompt, asked))}
            {reply}
          </Box>
        ))
      : row
    if (!ended) return tree

    return (
      <Box flexDirection="column">
        {tree}
        {lineOf(ui, e.surface, `output ${comma(ended.output)} tokens`)}
      </Box>
    )
  })
}
