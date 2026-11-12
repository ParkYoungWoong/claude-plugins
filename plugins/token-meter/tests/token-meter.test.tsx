import { expect, mock, test } from 'claude-code/testing'
import type { On, TurnUsage } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'

const MINUTE = 60 * 1000
// 이 컴퓨터 시간대의 13:55:02 라서 어느 시간대에서 돌려도 화면 시각이 같다
const START = new Date(2026, 9, 27, 13, 55, 2).getTime()

const usage = (input: number, cached: number, output: number): TurnUsage => ({
  model: 'claude-opus-5-5',
  input_tokens: input,
  cache_read_input_tokens: cached,
  cache_creation_input_tokens: 0,
  output_tokens: output
})

const prompt = (text: string, kind: 'composer' | 'task-notification' = 'composer') =>
  ({
    plugin: 'token-meter',
    component: 'UserMessage',
    props: { text, origin: { kind }, isExpanded: false }
  }) as const

const reply = (text: string) =>
  ({
    plugin: 'token-meter',
    component: 'AssistantMessage',
    props: { text, isFirstOfReply: true }
  }) as const

// 서버는 요청을 받고 lag 밀리초 뒤에 첫 조각을 보낸다: 시험이 시계를 옮긴 뒤 gate 를 연다
type Server = { clock: MockClock; lag: number; gate: Promise<void> }

// 엔진 자리에 서서 각 요청이 돌려줄 사용량을 차례로 내주고, 시계를 맡는다
const engine = (on: On, steps: TurnUsage[], lag = 0): Server => {
  const queue = [...steps]
  const server: Server = { clock: mock.clock(on, { now: START }), lag, gate: Promise.resolve() }
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* (_, e) {
    await server.gate
    yield { kind: 'text' as const, index: 0, text: '응답' }

    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn' as const,
      usage: queue.shift() ?? null
    }
  })
  on('turn.complete', (_, e) => ({ text: e.answer, usage: e.usage }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  return server
}

const step = async ($: Engine, server: Server, turnId: string, index: number, agentId?: string) => {
  let open = () => {}
  server.gate = new Promise(resolve => (open = resolve))
  const stream = $.turn.step({ turnId, index, model: 'claude-opus-5-5', messageCount: 1, agentId })
  const drained = (async () => {
    for await (const _ of stream) {
      // 응답 조각은 쓰지 않는다
    }
  })()
  if (server.lag) await server.clock.advance(server.lag)
  open()
  await drained

  return stream.result
}

const run = async (
  $: Engine,
  server: Server,
  turnId: string,
  text: string,
  answer: string,
  steps: number
) => {
  await $.turn.start({ turnId, text })
  for (let index = 0; index < steps; index += 1) await step($, server, turnId, index)
  await $.turn.complete({
    turnId,
    answer,
    durationMs: 1000,
    isAborted: false,
    reason: 'answer'
  })
}


// 그린 나무를 터미널 화면처럼 줄 단위 글로 바꾼다: 세로 상자는 줄을 쌓고, 가로 상자는 글을 잇고,
// paddingLeft 만큼 앞에 빈칸을 둔다. 줄 끝 빈칸은 화면에 보이지 않아 지운다
type Drawn = string | { type: string; props?: Record<string, unknown>; children?: Drawn[] }
const flat = (node: Drawn): string =>
  typeof node === 'string' ? node : node.type === 'engine' ? 'engine' : (node.children ?? []).map(flat).join('')
const linesOf = (node: Drawn, indent = 0): string[] => {
  if (typeof node === 'string' || node.type !== 'Box') return [' '.repeat(indent) + flat(node)]
  const pad = indent + (Number(node.props?.paddingLeft) || 0)
  if (node.props?.flexDirection === 'column') return (node.children ?? []).flatMap(one => linesOf(one, pad))

  return [' '.repeat(pad) + flat(node)]
}

type Mount = Parameters<Engine['ui']['mount']>[0]

// 터미널에 그린 줄: open 에 적은 단추(fold-input, fold-output)를 눌러 펼친 뒤 읽는다
const screen = async ($: Engine, mount: Mount, open: string[] = []) => {
  const ui = await $.ui.mount(mount)
  for (const key of open) await ui.press({ key })
  const lines = linesOf((await ui.drawn()) as Drawn).map(line => line.trimEnd())
  await ui.unmount()

  return lines
}

const terminal = <T extends object>(mount: T) => ({ ...mount, surface: 'terminal' }) as const
const desktop = <T extends object>(mount: T) => ({ ...mount, surface: 'desktop' }) as const

test('응답 전의 프롬프트 줄 밑에는 글자 수로 어림한 토큰을 보인다', async ($, on) => {
  engine(on, [])

  // 한글 8자 x 1.35 + 공백 3자 / 3.2 = 11.7. 턴이 시작되기 전이라 맥락이 없다
  expect(await screen($, terminal(prompt('이 버그를 고쳐 줄래')))).toEqual([
    'engine',
    '      INPUT      ~12 tok'
  ])

  // 턴이 시작되면 턴 번호와 응답을 기다린다는 것을 보이고, 펼칠 표가 없어 단추를 두지 않는다
  await $.turn.start({ turnId: 't1', text: '이 버그를 고쳐 줄래' })
  expect(await screen($, terminal(prompt('이 버그를 고쳐 줄래')))).toEqual([
    'engine',
    '      INPUT      ~12 tok           (turn 1 / waiting for response)'
  ])
})

test('입력과 출력은 접힌 한 줄로 시작하고, 펼치면 열을 맞춘 표를 보인다', async ($, on) => {
  const server = engine(
    on,
    [usage(5, 20000, 300), usage(10, 20400, 120), usage(8, 20700, 900), usage(4, 21650, 1500)],
    2000
  )

  await run($, server, 't1', '첫 질문', '첫 답변', 2)
  await server.clock.advance(MINUTE)
  await run($, server, 't2', '두 번째 질문', '두 번째 답변입니다.', 2)

  // 첫 턴은 견줄 직전 요청이 없어 늘린 양(context)이 없고, 보낸 양은 20005 + 20410
  // 캐시 시각은 요청을 보낸 13:55:02 가 아니라 서버가 응답을 시작한 2초 뒤
  expect(await screen($, terminal(prompt('첫 질문')))).toEqual(FIRST_COLLAPSED)
  expect(await screen($, terminal(reply('첫 답변')))).toEqual(FIRST_OUTPUT_COLLAPSED)

  // 늘린 양은 20708 - (20410 + 120) = 178, 보낸 양은 20708 + 21654
  // 첫 턴 두 요청(4초) + 1분 + 응답까지 2초
  expect(await screen($, terminal(prompt('두 번째 질문')), ['fold-input'])).toEqual(SECOND_OPEN)
  expect(await screen($, terminal(reply('두 번째 답변입니다.')), ['fold-output'])).toEqual(
    SECOND_OUTPUT_OPEN
  )
  // 펼친 줄은 다시 그려도 펼친 채이고, 다른 턴의 줄은 접힌 채다
  expect(await screen($, terminal(prompt('두 번째 질문')))).toEqual(SECOND_OPEN)
  expect(await screen($, terminal(prompt('첫 질문')))).toEqual(FIRST_COLLAPSED)
  // 다시 누르면 접는다
  expect((await screen($, terminal(prompt('두 번째 질문')), ['fold-input'])).length).toBe(2)

  expect(await screen($, terminal(reply('중간에 쓴 다른 글')))).toEqual(['engine'])
})

test('서브에이전트의 요청은 세지 않는다', async ($, on) => {
  const server = engine(on, [usage(5, 20000, 300), usage(50, 9000, 7000), usage(4, 20310, 200)])

  await $.turn.start({ turnId: 't1', text: '조사해 줘' })
  await step($, server, 't1', 0)
  await step($, server, 'sub', 0, 'agent-1')
  await step($, server, 't1', 1)
  await complete($, 't1', '조사했습니다.')

  expect(await screen($, terminal(reply('조사했습니다.')))).toEqual(SUBAGENT_OUTPUT)
  expect(await screen($, terminal(prompt('조사해 줘')))).toEqual(SUBAGENT_INPUT)
})

test('요청이 한 번이면 단수형으로 쓴다', async ($, on) => {
  const server = engine(on, [usage(3, 30000, 50)])
  await run($, server, 't1', '안녕', '안녕하세요.', 1)

  expect(await screen($, terminal(prompt('안녕')))).toEqual(SINGLE)
})

test('캐시에서 읽은 양과 쓴 양, 캐시를 거치지 않은 양을 나누고 셋을 더하면 total 이다', async ($, on) => {
  // 첫 요청은 캐시를 새로 쓰기만 하고, 다음 요청은 그 캐시를 읽는다
  const server = engine(on, [
    { ...usage(2000, 0, 100), cache_creation_input_tokens: 8000 },
    { ...usage(50, 10000, 80), cache_creation_input_tokens: 150 }
  ])
  await run($, server, 't1', '읽어 줘', '읽었습니다.', 2)

  // 읽은 10,000 / 보낸 20,200 = 49.50...%, 쓴 8,150 = 40.34...%, 나머지 2,050 = 10.14...%
  expect(await screen($, terminal(prompt('읽어 줘')), ['fold-input'])).toEqual(CACHE_SPLIT)
})

test('알림 줄과 슬래시 명령 줄은 그대로 둔다', async ($, on) => {
  engine(on, [])

  expect(await screen($, terminal(prompt('작업 완료', 'task-notification')))).toEqual(['engine'])
  expect(await screen($, terminal(prompt('/context')))).toEqual(['engine'])
})

const input = ($: Engine, door: 'prompt' | 'command', uuid: string, text: string) =>
  $.session.append({
    door,
    uuid,
    origin: { kind: 'composer' },
    message: { type: 'user', role: 'user', content: [{ type: 'text', text }] }
  })

// 엔진처럼 입력 줄을 쌓고 턴을 시작한다. 명령은 명령 줄과 출력 줄을 쌓고 /goal 만 턴을 시작하며,
// 2.1.312 의 /goal 처럼 턴의 글은 출력 줄이다. prompt.submit 은 턴이 시작되기 전에 끝날 수 있다
const prompts = (on: On, $: Engine) => {
  let count = 0
  const started: Promise<unknown>[] = []
  on('prompt.submit', async (_, e) => {
    count += 1
    const id = `row-${count}`
    if (!e.command) {
      await input($, 'prompt', id, e.text)
      started.push($.turn.start({ turnId: `turn-${count}`, text: e.text }))

      return { text: e.text }
    }

    const { name, args } = e.command
    await input(
      $,
      'command',
      id,
      `<command-name>/${name}</command-name>\n<command-args>${args}</command-args>`
    )
    const output = `<local-command-stdout>Done: ${args}</local-command-stdout>`
    await input($, 'command', `${id}-output`, output)
    if (name === 'goal') started.push($.turn.start({ turnId: `turn-${count}`, text: output }))

    return { text: e.text }
  })

  return () => Promise.all(started)
}

const command = ($: Engine, name: string, args: string) =>
  $.prompt.submit({
    text: `/${name} ${args}`,
    command: { name, args },
    wait: false,
    origin: { kind: 'composer' }
  })

const respond = ($: Engine, uuid: string, text: string) =>
  $.session.append({
    door: 'response',
    uuid,
    origin: { kind: 'model', model: 'claude-opus-5-5' },
    message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text }] }
  })

const complete = ($: Engine, turnId: string, answer: string) =>
  $.turn.complete({ turnId, answer, durationMs: 1000, isAborted: false, reason: 'answer' })

test('명령이 시작한 턴은 첫 답변 위에 입력 토큰을, 마지막 답변 밑에 출력 합계를 보인다', async ($, on) => {
  const server = engine(on, [usage(5, 20000, 300), usage(10, 20400, 120)])
  const settle = prompts(on, $)

  // 턴을 시작하지 않는 명령은 턴 번호를 받지 않는다
  await command($, 'rename', '새 이름')
  await command($, 'goal', '테스트 통과')
  await settle()
  await step($, server, 'turn-2', 0)
  await respond($, 'reply-1', '목표를 확인했습니다.')
  await step($, server, 'turn-2', 1)
  await respond($, 'reply-2', '모두 통과했습니다.')
  await complete($, 'turn-2', '모두 통과했습니다.')

  // 한글 5자 x 1.35 + 나머지 7자 / 3.2 = 8.9
  const first = { ...reply('목표를 확인했습니다.'), requestId: 'reply-1' }
  expect(await screen($, terminal(first))).toEqual([...COMMAND_INPUT, 'engine'])
  const last = { ...reply('모두 통과했습니다.'), requestId: 'reply-2' }
  expect(await screen($, terminal(last))).toEqual(['engine', ...COMMAND_OUTPUT])

  // 명령 줄에는 아무것도 붙이지 않는다
  const row = { ...prompt('<command-name>/goal</command-name>'), requestId: 'row-2' }
  expect(await screen($, terminal(row))).toEqual(['engine'])
})

test('focus 보기가 명령 턴의 첫 답변을 그리지 않으면 그려진 마지막 답변 위에 입력 토큰을 둔다', async ($, on) => {
  const server = engine(on, [usage(5, 20000, 300), usage(10, 20400, 120)])
  const settle = prompts(on, $)

  await command($, 'goal', '테스트 통과')
  await settle()
  await step($, server, 'turn-1', 0)
  await respond($, 'focus-1', '목표를 확인했습니다.')
  await step($, server, 'turn-1', 1)
  await respond($, 'focus-2', '모두 통과했습니다.')
  await complete($, 'turn-1', '모두 통과했습니다.')

  // 도구 호출 앞의 첫 답변은 그려지지 않고 마지막 답변만 그려진다
  const last = { ...reply('모두 통과했습니다.'), requestId: 'focus-2' }
  expect(await screen($, terminal(last))).toEqual([...FOCUS_INPUT, 'engine', ...FOCUS_OUTPUT])
})

test('데스크톱 앱이 API 메시지 id 와 블록 번호로 물어도 블록의 글로 짝을 맞춘다', async ($, on) => {
  const server = engine(on, [usage(5, 20000, 300), usage(10, 20400, 120)])
  const settle = prompts(on, $)

  await command($, 'goal', '테스트 통과')
  await settle()
  await step($, server, 'turn-1', 0)
  await respond($, 'reply-1', '목표를 확인했습니다.')
  await step($, server, 'turn-1', 1)
  await respond($, 'reply-2', '모두 통과했습니다.')
  await complete($, 'turn-1', '모두 통과했습니다.')

  const first = { ...reply('목표를 확인했습니다.'), requestId: 'msg_01A-t0' }
  expect((await textsOf($, desktop(first))).slice(0, 4)).toEqual(['Input', '(turn 1)', '40,415 tok', '$0.0081'])
  const last = { ...reply('모두 통과했습니다.\n'), requestId: 'msg_01B-t0' }
  expect(await textsOf($, desktop(last), ['fold-output'])).toEqual(OUTPUT_CARD)
  // 글이 다른 블록에는 붙이지 않는다
  const other = { ...reply('중간 설명'), requestId: 'msg_01B-t1' }
  expect(await textsOf($, desktop(other))).toEqual(['engine'])
})

test('같은 글을 두 번 보내도 줄 id 로 각자의 숫자를 보이고, 앞에 붙은 안내 블록은 뺀다', async ($, on) => {
  const server = engine(on, [usage(5, 20000, 300), usage(4, 20400, 50)])
  const settle = prompts(on, $)
  const typed = '다시 해 줘'

  // 데스크톱 앱이 폴더 없이 시작한 세션의 첫 메시지는 앞에 안내 블록이 붙어 온다
  await $.prompt.submit({
    text: `<system-reminder>\nNo folder.\n</system-reminder>\n${typed}`,
    wait: false,
    origin: { kind: 'sdk' }
  })
  await settle()
  await step($, server, 'turn-1', 0)
  await respond($, 'reply-1', '했습니다.')
  await complete($, 'turn-1', '했습니다.')
  await $.prompt.submit({ text: typed, wait: false, origin: { kind: 'sdk' } })
  await settle()
  await step($, server, 'turn-2', 0)
  await respond($, 'reply-2', '했습니다.')
  await complete($, 'turn-2', '했습니다.')

  // 늘린 양은 20404 - (20005 + 300) = 99
  expect(await screen($, terminal({ ...prompt(typed), requestId: 'row-1' }), ['fold-input'])).toEqual(
    TWICE_FIRST
  )
  expect(await screen($, terminal({ ...prompt(typed), requestId: 'row-2' }), ['fold-input'])).toEqual(
    TWICE_SECOND
  )

  // 답변도 글이 같아 줄 id 로 가른다
  const replies = await Promise.all(
    ['reply-1', 'reply-2'].map(id => screen($, terminal({ ...reply('했습니다.'), requestId: id })))
  )
  expect(replies).toEqual(TWICE_REPLIES)
})

const priced = (model: string, input: number, cached: number, written: number, output: number) => ({
  ...usage(input, cached, output),
  model,
  cache_creation_input_tokens: written
})

const subscribed = ($: Engine) =>
  $.session.measure({
    context: { window: 1_000_000 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 3 }],
    changed: ['rateLimits']
  })

// 펼친 입력 표에서 비용이 있는 줄(total, cache read, cache write, uncached)만 고른다
const costRows = (lines: string[]) =>
  lines.filter(line => /^ {6}(total|cache|uncached)/.test(line))

test('입력 비용을 캐시 읽기와 쓰기로 나누고, 캐시 쓰기는 구독이면 1시간, 아니면 5분 값으로 매긴다', async ($, on) => {
  const server = engine(on, [
    priced('claude-opus-5-5', 2000, 0, 8000, 100),
    priced('claude-opus-5-5', 50, 10000, 150, 80)
  ])
  await run($, server, 't1', '읽어 줘', '읽었습니다.', 2)
  const row = terminal(prompt('읽어 줘'))

  // 입력 2,050 x $4, 읽기 10,000 x $0.20, 쓰기 8,150 x $4 x 1.25 (100만 토큰당)
  expect(costRows(await screen($, row, ['fold-input']))).toEqual(COST_5M)
  expect(await screen($, terminal(reply('읽었습니다.')))).toEqual(COST_OUTPUT_5M)

  // 구독 로그인은 사용량 한도 창을 알려 오고, Claude Code 는 1시간 동안 캐시에 둔다(입력 단가의 2배)
  await subscribed($)
  expect(costRows(await screen($, row))).toEqual(COST_1H)
})

test(
  '설정에서 고른 캐시 보존 시간을 쓴다',
  { options: { cacheTtl: '1h' } },
  async ($, on) => {
    const server = engine(on, [priced('claude-opus-5-5', 0, 0, 10000, 0)])
    await run($, server, 't1', '써 줘', '썼습니다.', 1)

    expect(costRows(await screen($, terminal(prompt('써 줘')), ['fold-input']))).toEqual(WRITE_1H)
  }
)

test('FORCE_PROMPT_CACHING_5M 이 있으면 구독이어도 5분 값으로 매긴다', async ($, on) => {
  mock.env(on, { FORCE_PROMPT_CACHING_5M: '1' })
  const server = engine(on, [priced('claude-opus-5-5', 0, 0, 10000, 0)])
  await run($, server, 't1', '써 줘', '썼습니다.', 1)
  await subscribed($)

  expect(costRows(await screen($, terminal(prompt('써 줘')), ['fold-input']))).toEqual(WRITE_5M)
})

test('Haiku 5.5 는 프롬프트가 10만 토큰을 넘는 요청에만 긴 프롬프트 정가를 매긴다', async ($, on) => {
  const server = engine(on, [
    priced('claude-haiku-5-5', 100_000, 0, 0, 1000),
    priced('claude-haiku-5-5', 100_001, 0, 0, 1000)
  ])
  await run($, server, 't1', '짧게', '짧은 답', 1)
  await run($, server, 't2', '길게', '긴 답', 1)

  expect(await screen($, terminal(prompt('짧게')))).toEqual(HAIKU_SHORT)
  expect(await screen($, terminal(prompt('길게')))).toEqual(HAIKU_LONG)
  expect(await screen($, terminal(reply('긴 답')))).toEqual(HAIKU_OUTPUT)
})

test('턴 중간에 모델이 바뀌면 요청마다 그 모델의 정가로 매기고, 공급자 접두사와 날짜 꼬리는 뗀다', async ($, on) => {
  const server = engine(on, [
    priced('claude-opus-5-5', 1000, 0, 0, 100),
    priced('us.anthropic.claude-sonnet-5-5-20261001-v1:0', 1000, 0, 0, 100)
  ])
  await run($, server, 't1', '바꿔 줘', '바꿨습니다.', 2)

  // 입력 1,000 x ($4 + $2), 출력 100 x ($20 + $10)
  expect(await screen($, terminal(prompt('바꿔 줘')))).toEqual(MIXED_INPUT)
  expect(await screen($, terminal(reply('바꿨습니다.')))).toEqual(MIXED_OUTPUT)
})

test('정가를 모르는 모델의 요청이 있으면 비용을 어림하지 않는다', async ($, on) => {
  const server = engine(on, [
    priced('claude-opus-5-5', 1000, 0, 0, 100),
    priced('claude-future-9', 1000, 0, 0, 100)
  ])
  await run($, server, 't1', '새 모델', '답했습니다.', 2)

  expect(await screen($, terminal(prompt('새 모델')), ['fold-input'])).toEqual(UNPRICED_INPUT)
  expect(await screen($, terminal(reply('답했습니다.')), ['fold-output'])).toEqual(UNPRICED_OUTPUT)
})

test('Opus 5 를 Opus 5.5 정가로 섞지 않는다', async ($, on) => {
  const server = engine(on, [priced('claude-opus-5', 1000, 0, 0, 0)])
  await run($, server, 't1', '옛 모델', '답', 1)

  expect(await screen($, terminal(prompt('옛 모델')))).toEqual(OPUS_5)
})

test('그려 둔 줄도 구독인 것을 알게 되면 1시간 값으로 다시 그린다', async ($, on) => {
  const server = engine(on, [priced('claude-opus-5-5', 0, 0, 10000, 0)])
  await run($, server, 't1', '써 줘', '썼습니다.', 1)

  const ui = await $.ui.mount(terminal(prompt('써 줘')))
  await ui.press({ key: 'fold-input' })
  const drawn = async () => costRows(linesOf((await ui.drawn()) as Drawn).map(line => line.trimEnd()))
  expect(await drawn()).toEqual(WRITE_5M)
  await subscribed($)
  expect(await drawn()).toEqual(WRITE_1H)
  await ui.unmount()
})

// 데스크톱에 그린 글: open 에 적은 단추를 눌러 펼친 뒤 읽는다
const textsOf = async ($: Engine, mount: Mount, open: string[] = []) => {
  const ui = await $.ui.mount(mount)
  for (const key of open) await ui.press({ key })
  const texts = (await ui.findAll({ type: 'Text' })).map(one => one.text)
  await ui.unmount()

  return texts
}

// 카드 머리줄의 접기 단추(펼친 카드는 빼기 기호, 접힌 카드는 더하기)
const FOLD = ' − '
const UNFOLD = ' + '

test('데스크톱 앱은 프롬프트 밑에 입력 카드를, 마지막 답변 밑에 출력 카드를 그린다', async ($, on) => {
  const server = engine(on, [
    priced('claude-opus-5-5', 5, 20000, 300, 300),
    priced('claude-opus-5-5', 10, 20400, 0, 120)
  ])
  await $.turn.start({ turnId: 't1', text: '첫 질문' })
  const row = desktop(prompt('첫 질문'))

  // 응답 전에는 턴 번호와 어림한 프롬프트 토큰만 있고, 펼칠 표가 없어 단추가 없다
  expect(await textsOf($, row)).toEqual(DESKTOP_WAITING)

  for (let index = 0; index < 2; index += 1) await step($, server, 't1', index)
  await complete($, 't1', '첫 답변')

  // 펼치면 머리줄의 제목, 금액, 단추, 그 밑에 맥락 한 줄과 이름, 토큰 수, 비율, 비용, 메모의 다섯 열(빈칸은 공백 한 칸)
  expect(await textsOf($, row, ['fold-input'])).toEqual(DESKTOP_INPUT)
  expect(await textsOf($, desktop(reply('첫 답변')), ['fold-output'])).toEqual(DESKTOP_OUTPUT)
})

test('데스크톱 앱의 카드는 정가를 모르는 모델이면 비용 열 없이 그 모델을 적는다', async ($, on) => {
  const server = engine(on, [priced('claude-future-9', 1000, 0, 0, 100)])
  await run($, server, 't1', '새 모델', '답했습니다.', 1)

  expect(await textsOf($, desktop(prompt('새 모델')), ['fold-input'])).toEqual(DESKTOP_UNPRICED_INPUT)
  expect(await textsOf($, desktop(reply('답했습니다.')), ['fold-output'])).toEqual(DESKTOP_UNPRICED_OUTPUT)
})

test('데스크톱 앱의 카드는 접힌 채로 시작하고, 단추를 누른 카드만 펼치며 다시 누르면 접는다', async ($, on) => {
  const server = engine(on, [
    priced('claude-opus-5-5', 5, 20000, 300, 300),
    priced('claude-opus-5-5', 5, 20000, 0, 100)
  ])
  await run($, server, 't1', '첫 질문', '첫 답변', 1)
  await run($, server, 't2', '둘째 질문', '둘째 답변', 1)
  const first = desktop(prompt('첫 질문'))
  const second = desktop(prompt('둘째 질문'))
  const answer = desktop(reply('첫 답변'))

  // 접힌 카드는 머리줄의 제목, 턴 번호, 전체 토큰 수, 금액, 단추만 보인다
  const folded = ['engine', 'Input', '(turn 1)', '20,305 tok', '$0.0055', UNFOLD]
  const foldedOutput = ['engine', 'Output', '(turn 1)', '300 tok', '$0.0060', UNFOLD]
  expect(await textsOf($, first)).toEqual(folded)
  expect(await textsOf($, answer)).toEqual(foldedOutput)

  const input = await $.ui.mount(first)
  await input.press({ key: 'fold-input' })
  expect((await input.find({ key: 'fold-input' }))?.text).toBe(FOLD)
  await input.unmount()

  // 누른 카드만 펼쳐지고, 같은 턴의 출력 카드와 다른 턴의 카드는 접힌 채다
  expect((await textsOf($, first)).length).toBeGreaterThan(6)
  expect(await textsOf($, answer)).toEqual(foldedOutput)
  expect(await textsOf($, second)).toHaveLength(6)

  // 다시 누르면 접는다
  expect(await textsOf($, first, ['fold-input'])).toEqual(folded)

  // 데스크톱에서 펼친 상태는 터미널과 따로 간다
  await textsOf($, second, ['fold-input'])
  expect(await screen($, terminal(prompt('둘째 질문')))).toHaveLength(2)
})

// 화면에 그려져야 하는 줄. 터미널은 열 정렬까지 글자 그대로 견주고, 데스크톱은 Text 의 글을 문서 차례대로 견준다
const CACHE_SPLIT: unknown[] = [
  "engine",
  "  [-] INPUT  (turn 1 / 2 requests / cached 13:55:02)",
  "                       TOK       %      COST",
  "      total         20,200           $0.0510",
  "      cache read    10,000   49.5%   $0.0020",
  "      cache write    8,150   40.3%   $0.0408   (5m)",
  "      uncached       2,050   10.1%   $0.0082",
  "      prompt            ~4",
]
const COMMAND_INPUT: unknown[] = [
  "  [+] INPUT   40,415 tok  $0.0081  (turn 1 / 2 requests / cached 13:55:02)",
]
const COMMAND_OUTPUT: unknown[] = [
  "  [+] OUTPUT     420 tok  $0.0084  (turn 1 / turn total $0.0165)",
]
const COST_1H: unknown[] = [
  "      total         20,200           $0.0754",
  "      cache read    10,000   49.5%   $0.0020",
  "      cache write    8,150   40.3%   $0.0652   (1h)",
  "      uncached       2,050   10.1%   $0.0082",
]
const COST_5M: unknown[] = [
  "      total         20,200           $0.0510",
  "      cache read    10,000   49.5%   $0.0020",
  "      cache write    8,150   40.3%   $0.0408   (5m)",
  "      uncached       2,050   10.1%   $0.0082",
]
const COST_OUTPUT_5M: unknown[] = [
  "engine",
  "  [+] OUTPUT     180 tok  $0.0036  (turn 1 / turn total $0.0546)",
]
const DESKTOP_INPUT: unknown[] = [
  "engine",
  "Input",
  "(turn 1)",
  "$0.0096",
  " − ",
  "2 requests / cached 13:55:02",
  "Total",
  "Cache read",
  "Cache write",
  "Uncached",
  "Prompt",
  "40,715",
  "40,400",
  "300",
  "15",
  "~4",
  " ",
  "99.2%",
  "0.7%",
  "0.0%",
  " ",
  "$0.0096",
  "$0.0081",
  "$0.0015",
  "$0.0001",
  " ",
  " ",
  " ",
  "(5m)",
  " ",
  " ",
]
const DESKTOP_OUTPUT: unknown[] = [
  "engine",
  "Output",
  "(turn 1)",
  "$0.0084",
  " − ",
  "Output",
  "Turn total",
  "420",
  " ",
  "$0.0084",
  "$0.0180",
]
const DESKTOP_UNPRICED_INPUT: unknown[] = [
  "engine",
  "Input",
  "(turn 1)",
  "$?",
  " − ",
  "1 request / cached 13:55:02",
  "Total",
  "Cache read",
  "Uncached",
  "Prompt",
  "1,000",
  "0",
  "1,000",
  "~4",
  " ",
  "0.0%",
  "100.0%",
  " ",
  "No price for claude-future-9",
]
const DESKTOP_UNPRICED_OUTPUT: unknown[] = [
  "engine",
  "Output",
  "(turn 1)",
  "$?",
  " − ",
  "Output",
  "100",
  "No price for claude-future-9",
]
const DESKTOP_WAITING: unknown[] = [
  "engine",
  "Input",
  "(turn 1)",
  "Waiting for response",
  "Prompt",
  "~4",
]
const FIRST_COLLAPSED: unknown[] = [
  "engine",
  "  [+] INPUT   40,415 tok  $0.0081  (turn 1 / 2 requests / cached 13:55:04)",
]
const FIRST_OUTPUT_COLLAPSED: unknown[] = [
  "engine",
  "  [+] OUTPUT     420 tok  $0.0084  (turn 1 / turn total $0.0165)",
]
const FOCUS_INPUT: unknown[] = [
  "  [+] INPUT   40,415 tok  $0.0081  (turn 1 / 2 requests / cached 13:55:02)",
]
const FOCUS_OUTPUT: unknown[] = [
  "  [+] OUTPUT     420 tok  $0.0084  (turn 1 / turn total $0.0165)",
]
const HAIKU_LONG: unknown[] = [
  "engine",
  "  [+] INPUT  100,001 tok  $0.0500  (turn 2 / 1 request / cached 13:55:02)",
]
const HAIKU_OUTPUT: unknown[] = [
  "engine",
  "  [+] OUTPUT   1,000 tok  $0.0025  (turn 2 / turn total $0.0525)",
]
const HAIKU_SHORT: unknown[] = [
  "engine",
  "  [+] INPUT  100,000 tok  $0.0100  (turn 1 / 1 request / cached 13:55:02)",
]
const MIXED_INPUT: unknown[] = [
  "engine",
  "  [+] INPUT    2,000 tok  $0.0060  (turn 1 / 2 requests / cached 13:55:02)",
]
const MIXED_OUTPUT: unknown[] = [
  "engine",
  "  [+] OUTPUT     200 tok  $0.0030  (turn 1 / turn total $0.0090)",
]
const OPUS_5: unknown[] = [
  "engine",
  "  [+] INPUT    1,000 tok  $0.0050  (turn 1 / 1 request / cached 13:55:02)",
]
const OUTPUT_CARD: unknown[] = [
  "engine",
  "Output",
  "(turn 1)",
  "$0.0084",
  " − ",
  "Output",
  "Turn total",
  "420",
  " ",
  "$0.0084",
  "$0.0165",
]
const SECOND_OPEN: unknown[] = [
  "engine",
  "  [-] INPUT  (turn 2 / 2 requests / cached 13:56:08)",
  "                       TOK       %      COST",
  "      total         42,362           $0.0085",
  "      cache read    42,350   99.9%   $0.0085",
  "      uncached          12    0.0%  <$0.0001",
  "      prompt            ~7",
  "      context          178",
]
const SECOND_OUTPUT_OPEN: unknown[] = [
  "engine",
  "  [-] OUTPUT  (turn 2)",
  "                       TOK              COST",
  "      output         2,400           $0.0480",
  "      turn total                     $0.0565",
]
const SINGLE: unknown[] = [
  "engine",
  "  [+] INPUT   30,003 tok  $0.0060  (turn 1 / 1 request / cached 13:55:02)",
]
const SUBAGENT_INPUT: unknown[] = [
  "engine",
  "  [+] INPUT   40,319 tok  $0.0081  (turn 1 / 2 requests / cached 13:55:02)",
]
const SUBAGENT_OUTPUT: unknown[] = [
  "engine",
  "  [+] OUTPUT     500 tok  $0.0100  (turn 1 / turn total $0.0181)",
]
const TWICE_FIRST: unknown[] = [
  "engine",
  "  [-] INPUT  (turn 1 / 1 request / cached 13:55:02)",
  "                       TOK       %      COST",
  "      total         20,005           $0.0040",
  "      cache read    20,000   99.9%   $0.0040",
  "      uncached           5    0.0%  <$0.0001",
  "      prompt            ~6",
]
const TWICE_REPLIES: unknown[] = [
  ["engine", "  [+] OUTPUT     300 tok  $0.0060  (turn 1 / turn total $0.0100)"],
  ["engine", "  [+] OUTPUT      50 tok  $0.0010  (turn 2 / turn total $0.0051)"],
]
const TWICE_SECOND: unknown[] = [
  "engine",
  "  [-] INPUT  (turn 2 / 1 request / cached 13:55:02)",
  "                       TOK       %      COST",
  "      total         20,404           $0.0041",
  "      cache read    20,400   99.9%   $0.0041",
  "      uncached           4    0.0%  <$0.0001",
  "      prompt            ~6",
  "      context           99",
]
const UNPRICED_INPUT: unknown[] = [
  "engine",
  "  [-] INPUT  (turn 1 / 2 requests / cached 13:55:02)",
  "                       TOK       %",
  "      total          2,000",
  "      cache read         0    0.0%",
  "      uncached       2,000  100.0%",
  "      prompt            ~4",
  "      no price for claude-future-9",
]
const UNPRICED_OUTPUT: unknown[] = [
  "engine",
  "  [-] OUTPUT  (turn 1)",
  "                       TOK",
  "      output           200",
  "      no price for claude-future-9",
]
const WRITE_1H: unknown[] = [
  "      total         10,000           $0.0800",
  "      cache read         0    0.0%   $0.0000",
  "      cache write   10,000  100.0%   $0.0800   (1h)",
  "      uncached           0    0.0%   $0.0000",
]
const WRITE_5M: unknown[] = [
  "      total         10,000           $0.0500",
  "      cache read         0    0.0%   $0.0000",
  "      cache write   10,000  100.0%   $0.0500   (5m)",
  "      uncached           0    0.0%   $0.0000",
]
