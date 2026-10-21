#!/bin/bash

# Keep this hook self-contained: installation copies only this file. Python runs
# in isolated mode and only inspects input; it never evaluates the Bash command.
if ! command -v python3 >/dev/null 2>&1; then
  printf '%s\n' 'BLOCKED: Git guardrail requires Python 3.' >&2
  exit 2
fi

python3 -I -c '
import json
import posixpath
import shlex
import sys


def block(reason):
    print("BLOCKED: " + reason, file=sys.stderr)
    raise SystemExit(2)


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def invalid_constant(value):
    raise ValueError("non-JSON constant")


def git_arguments(command):
    # This is a bounded literal-word recognizer, not a Bash interpreter. Anything
    # outside it still requires user review, including scripts and substitutions.
    if any(char in command for char in "$`;|&<>(){}#"):
        return []
    words = shlex.split(command.replace("\\\n", ""), posix=True)
    if not words or posixpath.basename(words[0]) != "git":
        return []
    index = 1
    value_options = {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env"}
    flags = {"-p", "--paginate", "-P", "--no-pager", "--bare", "--no-replace-objects",
             "--no-lazy-fetch", "--no-optional-locks", "--no-advice", "--literal-pathspecs",
             "--glob-pathspecs", "--noglob-pathspecs", "--icase-pathspecs"}
    while index < len(words) and words[index].startswith("-"):
        word = words[index]
        if word in value_options:
            index += 2
        elif word in flags or (word.startswith(("-C", "-c")) and len(word) > 2):
            index += 1
        elif "=" in word and word.split("=", 1)[0] in value_options:
            index += 1
        else:
            return []
    return words[index:]


def prohibited(args):
    if not args:
        return False
    subcommand, *rest = args
    # Stop option recognition at -- so a filename cannot become an option.
    options = rest[:rest.index("--")] if "--" in rest else rest
    short_flags = "".join(word[1:] for word in options if word.startswith("-") and not word.startswith("--"))
    if subcommand == "push":
        return True
    if subcommand == "reset":
        return any(word == "--hard" or word.startswith("--hard=") for word in options)
    if subcommand == "clean":
        # -e consumes the rest of its cluster (or the next word) as an exclusion
        # pattern. Do not mistake pattern text for flags; leave these to review.
        if any(word == "--exclude" or word.startswith("--exclude=")
               or (word.startswith("-") and not word.startswith("--") and "e" in word[1:])
               for word in options):
            return False
        if "n" in short_flags or "--dry-run" in options:
            return False
        return "f" in short_flags or "--force" in options
    if subcommand == "branch":
        return "D" in short_flags or (("d" in short_flags or "--delete" in options)
                                        and ("f" in short_flags or "--force" in options))
    return subcommand in {"checkout", "restore"} and "." in rest


try:
    # Bound parser work and reject ambiguous or incomplete hook envelopes.
    payload = sys.stdin.buffer.read(1024 * 1024 + 1)
    if len(payload) > 1024 * 1024:
        block("Hook input is too large to inspect.")
    data = json.loads(payload.decode("utf-8"), object_pairs_hook=unique_object,
                      parse_constant=invalid_constant)
    if not isinstance(data, dict) or not isinstance(data.get("tool_input"), dict):
        block("Expected a Bash hook input object.")
    if data.get("tool_name", "Bash") != "Bash" or data.get("hook_event_name", "PreToolUse") != "PreToolUse":
        block("Unexpected hook event or tool.")
    command = data["tool_input"].get("command")
    if not isinstance(command, str) or not command.strip() or "\0" in command:
        block("Expected a nonempty command string without NUL bytes.")
    try:
        args = git_arguments(command)
    except ValueError:
        args = []
    if prohibited(args):
        block("This Git operation is prohibited by the installed guardrail.")
    # Never silently authorize unrecognized syntax, aliases, interpreters, or
    # ordinary programs that may run Git indirectly. Even read-only Git commands
    # can invoke configured executables. Leave the command unchanged for review.
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "ask",
        "permissionDecisionReason": "Git guardrail requires user review before running this Bash command; it may invoke Git indirectly."
    }}))
except Exception:
    block("Could not inspect hook input safely.")
'
status=$?

# Claude treats most non-2 failures as nonblocking. Translate interpreter startup
# failures and crashes to an explicit denial, rather than propagating that status.
if [ "$status" -eq 2 ]; then
  exit 2
fi
if [ "$status" -ne 0 ]; then
  printf '%s\n' 'BLOCKED: Git guardrail could not authorize this command.' >&2
  exit 2
fi

exit 0
