import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, chmodSync, closeSync, openSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const hook = join(repo, "skills/misc/git-guardrails-claude-code/scripts/block-dangerous-git.sh");

/** Invoke only the hook, with bounded execution and optional dependency isolation. */
function run(input, env = process.env) {
  const dir = mkdtempSync(join(tmpdir(), "git-hook-input-"));
  const file = join(dir, "stdin");
  writeFileSync(file, input);
  const stdin = openSync(file, "r");
  try {
    const result = spawnSync("/bin/bash", [hook], { stdio: [stdin, "pipe", "pipe"], encoding: "utf8", env, timeout: 5000 });
    assert.equal(result.error, undefined);
    return result;
  } finally {
    closeSync(stdin);
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Encode a command as a Bash PreToolUse input without executing it. */
function command(value) {
  return JSON.stringify({ tool_name: "Bash", hook_event_name: "PreToolUse", tool_input: { command: value } });
}

/** Require an explicit blocking exit without an output authorization decision. */
function denied(result) {
  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /^BLOCKED:/);
}

/** Require a user-review decision that preserves the original tool input. */
function reviewed(result) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const output = JSON.parse(result.stdout);
  assert.equal(output.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(output.hookSpecificOutput.permissionDecision, "ask");
  assert.equal(typeof output.hookSpecificOutput.permissionDecisionReason, "string");
  assert.equal(output.hookSpecificOutput.updatedInput, undefined);
}

test("recognized prohibited Git operations are denied after word and global-option parsing", () => {
  const invocations = [
    "git push origin main", "git -C . push", "git -C. push --force",
    "git -c color.ui=never push", "git -ccolor.ui=never push",
    "git -c core.foo='a#b' push origin main", 'git -c core.foo="a#b" push',
    "git -c core.foo=a#b push", "git -C '#' push", "git -C \\# push",
    "git --git-dir=.git --work-tree=. push", "git --no-pager push",
    "git --config-env=foo=BAR push", "/usr/bin/git push", "'git' 'push'",
    'g\\it pu"sh"', "git  push", "git\tpush", "git \\\npush",
    "git reset HEAD --hard", "git reset --hard=HEAD",
    "git clean -f", "git clean -fd", "git clean -dfx", "git clean --force",
    "git branch -D old", "git branch -vD old", "git branch -d -f old",
    "git branch --delete --force old",
    "git checkout .", "git checkout -- .", "git restore --worktree .", "git restore -- .",
  ];
  for (const value of invocations) denied(run(command(value)));
});

test("equivalent dangerous shell forms never get a silent success", () => {
  const invocations = [
    "env git -C . push", "FOO=bar git push", "command git push", "exec git push",
    "git status && git -C . push", "git status; git push", "git status\ngit push",
    "(git push)", "{ git push; }", "git push | cat", "git push &",
    '"$GIT" push', "git $'push'", 'git "$(printf push)"', "git `printf push`",
    "eval 'git push'", "bash -c 'git push'", "python3 -c 'import subprocess; subprocess.run([\"git\", \"push\"])'",
    "git publish", "git --exec-path=/tmp push", "git clean --for", "git branch --del --for old",
    "git restore :/", "git checkout HEAD -- file", "git --help", "./git push",
    "git status > .git/config", "cat <<EOF\ngit push\nEOF", "git push # comment",
  ];
  for (const value of invocations) {
    const result = run(command(value));
    if (result.status === 2) denied(result);
    else reviewed(result);
  }
});

test("legitimate Bash workflows remain available through explicit review without rewriting commands", () => {
  for (const value of [
    "git status --short", "git log --oneline", "git diff", "git add file",
    "git commit -m 'change'", "git reset --soft HEAD~", "git branch -d merged",
    "git clean -n", "git clean -nf", "git clean --force --dry-run", "git clean -nefoo",
    "git clean -efoo", "git clean -e -f", "git clean --exclude=-f", "git clean --exclude -f",
    "git checkout feature", "git restore file", "npm test",
    "printf '%s\\n' 'git push origin main'", "echo reset --hard", "git status | cat",
    "git branch # -D old", "git clean # --force", "git branch # 'unclosed quote",
    "git -c core.fsmonitor='git push' status", "GIT_PAGER='git push' git log", "git --version",
  ]) reviewed(run(command(value)));
  reviewed(run(JSON.stringify({ tool_input: { command: "git status" } })));
});

test("invalid hook payloads fail closed without echoing input", () => {
  for (const input of [
    "", "{", "{}", "null", "[]", '"text"', "{}{}",
    ...[null, 42, [], {}, true, "", "   ", "git\u0000push"].map(command),
    '{"tool_input":null}', '{"tool_input":[]}',
    '{"tool_input":{"command":"git status","command":"git push"}}',
    '{"tool_input":{"command":"git status"},"tool_input":{"command":"git push"}}',
    ...["NaN", "Infinity", "-Infinity"].map((value) => `{"tool_input":{"command":"git status"},"invalid":${value}}`),
    JSON.stringify({ tool_name: "Other", tool_input: { command: "git status" } }),
    JSON.stringify({ hook_event_name: "PostToolUse", tool_input: { command: "git status" } }),
    Buffer.from([0xff]), "x".repeat(1024 * 1024 + 1),
  ]) {
    const result = run(input);
    denied(result);
    assert.doesNotMatch(result.stderr, /git status|git push/);
  }
});

test("missing or failed parser runtime blocks instead of returning a nonblocking hook error", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "git-hook-runtime-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  denied(run(command("git status"), { PATH: dir }));
  const python = join(dir, "python3");
  const runtime = spawnSync("python3", ["-I", "-c", "import sys; print(sys.executable)"], { encoding: "utf8" });
  assert.equal(runtime.status, 0, runtime.stderr);
  symlinkSync(runtime.stdout.trim(), python);
  reviewed(run(command("git status"), { PATH: dir })); // No jq, cat, or grep on PATH.
  rmSync(python);
  writeFileSync(python, "#!/bin/sh\nexit 17\n");
  chmodSync(python, 0o755);
  denied(run(command("git status"), { PATH: dir }));
});

test("inspection never executes command substitutions or supplied programs", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "git-hook-no-exec-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const sentinel = join(dir, "executed");
  reviewed(run(command(`git "$(touch '${sentinel}'; printf push)"`)));
  reviewed(run(command(`touch '${sentinel}'`)));
  assert.equal(spawnSync("/bin/test", ["-e", sentinel]).status, 1);
});

test("both installation configurations block hook startup and timeout failures", () => {
  const skill = readFileSync(join(dirname(dirname(hook)), "SKILL.md"), "utf8");
  const configurations = [...skill.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => JSON.parse(match[1]));
  assert.equal(configurations.length, 2);
  for (const configuration of configurations) {
    const registration = configuration.hooks.PreToolUse;
    assert.equal(registration.length, 1);
    assert.equal(registration[0].matcher, "Bash");
    assert.equal(registration[0].hooks[0].type, "command");
    assert.equal(registration[0].hooks[0].onFailure, "block");
  }
});
