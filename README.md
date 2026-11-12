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
Click the + button next to the prompt box and choose Add plugins, then choose Add > Add marketplace, enter `ParkYoungWoong/claude-plugins`, and click Sync.  
Find the plugin in the Discover tab and click Add to this computer.  
See the [prompt-translator README](./plugins/prompt-translator/README.md#claude-desktop-app) for screenshots of each step.

## Plugins

### [prompt-translator](./plugins/prompt-translator)

Translates the prompts you type into the language you choose and shows the translation right under each prompt.  
You pick the language from English (US), English (UK), 한글, 日本語, 中文 (简体) or Español (in the terminal when you install it, in the desktop app in its Settings tab afterward), with English (US) as the default.  
The translation is only for reading, and Claude still works from your original prompt.  
Fold a translation with `[-]` in front of it in the terminal, or with the minus button on its card under your prompt in the desktop app.

```plaintext
> 이 함수에 에러 처리 좀 추가해 줘
  [-] Can you add error handling to this function?
```

### [token-meter](./plugins/token-meter)

Shows the input tokens of each turn under its prompt, and the output tokens under the turn's last reply, each with what it costs at the API list price.  
Cache reads and writes are priced apart, and each request is priced at its own model's rate even when the model changes mid-turn.  
In the terminal, each shows as one folded line with the turn number, and `[+]` unfolds it into a table with token, share and cost columns lined up.  
In the desktop app, the same numbers show as an input card and an output card at the right edge, and the minus button on each card folds it down to its title, turn number and cost.

```plaintext
> 이 버그를 고쳐 줄래
  [+] INPUT   42,362 tok  $0.0105  (turn 3 / 2 requests / cached 13:56:08)

  고쳤습니다.
  [+] OUTPUT   2,400 tok  $0.0480  (turn 3 / turn total $0.0585)
```

## Requirements

Both plugins are mods (plugins that run as a hooks module and add lines or cards to the Claude Code screen), so they need Claude Code 2.1.299 or later.  
Their tests pass on several releases from 2.1.299 to 2.1.322, and on 2.1.296, the release before, some of token-meter's lines come out differently.  
They were checked on screen in Claude Code 2.1.322 in the terminal and in the Claude desktop app 5.1231 (Claude Code 2.1.321).

After you update a plugin, run `/reload-plugins` in a session that is already open, or open a new session, to see the change.

## License

[MIT](./LICENSE)
