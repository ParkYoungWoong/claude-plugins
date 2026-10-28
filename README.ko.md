# heropy-plugins

[HEROPY](https://heropy.dev)의 Claude Code 플러그인 모음입니다.

[English](./README.md)

## 설치

Claude Code 터미널 세션의 프롬프트에서 원하는 플러그인을 하나씩 설치합니다.

```plaintext
/plugin install prompt-translator --marketplace ParkYoungWoong/claude-plugins
/plugin install token-meter --marketplace ParkYoungWoong/claude-plugins
```

처음 설치할 때 `Add marketplace?`를 물으면 `y`로 답하고, 설치 범위를 고른 뒤 Enter를 누릅니다.  
맨 위의 user 범위로 설치하면 지금 세션에서 바로 동작하고, 이후에 여는 모든 세션에서도 동작합니다.

셸에서 설치할 때:

```bash
claude plugin install prompt-translator --marketplace ParkYoungWoong/claude-plugins
claude plugin install token-meter --marketplace ParkYoungWoong/claude-plugins
```

데스크톱 앱에서는 `/plugin`을 쓸 수 없습니다.  
입력창 옆의 + 단추에서 `플러그인 추가`를 고르고, `추가 > 마켓플레이스 추가`에 `ParkYoungWoong/claude-plugins`를 입력한 뒤 `동기화`를 누릅니다.  
그다음 `탐색` 탭에서 플러그인을 찾아 `이 컴퓨터에 추가`를 누릅니다.  
단계별 화면은 [prompt-translator 문서](./plugins/prompt-translator/README.ko.md#클로드-데스크톱-앱)에 있습니다.

## 플러그인 목록

### [prompt-translator](./plugins/prompt-translator/README.ko.md)

입력한 프롬프트를 고른 언어로 번역해 프롬프트 바로 밑에 보여 줍니다.  
언어는 설치할 때 English (US), English (UK), 한글, 日本語, 中文 (简体), Español 중에서 고르고, 기본값은 English (US)입니다.  
번역은 보기 전용이고, Claude는 입력한 원문을 그대로 처리합니다.  
데스크톱 앱에서는 번역이 입력 말풍선 밑의 말풍선으로 보입니다.

```plaintext
> 이 함수에 에러 처리 좀 추가해 줘
  [Hide] Can you add error handling to this function?
```

### [token-meter](./plugins/token-meter/README.ko.md)

각 프롬프트 밑에 그 턴의 입력 토큰을, 턴의 마지막 답변 밑에 출력 토큰을 보여 줍니다.  
데스크톱 앱에서는 두 줄 모두 입력 말풍선처럼 오른쪽 끝에 붙습니다.

```plaintext
> 이 버그를 고쳐 줄래
  prompt ~12 / context 15 / total input 42,362 tokens (2 requests, cached 13:56:08)

  고쳤습니다.
  output 2,400 tokens
```

## 요구 사항

두 플러그인 모두 훅 모듈로 동작하는 Mod라서, Mod를 지원하는 Claude Code가 필요합니다.  
Claude Code 2.1.312의 터미널(기본 화면과 전체 화면 모드)과 클로드 데스크톱 앱 4.29의 Claude Code에서 확인했습니다.

## 라이선스

[MIT](./LICENSE)
