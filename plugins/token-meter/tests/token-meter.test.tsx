import { expect, mock, test } from 'claude-code/testing'
import type { On, TurnUsage } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'

// 글 한 줄로 그리는 화면: 데스크톱 앱은 같은 자리에 카드를 그려서 따로 시험한다
const SURFACES = ['terminal'] as const
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

const lineUnder = async ($: Engine, mount: Parameters<Engine['ui']['mount']>[0]) => {
  const ui = await $.ui.mount(mount)
  const engineRow = await ui.find({ type: 'Text', text: 'engine' })
  const line = await ui.find({ type: 'Text', text: /tokens/ })
  await ui.unmount()

  return { hasRow: engineRow !== undefined, line: line?.text }
}

test('응답 전의 프롬프트 줄 밑에는 글자 수로 어림한 토큰을 보인다', async ($, on) => {
  engine(on, [])

  for (const surface of SURFACES) {
    // 한글 8자 x 1.35 + 공백 3자 / 3.2 = 11.7
    const seen = await lineUnder($, { ...prompt('이 버그를 고쳐 줄래'), surface })
    expect(seen.hasRow).toBe(true)
    expect(seen.line).toBe('prompt ~12 tokens')
  }
})

test('입력한 글, 첫 요청이 늘린 양, 보낸 전체 입력의 합과 서버가 캐시에 쓴 시각을, 답변 밑에는 출력 합계를 보인다', async ($, on) => {
  const server = engine(
    on,
    [usage(5, 20000, 300), usage(10, 20400, 120), usage(8, 20700, 900), usage(4, 21650, 1500)],
    2000
  )

  await run($, server, 't1', '첫 질문', '첫 답변', 2)
  await server.clock.advance(MINUTE)
  await run($, server, 't2', '두 번째 질문', '두 번째 답변입니다.', 2)

  for (const surface of SURFACES) {
    // 첫 턴은 견줄 직전 요청이 없어 늘린 양을 빼고, 보낸 양은 20005 + 20410
    // 캐시 시각은 요청을 보낸 13:55:02 가 아니라 서버가 응답을 시작한 2초 뒤
    const first = await lineUnder($, { ...prompt('첫 질문'), surface })
    expect(first.line).toBe(
      'prompt ~4 / total input 40,415 tokens (cache read 40,400 / 99.9%, 2 requests, cached 13:55:04)'
    )

    // 늘린 양은 20708 - (20410 + 120) = 178, 보낸 양은 20708 + 21654
    // 첫 턴 두 요청(4초) + 1분 + 응답까지 2초
    const second = await lineUnder($, { ...prompt('두 번째 질문'), surface })
    expect(second.line).toBe(
      'prompt ~7 / context 178 / total input 42,362 tokens (cache read 42,350 / 99.9%, 2 requests, cached 13:56:08)'
    )

    expect((await lineUnder($, { ...reply('첫 답변'), surface })).line).toBe(
      'output 420 tokens / $0.0084 (turn $0.0165)'
    )
    const last = await lineUnder($, { ...reply('두 번째 답변입니다.'), surface })
    expect(last.hasRow).toBe(true)
    expect(last.line).toBe('output 2,400 tokens / $0.0480 (turn $0.0565)')

    expect((await lineUnder($, { ...reply('중간에 쓴 다른 글'), surface })).line).toBeUndefined()
  }
})

test('서브에이전트의 요청은 세지 않는다', async ($, on) => {
  const server = engine(on, [usage(5, 20000, 300), usage(50, 9000, 7000), usage(4, 20310, 200)])

  await $.turn.start({ turnId: 't1', text: '조사해 줘' })
  await step($, server, 't1', 0)
  await step($, server, 'sub', 0, 'agent-1')
  await step($, server, 't1', 1)
  await $.turn.complete({
    turnId: 't1',
    answer: '조사했습니다.',
    durationMs: 1000,
    isAborted: false,
    reason: 'answer'
  })

  const seen = await lineUnder($, { ...reply('조사했습니다.'), surface: 'terminal' })
  expect(seen.line).toBe('output 500 tokens / $0.0100 (turn $0.0181)')
  const sent = await lineUnder($, { ...prompt('조사해 줘'), surface: 'terminal' })
  expect(sent.line).toBe(
    'prompt ~6 / total input 40,319 tokens (cache read 40,310 / 99.9%, 2 requests, cached 13:55:02)'
  )
})

test('요청이 한 번이면 단수형으로 쓴다', async ($, on) => {
  const server = engine(on, [usage(3, 30000, 50)])

  await run($, server, 't1', '안녕', '안녕하세요.', 1)

  const seen = await lineUnder($, { ...prompt('안녕'), surface: 'terminal' })
  expect(seen.line).toBe(
    'prompt ~3 / total input 30,003 tokens (cache read 30,000 / 99.9%, 1 request, cached 13:55:02)'
  )
})

test('캐시에서 읽은 양과 그 비율을 보이고, 캐시에 새로 쓴 양은 읽은 양에 넣지 않는다', async ($, on) => {
  // 첫 요청은 캐시를 새로 쓰기만 하고, 다음 요청은 그 캐시를 읽는다
  const server = engine(on, [
    { ...usage(2000, 0, 100), cache_creation_input_tokens: 8000 },
    { ...usage(50, 10000, 80), cache_creation_input_tokens: 150 }
  ])

  await run($, server, 't1', '읽어 줘', '읽었습니다.', 2)

  // 읽은 10,000 / 보낸 20,200 = 49.50...%
  const seen = await lineUnder($, { ...prompt('읽어 줘'), surface: 'terminal' })
  expect(seen.line).toBe(
    'prompt ~4 / total input 20,200 tokens (cache read 10,000 / 49.5%, cache write 8,150, 2 requests, cached 13:55:02)'
  )
})

test('알림 줄과 슬래시 명령 줄은 그대로 둔다', async ($, on) => {
  engine(on, [])

  for (const surface of SURFACES) {
    const notice = await lineUnder($, { ...prompt('작업 완료', 'task-notification'), surface })
    expect(notice.hasRow).toBe(true)
    expect(notice.line).toBeUndefined()

    expect((await lineUnder($, { ...prompt('/context'), surface })).line).toBeUndefined()
  }
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

// 데스크톱 앱의 출력 카드: 출력 420 토큰, 앞의 두 요청을 더한 턴 비용
// 카드 머리줄의 접기 단추(펼친 카드는 위 꺾쇠, 접힌 카드는 아래 꺾쇠)
const FOLD = '-'
const UNFOLD = '+'

const OUTPUT_CARD = [
  'engine',
  'Output',
  '$0.0084',
  FOLD,
  ...['Output', 'Turn total'],
  ...['420', ' '],
  ...['$0.0084', '$0.0165']
]

const textsOf = async ($: Engine, mount: Parameters<Engine['ui']['mount']>[0]) => {
  const ui = await $.ui.mount(mount)
  const texts = (await ui.findAll({ type: 'Text' })).map(one => one.text)
  await ui.unmount()

  return texts
}

test('명령이 시작한 턴은 첫 답변 위에 입력 토큰을, 마지막 답변 밑에 출력 합계를 보인다', async ($, on) => {
  const server = engine(on, [usage(5, 20000, 300), usage(10, 20400, 120)])
  const settle = prompts(on, $)

  // 턴을 시작하지 않는 명령의 줄은 다음 턴에 섞이지 않는다
  await command($, 'rename', '새 이름')
  await command($, 'goal', '테스트 통과')
  await settle()
  await step($, server, 'turn-2', 0)
  await respond($, 'reply-1', '목표를 확인했습니다.')
  await step($, server, 'turn-2', 1)
  await respond($, 'reply-2', '모두 통과했습니다.')
  await complete($, 'turn-2', '모두 통과했습니다.')

  for (const surface of SURFACES) {
    // 한글 5자 x 1.35 + 나머지 7자 / 3.2 = 8.9
    const first = { ...reply('목표를 확인했습니다.'), requestId: 'reply-1', surface }
    expect(await textsOf($, first)).toEqual([
      'prompt ~9 / total input 40,415 tokens (cache read 40,400 / 99.9%, 2 requests, cached 13:55:02)',
      'input cost $0.0081 (uncached $0.0001, cache read $0.0081)',
      'engine'
    ])
    const last = { ...reply('모두 통과했습니다.'), requestId: 'reply-2', surface }
    expect(await textsOf($, last)).toEqual(['engine', 'output 420 tokens / $0.0084 (turn $0.0165)'])

    // 명령 줄에는 아무것도 붙이지 않는다
    const row = { ...prompt('<command-name>/goal</command-name>'), requestId: 'row-2', surface }
    expect(await textsOf($, row)).toEqual(['engine'])
  }
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

  for (const surface of SURFACES) {
    // 도구 호출 앞의 첫 답변은 그려지지 않고 마지막 답변만 그려진다
    const last = { ...reply('모두 통과했습니다.'), requestId: 'focus-2', surface }
    expect(await textsOf($, last)).toEqual([
      'prompt ~9 / total input 40,415 tokens (cache read 40,400 / 99.9%, 2 requests, cached 13:55:02)',
      'input cost $0.0081 (uncached $0.0001, cache read $0.0081)',
      'engine',
      'output 420 tokens / $0.0084 (turn $0.0165)'
    ])
  }
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

  const first = {
    ...reply('목표를 확인했습니다.'),
    requestId: 'msg_01A-t0',
    surface: 'desktop'
  } as const
  expect((await textsOf($, first)).slice(0, 4)).toEqual(['Input', '$0.0081', FOLD, 'Prompt'])
  const last = {
    ...reply('모두 통과했습니다.\n'),
    requestId: 'msg_01B-t0',
    surface: 'desktop'
  } as const
  expect(await textsOf($, last)).toEqual(OUTPUT_CARD)
  // 글이 다른 블록에는 붙이지 않는다
  const other = { ...reply('중간 설명'), requestId: 'msg_01B-t1', surface: 'desktop' } as const
  expect(await textsOf($, other)).toEqual(['engine'])
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

  for (const surface of SURFACES) {
    const first = { ...prompt(typed), requestId: 'row-1', surface }
    expect(await textsOf($, first)).toEqual([
      'engine',
      'prompt ~6 / total input 20,005 tokens (cache read 20,000 / 99.9%, 1 request, cached 13:55:02)',
      'input cost $0.0040 (uncached <$0.0001, cache read $0.0040)'
    ])
    // 늘린 양은 20404 - (20005 + 300) = 99
    const second = { ...prompt(typed), requestId: 'row-2', surface }
    expect(await textsOf($, second)).toEqual([
      'engine',
      'prompt ~6 / context 99 / total input 20,404 tokens (cache read 20,400 / 99.9%, 1 request, cached 13:55:02)',
      'input cost $0.0041 (uncached <$0.0001, cache read $0.0041)'
    ])

    // 답변도 글이 같아 줄 id 로 가른다
    const replies = await Promise.all(
      ['reply-1', 'reply-2'].map(id =>
        textsOf($, { ...reply('했습니다.'), requestId: id, surface })
      )
    )
    expect(replies).toEqual([
      ['engine', 'output 300 tokens / $0.0060 (turn $0.0100)'],
      ['engine', 'output 50 tokens / $0.0010 (turn $0.0051)']
    ])
  }
})

const priced = (model: string, input: number, cached: number, written: number, output: number) => ({
  ...usage(input, cached, output),
  model,
  cache_creation_input_tokens: written
})

const lineOf = async ($: Engine, mount: Parameters<Engine['ui']['mount']>[0], pattern: RegExp) =>
  (await textsOf($, mount)).find(text => pattern.test(text))

const subscribed = ($: Engine) =>
  $.session.measure({
    context: { window: 1_000_000 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 3 }],
    changed: ['rateLimits']
  })

test('입력 비용을 캐시 읽기와 쓰기로 나누고, 캐시 쓰기는 구독이면 1시간, 아니면 5분 값으로 매긴다', async ($, on) => {
  const server = engine(on, [
    priced('claude-opus-5-5', 2000, 0, 8000, 100),
    priced('claude-opus-5-5', 50, 10000, 150, 80)
  ])
  await run($, server, 't1', '읽어 줘', '읽었습니다.', 2)
  const row = { ...prompt('읽어 줘'), surface: 'terminal' } as const
  const answer = { ...reply('읽었습니다.'), surface: 'terminal' } as const

  // 입력 2,050 x $4, 읽기 10,000 x $0.20, 쓰기 8,150 x $4 x 1.25 (100만 토큰당)
  expect(await lineOf($, row, /^input cost/)).toBe(
    'input cost $0.0510 (uncached $0.0082, cache read $0.0020, cache write 5m $0.0408)'
  )
  expect(await lineOf($, answer, /^output/)).toBe('output 180 tokens / $0.0036 (turn $0.0546)')

  // 구독 로그인은 사용량 한도 창을 알려 오고, Claude Code 는 1시간 동안 캐시에 둔다(입력 단가의 2배)
  await subscribed($)
  expect(await lineOf($, row, /^input cost/)).toBe(
    'input cost $0.0754 (uncached $0.0082, cache read $0.0020, cache write 1h $0.0652)'
  )
})

test(
  '설정에서 고른 캐시 보존 시간을 쓴다',
  { options: { cacheTtl: '1h' } },
  async ($, on) => {
    const server = engine(on, [priced('claude-opus-5-5', 0, 0, 10000, 0)])
    await run($, server, 't1', '써 줘', '썼습니다.', 1)

    const row = { ...prompt('써 줘'), surface: 'terminal' } as const
    expect(await lineOf($, row, /^input cost/)).toBe(
      'input cost $0.0800 (uncached $0.0000, cache read $0.0000, cache write 1h $0.0800)'
    )
  }
)

test('FORCE_PROMPT_CACHING_5M 이 있으면 구독이어도 5분 값으로 매긴다', async ($, on) => {
  mock.env(on, { FORCE_PROMPT_CACHING_5M: '1' })
  const server = engine(on, [priced('claude-opus-5-5', 0, 0, 10000, 0)])
  await run($, server, 't1', '써 줘', '썼습니다.', 1)
  await subscribed($)

  const row = { ...prompt('써 줘'), surface: 'terminal' } as const
  expect(await lineOf($, row, /^input cost/)).toBe(
    'input cost $0.0500 (uncached $0.0000, cache read $0.0000, cache write 5m $0.0500)'
  )
})

test('Haiku 5.5 는 프롬프트가 10만 토큰을 넘는 요청에만 긴 프롬프트 정가를 매긴다', async ($, on) => {
  const server = engine(on, [
    priced('claude-haiku-5-5', 100_000, 0, 0, 1000),
    priced('claude-haiku-5-5', 100_001, 0, 0, 1000)
  ])
  await run($, server, 't1', '짧게', '짧은 답', 1)
  await run($, server, 't2', '길게', '긴 답', 1)

  const short = { ...prompt('짧게'), surface: 'terminal' } as const
  expect(await lineOf($, short, /^input cost/)).toBe(
    'input cost $0.0100 (uncached $0.0100, cache read $0.0000)'
  )
  const long = { ...prompt('길게'), surface: 'terminal' } as const
  expect(await lineOf($, long, /^input cost/)).toBe(
    'input cost $0.0500 (uncached $0.0500, cache read $0.0000)'
  )
  const answer = { ...reply('긴 답'), surface: 'terminal' } as const
  expect(await lineOf($, answer, /^output/)).toBe('output 1,000 tokens / $0.0025 (turn $0.0525)')
})

test('턴 중간에 모델이 바뀌면 요청마다 그 모델의 정가로 매기고, 공급자 접두사와 날짜 꼬리는 뗀다', async ($, on) => {
  const server = engine(on, [
    priced('claude-opus-5-5', 1000, 0, 0, 100),
    priced('us.anthropic.claude-sonnet-5-5-20261001-v1:0', 1000, 0, 0, 100)
  ])
  await run($, server, 't1', '바꿔 줘', '바꿨습니다.', 2)

  // 입력 1,000 x ($4 + $2), 출력 100 x ($20 + $10)
  const row = { ...prompt('바꿔 줘'), surface: 'terminal' } as const
  expect(await lineOf($, row, /^input cost/)).toBe(
    'input cost $0.0060 (uncached $0.0060, cache read $0.0000)'
  )
  const answer = { ...reply('바꿨습니다.'), surface: 'terminal' } as const
  expect(await lineOf($, answer, /^output/)).toBe('output 200 tokens / $0.0030 (turn $0.0090)')
})

test('정가를 모르는 모델의 요청이 있으면 비용을 어림하지 않는다', async ($, on) => {
  const server = engine(on, [
    priced('claude-opus-5-5', 1000, 0, 0, 100),
    priced('claude-future-9', 1000, 0, 0, 100)
  ])
  await run($, server, 't1', '새 모델', '답했습니다.', 2)

  const row = { ...prompt('새 모델'), surface: 'terminal' } as const
  expect(await lineOf($, row, /^input cost/)).toBe(
    'input cost unknown (no price for claude-future-9)'
  )
  const answer = { ...reply('답했습니다.'), surface: 'terminal' } as const
  expect(await lineOf($, answer, /^output/)).toBe('output 200 tokens')
})

test('Opus 5 를 Opus 5.5 정가로 섞지 않는다', async ($, on) => {
  const server = engine(on, [priced('claude-opus-5', 1000, 0, 0, 0)])
  await run($, server, 't1', '옛 모델', '답', 1)

  const row = { ...prompt('옛 모델'), surface: 'terminal' } as const
  expect(await lineOf($, row, /^input cost/)).toBe(
    'input cost $0.0050 (uncached $0.0050, cache read $0.0000)'
  )
})

test('그려 둔 줄도 구독인 것을 알게 되면 1시간 값으로 다시 그린다', async ($, on) => {
  const server = engine(on, [priced('claude-opus-5-5', 0, 0, 10000, 0)])
  await run($, server, 't1', '써 줘', '썼습니다.', 1)

  const ui = await $.ui.mount({ ...prompt('써 줘'), surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^input cost/ }))?.text).toBe(
    'input cost $0.0500 (uncached $0.0000, cache read $0.0000, cache write 5m $0.0500)'
  )
  await subscribed($)
  expect((await ui.find({ type: 'Text', text: /^input cost/ }))?.text).toBe(
    'input cost $0.0800 (uncached $0.0000, cache read $0.0000, cache write 1h $0.0800)'
  )
  await ui.unmount()
})

test('데스크톱 앱은 프롬프트 밑에 입력 카드를, 마지막 답변 밑에 출력 카드를 그린다', async ($, on) => {
  const server = engine(on, [
    priced('claude-opus-5-5', 5, 20000, 300, 300),
    priced('claude-opus-5-5', 10, 20400, 0, 120)
  ])
  await $.turn.start({ turnId: 't1', text: '첫 질문' })
  const row = { ...prompt('첫 질문'), surface: 'desktop' } as const

  // 응답 전에는 어림한 프롬프트 토큰만
  expect(await textsOf($, row)).toEqual(['engine', 'Input', FOLD, 'Prompt', '~4'])

  for (let index = 0; index < 2; index += 1) await step($, server, 't1', index)
  await complete($, 't1', '첫 답변')

  // 머리줄의 제목과 입력 비용, 그 밑에 이름, 토큰 수, 비용의 세 열(빈칸은 공백 한 칸)
  expect(await textsOf($, row)).toEqual([
    'engine',
    'Input',
    '$0.0096',
    FOLD,
    ...['Prompt', 'Total input', 'Uncached', 'Cache read', 'Cache write 5m', 'Requests', 'Cached at'],
    ...['~4', '40,715', '15', '40,400 (99.2%)', '300', '2', '13:55:02'],
    ...[' ', ' ', '$0.0001', '$0.0081', '$0.0015', ' ', ' ']
  ])
  expect(await textsOf($, { ...reply('첫 답변'), surface: 'desktop' })).toEqual([
    'engine',
    'Output',
    '$0.0084',
    FOLD,
    ...['Output', 'Turn total'],
    ...['420', ' '],
    ...['$0.0084', '$0.0180']
  ])
})

test('데스크톱 앱의 카드는 정가를 모르는 모델이면 비용 열 없이 그 모델을 적는다', async ($, on) => {
  const server = engine(on, [priced('claude-future-9', 1000, 0, 0, 100)])
  await run($, server, 't1', '새 모델', '답했습니다.', 1)

  const row = { ...prompt('새 모델'), surface: 'desktop' } as const
  expect(await textsOf($, row)).toEqual([
    'engine',
    'Input',
    FOLD,
    ...['Prompt', 'Total input', 'Uncached', 'Cache read', 'Request', 'Cached at'],
    ...['~4', '1,000', '1,000', '0 (0.0%)', '1', '13:55:02'],
    'No price for claude-future-9'
  ])
  expect(await textsOf($, { ...reply('답했습니다.'), surface: 'desktop' })).toEqual([
    'engine',
    'Output',
    FOLD,
    'Output',
    '100',
    'No price for claude-future-9'
  ])
})

test('데스크톱 앱의 카드는 접기 단추를 누른 카드만 머리줄만 남기고 다시 누르면 펼친다', async ($, on) => {
  const server = engine(on, [
    priced('claude-opus-5-5', 5, 20000, 300, 300),
    priced('claude-opus-5-5', 5, 20000, 0, 100)
  ])
  await run($, server, 't1', '첫 질문', '첫 답변', 1)
  await run($, server, 't2', '둘째 질문', '둘째 답변', 1)
  const first = { ...prompt('첫 질문'), surface: 'desktop' } as const
  const second = { ...prompt('둘째 질문'), surface: 'desktop' } as const
  const answer = { ...reply('첫 답변'), surface: 'desktop' } as const

  const input = await $.ui.mount(first)
  expect((await input.find({ key: 'fold' }))?.text).toBe(FOLD)
  await input.press({ key: 'fold' })
  expect((await input.find({ key: 'fold' }))?.text).toBe(UNFOLD)
  await input.unmount()

  // 누른 카드만 머리줄의 제목, 금액, 단추가 남고, 같은 턴의 출력 카드와 다른 턴의 카드는 그대로다
  expect(await textsOf($, first)).toEqual(['engine', 'Input', '$0.0055', UNFOLD])
  expect((await textsOf($, answer)).length).toBeGreaterThan(4)
  expect((await textsOf($, second)).length).toBeGreaterThan(4)

  // 출력 카드도 따로 접힌다
  const output = await $.ui.mount(answer)
  await output.press({ key: 'fold' })
  await output.unmount()
  expect(await textsOf($, answer)).toEqual(['engine', 'Output', '$0.0060', UNFOLD])

  // 다시 누르면 펼친다
  const again = await $.ui.mount(first)
  await again.press({ key: 'fold' })
  await again.unmount()
  expect((await textsOf($, first)).length).toBeGreaterThan(4)
  expect(await textsOf($, answer)).toEqual(['engine', 'Output', '$0.0060', UNFOLD])

  // 터미널의 한 줄은 접지 않는다
  expect((await textsOf($, { ...prompt('첫 질문'), surface: 'terminal' })).length).toBeGreaterThan(1)
})
