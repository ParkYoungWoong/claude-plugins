# token-meter

대화 기록에 토큰 수를 보여 주는 Claude Code Mod입니다.  
각 프롬프트 밑에는 그 턴의 입력 토큰이, 턴의 마지막 답변 밑에는 출력 토큰이 보입니다.  
둘 다 Anthropic API 정가로 매긴 비용이 함께 보입니다.

[English](./README.md)

```plaintext
> 이 버그를 고쳐 줄래
  prompt ~12 / context 15 / total input 42,362 tokens (cache read 42,100 / 99.3%, cache write 247, 2 requests, cached 13:56:08)
  input cost $0.0105 (uncached $0.0001, cache read $0.0084, cache write 1h $0.0020)

  고쳤습니다.
  output 2,400 tokens / $0.0480 (turn $0.0585)
```

## 설치

```plaintext
/plugin install token-meter --marketplace ParkYoungWoong/claude-plugins
```

`Add marketplace?`에 `y`로 답하고 설치 범위를 고르면 바로 동작합니다.  
다른 설치 방법은 [저장소 README](../../README.ko.md#설치)를 참고하세요.

## 표시 항목

- `prompt ~N`: 입력한 글을 글자 수로 어림한 토큰입니다.  
  한글은 1글자에 약 1.35토큰, 그 밖의 글자는 3.2자에 1토큰으로 셉니다(Opus 5.5 실측).
- `context N`: 이 입력이 컨텍스트에 실제로 더한 토큰입니다.  
  턴의 첫 요청 입력에서 직전 요청의 입력과 출력을 뺀 값입니다.  
  첫 턴과 압축, `/clear` 직후에는 생략합니다.
- `total input N`: 이 턴에 서버로 보낸 입력 토큰의 합입니다.  
  요청마다 시스템 프롬프트와 지난 대화 전체를 다시 보냅니다.  
  그래서 요청별 전체 입력(input + cache read + cache write)을 더합니다.
- `cache read N / P%`: `total input` 가운데 프롬프트 캐시에서 읽은 토큰과 그 비율입니다.  
  요청별 cache read 를 더한 값이고, 캐시에 새로 쓴 양(cache write)은 넣지 않습니다.  
  비율은 소수 첫째 자리에서 버려서, 캐시를 다 읽지 않았는데 100.0%로 보이는 일이 없습니다.
- `cache write N`: `total input` 가운데 프롬프트 캐시에 새로 쓴 토큰입니다.  
  새로 쓴 양이 없으면 생략합니다.
- `n requests`: 이 턴의 요청 횟수입니다.  
  도구를 쓸 때마다 늘어납니다.
- `cached HH:MM:SS`: 이 입력을 실은 첫 요청에 서버가 응답을 시작한 시각(이 컴퓨터의 시간대)입니다.  
  그때 프롬프트 캐시에 쓰여 있습니다.
- `output N`: 그 턴의 모든 요청이 낸 출력 토큰의 합(생각과 도구 호출 포함)입니다.

## 비용

- `input cost $N`: 이 턴의 입력 비용입니다.  
  괄호 안은 캐시를 거치지 않은 입력(uncached), 캐시 읽기(cache read), 캐시 쓰기(cache write)로 나눈 값입니다.
- `output N tokens / $N`: 출력 비용이고, 괄호 안의 `turn $N`은 입력과 출력을 더한 이 턴의 비용입니다.

요청마다 그 요청에 답한 모델의 정가로 따로 매깁니다.  
그래서 턴 중간에 모델이 바뀌어도(폴백, `/model`) 맞게 계산됩니다.  
금액은 소수 넷째 자리까지 보이고, 그보다 작은 금액은 `<$0.0001`로 보입니다.  
금액마다 따로 반올림하므로 괄호 안 값을 더하면 합계와 $0.0001쯤 다를 수 있습니다.

| 모델 | 입력 | 캐시 읽기 | 출력 |
| --- | --- | --- | --- |
| Fable 5.2, Mythos 5.2 | $8 | $0.20 | $40 |
| Fable 5.1, Mythos 5.1 | $10 | $0.25 | $50 |
| Fable 5, Mythos 5 | $10 | $1 | $50 |
| Opus 5.5 | $4 | $0.20 | $20 |
| Opus 5, Opus 4.8, 4.7, 4.6 | $5 | $0.50 | $25 |
| Sonnet 5.5 | $2 | $0.10 | $10 |
| Sonnet 5 | $2 | $0.20 | $10 |
| Sonnet 4.6 | $3 | $0.30 | $15 |
| Haiku 5.5 (프롬프트 10만 토큰 이하) | $0.10 | $0.01 | $0.50 |
| Haiku 5.5 (프롬프트 10만 토큰 초과) | $0.50 | $0.05 | $2.50 |
| Haiku 4.5 | $1 | $0.10 | $5 |

100만 토큰당 가격이며, 2026-11-03 기준 Anthropic API 정가입니다.  
Haiku 5.5는 요청마다 그 요청의 전체 입력으로 정가를 고릅니다.

캐시 쓰기는 캐시에 5분 동안 두면 입력 단가의 1.25배, 1시간 동안 두면 2배입니다.  
어느 쪽인지는 `cacheTtl` 설정(`auto`, `5m`, `1h`)으로 고르고, `auto`는 Claude Code가 정하는 방식을 따릅니다.  
`/plugin`으로 설치할 때 묻고, 나중에는 `/config`나 데스크톱 앱의 플러그인 `설정` 탭에서 바꿀 수 있습니다.

1. `FORCE_PROMPT_CACHING_5M`이 있으면 5분
2. `CLAUDE_CODE_PROMPT_CACHE_TTL`이나 `promptCacheTtl` 설정이 있으면 그 값
3. `ENABLE_PROMPT_CACHING_1H`가 있으면 1시간
4. 그 밖에는 Claude 구독(세션이 사용량 한도 창을 알려 옴)이면 1시간, API 키면 5분

알아 둘 점:

- 정가로 어림한 값입니다.  
  Claude 구독은 토큰 단위로 청구되지 않고, Bedrock, Vertex AI 같은 공급자는 가격이 따로 있습니다.
- 빠른 모드(fast mode)는 더 비싸지만(Opus 5.5는 2배) 요청 결과에 빠른 모드 여부가 없어 기본 정가로 매깁니다.
- 구독에서 추가 사용량(extra usage)으로 넘어가면 Claude Code는 캐시를 5분 동안 두는데, `auto`는 그래도 1시간으로 매깁니다.  
  이 차이가 중요하면 `cacheTtl`을 `5m`으로 바꾸세요.
- 서브에이전트의 요청과 Claude Code가 뒤에서 보내는 작은 요청은 세지 않으므로, 합계가 `/cost`보다 작을 수 있습니다.
- 정가표에 없는 모델을 쓴 턴은 `input cost unknown`으로 보이고 출력 비용은 보이지 않습니다.

## 숫자가 채워지는 때

응답이 오기 전에는 `prompt ~N tokens`만 보입니다.  
응답이 오면 나머지가 채워집니다.  
서브에이전트의 요청은 세지 않고, 알림 줄에는 표시하지 않습니다.

## 슬래시 명령과 작업 중에 보낸 프롬프트

- `/goal`이나 스킬처럼 턴을 시작하는 명령은 명령 줄에 Mod가 그릴 자리가 없습니다.  
  그래서 입력 토큰은 그 턴의 첫 답변 바로 위에 보입니다.  
  `prompt ~N`은 입력한 명령 줄을 어림한 값이고, `context N`에는 명령이 덧붙인 지시문도 들어갑니다.
- `/rename`처럼 턴을 시작하지 않는 명령에는 아무것도 표시하지 않습니다.
- Claude가 작업하는 중에 보낸 프롬프트는 진행 중인 턴에 합쳐지므로 `prompt ~N tokens`만 보입니다.  
  그 입력의 토큰은 진행 중이던 턴의 숫자에 들어갑니다.

## 클로드 데스크톱 앱

클로드 데스크톱 앱의 Claude Code에서도 같은 자리에 보입니다.  
모든 줄이 입력 말풍선처럼 오른쪽 끝에 붙습니다.

## 끄기

`/plugin`에서 token-meter를 끄거나, 셸에서 다음 명령을 실행합니다.

```bash
claude plugin disable token-meter@heropy-plugins
```

## 개발

```bash
claude plugin validate plugins/token-meter
claude plugin test plugins/token-meter
```
