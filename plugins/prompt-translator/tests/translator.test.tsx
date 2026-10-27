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

// 엔진 자리에 서서 번역 요청과 넘어간 프롬프트를 기록한다
const engine = (on: On, reply = 'Translated.') => {
  const seen = { prompts: [] as string[], passed: [] as string[] }
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('model.complete', (_, e) => {
    seen.prompts.push(e.prompt)

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
    expect((await ui.find({ type: 'Text', text: 'Can you fix' }))?.text).toBe(
      'Can you fix this bug?'
    )
    await ui.unmount()

    const other = await $.ui.mount({ ...row('다른 프롬프트'), surface })
    expect(await other.find({ type: 'Text', text: 'Can you fix' })).toBeUndefined()
    expect(await other.find({ type: 'Button' })).toBeUndefined()
    await other.unmount()
  }
})

test('번역마다 아이콘으로 숨기고 다시 보인다', async ($, on) => {
  engine(on, 'Run the tests.')

  await submit($, '테스트 돌려 줘')
  await submit($, '빌드해 줘')

  for (const surface of SURFACES) {
    const first = await $.ui.mount({ ...row('테스트 돌려 줘'), surface })
    const second = await $.ui.mount({ ...row('빌드해 줘'), surface })
    // 한글 8자(테스트 돌려 줘), 영어 14자(Run the tests.)
    expect((await first.find({ key: 'toggle' }))?.text).toBe('[- 8(14)]')

    await first.press({ key: 'toggle' })
    expect((await first.find({ key: 'toggle' }))?.text).toBe('[+ 8(14)]')
    expect(await first.find({ type: 'Text', text: 'Run the tests.' })).toBeUndefined()
    // 다른 번역은 그대로 보인다
    expect(await second.find({ type: 'Text', text: 'Run the tests.' })).toBeDefined()

    await first.press({ key: 'toggle' })
    expect((await first.find({ key: 'toggle' }))?.text).toBe('[- 8(14)]')
    expect(await first.find({ type: 'Text', text: 'Run the tests.' })).toBeDefined()
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
  expect(await ui.find({ type: 'Text', text: 'Translated.' })).toBeDefined()
  await ui.unmount()
})

test('붙여넣은 글의 표식은 번역할 글과 글자 수에서 뺀다', async ($, on) => {
  const seen = engine(on)

  await submit(
    $,
    '<pasted_content id="ab12">\n첫 줄입니다.\n</pasted_content id="ab12">\n\n요약해 줘'
  )

  expect(seen.prompts).toEqual(['<message>\n첫 줄입니다.\n\n요약해 줘\n</message>'])
})

test('슬래시 명령, 영어, 작업 알림, 화면 없는 세션은 번역하지 않는다', async ($, on) => {
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
  expect(await ui.find({ type: 'Text', text: '번역하지 못했습니다 (API 오류 529)' })).toBeDefined()
  await ui.unmount()
})

test('모델이 따라 쓴 태그와 남는 빈 줄은 번역문에서 걷어 낸다', async ($, on) => {
  engine(on, '<message>\n\n\nLine one.\n\n\n\nLine two.\n</message>')

  await submit($, '두 줄 요약')

  const ui = await $.ui.mount({ ...row('두 줄 요약'), surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: 'Line one.' }))?.text).toBe('Line one.\n\nLine two.')
  await ui.unmount()
})

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
  expect(await ui.find({ type: 'Text', text: '번역 중...' })).toBeDefined()

  release()
  await submitting
  await wait(50)
  expect(await ui.find({ type: 'Text', text: 'Build it.' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '번역 중...' })).toBeUndefined()
  await ui.unmount()
})
