# token-meter

A Claude Code mod that shows token counts in the transcript.  
The input tokens of each turn appear under its prompt, and the output tokens appear under the turn's last reply.  
Each comes with what it costs at the Anthropic API list price.

Read this in [한글](./README.ko.md).

```plaintext
> 이 버그를 고쳐 줄래
  prompt ~12 / context 15 / total input 42,362 tokens (cache read 42,100 / 99.3%, cache write 247, 2 requests, cached 13:56:08)
  input cost $0.0105 (uncached $0.0001, cache read $0.0084, cache write 1h $0.0020)

  고쳤습니다.
  output 2,400 tokens / $0.0480 (turn $0.0585)
```

## Install

```plaintext
/plugin install token-meter --marketplace ParkYoungWoong/claude-plugins
```

Answer `y` to `Add marketplace?` and pick a scope, and the plugin starts working right away.  
For other ways to install, see the [repository README](../../README.md#install).

## What it shows

- `prompt ~N`: tokens estimated from the length of what you typed.  
  Hangul counts as about 1.35 tokens per character, and other characters as 1 token per 3.2 characters (measured on Opus 5.5).
- `context N`: the tokens this prompt actually added to the context.  
  It is the input of the turn's first request minus the input and output of the request before it.  
  It is left out on the first turn and right after compaction or `/clear`.
- `total input N`: the sum of the input tokens sent to the server during the turn.  
  Every request resends the system prompt and the whole conversation so far.  
  So this adds up each request's full input (input + cache read + cache write).
- `cache read N / P%`: how much of `total input` was read from the prompt cache, and its share.  
  It adds up each request's cache read and leaves out what was newly written to the cache (cache write).  
  The share is rounded down to one decimal place, so it never shows 100.0% unless everything came from the cache.
- `cache write N`: how much of `total input` was newly written to the prompt cache.  
  It is left out when nothing was written.
- `n requests`: how many requests the turn made.  
  It goes up each time Claude uses a tool.
- `cached HH:MM:SS`: when the server started answering the first request that carried this prompt, in this computer's time zone.  
  By then the prompt has been written to the prompt cache.
- `output N`: the output tokens of every request in the turn, thinking and tool calls included.

## Cost

- `input cost $N`: what the turn's input costs, split into uncached input, cache read and cache write.
- `output N tokens / $N`: what the output costs, and `turn $N` in parentheses is input and output together.

Each request is priced on its own, at the list price of the model that answered it.  
So a turn whose model changes partway (a fallback, `/model`) is still priced right.  
Amounts are shown to four decimal places, and an amount too small for that shows as `<$0.0001`.  
Each amount is rounded on its own, so the parts in parentheses can be off from the total by $0.0001.

| Model | Input | Cache read | Output |
| --- | --- | --- | --- |
| Fable 5.2, Mythos 5.2 | $8 | $0.20 | $40 |
| Fable 5.1, Mythos 5.1 | $10 | $0.25 | $50 |
| Fable 5, Mythos 5 | $10 | $1 | $50 |
| Opus 5.5 | $4 | $0.20 | $20 |
| Opus 5, Opus 4.8, 4.7, 4.6 | $5 | $0.50 | $25 |
| Sonnet 5.5 | $2 | $0.10 | $10 |
| Sonnet 5 | $2 | $0.20 | $10 |
| Sonnet 4.6 | $3 | $0.30 | $15 |
| Haiku 5.5 (prompt up to 100K) | $0.10 | $0.01 | $0.50 |
| Haiku 5.5 (prompt over 100K) | $0.50 | $0.05 | $2.50 |
| Haiku 4.5 | $1 | $0.10 | $5 |

Prices are per million tokens, the Anthropic API list prices as of 2026-11-03.  
Haiku 5.5 picks its rate for each request by that request's whole input.

A cache write costs 1.25x the input price when the cache keeps it for 5 minutes, and 2x for 1 hour.  
The `cacheTtl` setting chooses which (`auto`, `5m`, `1h`), and `auto` follows Claude Code.  
Installing with `/plugin` asks for it, and you can change it later in `/config` or, in the desktop app, in the plugin's settings tab.

1. `FORCE_PROMPT_CACHING_5M` set: 5 minutes.
2. `CLAUDE_CODE_PROMPT_CACHE_TTL` or the `promptCacheTtl` setting: that value.
3. `ENABLE_PROMPT_CACHING_1H` set: 1 hour.
4. Otherwise 1 hour on a Claude subscription (the session reports usage limit windows), and 5 minutes on an API key.

Things to know:

- It is an estimate at list price.  
  A Claude subscription is not billed per token, and Bedrock, Vertex AI and other providers have their own prices.
- Fast mode costs more (2x on Opus 5.5), but a request does not say it ran in fast mode, so it is priced at the standard rate.
- On a subscription that has gone into extra usage, Claude Code writes the cache for 5 minutes, but `auto` still prices it at 1 hour.  
  Set `cacheTtl` to `5m` if that matters.
- Subagent requests and Claude Code's own small background requests are not counted, so the total can be lower than `/cost`.
- A turn that used a model with no price in the table shows `input cost unknown` and no output cost.

## When the numbers fill in

Before the first response arrives, only `prompt ~N tokens` shows.  
The rest fills in once the response comes in.  
Subagent requests are not counted, and notification rows are left alone.

## Slash commands and prompts sent mid-turn

- A command that starts a turn, such as `/goal` or a skill, has no row a mod can draw under.  
  So its input tokens show right above the first reply of that turn.  
  `prompt ~N` is estimated from the command line you typed, and `context N` includes the instructions the command adds.
- Commands that don't start a turn, such as `/rename`, show nothing.
- A prompt you send while Claude is working joins the running turn, so it shows only `prompt ~N tokens`.  
  Its tokens are counted in the numbers of the turn that was running.

## Claude desktop app

In Claude Code in the Claude desktop app, the numbers show in the same places as cards instead of lines.  
Each card sits at the right edge, like your prompts, and looks like prompt-translator's translation card.

- Input card: `Input` and the input cost on top, then a table of prompt, context, total input, uncached, cache read (with its share), cache write, requests and the time it was cached, with the cost of each part.
- Output card: `Output` and the output cost on top, then the output tokens and the turn total.

At the right end of each card's top line is a fold button in a faint gray box.

- Press the minus button to fold that card's table away and keep only the title and the cost on its top line.  
  The button turns into a plus, which unfolds the card again.
- Each card folds on its own.  
  The input card and the output card of the same turn fold apart too.
- A folded card stays folded for the session, even when the screen is drawn again.

Lines in the terminal are short already, so they have no fold button.

## Turning it off

Turn off token-meter in `/plugin`, or run this in a shell.

```bash
claude plugin disable token-meter@heropy-plugins
```

## Development

```bash
claude plugin validate plugins/token-meter
claude plugin test plugins/token-meter
```
