import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const codex = process.env.CODEX_BIN || "codex";

async function readPlugin(root) {
  const home = mkdtempSync(join(tmpdir(), "codex-plugin-home-"));
  const env = { PATH: process.env.PATH, HOME: home, CODEX_HOME: join(home, ".codex"), XDG_CONFIG_HOME: join(home, "config"), XDG_CACHE_HOME: join(home, "cache"), XDG_STATE_HOME: join(home, "state"), TMPDIR: join(home, "tmp") };
  for (const key of ["HOME", "CODEX_HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME", "TMPDIR"]) mkdirSync(env[key], { recursive: true });
  const child = spawn(codex, ["app-server", "--stdio"], { cwd: home, env, stdio: ["pipe", "pipe", "pipe"] });
  const lines = createInterface({ input: child.stdout });
  const pending = new Map();
  let stderr = "";
  let failure;
  child.stderr.on("data", (bytes) => { stderr = (stderr + bytes).slice(-4096); });
  function fail(error) {
    failure = error;
    for (const request of pending.values()) request.reject(error);
  }
  child.on("error", fail);
  child.stdin.on("error", fail);
  child.on("exit", (code, signal) => fail(new Error(`Codex exited (${code ?? signal}): ${stderr}`)));
  lines.on("line", (line) => {
    try {
      const message = JSON.parse(line);
      if (pending.has(message.id)) pending.get(message.id).resolve(message);
    } catch (error) { fail(error); }
  });
  async function request(id, method, params) {
    if (failure) throw failure;
    let timer;
    try {
      const response = await new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        timer = setTimeout(() => reject(new Error(`Codex ${method} timed out: ${stderr}`)), 30_000);
        child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
      });
      assert.equal(response.error, undefined, `Codex ${method}: ${JSON.stringify(response.error)}`);
      return response.result;
    } finally { clearTimeout(timer); pending.delete(id); }
  }
  try {
    const initialized = await request(1, "initialize", { clientInfo: { name: "plugin-compatibility-test", version: "1.0.0" }, capabilities: { experimentalApi: true } });
    child.stdin.write(JSON.stringify({ method: "initialized", params: {} }) + "\n");
    const result = await request(2, "plugin/read", { marketplacePath: join(root, ".agents/plugins/marketplace.json"), pluginName: "mattpocock-skills" });
    return { plugin: result.plugin, userAgent: initialized.userAgent };
  } finally {
    lines.close();
    child.kill("SIGTERM");
    if (child.pid && child.exitCode === null && child.signalCode === null) await new Promise((resolve) => {
      const timer = setTimeout(() => child.kill("SIGKILL"), 2000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
    });
    rmSync(home, { recursive: true, force: true });
  }
}

function assertPromotedSkills(plugin, root) {
  const source = JSON.parse(readFileSync(join(root, ".claude-plugin/plugin.json"), "utf8"));
  const expected = source.skills.map((path) => ({ name: `${source.name}:${path.split("/").at(-1)}`, path: resolve(root, path, "SKILL.md") }));
  const order = (a, b) => a.name.localeCompare(b.name);
  assert.deepEqual(plugin.skills.map(({ name, path }) => ({ name, path })).sort(order), expected.sort(order));
  assert.equal(plugin.summary.interface.longDescription, null);
}

test("Codex discovers exactly the promoted original bucketed skills with no long description", { timeout: 65_000 }, async (t) => {
  const { plugin, userAgent } = await readPlugin(repo);
  t.diagnostic(`Native loader: ${userAgent}`);
  assertPromotedSkills(plugin, repo);
});

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "codex-plugin-fixture-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  function put(path, bytes) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), bytes);
  }
  put(".agents/plugins/marketplace.json", JSON.stringify({ name: "fixture", plugins: [{ name: "mattpocock-skills", source: { source: "local", path: "./" } }] }));
  for (const [bucket, name] of [["engineering", "alpha"], ["productivity", "beta"], ["misc", "unpromoted"]]) {
    put(`skills/${bucket}/${name}/SKILL.md`, `---\nname: ${name}\ndescription: A compatibility control.\n---\n# ${name}\n`);
  }
  const manifest = { name: "mattpocock-skills", skills: ["./skills/engineering", "./skills/productivity"], interface: { displayName: "Compatibility fixture", shortDescription: "Native discovery controls" } };
  const save = () => put(".codex-plugin/plugin.json", JSON.stringify(manifest));
  save();
  return { root, manifest, save, put };
}

function assertFixtureSkills(plugin, root) {
  assert.deepEqual(plugin.skills.map(({ name, path }) => ({ name, path })).sort((a, b) => a.name.localeCompare(b.name)), [
    { name: "mattpocock-skills:alpha", path: join(root, "skills/engineering/alpha/SKILL.md") },
    { name: "mattpocock-skills:beta", path: join(root, "skills/productivity/beta/SKILL.md") },
  ]);
}

test("Codex recursively discovers both selected buckets and omits unselected buckets", { timeout: 65_000 }, async (t) => {
  const f = fixture(t);
  assert.equal(Object.hasOwn(f.manifest.interface, "longDescription"), false);
  const { plugin } = await readPlugin(f.root);
  assertFixtureSkills(plugin, f.root);
  assert.equal(plugin.summary.interface.displayName, "Compatibility fixture");
  assert.equal(plugin.summary.interface.longDescription, null);
});

test("Codex reports a rejected native manifest", { timeout: 65_000 }, async (t) => {
  const f = fixture(t);
  f.put(".codex-plugin/plugin.json", "{invalid JSON");
  await assert.rejects(readPlugin(f.root), /Codex plugin\/read:/);
});

test("the exposure assertion detects a manifest that includes an unpromoted bucket", { timeout: 65_000 }, async (t) => {
  const f = fixture(t);
  f.manifest.skills = ["./skills"];
  f.save();
  const { plugin } = await readPlugin(f.root);
  assert.deepEqual(plugin.skills.map(({ name }) => name).sort(), ["mattpocock-skills:alpha", "mattpocock-skills:beta", "mattpocock-skills:unpromoted"]);
  assert.throws(() => assertFixtureSkills(plugin, f.root), assert.AssertionError);
});

test("the exposure assertion detects a manifest that omits a selected bucket", { timeout: 65_000 }, async (t) => {
  const f = fixture(t);
  f.manifest.skills = ["./skills/engineering"];
  f.save();
  const { plugin } = await readPlugin(f.root);
  assert.deepEqual(plugin.skills.map(({ name }) => name), ["mattpocock-skills:alpha"]);
  assert.throws(() => assertFixtureSkills(plugin, f.root), assert.AssertionError);
});

test("a portable root manifest selects direct children instead of native recursive discovery", { timeout: 65_000 }, async (t) => {
  const f = fixture(t);
  f.put("skills/direct/SKILL.md", "---\nname: direct\ndescription: A direct portable skill.\n---\n# Direct\n");
  f.put("plugin.json", JSON.stringify({ $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", name: "mattpocock.skills" }));
  const { plugin } = await readPlugin(f.root);
  assert.deepEqual(plugin.skills.map(({ path }) => path), [join(f.root, "skills/direct/SKILL.md")]);
  assert.throws(() => assertFixtureSkills(plugin, f.root), assert.AssertionError);
});
