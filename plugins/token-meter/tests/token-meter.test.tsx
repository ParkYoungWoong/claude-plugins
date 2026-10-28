import { expect, mock, test } from 'claude-code/testing'
import type { On, TurnUsage } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'

const SURFACES = ['terminal', 'desktop'] as const
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
    expect(first.line).toBe('prompt ~4 / total input 40,415 tokens (2 requests, cached 13:55:04)')

    // 늘린 양은 20708 - (20410 + 120) = 178, 보낸 양은 20708 + 21654
    // 첫 턴 두 요청(4초) + 1분 + 응답까지 2초
    const second = await lineUnder($, { ...prompt('두 번째 질문'), surface })
    expect(second.line).toBe(
      'prompt ~7 / context 178 / total input 42,362 tokens (2 requests, cached 13:56:08)'
    )

    expect((await lineUnder($, { ...reply('첫 답변'), surface })).line).toBe('output 420 tokens')
    const last = await lineUnder($, { ...reply('두 번째 답변입니다.'), surface })
    expect(last.hasRow).toBe(true)
    expect(last.line).toBe('output 2,400 tokens')

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
  expect(seen.line).toBe('output 500 tokens')
  const sent = await lineUnder($, { ...prompt('조사해 줘'), surface: 'terminal' })
  expect(sent.line).toBe('prompt ~6 / total input 40,319 tokens (2 requests, cached 13:55:02)')
})

test('요청이 한 번이면 단수형으로 쓴다', async ($, on) => {
  const server = engine(on, [usage(3, 30000, 50)])

  await run($, server, 't1', '안녕', '안녕하세요.', 1)

  const seen = await lineUnder($, { ...prompt('안녕'), surface: 'terminal' })
  expect(seen.line).toBe('prompt ~3 / total input 30,003 tokens (1 request, cached 13:55:02)')
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
      'prompt ~9 / total input 40,415 tokens (2 requests, cached 13:55:02)',
      'engine'
    ])
    const last = { ...reply('모두 통과했습니다.'), requestId: 'reply-2', surface }
    expect(await textsOf($, last)).toEqual(['engine', 'output 420 tokens'])

    // 명령 줄에는 아무것도 붙이지 않는다
    const row = { ...prompt('<command-name>/goal</command-name>'), requestId: 'row-2', surface }
    expect(await textsOf($, row)).toEqual(['engine'])
  }
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
      'prompt ~6 / total input 20,005 tokens (1 request, cached 13:55:02)'
    ])
    // 늘린 양은 20404 - (20005 + 300) = 99
    const second = { ...prompt(typed), requestId: 'row-2', surface }
    expect(await textsOf($, second)).toEqual([
      'engine',
      'prompt ~6 / context 99 / total input 20,404 tokens (1 request, cached 13:55:02)'
    ])

    // 답변도 글이 같아 줄 id 로 가른다
    const replies = await Promise.all(
      ['reply-1', 'reply-2'].map(id =>
        textsOf($, { ...reply('했습니다.'), requestId: id, surface })
      )
    )
    expect(replies).toEqual([
      ['engine', 'output 300 tokens'],
      ['engine', 'output 50 tokens']
    ])
  }
})
