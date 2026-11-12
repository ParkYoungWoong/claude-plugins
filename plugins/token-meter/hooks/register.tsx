import { atom, read, update } from 'claude-code'
import type {
  ElementTable,
  EngineInterface,
  ModelUsage,
  Register,
  RenderElement,
  RenderNode,
  RenderSurface,
  StateDollar
} from 'claude-code'

import type { Cost, Meter, Turn } from '../types'

const KEEP = 200
const HANGUL = /[ㄱ-ㆎ가-힣]/g
const PEOPLE = ['composer', 'bridge', 'sdk']
// 데스크톱 앱이 프로젝트 폴더 없이 시작한 세션의 첫 메시지 앞에 붙이는 안내는 화면에 없는 글이다
const REMINDER = /^(?:<system-reminder>[\s\S]*?<\/system-reminder>\n?)+/
// 슬래시 명령 줄: 입력한 그대로(/goal ...)나 엔진의 기록 형태(<command-name>...)로 온다
const COMMAND_ROW = /^(?:\/|<command-)/
const COMMAND_NAME = /<command-name>\/?([^<]*)<\/command-name>/
const COMMAND_ARGS = /<command-args>([\s\S]*?)<\/command-args>/
// 데스크톱 앱이 답변 블록을 묻는 id 의 끝(API 메시지 id 뒤의 블록 번호)
const BLOCK_ID = /-t\d+$/
// 턴마다 적어 두는 답변 줄의 수: 그 뒤의 답변은 마지막 답변만 적는다
const REPLIES = 20

// 모델별 정가: 100만 토큰당 달러의 1000배(4달러는 4000)로 입력, 출력, 캐시 읽기를 적는다
// 2026-11-03 Anthropic API 정가. 캐시 쓰기는 입력 단가의 1.25배(5분 보존)나 2배(1시간 보존)다
type Price = { input: number; output: number; cacheRead: number }
const price = (input: number, output: number, cacheRead: number): Price => ({
  input,
  output,
  cacheRead
})
const PRICES: Record<string, Price> = {
  'claude-fable-5-2': price(8000, 40000, 200),
  'claude-mythos-5-2': price(8000, 40000, 200),
  'claude-fable-5-1': price(10000, 50000, 250),
  'claude-mythos-5-1': price(10000, 50000, 250),
  'claude-fable-5': price(10000, 50000, 1000),
  'claude-mythos-5': price(10000, 50000, 1000),
  'claude-opus-5-5': price(4000, 20000, 200),
  'claude-opus-5': price(5000, 25000, 500),
  'claude-opus-4-8': price(5000, 25000, 500),
  'claude-opus-4-7': price(5000, 25000, 500),
  'claude-opus-4-6': price(5000, 25000, 500),
  'claude-sonnet-5-5': price(2000, 10000, 100),
  'claude-sonnet-5': price(2000, 10000, 200),
  'claude-sonnet-4-6': price(3000, 15000, 300),
  'claude-haiku-5-5': price(100, 500, 10),
  'claude-haiku-4-5': price(1000, 5000, 100)
}
// 프롬프트(그 요청의 전체 입력)가 over 토큰을 넘는 요청에는 다른 정가를 매기는 모델
const LONG_PRICES: Record<string, { over: number; price: Price }> = {
  'claude-haiku-5-5': { over: 100_000, price: price(500, 2500, 50) }
}

// API 가 알려 준 모델 id 를 정가표의 이름으로: Bedrock 접두사(us.anthropic.)와 버전 꼬리(-v1:0),
// 날짜 꼬리(-20251001, @20251001), 컨텍스트 표시([1m])를 뗀다. 앞부분만 같은 이름(opus-5 와 opus-5-5)은 섞지 않는다
const modelKey = (model: string) =>
  model
    .toLowerCase()
    .replace(/\[[^\]]*\]$/, '')
    .replace(/^(?:[a-z]+\.)?anthropic\./, '')
    .replace(/-v\d+(?::\d+)?$/, '')
    .replace(/[-@]\d{8}$/, '')

const priceOf = (model: string, prompt: number) => {
  const key = modelKey(model)
  const long = LONG_PRICES[key]

  return long && prompt > long.over ? long.price : PRICES[key]
}

// 토큰 수 x 단가 = 10억분의 1달러 단위의 정수
const addCost = (cost: Cost | undefined, usage: ModelUsage, rate: Price): Cost => ({
  input: (cost?.input ?? 0) + usage.input_tokens * rate.input,
  cacheRead: (cost?.cacheRead ?? 0) + usage.cache_read_input_tokens * rate.cacheRead,
  cacheWriteBase: (cost?.cacheWriteBase ?? 0) + usage.cache_creation_input_tokens * rate.input,
  output: (cost?.output ?? 0) + usage.output_tokens * rate.output
})

type Ttl = '5m' | '1h'
const TTLS = ['5m', '1h']
const isTtl = (value: unknown): value is Ttl => TTLS.includes(String(value))

// 캐시 보존 시간: 설정(userConfig.cacheTtl)이 auto 가 아니면 그 값을 쓰고, auto 면 Claude Code 처럼 정한다
// 환경 변수와 promptCacheTtl 설정이 먼저고, 그다음 구독(사용량 한도 창이 있는 로그인)이면 1시간, 아니면 5분
// 구독 여부는 meter 에 두어, 알게 되면 이미 그린 줄도 다시 그려진다
let ttlSetting: Ttl | undefined
// 아직 읽지 않았으면 undefined, 읽었는데 정한 곳이 없으면 null
let ttlEngine: Ttl | null | undefined

// 읽지 못하면(환경 변수나 설정을 막은 곳) 정하지 않은 것으로 보고 구독 여부로 정한다
const readEngineTtl = async ($: EngineInterface): Promise<Ttl | null> => {
  try {
    if (await $.env.get('FORCE_PROMPT_CACHING_5M')) return '5m'
    const env = await $.env.get('CLAUDE_CODE_PROMPT_CACHE_TTL')
    if (isTtl(env)) return env
    const setting = await $.settings.read({ key: 'promptCacheTtl' }).catch(() => undefined)
    if (isTtl(setting)) return setting
    if (await $.env.get('ENABLE_PROMPT_CACHING_1H')) return '1h'
  } catch {
    return null
  }

  return null
}

const ttlOf = (state: Meter): Ttl => ttlSetting ?? ttlEngine ?? (state.isSubscription ? '1h' : '5m')

const writeCostOf = (cost: Cost, ttl: Ttl) => cost.cacheWriteBase * (ttl === '1h' ? 2 : 1.25)

const inputCostOf = (cost: Cost, ttl: Ttl) => cost.input + cost.cacheRead + writeCostOf(cost, ttl)

// 10억분의 1달러 단위를 소수 넷째 자리 달러로: 0 이 아닌데 반올림하면 0 이 되는 값은 <$0.0001 로 쓴다
const money = (units: number) => {
  if (units > 0 && units < 50_000) return '<$0.0001'

  return `$${(Math.round(units / 100_000) / 10_000).toFixed(4)}`
}

// 저장 형태가 바뀌면 태그를 올려 이전 버전이 남긴 값을 버린다
const meter = atom(
  { plugin: 'token-meter', key: 'meter' } as const,
  { last: null, turns: [] },
  { shape: 'meter-2' }
)

type Input = { uuid: string; door: string; text: string }

// 지난 턴이 시작된 뒤 쌓인 입력 줄(프롬프트 줄, 명령 줄): 다음 턴이 시작되면 그 턴의 글과 맞춰 본다
let inputs: Input[] = []
// 지금 도는 메인 루프의 턴
let running: string | undefined
// 화면(surface)마다 명령 턴의 답변 가운데 그려진 것의 가장 앞 차례: 입력 토큰은 그 답변 위에 둔다
const shown = new Map<string, number>()

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

// 캐시 적중률: 반올림으로 100.0% 가 되지 않게 소수 첫째 자리에서 버린다
const percent = (part: number, whole: number) =>
  `${whole ? (Math.floor((part / whole) * 1000) / 10).toFixed(1) : '0.0'}%`

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
  // 서버로 보낸 양 옆 괄호에 캐시에서 읽은 양과 비율, 요청 횟수, 서버가 캐시에 쓴 시각을 함께 둔다
  const notes: string[] = []
  if (turn?.sent && turn.cacheRead !== undefined) {
    notes.push(`cache read ${comma(turn.cacheRead)} / ${percent(turn.cacheRead, turn.sent)}`)
  }
  if (turn?.cacheWrite) notes.push(`cache write ${comma(turn.cacheWrite)}`)
  const count = turn?.requests ?? 0
  if (count) notes.push(`${count} ${count === 1 ? 'request' : 'requests'}`)
  if (turn?.cachedAt) notes.push(`cached ${clock(turn.cachedAt)}`)

  return `${parts.join(' / ')} tokens${notes.length ? ` (${notes.join(', ')})` : ''}`
}

// 입력 비용: 캐시를 거치지 않은 입력, 캐시 읽기, 캐시 쓰기(보존 시간과 함께)로 나눈다
const inputCostLabel = (turn: Turn | undefined, ttl: Ttl) => {
  if (turn?.unpriced) return `input cost unknown (no price for ${turn.unpriced})`
  const cost = turn?.cost
  if (!cost) return undefined
  const parts = [`uncached ${money(cost.input)}`, `cache read ${money(cost.cacheRead)}`]
  if (cost.cacheWriteBase) parts.push(`cache write ${ttl} ${money(writeCostOf(cost, ttl))}`)

  return `input cost ${money(inputCostOf(cost, ttl))} (${parts.join(', ')})`
}

// 출력 토큰과 그 비용, 괄호에는 입력과 출력을 더한 이 턴의 비용
const outputLabel = (turn: Turn, ttl: Ttl) => {
  const tokens = `output ${comma(turn.output)} tokens`
  if (turn.unpriced || !turn.cost) return tokens

  return `${tokens} / ${money(turn.cost.output)} (turn ${money(inputCostOf(turn.cost, ttl) + turn.cost.output)})`
}

// 데스크톱 앱 카드 머리줄의 아이콘(Material Icons 의 arrow_upward, arrow_downward, Apache 2.0):
// 서버로 보낸 입력은 위로, 받은 출력은 아래로. 어두운 테마와 밝은 테마 모두에서 보이는 회색
const SENT_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#8E8E93"><path d="M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z"/></svg>'
const RECEIVED_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#8E8E93"><path d="M20 12l-1.41-1.41L13 16.17V4h-2v12.17l-5.58-5.59L4 12l8 8 8-8z"/></svg>'

// 카드 표의 한 줄: 이름, 토큰 수, 비용(없으면 빈칸)
type Cell = { label: string; tokens?: string; cost?: string }

type Card = { icon: string; title: string; total?: string; cells: Cell[]; note?: string }

// 데스크톱 앱의 토큰 카드: prompt-translator 의 번역 카드처럼 입력 말풍선과 같은 반투명 회색 말풍선으로 오른쪽에 붙인다
// 머리줄 왼쪽에 아이콘과 제목, 오른쪽 끝에 금액을 두고, 밑에는 이름, 토큰 수, 비용을 세 열로 맞춘 표를 둔다
// 열마다 세로 상자로 쌓아 숫자가 줄마다 오른쪽 끝을 맞추고, 빈칸은 공백 한 칸으로 줄 높이를 지킨다
// 접기: 머리줄 오른쪽 꺾쇠 단추로 카드마다 표와 안내를 숨기고 머리줄(제목과 금액)만 남긴다.
// 아직 턴이 없는 입력 카드처럼 접을 곳이 없는 카드는 단추 없이 그린다
type Fold = { isFolded: boolean; onToggle: () => unknown } | undefined

// 단추 안에는 글자만 넣을 수 있어 Svg 대신 글자를 쓴다: 펼친 카드는 -(접기), 접힌 카드는 +(펼치기)
// 두 글자가 같은 높이에 놓여 바꿀 때 튀지 않는다. 데스크톱 앱은 label 이 있으면 안의 글자 대신 그리므로 주지 않는다
const FOLD_ICON = '-'
const UNFOLD_ICON = '+'

const desktopCardOf = (
  { Box, Button, Svg, Text }: ElementTable<'desktop'>,
  card: Card,
  fold: Fold
) => {
  const isFolded = fold?.isFolded === true
  const column = (values: string[], isNumber: boolean) => (
    <Box flexDirection="column" alignItems={isNumber ? 'flex-end' : 'flex-start'}>
      {values.map(value => (
        <Text size="caption" dimColor={!isNumber} tabular={isNumber}>
          {value || ' '}
        </Text>
      ))}
    </Box>
  )
  const hasCost = card.cells.some(cell => cell.cost)

  // 위에 붙는 번역 카드나 답변과 맞닿지 않게 카드 위에 여백을 둔다
  return (
    <Box flexDirection="row" justifyContent="flex-end" marginTop="sm">
      <Box width="20%" flexShrink={0} />
      <Box
        flexDirection="column"
        flexShrink={1}
        gap="xs"
        paddingX="sm"
        paddingY="xs"
        borderStyle="round"
        borderColor="rgba(128, 128, 128, 0)"
        backgroundColor="rgba(128, 128, 128, 0.1)"
      >
        <Box flexDirection="row" alignItems="center" justifyContent="space-between" gap="md">
          <Box flexDirection="row" alignItems="center" gap="xs">
            <Svg source={card.icon} alt={card.title} width={14} height={14} />
            <Text size="caption" dimColor>
              {card.title}
            </Text>
          </Box>
          <Box flexDirection="row" alignItems="center" gap="sm">
            {card.total && (
              <Text size="caption" weight="semibold" tabular>
                {card.total}
              </Text>
            )}
            {fold && (
              // 누를 곳이 보이도록 단추를 옅은 회색 칸에 넣는다. 데스크톱 앱은 단추 안 글자의 배경색을 그리지 않는다.
              // 테두리가 있는 칸은 데스크톱 앱이 안쪽 여백을 더해 머리줄보다 커지므로, 테두리 없이 여백을 0 으로 둔다.
              // 고정폭 글꼴과 앞뒤 한 칸으로 -와 + 가 바뀌어도 칸 크기가 같다
              <Box paddingX={0} paddingY={0} backgroundColor="rgba(128, 128, 128, 0.2)">
                <Button key="fold" plain onPress={fold.onToggle}>
                  <Text size="caption" mono color="permissionShimmer">
                    {` ${isFolded ? UNFOLD_ICON : FOLD_ICON} `}
                  </Text>
                </Button>
              </Box>
            )}
          </Box>
        </Box>
        {!isFolded && card.cells.length > 0 && (
          <Box flexDirection="row" gap="md">
            {column(
              card.cells.map(cell => cell.label),
              false
            )}
            {column(
              card.cells.map(cell => cell.tokens ?? ''),
              true
            )}
            {hasCost &&
              column(
                card.cells.map(cell => cell.cost ?? ''),
                true
              )}
          </Box>
        )}
        {!isFolded && card.note && (
          <Text size="caption" dimColor>
            {card.note}
          </Text>
        )}
      </Box>
    </Box>
  )
}

// 입력 카드: 응답 전에는 어림한 프롬프트 토큰만, 응답이 오면 보낸 양을 캐시 읽기와 쓰기로 나누고 각 비용을 붙인다
const inputCardOf = (text: string, turn: Turn | undefined, ttl: Ttl): Card => {
  const cells: Cell[] = [{ label: 'Prompt', tokens: `~${comma(estimate(text))}` }]
  if (turn?.added) cells.push({ label: 'Context', tokens: comma(turn.added) })
  const sent = turn?.sent
  if (!turn || !sent) return { icon: SENT_ICON, title: 'Input', cells }

  const read = turn.cacheRead ?? 0
  const written = turn.cacheWrite ?? 0
  const cost = turn.unpriced ? undefined : turn.cost
  cells.push(
    { label: 'Total input', tokens: comma(sent) },
    { label: 'Uncached', tokens: comma(sent - read - written), cost: cost && money(cost.input) },
    {
      label: 'Cache read',
      tokens: `${comma(read)} (${percent(read, sent)})`,
      cost: cost && money(cost.cacheRead)
    }
  )
  if (written) {
    cells.push({
      label: `Cache write ${ttl}`,
      tokens: comma(written),
      cost: cost && money(writeCostOf(cost, ttl))
    })
  }
  const count = turn.requests ?? 0
  if (count) cells.push({ label: count === 1 ? 'Request' : 'Requests', tokens: String(count) })
  if (turn.cachedAt) cells.push({ label: 'Cached at', tokens: clock(turn.cachedAt) })

  return {
    icon: SENT_ICON,
    title: 'Input',
    total: cost && money(inputCostOf(cost, ttl)),
    cells,
    ...(turn.unpriced && { note: `No price for ${turn.unpriced}` })
  }
}

// 출력 카드: 출력 토큰과 비용, 입력과 출력을 더한 이 턴의 비용
const outputCardOf = (turn: Turn, ttl: Ttl): Card => {
  const cost = turn.unpriced ? undefined : turn.cost
  const cells: Cell[] = [
    { label: 'Output', tokens: comma(turn.output), cost: cost && money(cost.output) }
  ]
  if (cost) cells.push({ label: 'Turn total', cost: money(inputCostOf(cost, ttl) + cost.output) })

  return {
    icon: RECEIVED_ICON,
    title: 'Output',
    total: cost && money(cost.output),
    cells,
    ...(turn.unpriced && { note: `No price for ${turn.unpriced}` })
  }
}

// 입력 토큰: 데스크톱 앱은 카드, 그 밖(터미널 등)은 토큰 한 줄과 비용 한 줄
const promptRows = (
  ui: ElementTable,
  surface: RenderSurface,
  text: string,
  turn: Turn | undefined,
  ttl: Ttl,
  fold: Fold
) => {
  if (surface === 'desktop') {
    return desktopCardOf(ui as ElementTable<'desktop'>, inputCardOf(text, turn, ttl), fold)
  }
  const cost = inputCostLabel(turn, ttl)

  return [promptLabel(text, turn), ...(cost ? [cost] : [])].map(line => lineOf(ui, line))
}

// 출력 토큰: 데스크톱 앱은 카드, 그 밖은 한 줄
const outputRow = (
  ui: ElementTable,
  surface: RenderSurface,
  turn: Turn,
  ttl: Ttl,
  fold: Fold
) =>
  surface === 'desktop'
    ? desktopCardOf(ui as ElementTable<'desktop'>, outputCardOf(turn, ttl), fold)
    : lineOf(ui, outputLabel(turn, ttl))

// 엔진이 그린 답변(engine 노드) 바로 위에 줄을 끼워, 다른 Mod 가 맨 위에 붙인 줄(번역)보다 아래에 온다
// 터미널 등의 토큰 수 한 줄: 두 칸 들여 쓴다
const lineOf = ({ Box, Text }: ElementTable, text: string) => (
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

// 이 답변이 명령 턴의 몇 번째 답변인지 찾고, 그 화면에서 그려진 가장 앞의 답변이면 그 턴을 돌려준다
const askedAbove = (
  turns: Turn[],
  surface: RenderSurface,
  isReply: (id?: string, replyText?: string) => boolean
) => {
  for (const turn of turns) {
    if (!turn.isCommand) continue
    const replies = turn.replies ?? []
    let order = replies.findIndex(one => isReply(one.id, one.text))
    if (order < 0 && isReply(turn.lastReplyId, turn.lastReplyText)) order = replies.length
    if (order < 0) continue

    const key = `${surface}:${turn.id}`
    const first = Math.min(shown.get(key) ?? order, order)
    shown.set(key, first)

    return order === first ? turn : undefined
  }

  return undefined
}

// 데스크톱 카드 하나(턴 id 와 input 또는 output)의 접힌 상태와 그것을 바꾸는 단추 동작
const FOLDED = KEEP * 2
const foldOf = (
  $: StateDollar,
  state: Meter,
  turn: Turn | undefined,
  side: 'input' | 'output'
): Fold => {
  if (!turn) return undefined
  const key = `${turn.id}:${side}`

  return {
    isFolded: state.folded?.includes(key) === true,
    onToggle: () =>
      change($, one => {
        const folded = one.folded ?? []

        return {
          ...one,
          folded: folded.includes(key)
            ? folded.filter(other => other !== key)
            : [key, ...folded].slice(0, FOLDED)
        }
      })
  }
}

export const register: Register = (on, options) => {
  ttlSetting = isTtl(options.cacheTtl) ? options.cacheTtl : undefined
  ttlEngine = undefined

  // 구독 로그인은 응답마다 사용량 한도 창(5시간, 7일)을 알려 온다
  on('session.measure', async ($, e, next) => {
    const isSubscription = e.rateLimits.some(
      limit => limit.kind === 'five_hour' || limit.kind === 'seven_day'
    )
    if (isSubscription && !(await read($, meter)).isSubscription) {
      await change($, state => ({ ...state, isSubscription: true }))
    }

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const rows = e.agentId === undefined ? inputs : []
    if (e.agentId === undefined) inputs = []
    if (ttlEngine === undefined) ttlEngine = await readEngineTtl($)
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
            replies:
              (turn.replies?.length ?? 0) < REPLIES
                ? [...(turn.replies ?? []), { id: e.uuid, text }]
                : turn.replies,
            lastReplyId: e.uuid,
            lastReplyText: text
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
    // 요청마다 그 요청의 모델과 프롬프트 길이로 정가를 고른다(턴 중간에 모델이 바뀌어도 맞는다)
    const rate = priceOf(usage.model, input)
    await change($, state => {
      // 턴의 첫 요청 입력에서 직전 요청의 입력과 출력을 빼면 이번 입력이 더한 양이 남는다
      const added = e.index === 0 && state.last ? input - state.last.input - state.last.output : 0
      // 요청마다 시스템 프롬프트와 지난 대화 전체를 다시 보내므로 요청별 전체 입력을 더한다
      const turns = patchTurn(state, e.turnId, turn => ({
        ...turn,
        sent: (turn.sent ?? 0) + input,
        cacheRead: (turn.cacheRead ?? 0) + usage.cache_read_input_tokens,
        cacheWrite: (turn.cacheWrite ?? 0) + usage.cache_creation_input_tokens,
        cost: rate ? addCost(turn.cost, usage, rate) : turn.cost,
        ...(!rate && !turn.unpriced && { unpriced: usage.model }),
        requests: (turn.requests ?? 0) + 1,
        cachedAt: turn.cachedAt ?? cachedAt,
        output: turn.output + usage.output_tokens,
        ...(added > 0 && { added })
      }))

      return { ...state, last: { input, output: usage.output_tokens }, turns }
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
    const state = await read($, meter)
    const { turns } = state
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
        {promptRows(ui, e.surface, text, turn, ttlOf(state), foldOf($, state, turn, 'input'))}
      </Box>
    )
  })

  // 명령이 시작한 턴의 첫 답변 위에는 입력 토큰을, 턴의 마지막 답변 밑에는 출력 토큰을 붙인다
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const text = e.props.text.trim()
    if (!text) return next(e)

    const state = await read($, meter)
    const { turns } = state
    const ttl = ttlOf(state)
    // 데스크톱 앱은 답변을 기록 줄 id 가 아니라 API 메시지 id 와 블록 번호(msg_...-t0)로, 그 블록의 글과 함께
    // 묻는다. 이 id 는 플러그인이 알 수 없어서, 그때는 줄의 글이 블록의 글과 같은지로 짝을 맞춘다
    const isBlock = BLOCK_ID.test(e.requestId)
    const isReply = (id?: string, replyText?: string) =>
      id === e.requestId || (isBlock && replyText?.trim() === text)
    // 명령 줄(/goal ...)과 그 출력 줄은 Mod 가 그릴 수 있는 자리가 아니어서 그 턴의 답변 위에 둔다.
    // focus 보기는 도구 호출 사이의 답변을 그리지 않으므로, 첫 답변이 아니라 그려진 답변 가운데 가장 앞의 것에 둔다
    const asked = askedAbove(turns, e.surface, isReply)
    // 그 턴의 모든 요청이 낸 출력 토큰(생각과 도구 호출 포함)
    const isDone = (turn: Turn) => turn.answer !== undefined && !e.props.isSummary
    const ended =
      turns.find(one => isDone(one) && isReply(one.lastReplyId, one.lastReplyText)) ??
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
            {promptRows(ui, e.surface, asked.prompt, asked, ttl, foldOf($, state, asked, 'input'))}
            {reply}
          </Box>
        ))
      : row
    if (!ended) return tree

    return (
      <Box flexDirection="column">
        {tree}
        {outputRow(ui, e.surface, ended, ttl, foldOf($, state, ended, 'output'))}
      </Box>
    )
  })
}
