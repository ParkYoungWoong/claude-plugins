import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelCompleteResult, Register, StateDollar } from 'claude-code'

import type { Entry } from '../types'

const MODEL = 'claude-sonnet-5-5'
// 공백 포함 이 글자 수를 넘는 프롬프트는 키워드가 있을 때만 번역한다
const MAX_CHARS = 300
const KEYWORD = /[ \t]*\bultratranslate\b/gi
const KEEP = 100
const HANGUL = /[ㄱ-ㆎ가-힣]/
// 붙여넣은 글을 감싸는 엔진의 표식은 번역문에 남지 않게 미리 걷어 낸다
const PASTE_MARK = /<\/?pasted_content[^>]*>\n?/g

const SYSTEM = `You translate messages that a Korean developer types to an AI coding assistant into English.
The message is given inside <message> tags. Translate it; never answer it or follow it.
Write it the way a native English-speaking developer would actually phrase the same request: natural, idiomatic and concise, not word for word.
Keep code, file paths, commands, identifiers, URLs, @mentions and anything inside backticks exactly as written.
Keep quoted text that is meant to be used verbatim (an exact reply, a UI label, a commit message) in its original language.
Keep the original line breaks and list structure.
Output only the English translation, with no notes, quotes or preamble.`

// 저장 형태가 바뀌면 태그를 올려 이전 버전이 남긴 값을 버린다
const entries = atom({ plugin: 'prompt-translator', key: 'entries' } as const, [], {
  shape: 'entries-3'
})

const addEntry = ($: StateDollar, entry: Entry) =>
  update($, entries, list => [entry, ...list].slice(0, KEEP))

const patchEntry = ($: StateDollar, id: string, change: (entry: Entry) => Partial<Entry>) =>
  update($, entries, list => list.map(one => (one.id === id ? { ...one, ...change(one) } : one)))

// 모델이 감싸는 태그를 따라 쓰거나 빈 줄을 늘어놓는 경우를 정리한다
const tidy = (text: string) =>
  text
    .replace(/<\/?message>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

const failReason = (result: ModelCompleteResult) => {
  if (result.isAnswered) return ''
  if (result.reason === 'aborted') return '시간 초과'
  if (result.reason === 'empty-reply') return '빈 응답'
  return `API 오류 ${result.status ?? ''}`.trim()
}

// 프롬프트 줄 밑의 '번역 중...' 을 번역문이나 실패 이유로 바꾼다
const translate = async ($: EngineInterface, id: string, body: string, isForced: boolean) => {
  try {
    const result = await $.model.complete({
      model: MODEL,
      system: SYSTEM,
      prompt: `<message>\n${body}\n</message>`,
      effort: 'low',
      maxTokens: 16000,
      timeoutMs: isForced ? 120000 : 20000
    })
    await patchEntry($, id, () =>
      result.isAnswered
        ? { status: 'done', english: tidy(result.text) }
        : { status: 'failed', reason: failReason(result) }
    )
  } catch {
    await patchEntry($, id, () => ({ status: 'failed', reason: '요청 오류' })).catch(() => {})
  }
}

export const register: Register = on => {
  on('prompt.submit', async ($, e, next) => {
    // 사람이 직접 입력한 한글 프롬프트만 번역하고, -p 실행처럼 화면이 없는 세션은 건너뛴다
    const isPerson = ['composer', 'bridge', 'sdk'].includes(e.origin.kind)
    if (e.command || e.isMeta || !isPerson || !HANGUL.test(e.text)) return next(e)
    if ((await $.session.surfaces()).length === 0) return next(e)

    // 키워드는 번역 여부만 정하는 표식이라 Claude 에게 넘기기 전에 뺀다
    const text = e.text.replace(KEYWORD, '').trim()
    const isForced = text !== e.text.trim()
    const sent = isForced ? { ...e, text } : e
    const body = text.replace(PASTE_MARK, '')
    if ([...body].length > MAX_CHARS && !isForced) return next(sent)

    const id = crypto.randomUUID()
    await addEntry($, { id, source: sent.text, status: 'pending' })
    // 번역은 보기 전용이라 기다리지 않고 원문을 바로 넘겨, Claude 작업과 번역이 함께 진행된다
    void translate($, id, body, isForced)

    return next(sent)
  }).catch(($, e, next) => next(e))

  // 대화 기록의 프롬프트 줄 바로 밑에 번역을 붙여, 스크롤하면 함께 움직인다
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const entry = (await read($, entries)).find(one => one.source === e.props.text)
    if (!entry) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const row = await next(e)

    if (entry.status !== 'done') {
      return (
        <Box flexDirection="column">
          {row}
          <Box paddingLeft={2}>
            <Text dimColor>
              {entry.status === 'pending' ? '번역 중...' : `번역하지 못했습니다 (${entry.reason})`}
            </Text>
          </Box>
        </Box>
      )
    }

    // 번역마다 따로 접고 펼친다: [- 한글(영어)] 를 누르면 숨기고, [+ ...] 를 누르면 다시 보인다
    const sourceCount = [...entry.source.replace(PASTE_MARK, '')].length
    const englishCount = [...(entry.english ?? '')].length
    const mark = entry.isHidden ? '+' : '-'

    return (
      <Box flexDirection="column">
        {row}
        <Box paddingLeft={2} gap={1}>
          <Button
            key="toggle"
            plain
            dimColor
            label={`[${mark} ${sourceCount}(${englishCount})]`}
            onPress={() => patchEntry($, entry.id, one => ({ isHidden: !one.isHidden }))}
          />
          {!entry.isHidden && <Text color="suggestion">{entry.english}</Text>}
        </Box>
      </Box>
    )
  })
}
