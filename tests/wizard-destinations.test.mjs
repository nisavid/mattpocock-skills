import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, closeSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const template = readFileSync(join(repo, "skills/engineering/wizard/template.sh"), "utf8");
const stages = template.indexOf("\n# STAGES: author this section.");
assert.notEqual(stages, -1, "the template must retain its STAGES marker");
const library = template.slice(0, stages);

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "wizard-destinations-test-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, "project with spaces");
  const other = join(root, "other checkout");
  const bin = join(root, "bin");
  for (const directory of [project, other, bin]) mkdirSync(directory);
  const source = join(root, "library.sh");
  const calls = join(root, "gh-calls.jsonl");
  writeFileSync(source, library);
  writeFileSync(join(bin, "gh"), `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
const body = args[0] === "secret" && args[1] === "set" ? fs.readFileSync(0, "utf8") : null;
const context = process.env.WIZARD_TRACE_CONTEXT === "1" ? { home: process.env.HOME, ghConfig: process.env.GH_CONFIG_DIR, bashEnv: process.env.BASH_ENV, added: process.env.SYNTHETIC_ADDED, token: process.env.WIZARD_CHECK_TOKEN === "1" ? process.env.GH_TOKEN : undefined, shellFunction: process.env['BASH_FUNC_SYNTHETIC%%'] } : undefined;
fs.appendFileSync(process.env.WIZARD_GH_CALLS, JSON.stringify({ args, body, context }) + "\\n");
const fail = process.env.WIZARD_GH_FAIL;
process.exit((fail === "auth" && args[0] === "auth") || (fail === "write" && args[0] !== "auth") ? 1 : 0);
`);
  chmodSync(join(bin, "gh"), 0o755);
  const options = (extra = {}) => ({
    cwd: project,
    encoding: "utf8",
    timeout: 5000,
    ...extra,
    env: {
      ...process.env,
      ENV_FILE: ".env",
      PATH: `${bin}:${process.env.PATH}`,
      WIZARD_GH_CALLS: calls,
      GH_REPO: "ambient.invalid/unintended/repository",
      GH_HOST: "ambient.invalid",
      ...extra.env,
    },
  });
  const args = (script, extra = []) => ["-c", `source "$1"\n${script}`, "wizard-test", source, project, other, ...extra];
  let inputIndex = 0;
  const run = (script, { args: extra = [], input = "", ...extraOptions } = {}) => {
    const inputFile = join(root, `stdin-${inputIndex++}`);
    writeFileSync(inputFile, input);
    const stdin = openSync(inputFile, "r");
    try {
      return spawnSync("bash", args(script, extra), options({ ...extraOptions, stdio: [stdin, "pipe", "pipe"] }));
    } finally {
      closeSync(stdin);
    }
  };
  const ghCalls = () => existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
  return { root, project, other, run, ghCalls, options, args };
}

function succeeded(result) {
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test("wizard input cannot replace the confirmed repository", (t) => {
  const f = fixture(t);
  const result = f.run('configure_destinations "$2" example/project\nif write_env _WIZARD_REPO github.com/other/repo; then exit 90; fi\nset_secret DUMMY_SECRET dummy-secret\nset_var DUMMY_VAR dummy-value', { input: "yes\n" });
  succeeded(result);
  assert.equal(existsSync(join(f.project, ".env")), false);
  const writes = f.ghCalls().filter(({ args }) => args[1] === "set");
  assert.equal(writes.length, 2);
  for (const { args } of writes) assert.equal(args[args.indexOf("--repo") + 1], "github.com/example/project");
});

test("reserved destination names are refused before input or writes", (t) => {
  for (const name of ["PATH", "ENV_FILE", "_WIZARD_ROOT", "_WIZARD_ENV_FILE", "_WIZARD_REPO", "_WIZARD_CONFIGURED", "_WIZARD_FUTURE"]) {
    for (const operation of [`ask ${name} prompt`, `ask_secret ${name} prompt`, `write_env ${name} dummy-value`]) {
      const f = fixture(t);
      const result = f.run(`configure_destinations "$2" example/project\nif ${operation}; then exit 90; fi\nIFS= read -r remaining\n[[ "$remaining" == sentinel ]] || exit 91\nset_secret DUMMY_SECRET dummy-secret\nset_var DUMMY_VAR dummy-value`, { input: "yes\nsentinel\n" });
      succeeded(result);
      assert.equal(existsSync(join(f.project, ".env")), false, `${operation} wrote an env file`);
      const calls = f.ghCalls();
      assert.equal(calls.length, 4, `${operation} made an unexpected GitHub call`);
      const writes = calls.filter(({ args }) => args[1] === "set");
      assert.equal(writes.length, 2);
      for (const { args } of writes) assert.equal(args[args.indexOf("--repo") + 1], "github.com/example/project");
    }
  }
});

test("tracing does not disclose synthetic secrets in generated wizards", (t) => {
  for (const mode of ["command-line", "inherited"]) {
    const f = fixture(t);
    const script = join(f.root, "generated-wizard.sh");
    const startup = join(f.root, "bash-env.sh");
    writeFileSync(startup, "set -x\n");
    writeFileSync(script, library + '\nconfigure_destinations "$PWD" example/project\nask_secret DUMMY_SECRET "Secret:"\nwrite_env DUMMY_SECRET "$DUMMY_SECRET"\nset_secret DUMMY_SECRET "$DUMMY_SECRET"\n');
    const secret = "synthetic-secret-do-not-log";
    const args = mode === "command-line" ? ["-x", script] : [script];
    const result = spawnSync("bash", args, f.options({ input: `yes\n${secret}\n`, env: mode === "inherited" ? { BASH_ENV: startup } : {} }));
    succeeded(result);
    assert.equal(result.stdout.includes(secret), false, `${mode} leaked to stdout`);
    assert.equal(result.stderr.includes(secret), false, `${mode} leaked to stderr`);
    assert.ok(f.ghCalls().some(({ args, body }) => args[0] === "secret" && args[1] === "set" && body === secret));
  }
});

test("helper commands keep their confirmed resolution after a directory change", (t) => {
  const f = fixture(t);
  symlinkSync(join(f.root, "bin"), join(f.project, "bin"));
  symlinkSync("/usr/bin/python3", join(f.root, "bin", "python3"));
  mkdirSync(join(f.other, "bin"));
  const marker = join(f.root, "redirected");
  for (const name of ["python3", "gh"]) {
    const file = join(f.other, "bin", name);
    writeFileSync(file, `#!/bin/sh\nprintf redirected > "$WIZARD_REDIRECT_MARKER"\nexit 1\n`);
    chmodSync(file, 0o755);
  }
  const result = f.run('configure_destinations "$2" example/project\ncd "$3"\nset_secret DUMMY_SECRET synthetic-value', { input: "yes\n", env: { PATH: "bin:/usr/bin:/bin", WIZARD_REDIRECT_MARKER: marker } });
  succeeded(result);
  assert.equal(existsSync(marker), false);
  assert.ok(f.ghCalls().some(({ args }) => args[0] === "secret" && args[1] === "set"));
});

test("replacing the launch directory cannot redirect helper commands", (t) => {
  const f = fixture(t);
  symlinkSync(join(f.root, "bin"), join(f.project, "bin"));
  symlinkSync("/usr/bin/python3", join(f.root, "bin", "python3"));
  mkdirSync(join(f.other, "bin"));
  const marker = join(f.root, "redirected");
  for (const name of ["python3", "gh"]) {
    const file = join(f.other, "bin", name);
    writeFileSync(file, '#!/bin/sh\nprintf redirected > "$WIZARD_REDIRECT_MARKER"\nexit 1\n');
    chmodSync(file, 0o755);
  }
  const result = f.run('configure_destinations "$2" example/project\nmv "$2" "$4"\nmv "$3" "$2"\nset_secret DUMMY_SECRET synthetic-value', { args: [join(f.root, "moved")], input: "yes\n", env: { PATH: "bin:/usr/bin:/bin", WIZARD_REDIRECT_MARKER: marker } });
  succeeded(result);
  assert.equal(existsSync(marker), false);
  assert.ok(f.ghCalls().some(({ args }) => args[0] === "secret" && args[1] === "set"));
});

test("captured exported values cannot change helper credential context", (t) => {
  const f = fixture(t);
  const result = f.run('configure_destinations "$2" example/project\nwrite_env HOME changed-home\nwrite_env GH_CONFIG_DIR changed-config\nwrite_env BASH_ENV changed-startup\nexport SYNTHETIC_ADDED=changed\nset_secret DUMMY_SECRET synthetic-value\n[[ "$HOME" == changed-home && "$GH_CONFIG_DIR" == changed-config && "$BASH_ENV" == changed-startup ]]', { input: "yes\n", env: { HOME: "original-home", GH_CONFIG_DIR: "original-config", BASH_ENV: "original-startup", WIZARD_TRACE_CONTEXT: "1" } });
  succeeded(result);
  const call = f.ghCalls().find(({ args }) => args[0] === "secret" && args[1] === "set");
  assert.deepEqual(call?.context, { home: "original-home", ghConfig: "original-config", bashEnv: "original-startup" });
});

test("helper environment preserves readonly exports and literal shell syntax", (t) => {
  const f = fixture(t);
  const marker = join(f.root, "unexpected-command");
  const literal = `$(touch ${marker})\nsynthetic`;
  const result = f.run('export SHELLOPTS\nreadonly SYNTHETIC_READONLY=original\nexport SYNTHETIC_READONLY\nconfigure_destinations "$2" example/project\nset_secret DUMMY_SECRET synthetic-value', { input: "yes\n", env: { HOME: literal, GH_CONFIG_DIR: "original-config", BASH_ENV: "original-startup", WIZARD_TRACE_CONTEXT: "1" } });
  succeeded(result);
  assert.equal(existsSync(marker), false);
  assert.doesNotMatch(result.stderr, /readonly variable/);
  const call = f.ghCalls().find(({ args }) => args[0] === "secret" && args[1] === "set");
  assert.equal(call?.context?.home, literal);
});

test("a previously unset exported token stays absent from helper calls", (t) => {
  const f = fixture(t);
  const result = f.run('export GH_TOKEN\nconfigure_destinations "$2" example/project\nwrite_env GH_TOKEN synthetic-later-token\nset_secret DUMMY_SECRET synthetic-value\n[[ "$GH_TOKEN" == synthetic-later-token ]]', { input: "yes\n", env: { GH_TOKEN: undefined, WIZARD_TRACE_CONTEXT: "1", WIZARD_CHECK_TOKEN: "1" } });
  succeeded(result);
  const call = f.ghCalls().find(({ args }) => args[0] === "secret" && args[1] === "set");
  assert.ok(call);
  assert.equal(call.context.token, undefined);
});

test("helper calls exclude exported stage functions", (t) => {
  const f = fixture(t);
  const result = f.run('configure_destinations "$2" example/project\nSYNTHETIC() { :; }\nexport -f SYNTHETIC\nset_secret DUMMY_SECRET synthetic-value', { input: "yes\n", env: { WIZARD_TRACE_CONTEXT: "1" } });
  succeeded(result);
  const call = f.ghCalls().find(({ args }) => args[0] === "secret" && args[1] === "set");
  assert.ok(call);
  assert.equal(call.context.shellFunction, undefined);
});

test("destination setup refuses an exported nameref", (t) => {
  const capability = spawnSync("bash", ["-c", "if declare -n probe=target 2>/dev/null; then exit 0; else exit 77; fi"], { encoding: "utf8" });
  assert.equal(capability.error, undefined, capability.error?.message);
  if (capability.status === 77) return t.skip("the selected Bash does not support namerefs");
  assert.equal(capability.status, 0, capability.stderr);
  const f = fixture(t);
  const result = f.run('TARGET=original\ndeclare -nx SYNTHETIC_REFERENCE=TARGET\nif configure_destinations "$2" example/project; then exit 90; fi');
  succeeded(result);
  assert.equal(existsSync(join(f.project, ".env")), false);
  assert.deepEqual(f.ghCalls(), []);
});

test("destination preview is visible before the human confirms", async (t) => {
  const f = fixture(t);
  mkdirSync(join(f.project, "config"));
  const expected = [f.project, join(f.project, "config/local.env"), "github.com/example/project"];
  const result = await new Promise((resolve) => {
    const child = spawn("bash", f.args('configure_destinations "$2" example/project\nprintf "configured\\n"'), f.options({ env: { ENV_FILE: "config/local.env" } }));
    let stdout = "";
    let stderr = "";
    let confirmed = false;
    child.stdout.on("data", (data) => {
      stdout += data;
      const preview = stdout.replaceAll("\\ ", " ");
      if (!confirmed && expected.every((value) => preview.includes(value)) &&
          preview.includes("Existing env-file access settings are preserved") &&
          preview.includes("Accept these destinations and the existing readers? [y/N]")) {
        confirmed = true;
        child.stdin.end("yes\n");
      }
    });
    child.stderr.on("data", (data) => { stderr += data; });
    child.on("error", (error) => resolve({ error, stdout, stderr }));
    child.on("close", (status) => resolve({ status, stdout, stderr, confirmed }));
  });
  succeeded(result);
  assert.equal(result.confirmed, true, "confirmation must wait for the destinations, access warning, and reader question");
  assert.match(result.stdout, /configured/);
  assert.equal(existsSync(join(f.project, "config/local.env")), false);
  assert.deepEqual(f.ghCalls(), []);
});

test("replacing the project pathname during confirmation cannot redirect the accepted write", async (t) => {
  const f = fixture(t);
  const pinned = join(f.root, "original project");
  writeFileSync(join(f.project, ".env"), "OTHER='original-project'\n");
  const result = await new Promise((resolve) => {
    const child = spawn("bash", f.args('configure_destinations "$2"\nwrite_env DUMMY dummy-value'), f.options());
    let stdout = "";
    let stderr = "";
    let replaced = false;
    child.stdout.on("data", (data) => {
      stdout += data;
      if (!replaced && stdout.includes("Accept these destinations and the existing readers? [y/N]")) {
        replaced = true;
        renameSync(f.project, pinned);
        mkdirSync(f.project);
        writeFileSync(join(f.project, ".env"), "OTHER='replacement-sentinel'\n");
        child.stdin.end("yes\n");
      }
    });
    child.stderr.on("data", (data) => { stderr += data; });
    child.on("error", (error) => resolve({ error, stdout, stderr }));
    child.on("close", (status) => resolve({ status, stdout, stderr, replaced }));
  });
  succeeded(result);
  assert.equal(result.replaced, true, "replace the pathname only after the preview and before confirmation");
  assert.equal(readFileSync(join(pinned, ".env"), "utf8"), "OTHER='original-project'\nDUMMY='dummy-value'\n");
  assert.equal(readFileSync(join(f.project, ".env"), "utf8"), "OTHER='replacement-sentinel'\n");
  assert.deepEqual(f.ghCalls(), []);
});

test("value helpers fail before destination confirmation", async (t) => {
  const operations = ['_existing DUMMY', 'ask DUMMY "Dummy value:"', 'ask_secret DUMMY "Dummy secret:"', 'write_env DUMMY dummy-value', 'set_secret DUMMY dummy-value', 'set_var DUMMY dummy-value'];
  for (const operation of operations) await t.test(operation, (t) => {
    const f = fixture(t);
    writeFileSync(join(f.project, ".env"), "DUMMY='saved-dummy-value'\n");
    const result = f.run(`DUMMY=unchanged\nif ${operation}; then exit 90; fi\n[[ "$DUMMY" == unchanged ]]\nIFS= read -r remaining\n[[ "$remaining" == dummy-value ]]`, { input: "dummy-value\n" });
    succeeded(result);
    assert.doesNotMatch(result.stdout, /saved-dummy-value/);
    assert.equal(readFileSync(join(f.project, ".env"), "utf8"), "DUMMY='saved-dummy-value'\n");
    assert.deepEqual(f.ghCalls(), []);
  });
});

test("loading the library and declining confirmation never invoke the saved-value helper", (t) => {
  const f = fixture(t);
  const marker = join(f.root, "python-invoked");
  writeFileSync(join(f.root, "bin/python3"), `#!/bin/sh\nprintf invoked > '${marker.replaceAll("'", "'\\''")}'\nexit 93\n`);
  chmodSync(join(f.root, "bin/python3"), 0o755);
  writeFileSync(join(f.project, ".env"), "DUMMY='saved-dummy-value'\n");
  const result = f.run('printf "LIBRARY_LOADED\\n"\nif configure_destinations "$2" example/project; then exit 90; fi\nif _existing DUMMY; then exit 91; fi', { input: "n\n" });
  succeeded(result);
  assert.match(result.stdout, /LIBRARY_LOADED/);
  assert.match(result.stdout, /Accept these destinations and the existing readers/);
  assert.doesNotMatch(result.stdout, /saved-dummy-value/);
  assert.equal(existsSync(marker), false);
  assert.deepEqual(f.ghCalls(), []);
});

test("refusal, an empty answer, partial yes, and EOF leave destinations unconfigured", async (t) => {
  for (const [name, input] of [["no", "n\n"], ["empty answer", "\n"], ["partial yes", "yesterday\n"], ["EOF", ""]]) await t.test(name, (t) => {
    const f = fixture(t);
    const result = f.run('if configure_destinations "$2" example/project; then exit 90; fi\nif write_env DUMMY dummy-value; then exit 91; fi\nif set_secret DUMMY dummy-value; then exit 92; fi', { input });
    succeeded(result);
    assert.equal(existsSync(join(f.project, ".env")), false);
    assert.deepEqual(f.ghCalls(), []);
  });
});

test("invalid repository arguments cannot enable remote writes", async (t) => {
  for (const repository of ["owner", "https://github.com/owner/repo", "host/owner/repo/extra", "owner/repo --other", "owner/.", "owner/.."]) await t.test(repository, (t) => {
    const f = fixture(t);
    const result = f.run('if configure_destinations "$2" "$4"; then exit 90; fi\nif set_secret DUMMY dummy-value; then exit 91; fi', { args: [repository], input: "yes\n" });
    succeeded(result);
    assert.deepEqual(f.ghCalls(), []);
  });
});

test("a missing, unusable, or multiline root cannot fall back to the current checkout", async (t) => {
  const cases = {
    "omitted root": () => null,
    "missing directory": (f) => join(f.root, "missing"),
    "regular file": (f) => { const path = join(f.root, "file"); writeFileSync(path, "untouched\n"); return path; },
    "newline in root": (f) => { const path = join(f.root, "project\n"); mkdirSync(path); return path; },
    "carriage return in root": (f) => { const path = join(f.root, "project\r"); mkdirSync(path); return path; },
  };
  for (const [name, destination] of Object.entries(cases)) await t.test(name, (t) => {
    const f = fixture(t);
    const root = destination(f);
    const configure = root === null ? "configure_destinations" : 'configure_destinations "$4"';
    const result = f.run(`if ${configure}; then exit 90; fi\nif write_env DUMMY dummy-value; then exit 91; fi`, { args: root === null ? [] : [root], input: "yes\n" });
    succeeded(result);
    assert.equal(existsSync(join(f.project, ".env")), false);
    assert.deepEqual(f.ghCalls(), []);
  });
});

test("an omitted repository stays local despite ambient GitHub configuration", (t) => {
  const f = fixture(t);
  const result = f.run('configure_destinations "$2"\nwrite_env DUMMY dummy-value\nset_secret DUMMY_SECRET dummy-secret\nset_var DUMMY_VAR dummy-public\nprintf "%s\\n" "${SKIPPED[@]}"', { input: "y\n" });
  succeeded(result);
  assert.equal(readFileSync(join(f.project, ".env"), "utf8"), "DUMMY='dummy-value'\n");
  assert.match(result.stdout, /DUMMY_SECRET/);
  assert.match(result.stdout, /DUMMY_VAR/);
  assert.deepEqual(f.ghCalls(), []);
});

test("an explicit root selects the intended project when launched from another checkout", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.other, ".env"), "OTHER='untouched'\n");
  const result = f.run('configure_destinations "$2"\nwrite_env DUMMY dummy-value', { input: "yes\n", cwd: f.other });
  succeeded(result);
  assert.equal(readFileSync(join(f.project, ".env"), "utf8"), "DUMMY='dummy-value'\n");
  assert.equal(readFileSync(join(f.other, ".env"), "utf8"), "OTHER='untouched'\n");
  assert.deepEqual(f.ghCalls(), []);
});

test("reconfirmation binds saved defaults and writes to the newly selected project", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.project, ".env"), "DUMMY='first-saved-value'\n");
  writeFileSync(join(f.other, ".env"), "DUMMY='second-saved-value'\n");
  const result = f.run(`configure_destinations "$2"
ask_secret DUMMY "Dummy secret:"
[[ "$DUMMY" == first-saved-value ]]
write_env DUMMY first-updated-value
ENV_FILE=.env
configure_destinations "$3"
ask_secret DUMMY "Dummy secret:"
[[ "$DUMMY" == second-saved-value ]]
write_env DUMMY second-updated-value
finish`, { input: "yes\n\nyes\n\n", cwd: f.other });
  succeeded(result);
  assert.equal(readFileSync(join(f.project, ".env"), "utf8"), "DUMMY='first-updated-value'\n");
  assert.equal(readFileSync(join(f.other, ".env"), "utf8"), "DUMMY='second-updated-value'\n");
  assert.doesNotMatch(result.stdout, /first-saved-value|second-saved-value|first-updated-value|second-updated-value/);
  assert.deepEqual(f.ghCalls(), []);
});

test("a declined reconfirmation revokes the previous project's authorization", (t) => {
  const f = fixture(t);
  const result = f.run(`configure_destinations "$2" example/first
ENV_FILE=.env
if configure_destinations "$3" example/second; then exit 90; fi
ENV_FILE="$2/.env"
if write_env DUMMY dummy-value; then exit 91; fi
if set_secret DUMMY dummy-value; then exit 92; fi`, { input: "yes\nn\n" });
  succeeded(result);
  assert.equal(existsSync(join(f.project, ".env")), false);
  assert.equal(existsSync(join(f.other, ".env")), false);
  assert.deepEqual(f.ghCalls(), []);
});

test("relative roots resolve from the launch directory despite CDPATH and OLDPWD", async (t) => {
  for (const name of ["child", "-"]) await t.test(name, (t) => {
    const f = fixture(t);
    const intended = join(f.other, name);
    const poisoned = join(f.root, "poisoned-cdpath");
    const unintended = join(poisoned, name);
    mkdirSync(intended);
    mkdirSync(unintended, { recursive: true });
    writeFileSync(join(unintended, ".env"), "OTHER='untouched'\n");
    const result = f.run('configure_destinations "$4"\nwrite_env DUMMY dummy-value', { args: [name], input: "yes\n", cwd: f.other, env: { CDPATH: poisoned, OLDPWD: unintended } });
    succeeded(result);
    assert.equal(readFileSync(join(intended, ".env"), "utf8"), "DUMMY='dummy-value'\n");
    assert.equal(readFileSync(join(unintended, ".env"), "utf8"), "OTHER='untouched'\n");
    assert.equal(existsSync(join(f.other, ".env")), false);
    assert.equal(existsSync(join(f.project, ".env")), false);
    assert.deepEqual(f.ghCalls(), []);
  });
});

test("confirmed destinations survive cwd and ambient GitHub changes", async (t) => {
  for (const [repository, normalized] of [["example/project", "github.com/example/project"], ["github.example.com/example/project", "github.example.com/example/project"], ["example/.github", "github.com/example/.github"]]) await t.test(repository, (t) => {
    const f = fixture(t);
    const result = f.run('configure_destinations "$2" "$4"\ncd "$3"\nexport GH_REPO=elsewhere.invalid/wrong/repo GH_HOST=elsewhere.invalid\nwrite_env DUMMY dummy-value\nset_secret DUMMY_SECRET "dummy secret value"\nset_var DUMMY_VAR "dummy public value"', { args: [repository], input: "yes\n" });
    succeeded(result);
    assert.equal(readFileSync(join(f.project, ".env"), "utf8"), "DUMMY='dummy-value'\n");
    assert.equal(existsSync(join(f.other, ".env")), false);
    const calls = f.ghCalls();
    assert.equal(calls.filter(({ args }) => args[0] === "secret").length, 1);
    assert.equal(calls.filter(({ args }) => args[0] === "variable").length, 1);
    for (const { args } of calls) {
      assert.ok(["auth", "secret", "variable"].includes(args[0]), `unexpected gh discovery: ${args}`);
      if (args[0] === "auth") continue;
      const index = args.indexOf("--repo");
      assert.notEqual(index, -1, `missing explicit repository: ${args}`);
      assert.equal(args[index + 1], normalized);
    }
    assert.equal(calls.find(({ args }) => args[0] === "secret").body, "dummy secret value");
    const variable = calls.find(({ args }) => args[0] === "variable").args;
    assert.equal(variable[variable.indexOf("--body") + 1], "dummy public value");
  });
});

test("failed GitHub writes retain the confirmed repository in manual secret instructions", (t) => {
  const f = fixture(t);
  const result = f.run('configure_destinations "$2" example/project\nset_secret DUMMY_SECRET dummy-secret\nprintf "%s\\n" "${SKIPPED[@]}"', { input: "y\n", env: { WIZARD_GH_FAIL: "write" } });
  succeeded(result);
  const retry = result.stdout.split("\n").find((line) => line.includes("gh secret set"));
  assert.ok(retry, "a failed secret write needs a manual retry command");
  assert.match(retry, /DUMMY_SECRET/);
  assert.match(retry, /--repo github\.com\/example\/project/);
  assert.doesNotMatch(retry, /dummy-secret/);
});

test("unsafe or unusable env paths are rejected without changing other files", async (t) => {
  const cases = {
    "relative traversal": (f) => "../outside.env",
    "traversal resolving inside root": (f) => { mkdirSync(join(f.project, "config")); return "config/../.env"; },
    "absolute path outside root": (f) => join(f.other, "sentinel.env"),
    "outside parent symlink": (f) => { symlinkSync(f.other, join(f.project, "linked")); return "linked/sentinel.env"; },
    "inside parent symlink": (f) => { mkdirSync(join(f.project, "actual")); symlinkSync("actual", join(f.project, "linked")); return "linked/.env"; },
    "symlink leaf": (f) => { symlinkSync(join(f.other, "sentinel.env"), join(f.project, ".env")); return ".env"; },
    "dangling symlink leaf": (f) => { symlinkSync(join(f.other, "missing.env"), join(f.project, ".env")); return ".env"; },
    "directory leaf": (f) => { mkdirSync(join(f.project, ".env")); return ".env"; },
    "missing parent": () => "missing/.env",
    "newline in filename": () => ".env\n",
    "carriage return in filename": () => ".env\r",
  };
  for (const [name, destination] of Object.entries(cases)) await t.test(name, (t) => {
    const f = fixture(t);
    const sentinel = join(f.other, "sentinel.env");
    writeFileSync(sentinel, "untouched\n");
    const result = f.run('if configure_destinations "$2" example/project; then exit 90; fi\nif write_env DUMMY dummy-value; then exit 91; fi\nif set_var DUMMY dummy-value; then exit 92; fi', { input: "yes\n", env: { ENV_FILE: destination(f) } });
    succeeded(result);
    assert.equal(readFileSync(sentinel, "utf8"), "untouched\n");
    assert.equal(existsSync(join(f.root, "outside.env")), false);
    assert.equal(existsSync(join(f.other, "missing.env")), false);
    assert.deepEqual(f.ghCalls(), []);
  });
});

test("mutating ENV_FILE after confirmation disables every value helper", async (t) => {
  const operations = ['_existing DUMMY', 'ask DUMMY "Dummy value:"', 'ask_secret DUMMY "Dummy secret:"', 'write_env DUMMY dummy-value', 'set_secret DUMMY dummy-value', 'set_var DUMMY dummy-value'];
  for (const operation of operations) await t.test(operation, (t) => {
    const f = fixture(t);
    writeFileSync(join(f.project, ".env"), "DUMMY='saved-dummy-value'\n");
    const result = f.run(`configure_destinations "$2" example/project\nENV_FILE="$3/.env"\nDUMMY=unchanged\nif ${operation}; then exit 90; fi\n[[ "$DUMMY" == unchanged ]]`, { input: "y\ndummy-value\n" });
    succeeded(result);
    assert.doesNotMatch(result.stdout, /saved-dummy-value/);
    assert.equal(readFileSync(join(f.project, ".env"), "utf8"), "DUMMY='saved-dummy-value'\n");
    assert.equal(existsSync(join(f.other, ".env")), false);
    assert.deepEqual(f.ghCalls(), []);
  });
});

test("a symlink introduced after confirmation cannot redirect values", async (t) => {
  const cases = {
    "leaf replaced with symlink": 'rm "$ENV_FILE"\nln -s "$3/sentinel.env" "$ENV_FILE"',
    "parent replaced with symlink": 'mv "$2/config" "$2/original-config"\nln -s "$3" "$2/config"',
  };
  for (const [name, change] of Object.entries(cases)) await t.test(name, (t) => {
    const f = fixture(t);
    mkdirSync(join(f.project, "config"));
    writeFileSync(join(f.project, "config/sentinel.env"), "DUMMY='saved-dummy-value'\n");
    writeFileSync(join(f.other, "sentinel.env"), "DUMMY='outside-dummy-value'\n");
    const result = f.run(`configure_destinations "$2" example/project\n${change}\nif _existing DUMMY; then exit 90; fi\nif write_env DUMMY dummy-value; then exit 91; fi\nif set_secret DUMMY dummy-value; then exit 92; fi`, { input: "yes\n", env: { ENV_FILE: "config/sentinel.env" } });
    succeeded(result);
    assert.doesNotMatch(result.stdout, /outside-dummy-value|saved-dummy-value/);
    assert.equal(readFileSync(join(f.other, "sentinel.env"), "utf8"), "DUMMY='outside-dummy-value'\n");
    assert.deepEqual(f.ghCalls(), []);
  });
});

test("absolute env paths inside the confirmed root retain quoting, defaults, and idempotent upserts", (t) => {
  const f = fixture(t);
  const envFile = join(f.project, "saved settings.env");
  writeFileSync(envFile, "# keep this comment\nOTHER='kept'\nDUMMY='old'\nDUMMY='duplicate'\n");
  chmodSync(envFile, 0o644);
  const value = "dummy 'quoted' \\ value $HOME `literal`";
  const result = f.run('configure_destinations "$2"\nwrite_env DUMMY "$4"\nwrite_env DUMMY_SECRET "$4"\n[[ "$(_existing DUMMY)" == "$4" ]]\nask DUMMY "Dummy value:"\nask_secret DUMMY_SECRET "Dummy secret:"\n[[ "$DUMMY" == "$4" && "$DUMMY_SECRET" == "$4" ]]\nwrite_env DUMMY "$DUMMY"', { args: [value], input: "yes\n\n\n", env: { ENV_FILE: envFile } });
  succeeded(result);
  const contents = readFileSync(envFile, "utf8");
  assert.ok(contents.startsWith("# keep this comment\nOTHER='kept'\n"));
  assert.equal(contents.split("\n").filter((line) => line.startsWith("DUMMY=")).length, 1);
  assert.equal(contents.split("\n").filter((line) => line.startsWith("DUMMY_SECRET=")).length, 1);
  assert.ok(contents.includes(`DUMMY='${value.replaceAll("'", "'\\''")}'\n`));
  assert.equal(lstatSync(envFile).mode & 0o777, 0o644);
  assert.deepEqual(f.ghCalls(), []);
});

test("env updates support a valid basename near the filesystem length limit", (t) => {
  const f = fixture(t);
  const basename = `${"x".repeat(246)}.env`;
  const envFile = join(f.project, basename);
  writeFileSync(envFile, "OTHER='kept'\nDUMMY='old'\n");
  chmodSync(envFile, 0o644);
  const result = f.run('configure_destinations "$2"\nwrite_env DUMMY dummy-value', { input: "yes\n", env: { ENV_FILE: basename } });
  succeeded(result);
  assert.equal(readFileSync(envFile, "utf8"), "OTHER='kept'\nDUMMY='dummy-value'\n");
  assert.equal(lstatSync(envFile).mode & 0o777, 0o644);
  assert.deepEqual(f.ghCalls(), []);
});

test("env writes replace the bound file without changing a hardlinked alias", (t) => {
  const f = fixture(t);
  const envFile = join(f.project, ".env");
  const alias = join(f.other, "sentinel.env");
  writeFileSync(alias, "OTHER='original'\n");
  chmodSync(alias, 0o644);
  linkSync(alias, envFile);
  const result = f.run('configure_destinations "$2"\nwrite_env DUMMY dummy-value', { input: "y\n" });
  succeeded(result);
  assert.equal(readFileSync(alias, "utf8"), "OTHER='original'\n");
  assert.equal(lstatSync(alias).mode & 0o777, 0o644);
  assert.equal(readFileSync(envFile, "utf8"), "OTHER='original'\nDUMMY='dummy-value'\n");
  assert.equal(lstatSync(envFile).mode & 0o777, 0o644);
  assert.notEqual(lstatSync(envFile).ino, lstatSync(alias).ino);
});

test("the final summary retains actual destinations across reconfirmation", async (t) => {
  for (const writeSecond of [false, true]) await t.test(writeSecond ? "both destinations receive writes" : "the second destination receives no writes", (t) => {
    const f = fixture(t);
    const second = join(f.project, "next.env");
    const result = f.run(`configure_destinations "$2" example/first
write_env DUMMY first-dummy-value
set_secret DUMMY first-dummy-secret
ENV_FILE="$2/next.env"
configure_destinations "$2" example/second
${writeSecond ? "write_env DUMMY second-dummy-value\nset_secret DUMMY second-dummy-secret" : ""}
finish`, { input: "yes\nyes\n" });
    succeeded(result);
    const summary = result.stdout.slice(result.stdout.indexOf("✓ Setup complete")).replaceAll("\\ ", " ");
    assert.match(summary, new RegExp(`wrote ${writeSecond ? 2 : 1} value\\(s\\):`));
    assert.match(summary, new RegExp(`set ${writeSecond ? 2 : 1} GitHub secret\\(s\\):`));
    assert.ok(summary.includes(`DUMMY → ${join(f.project, ".env")}`));
    assert.ok(summary.includes("DUMMY → github.com/example/first"));
    assert.equal(summary.includes(`DUMMY → ${second}`), writeSecond);
    assert.equal(summary.includes("DUMMY → github.com/example/second"), writeSecond);
    assert.doesNotMatch(summary, /first-dummy-value|first-dummy-secret|second-dummy-value|second-dummy-secret/);
    assert.equal(readFileSync(join(f.project, ".env"), "utf8"), "DUMMY='first-dummy-value'\n");
    assert.equal(existsSync(second), writeSecond);
    if (writeSecond) assert.equal(readFileSync(second, "utf8"), "DUMMY='second-dummy-value'\n");
    assert.deepEqual(f.ghCalls().filter(({ args }) => args[0] === "secret"), [
      { args: ["secret", "set", "DUMMY", "--repo", "github.com/example/first"], body: "first-dummy-secret" },
      ...(writeSecond ? [{ args: ["secret", "set", "DUMMY", "--repo", "github.com/example/second"], body: "second-dummy-secret" }] : []),
    ]);
  });
});
