# prompt-translator

A Claude Code mod that translates the Korean prompts you type into the natural English a native English-speaking developer would actually write.  
The translation shows right under the prompt in the transcript.

Read this in [한글](./README.ko.md).

```plaintext
> 이 함수에 에러 처리 좀 추가해 줘
  [- 19(44)] Can you add error handling to this function?
```

## Install

```plaintext
/plugin install prompt-translator --marketplace ParkYoungWoong/claude-plugins
```

Answer `y` to `Add marketplace?` and pick a scope, and the plugin starts working right away.  
For other ways to install, see the [repository README](../../README.md#install).

## How it works

- The translation is only for reading.  
  Claude still receives your original Korean prompt.
- Translation and Claude's work start at the same time.  
  `번역 중...` (translating) shows under the prompt until the translation is ready, and then the same spot turns into the translation.
- The translation is attached to the prompt row, so it scrolls along with the transcript.
- `[- 19(44)]` in front is the character count of the Korean prompt (spaces included), followed by the English translation's count in parentheses.  
  Click it to hide that translation alone, and it turns into `[+ 19(44)]`.  
  Click it again to show the translation.
- Code, file paths, commands, identifiers, URLs, @mentions, and anything inside backticks stay as written.  
  Quoted text meant to be used verbatim (an exact reply, a UI label, a commit message) also stays in its original language.
- When a translation fails, only `번역하지 못했습니다 (reason)` (could not translate) is shown.  
  Claude's work goes on as usual.

## When it doesn't translate

- Prompts without any Hangul
- Slash commands
- Messages you didn't type yourself, such as task notifications
- Runs without a screen (`claude -p`)
- Prompts longer than 300 characters, spaces and pasted text included.  
  Nothing is shown for these.

## Translating long prompts: `ultratranslate`

Put `ultratranslate` anywhere in a prompt (case-insensitive) to translate it even when it runs past 300 characters.  
The keyword is removed before the prompt reaches Claude, so it doesn't change the work.

## Cost

Translations are requested from Claude Sonnet 5.5 (`claude-sonnet-5-5`, effort low).  
They count toward the usage of the account signed in to the session.

## Turning it off

Turn off prompt-translator in `/plugin`, or run this in a shell.

```bash
claude plugin disable prompt-translator@heropy-plugins
```

## Development

```bash
claude plugin validate plugins/prompt-translator
claude plugin test plugins/prompt-translator
```
