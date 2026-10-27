# prompt-translator

입력한 한글 프롬프트를 영어권 개발자가 실제로 쓰는 자연스러운 영어로 번역하는 Claude Code Mod입니다.  
번역은 대화 기록의 프롬프트 줄 바로 밑에 보입니다.

[English](./README.md)

```plaintext
> 이 함수에 에러 처리 좀 추가해 줘
  [- 19(44)] Can you add error handling to this function?
```

## 설치

```plaintext
/plugin install prompt-translator --marketplace ParkYoungWoong/claude-plugins
```

`Add marketplace?`에 `y`로 답하고 설치 범위를 고르면 바로 동작합니다.  
다른 설치 방법은 [저장소 README](../../README.ko.md#설치)를 참고하세요.

## 동작

- 번역은 보기 전용입니다.  
  Claude에게는 한글 원문이 그대로 전달됩니다.
- 번역과 Claude의 작업은 동시에 시작합니다.  
  번역이 끝날 때까지 프롬프트 밑에 `번역 중...`이 보이고, 끝나면 같은 자리가 번역문으로 바뀝니다.
- 번역은 프롬프트 줄에 붙어 있어서, 대화 기록을 스크롤하면 함께 움직입니다.
- 앞의 `[- 19(44)]`는 한글 원문의 글자 수(공백 포함)와 괄호 안의 영어 번역 글자 수입니다.  
  누르면 그 번역만 숨겨지고 `[+ 19(44)]`로 바뀝니다.  
  다시 누르면 번역이 보입니다.
- 코드, 파일 경로, 명령어, 식별자, URL, @멘션, 백틱 안의 글은 그대로 둡니다.  
  그대로 써야 하는 인용문(정확한 답장, UI 문구, 커밋 메시지)도 원문을 유지합니다.
- 번역에 실패하면 `번역하지 못했습니다 (이유)`만 표시합니다.  
  Claude의 작업은 그대로 진행됩니다.

## 번역하지 않는 경우

- 한글이 없는 프롬프트
- 슬래시 명령
- 작업 알림처럼 사람이 직접 입력하지 않은 메시지
- 화면이 없는 실행(`claude -p`)
- 공백과 붙여넣은 글을 포함해 300자가 넘는 프롬프트.  
  이때는 아무것도 표시하지 않습니다.

## 긴 프롬프트 번역: `ultratranslate`

프롬프트 아무 곳에나 `ultratranslate`를 넣으면(대소문자 구분 없음) 300자가 넘어도 번역합니다.  
키워드는 Claude에게 넘기기 전에 빠지므로 작업 내용에는 영향을 주지 않습니다.

## 비용

번역은 Claude Sonnet 5.5(`claude-sonnet-5-5`, effort low)로 요청합니다.  
지금 세션에 로그인한 계정의 사용량에 포함됩니다.

## 끄기

`/plugin`에서 prompt-translator를 끄거나, 셸에서 다음 명령을 실행합니다.

```bash
claude plugin disable prompt-translator@heropy-plugins
```

## 개발

```bash
claude plugin validate plugins/prompt-translator
claude plugin test plugins/prompt-translator
```
