---
name: git-guardrails-claude-code
description: Set up Claude Code hooks to block recognized dangerous Git operations and require user review for all other Bash commands. Use when user wants destructive Git guardrails or explicit command review in Claude Code.
---

# Setup Git Guardrails

Set up a PreToolUse hook that blocks recognized dangerous Git commands and requires user review for every other Bash command. Explain this review requirement before installing: ordinary commands such as `git status`, `npm test`, and `rg` will also prompt. In unattended sessions, commands requiring review cannot proceed without a permission host.

## What Gets Blocked

- Literal `git push` invocations (including global options, quoting, whitespace, and `--force`)
- `git reset --hard`
- `git clean -f` / `git clean -fd` (dry runs and exclusion patterns require review)
- `git branch -D`
- `git checkout .` / `git restore .`

Block these recognized operations with exit code 2. Reject malformed JSON, missing or invalid commands, duplicate JSON keys, oversized input, and parser failures with the same blocking status.

Require explicit user review for everything else using Claude Code's `PreToolUse` `permissionDecision: "ask"`. This includes shell composition, expansions, aliases, wrappers, arbitrary executables, and ordinary Git commands. Do not add a silent-success fallback or an executable-name allowlist: scripts can invoke Git, and even `git status` can execute configured helpers. The recognizer never executes or rewrites the submitted command.

Use this as a human-review guardrail with trusted Bash, Python, Git, hook files, settings, and environment. It covers the Bash tool only. Protect those files and other execution tools separately; this hook does not isolate a hostile process or prevent a user-approved command from running Git indirectly.

## Steps

### 1. Ask scope

Ask the user: install for **this project only** (`.claude/settings.json`) or **all projects** (`~/.claude/settings.json`)?

### 2. Copy the hook script

Require Bash, Python 3, and Claude Code **v2.1.295 or later**, which supports `onFailure: "block"`. The hook uses Python's standard library; `jq` is not required. Check the current [hooks reference](https://code.claude.com/docs/en/hooks) when installing.

The bundled script is at: [scripts/block-dangerous-git.sh](scripts/block-dangerous-git.sh). Copy this single file; there are no companion parser files.

Copy it to the target location based on scope:

- **Project**: `.claude/hooks/block-dangerous-git.sh`
- **Global**: `~/.claude/hooks/block-dangerous-git.sh`

Make it executable with `chmod +x`.

When updating an existing installation, replace every installed copy and update its hook settings too. Updating this repository alone does not update copied hooks.

### 3. Add hook to settings

Add to the appropriate settings file:

**Project** (`.claude/settings.json`):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/block-dangerous-git.sh",
            "onFailure": "block"
          }
        ]
      }
    ]
  }
}
```

**Global** (`~/.claude/settings.json`):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "\"$HOME\"/.claude/hooks/block-dangerous-git.sh",
            "onFailure": "block"
          }
        ]
      }
    ]
  }
}
```

If the settings file already exists, merge the hook into the existing `hooks.PreToolUse` array. Don't overwrite other settings.

Keep `onFailure: "block"` so missing scripts, timeouts, and startup failures also block tool execution. Restart Claude Code after changing hook files/settings, and verify the hook is loaded with `/hooks`.

### 4. Ask about customization

Ask whether the user wants to customize the recognized prohibited operations. Preserve the default review decision for unrecognized commands and fail-closed handling of input/runtime errors.

### 5. Verify

Test the hook itself; never execute the submitted Git commands:

```bash
echo '{"tool_input":{"command":"git push origin main"}}' | <path-to-script>
```

Should exit with code 2 and print a BLOCKED message to stderr.

Repeat with `git -C . push` and malformed JSON (`{`); both must exit 2. Submit `git status --short` and `npm test`; both must exit 0 with valid JSON containing `hookSpecificOutput.hookEventName: "PreToolUse"` and `permissionDecision: "ask"`, rather than silent success.

In a Claude Code session, verify a harmless Bash command actually prompts before execution and a prohibited command is denied. Reject installations where the review decision or failure setting is ignored. From this repository, run `node --test tests/git-guardrails.test.mjs` for the regression corpus.
