# heropy-plugins

Claude Code plugins by [HEROPY](https://heropy.dev).

Read this in [한글](./README.ko.md).

## Install

Install each plugin you want from the prompt of a Claude Code terminal session.

```plaintext
/plugin install prompt-translator --marketplace ParkYoungWoong/claude-plugins
/plugin install token-meter --marketplace ParkYoungWoong/claude-plugins
```

The first install asks `Add marketplace?`, so answer `y`, pick a scope, and press Enter.  
With the user scope at the top of the list, the plugin works in the current session right away and in every session you open after that.

From a shell:

```bash
claude plugin install prompt-translator --marketplace ParkYoungWoong/claude-plugins
claude plugin install token-meter --marketplace ParkYoungWoong/claude-plugins
```

The desktop app doesn't run `/plugin`.  
Click the + button next to the prompt box, choose Plugins > Add marketplace, enter `ParkYoungWoong/claude-plugins`, and install with Add plugin.

## Plugins

### [prompt-translator](./plugins/prompt-translator)

Translates the Korean prompts you type into natural English and shows the translation right under each prompt.  
The translation is only for reading, and Claude still works from your original Korean prompt.

```plaintext
> 이 함수에 에러 처리 좀 추가해 줘
  [- 19(44)] Can you add error handling to this function?
```

### [token-meter](./plugins/token-meter)

Shows the input tokens of each turn under its prompt, and the output tokens under the turn's last reply.

```plaintext
> 이 버그를 고쳐 줄래
  prompt ~12 / context 15 / total input 42,362 tokens (2 requests, cached 13:56:08)

  고쳤습니다.
  output 2,400 tokens
```

## Requirements

Both plugins are mods, plugins that run as a hooks module, so they need a version of Claude Code that supports mods.  
They were tested on Claude Code 2.1.311 in the terminal's fullscreen mode.

## License

[MIT](./LICENSE)
