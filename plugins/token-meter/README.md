# token-meter

대화 기록의 각 프롬프트 밑에 그 턴의 입력 토큰을, 턴의 마지막 답변 밑에 출력 토큰을 보여 주는 Claude Code Mod입니다.

```plaintext
> 이 버그를 고쳐 줄래
  prompt ~12 / context 15 / total input 42,362 tokens (2 requests, cached 13:56:08)

  고쳤습니다.
  output 2,400 tokens
```

## 설치

```plaintext
/plugin install token-meter --marketplace ParkYoungWoong/claude-plugins
```

`Add marketplace?`에 `y`로 답하고 설치 범위를 고르면 바로 동작합니다. 다른 설치 방법은 [저장소 README](../../README.md#설치)를 참고하세요.

## 표시 항목

| 항목              | 뜻                                                                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prompt ~N`       | 입력한 글을 글자 수로 어림한 토큰(한글 1글자 약 1.35토큰, 그 밖의 글자는 3.2자에 1토큰, Opus 5.5 실측)                                                      |
| `context N`       | 이 입력이 컨텍스트에 실제로 더한 토큰. 턴의 첫 요청 입력에서 직전 요청의 입력과 출력을 뺀 값으로, 첫 턴과 압축, `/clear` 직후에는 생략                      |
| `total input N`   | 이 턴에 서버로 보낸 입력 토큰의 합. 요청마다 시스템 프롬프트와 지난 대화 전체를 다시 보내므로, 요청별 전체 입력(input + cache read + cache write)을 더한 값 |
| `n requests`      | 이 턴의 요청 횟수. 도구를 쓸 때마다 늘어납니다.                                                                                                             |
| `cached HH:MM:SS` | 이 입력을 실은 첫 요청에 서버가 응답을 시작한 시각(이 컴퓨터의 시간대). 그때 프롬프트 캐시에 쓰여 있습니다.                                                 |
| `output N`        | 그 턴의 모든 요청이 낸 출력 토큰의 합(생각과 도구 호출 포함)                                                                                                |

- 응답이 오기 전에는 `prompt ~N tokens`만 보이고, 응답이 오면 나머지가 채워집니다.
- 서브에이전트의 요청은 세지 않습니다.
- 슬래시 명령 줄과 알림 줄에는 표시하지 않습니다.

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
