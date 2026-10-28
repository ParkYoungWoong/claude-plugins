import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

// 테스트 환경에는 있지만 hooks 모듈 타입에는 없는 타이머
declare const setTimeout: (callback: () => void, ms: number) => unknown
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

const ZERO = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0
}

const row = (text: string) =>
  ({
    plugin: 'prompt-translator',
    component: 'UserMessage',
    props: { text, origin: { kind: 'composer' }, isExpanded: false }
  }) as const

const SURFACES = ['terminal', 'desktop'] as const

// 숨기기 단추의 글: 터미널은 대괄호로 감싸고, 데스크톱 앱은 앱의 단추 모양으로 그린다
const HIDE = { terminal: '[Hide]', desktop: 'Hide' }
const SHOW = { terminal: '[Show]', desktop: 'Show' }

type Mounted = { findAll: (query: { type: 'Text' }) => Promise<{ text?: string }[]> }

// 번역은 낱말마다 Text 로 나뉘어 그려지므로 이어 붙여 화면에 보이는 글로 읽는다
const texts = async (ui: Mounted) => (await ui.findAll({ type: 'Text' })).map(one => one.text ?? '')
const shown = async (ui: Mounted) => (await texts(ui)).join('')

// 엔진 자리에 서서 번역 요청과 넘어간 프롬프트를 기록한다
const engine = (on: On, reply = 'Translated.') => {
  const seen = { prompts: [] as string[], systems: [] as string[], passed: [] as string[] }
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('model.complete', (_, e) => {
    seen.prompts.push(e.prompt)
    seen.systems.push(String(e.system ?? ''))

    return { value: { isAnswered: true, text: reply, usage: ZERO } }
  })
  on('prompt.submit', (_, e) => {
    seen.passed.push(e.text)

    return { text: e.text }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  return seen
}

const submit = (
  $: Engine,
  text: string,
  kind: 'composer' | 'task-notification' | 'sdk' = 'composer'
) => $.prompt.submit({ text, wait: false, origin: { kind } })

test('한글 프롬프트는 원문 그대로 넘기고 번역을 그 프롬프트 줄 밑에 붙인다', async ($, on) => {
  const seen = engine(on, 'Can you fix this bug?\n')

  await submit($, '이 버그 고쳐 줘')

  expect(seen.prompts).toHaveLength(1)
  expect(seen.passed).toEqual(['이 버그 고쳐 줘'])
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...row('이 버그 고쳐 줘'), surface })
    expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
    expect(await shown(ui)).toContain('Can you fix this bug?')
    await ui.unmount()

    const other = await $.ui.mount({ ...row('다른 프롬프트'), surface })
    expect((await shown(other)).includes('Can you fix')).toBe(false)
    expect(await other.find({ type: 'Button' })).toBeUndefined()
    await other.unmount()
  }
})

test('기본 언어는 미국 영어이고, 영어로 쓴 글과 언어를 가릴 수 없는 짧은 글은 번역하지 않는다', async ($, on) => {
  const seen = engine(on)

  await submit($, 'Can you fix this bug?')
  await submit($, 'continue')
  await submit($, '¿Puedes arreglar este error?')

  expect(seen.prompts).toEqual(['<message>\n¿Puedes arreglar este error?\n</message>'])
  expect(seen.systems[0]).toContain('into American English.')
})

test(
  '고른 언어로 번역하고, 이미 그 언어로 쓴 글은 번역하지 않는다',
  { options: { language: '日本語' } },
  async ($, on) => {
    const seen = engine(on, 'このバグを直して')

    await submit($, '이 버그 고쳐 줘')
    await submit($, 'このバグを直してください')
    await submit($, 'Can you fix this bug?')

    expect(seen.prompts).toEqual([
      '<message>\n이 버그 고쳐 줘\n</message>',
      '<message>\nCan you fix this bug?\n</message>'
    ])
    expect(seen.systems[0]).toContain('into Japanese.')
    const ui = await $.ui.mount({ ...row('이 버그 고쳐 줘'), surface: 'terminal' })
    expect((await ui.find({ key: 'toggle' }))?.text).toBe('[Hide]')
    await ui.unmount()
  }
)

test(
  '한글을 고르면 한글이 아닌 글을 한글로 번역한다',
  { options: { language: '한글' } },
  async ($, on) => {
    const seen = engine(on, '이 버그 고쳐 줘')

    await submit($, 'Can you fix this bug?')
    await submit($, '이 버그 고쳐 줘')
    await submit($, 'ok')
    await submit($, '这个错误帮我修一下')

    expect(seen.prompts).toEqual([
      '<message>\nCan you fix this bug?\n</message>',
      '<message>\n这个错误帮我修一下\n</message>'
    ])
    expect(seen.systems[0]).toContain('into Korean.')
  }
)

test(
  '영국 영어를 고르면 영국식 철자로 번역하게 한다',
  { options: { language: 'English (UK)' } },
  async ($, on) => {
    const seen = engine(on)

    await submit($, '색 정리해 줘')
    await submit($, 'Please organize the colors.')

    expect(seen.prompts).toHaveLength(1)
    expect(seen.systems[0]).toContain('into British English.')
    expect(seen.systems[0]).toContain('British spelling')
  }
)

test('번역마다 아이콘으로 숨기고 다시 보인다', async ($, on) => {
  engine(on, 'Run the tests.')

  await submit($, '테스트 돌려 줘')
  await submit($, '빌드해 줘')

  for (const surface of SURFACES) {
    const first = await $.ui.mount({ ...row('테스트 돌려 줘'), surface })
    const second = await $.ui.mount({ ...row('빌드해 줘'), surface })
    // 한글 8자(테스트 돌려 줘), 영어 14자(Run the tests.)
    expect((await first.find({ key: 'toggle' }))?.text).toBe(HIDE[surface])

    await first.press({ key: 'toggle' })
    expect((await first.find({ key: 'toggle' }))?.text).toBe(SHOW[surface])
    expect((await shown(first)).includes('Run the tests.')).toBe(false)
    // 다른 번역은 그대로 보인다
    expect(await shown(second)).toContain('Run the tests.')

    await first.press({ key: 'toggle' })
    expect((await first.find({ key: 'toggle' }))?.text).toBe(HIDE[surface])
    expect(await shown(first)).toContain('Run the tests.')
    await second.unmount()
    await first.unmount()
  }
})

test('300자가 넘으면 번역하지 않고, 키워드가 있으면 넘어도 번역하며 키워드는 뺀다', async ($, on) => {
  const seen = engine(on)
  const long = '가'.repeat(301)
  const exact = '나'.repeat(300)

  await submit($, long)
  await submit($, exact)
  await submit($, `${long} ultratranslate`)
  await submit($, '짧은 요청 ULTRATRANSLATE 입니다')

  expect(seen.prompts).toEqual([
    `<message>\n${exact}\n</message>`,
    `<message>\n${long}\n</message>`,
    '<message>\n짧은 요청 입니다\n</message>'
  ])
  expect(seen.passed).toEqual([long, exact, long, '짧은 요청 입니다'])

  const ui = await $.ui.mount({ ...row(long), surface: 'terminal' })
  expect(await shown(ui)).toContain('Translated.')
  await ui.unmount()
})

test(
  '자동 번역 글자 수를 바꾸면 그 수까지만 번역하고, 넘으면 키워드가 있을 때만 번역한다',
  { options: { maxChars: 10 } },
  async ($, on) => {
    const seen = engine(on)

    await submit($, '가'.repeat(10))
    await submit($, '나'.repeat(11))
    await submit($, `${'다'.repeat(11)} ultratranslate`)

    expect(seen.prompts).toEqual([
      `<message>\n${'가'.repeat(10)}\n</message>`,
      `<message>\n${'다'.repeat(11)}\n</message>`
    ])
  }
)

test(
  '자동 번역 글자 수가 0 이면 키워드가 있을 때만 번역한다',
  { options: { maxChars: 0 } },
  async ($, on) => {
    const seen = engine(on)

    await submit($, '짧은 요청')
    await submit($, '짧은 요청 ultratranslate')

    expect(seen.prompts).toEqual(['<message>\n짧은 요청\n</message>'])
  }
)

test('붙여넣은 글의 표식은 번역할 글과 글자 수에서 뺀다', async ($, on) => {
  const seen = engine(on)

  await submit(
    $,
    '<pasted_content id="ab12">\n첫 줄입니다.\n</pasted_content id="ab12">\n\n요약해 줘'
  )

  expect(seen.prompts).toEqual(['<message>\n첫 줄입니다.\n\n요약해 줘\n</message>'])
})

test('턴을 시작하지 않는 슬래시 명령, 영어, 작업 알림, 화면 없는 세션은 번역하지 않는다', async ($, on) => {
  let surfaces: ('terminal' | 'desktop')[] = ['terminal']
  let calls = 0
  on('session.surfaces', () => ({ value: surfaces }))
  on('model.complete', () => {
    calls += 1

    return { value: { isAnswered: true, text: 'x', usage: ZERO } }
  })
  on('prompt.submit', (_, e) => ({ text: e.text }))

  await $.prompt.submit({
    text: '/commit 커밋해 줘',
    command: { name: 'commit', args: '커밋해 줘' },
    wait: false,
    origin: { kind: 'composer' }
  })
  await submit($, 'fix the bug')
  await submit($, '작업이 끝났습니다', 'task-notification')
  surfaces = []
  await submit($, '헤드리스 실행', 'sdk')

  expect(calls).toBe(0)
})

test('번역에 실패하면 이유만 붙이고 원문은 그대로 넘어간다', async ($, on) => {
  const passed: string[] = []
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('model.complete', () => ({
    value: {
      isAnswered: false,
      reason: 'api-error',
      status: 529,
      error: 'overloaded',
      usage: ZERO
    }
  }))
  on('prompt.submit', (_, e) => {
    passed.push(e.text)

    return { text: e.text }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  await submit($, '테스트 돌려 줘')

  expect(passed).toEqual(['테스트 돌려 줘'])
  const ui = await $.ui.mount({ ...row('테스트 돌려 줘'), surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'Could not translate (API error 529)' })).toBeDefined()
  await ui.unmount()
})

test('모델이 따라 쓴 태그를 걷어 내고, 원문에 없는 빈 줄은 번역에서도 뺀다', async ($, on) => {
  engine(on, '<message>\n\n\nLine one.\n\n\n\nLine two.\n</message>')

  await submit($, '첫 줄\n둘째 줄')

  const ui = await $.ui.mount({ ...row('첫 줄\n둘째 줄'), surface: 'terminal' })
  // 줄마다 낱말이 이어지고, 두 줄 사이에 빈 줄(' ')이 없다
  expect(await texts(ui)).toEqual(['engine', ' ', 'Line ', 'one.', 'Line ', 'two.'])
  await ui.unmount()
})

test('원문에 빈 줄이 있으면 번역에도 빈 줄을 한 줄까지만 둔다', async ($, on) => {
  engine(on, 'Para one.\n\n\n\nPara two.')

  await submit($, '첫 문단\n\n둘째 문단')

  const ui = await $.ui.mount({ ...row('첫 문단\n\n둘째 문단'), surface: 'terminal' })
  expect(await texts(ui)).toEqual(['engine', ' ', 'Para ', 'one.', ' ', 'Para ', 'two.'])
  await ui.unmount()
})

test('번역이 길게 접혀도 다음 줄이 단추 밑에서 시작하도록 단추와 낱말을 한 줄에 흘린다', async ($, on) => {
  engine(on, 'このバグを直して')

  await submit($, '이 버그 고쳐 줘')

  const ui = await $.ui.mount({ ...row('이 버그 고쳐 줘'), surface: 'terminal' })
  // 한자와 가나는 한 글자씩 흐른다
  expect(await texts(ui)).toEqual(['engine', ' ', ...'このバグを直して'])
  await ui.unmount()
})

test(
  '데스크톱 앱은 번역을 카드에 담고 머리줄에 언어와 숨기기 단추를 둔다',
  { options: { language: '日本語' } },
  async ($, on) => {
    engine(on, 'このバグを直して\n二行目')

    await submit($, '이 버그 고쳐 줘\n둘째 줄')

    const ui = await $.ui.mount({ ...row('이 버그 고쳐 줘\n둘째 줄'), surface: 'desktop' })
    // 낱말로 나누지 않고 한 덩어리로 그려 줄바꿈은 앱에 맡긴다
    expect(await texts(ui)).toEqual(['engine', '日本語', 'このバグを直して\n二行目'])
    expect(await ui.find({ type: 'Svg' })).toBeDefined()

    await ui.press({ key: 'toggle' })
    expect((await ui.find({ key: 'toggle' }))?.text).toBe('Show')
    expect(await texts(ui)).toEqual(['engine', '日本語'])
    await ui.unmount()
  }
)

test('번역을 기다리지 않고 원문을 바로 넘기고, 번역은 끝나는 대로 같은 자리에 붙는다', async ($, on) => {
  let release = () => {}
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  const passed: string[] = []
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('model.complete', async () => {
    await gate

    return { value: { isAnswered: true, text: 'Build it.', usage: ZERO } }
  })
  on('prompt.submit', (_, e) => {
    passed.push(e.text)

    return { text: e.text }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  const submitting = submit($, '빌드해 줘')
  await Promise.race([submitting, wait(50)])

  // 번역이 아직 안 끝났는데 프롬프트는 이미 넘어갔다
  expect(passed).toEqual(['빌드해 줘'])
  const ui = await $.ui.mount({ ...row('빌드해 줘'), surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'Translating...' })).toBeDefined()

  release()
  await submitting
  await wait(50)
  expect(await shown(ui)).toContain('Build it.')
  expect(await ui.find({ type: 'Text', text: 'Translating...' })).toBeUndefined()
  await ui.unmount()
})

test('다른 Mod 가 프롬프트 줄 밑에 붙인 줄보다 번역이 먼저 온다', async ($, on) => {
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('model.complete', () => ({
    value: { isAnswered: true, text: 'Run the tests.', usage: ZERO }
  }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  // 엔진의 프롬프트 줄 밑에 token-meter 처럼 한 줄을 덧붙인 결과가 아래에서 올라온다
  on('ui.render', ($, e) => {
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {{ type: 'engine', ref: 0 }}
        <Text>prompt ~10 tokens</Text>
      </Box>
    )
  })

  await submit($, '테스트 돌려 줘')
  await wait(50)

  const ui = await $.ui.mount({ ...row('테스트 돌려 줘'), surface: 'terminal' })
  const text = await shown(ui)
  expect(text.indexOf('Run the tests.')).toBeGreaterThan(-1)
  expect(text.indexOf('Run the tests.')).toBeLessThan(text.indexOf('prompt ~10 tokens'))
  // 자리를 옮겨도 숨기기 단추는 그대로 동작한다
  await ui.press({ key: 'toggle' })
  expect((await ui.find({ key: 'toggle' }))?.text).toBe('[Show]')
  expect((await shown(ui)).includes('Run the tests.')).toBe(false)
  expect(await ui.find({ type: 'Text', text: 'prompt ~10 tokens' })).toBeDefined()
  await ui.unmount()
})

// 엔진처럼 프롬프트를 받으면 줄을 쌓고 턴을 시작한다: 명령이면 명령 줄을 쌓고 /goal 만 턴을 시작한다
const session = (on: On, $: Engine, surfaces: ('terminal' | 'desktop')[] = ['terminal']) => {
  const seen = {
    prompts: [] as string[],
    args: [] as string[],
    started: [] as Promise<unknown>[],
    surfaces
  }
  let count = 0
  on('session.surfaces', () => ({ value: seen.surfaces }))
  on('session.attach', (_, e) => ({ clientId: e.clientId }))
  on('model.complete', (_, e) => {
    seen.prompts.push(e.prompt)

    return { value: { isAnswered: true, text: 'Translated.', usage: ZERO } }
  })
  on('command.run', (_, e) => {
    seen.args.push(e.args)

    return {}
  })
  // 엔진처럼 입력 줄을 쌓고 턴을 시작한다. 명령은 명령 줄과 출력 줄을 쌓고 /goal 만 턴을 시작하며
  // (2.1.312 처럼 턴의 글은 출력 줄), prompt.submit 은 턴의 위쪽 훅이 끝나기 전에 끝난다
  on('prompt.submit', async (_, e) => {
    count += 1
    const rows = e.command
      ? [
          `<command-name>/${e.command.name}</command-name>\n<command-args>${e.command.args}</command-args>`,
          `<local-command-stdout>Done: ${e.command.args}</local-command-stdout>`
        ]
      : [e.text]
    for (const [index, text] of rows.entries()) {
      await $.session.append({
        door: e.command ? 'command' : 'prompt',
        uuid: index ? `row-${count}-${index}` : `row-${count}`,
        origin: e.origin,
        message: { type: 'user', role: 'user', content: [{ type: 'text', text }] }
      })
    }
    if (!e.command || e.command.name === 'goal') {
      seen.started.push($.turn.start({ turnId: `turn-${count}`, text: rows.at(-1) ?? '' }))
    }

    return { text: e.text }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer, usage: e.usage }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  return seen
}

const respond = (
  $: Engine,
  uuid: string,
  content: (
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: object }
  )[]
) =>
  $.session.append({
    door: 'response',
    uuid,
    origin: { kind: 'model', model: 'claude-opus-5-5' },
    message: { type: 'assistant', role: 'assistant', content }
  })

const answer = (uuid: string, text: string) =>
  ({
    plugin: 'prompt-translator',
    component: 'AssistantMessage',
    requestId: uuid,
    props: { text, isFirstOfReply: true }
  }) as const

// 엔진처럼 command.run 을 지난 인자로 명령을 제출한다
const command = async ($: Engine, seen: { args: string[] }, name: string, typed: string) => {
  await $.command.run({
    command: name,
    args: typed,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 }
  })
  const args = seen.args.at(-1) ?? typed
  await $.prompt.submit({
    text: `/${name} ${args}`,
    command: { name, args },
    wait: false,
    origin: { kind: 'composer' }
  })
}

test('/goal 처럼 턴을 시작하는 명령은 인자를 번역해 그 턴의 첫 답변 위에 붙인다', async ($, on) => {
  const seen = session(on, $)

  await command($, seen, 'rename', '새 이름')
  await command($, seen, 'goal', '테스트가 모두 통과하면 끝')
  await Promise.all(seen.started)
  // 도구만 부른 줄을 지나 처음 글을 쓴 답변 위에 붙는다
  await respond($, 'reply-1', [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }])
  await respond($, 'reply-2', [{ type: 'text', text: '목표를 확인했습니다.' }])
  await respond($, 'reply-3', [{ type: 'text', text: '모두 통과했습니다.' }])
  await $.turn.complete({
    turnId: 'turn-2',
    answer: '모두 통과했습니다.',
    durationMs: 1000,
    isAborted: false,
    reason: 'answer'
  })

  // 턴을 시작하지 않는 명령(/rename)은 번역하지 않는다
  expect(seen.prompts).toEqual(['<message>\n테스트가 모두 통과하면 끝\n</message>'])
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...answer('reply-2', '목표를 확인했습니다.'), surface })
    const text = await shown(ui)
    expect(text.indexOf('Translated.')).toBeGreaterThan(-1)
    expect(text.indexOf('Translated.')).toBeLessThan(text.indexOf('engine'))
    expect((await ui.find({ key: 'toggle' }))?.text).toBe(HIDE[surface])
    await ui.unmount()

    const later = await $.ui.mount({ ...answer('reply-3', '모두 통과했습니다.'), surface })
    expect((await shown(later)).includes('Translated.')).toBe(false)
    await later.unmount()

    // 같은 글을 일반 프롬프트 줄로 보내도 명령의 번역을 가져다 쓰지 않는다
    const prompt = await $.ui.mount({ ...row('테스트가 모두 통과하면 끝'), surface })
    expect((await shown(prompt)).includes('Translated.')).toBe(false)
    await prompt.unmount()
  }
})

test('명령 인자의 키워드는 명령이 실행되기 전에 빼고, 길어도 번역한다', async ($, on) => {
  const seen = session(on, $)
  const long = '가'.repeat(301)

  await command($, seen, 'goal', `${long} ultratranslate`)
  await command($, seen, 'goal', '나'.repeat(301))
  await Promise.all(seen.started)

  expect(seen.args).toEqual([long, '나'.repeat(301)])
  expect(seen.prompts).toEqual([`<message>\n${long}\n</message>`])
})

test('화면이 붙기 전에 보낸 프롬프트는 화면이 붙을 때 번역하고, 앞에 붙은 안내 블록은 뺀다', async ($, on) => {
  const seen = session(on, $, [])
  const typed = '안녕, 좋은 아침이야!'

  await submit(
    $,
    `<system-reminder>\nThe user started this session without a folder.\n</system-reminder>\n\n\n${typed}`,
    'sdk'
  )
  expect(seen.prompts).toEqual([])

  seen.surfaces.push('desktop')
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  await wait(50)
  expect(seen.prompts).toEqual([`<message>\n${typed}\n</message>`])

  // 화면이 그리는 글이 달라도 줄 id 로 짝을 맞춘다
  for (const text of [typed, `${typed}\n`]) {
    const ui = await $.ui.mount({
      plugin: 'prompt-translator',
      component: 'UserMessage',
      requestId: 'row-1',
      surface: 'desktop',
      props: { text, origin: { kind: 'sdk' }, isExpanded: false }
    })
    expect((await ui.find({ key: 'toggle' }))?.text).toBe('Hide')
    await ui.unmount()
  }

  // 다시 붙어도 번역을 또 하지 않는다
  await $.session.attach({ surface: 'desktop', clientId: 'second' })
  await wait(50)
  expect(seen.prompts).toHaveLength(1)
})
