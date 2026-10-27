# token-meter

A Claude Code mod that shows token counts in the transcript.  
The input tokens of each turn appear under its prompt, and the output tokens appear under the turn's last reply.

Read this in [한글](./README.ko.md).

```plaintext
> 이 버그를 고쳐 줄래
  prompt ~12 / context 15 / total input 42,362 tokens (2 requests, cached 13:56:08)

  고쳤습니다.
  output 2,400 tokens
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
- `n requests`: how many requests the turn made.  
  It goes up each time Claude uses a tool.
- `cached HH:MM:SS`: when the server started answering the first request that carried this prompt, in this computer's time zone.  
  By then the prompt has been written to the prompt cache.
- `output N`: the output tokens of every request in the turn, thinking and tool calls included.

Before the first response arrives, only `prompt ~N tokens` shows.  
The rest fills in once the response comes in.  
Subagent requests are not counted, and slash command and notification rows are left alone.

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
