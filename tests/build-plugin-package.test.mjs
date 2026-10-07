import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, readlinkSync, lstatSync, rmSync, writeFileSync, copyFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "plugin-package-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, bytes) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), bytes);
  };
  const manifest = {
    name: "mattpocock-skills", version: "1.3.1", author: { name: "Matt Pocock" },
    license: "MIT", skills: ["./skills/engineering/tdd", "./skills/productivity/handoff"],
  };
  put("package.json", JSON.stringify({ version: "1.3.1" }));
  put(".claude-plugin/plugin.json", JSON.stringify(manifest, null, 2) + "\n");
  put("LICENSE", "MIT attribution fixture\n");
  put("skills/engineering/tdd/SKILL.md", "---\nname: tdd\n---\n# TDD\n");
  put("skills/engineering/tdd/agents/openai.yaml", "policy:\n  allow_implicit_invocation: false\n");
  put("skills/engineering/tdd/references/binary.bin", Buffer.from([0, 255, 13, 10]));
  put("skills/productivity/handoff/SKILL.md", "---\nname: handoff\ndisable-model-invocation: true\n---\n# Handoff\n");
  put("skills/misc/secret-draft/SKILL.md", "Excluded draft\n");
  mkdirSync(join(root, "scripts"), { recursive: true });
  copyFileSync(join(repo, "scripts/build-plugin-package.mjs"), join(root, "scripts/build-plugin-package.mjs"));
  const run = (...args) => spawnSync(process.execPath, [join(root, "scripts/build-plugin-package.mjs"), ...args], { encoding: "utf8" });
  return { root, put, run, manifest, output: join(root, "plugins/mattpocock-skills") };
}

test("build delivers promoted skills at their original paths with unchanged bytes and native manifests", (t) => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  for (const path of ["LICENSE", ".claude-plugin/plugin.json", "skills/engineering/tdd/SKILL.md", "skills/engineering/tdd/agents/openai.yaml", "skills/engineering/tdd/references/binary.bin", "skills/productivity/handoff/SKILL.md"]) {
    assert.deepEqual(readFileSync(join(f.output, path)), readFileSync(join(f.root, path)), path);
  }
  assert.throws(() => readFileSync(join(f.output, "skills/misc/secret-draft/SKILL.md")), { code: "ENOENT" });
  const codex = JSON.parse(readFileSync(join(f.output, ".codex-plugin/plugin.json")));
  assert.deepEqual(codex.skills, f.manifest.skills);
  assert.equal(codex.name, "mattpocock-skills");
  assert.equal(codex.version, "1.3.1");
  assert.equal(codex.interface.displayName, "Skills for Real Engineers");
  assert.equal(codex.interface.developerName, "Matt Pocock");
});

function snapshot(root) {
  const entries = {};
  function visit(path) {
    const stat = lstatSync(join(root, path));
    entries[path] = { mtime: stat.mtimeMs, mode: stat.mode, bytes: stat.isFile() ? readFileSync(join(root, path)) : null, link: stat.isSymbolicLink() ? readlinkSync(join(root, path)) : null };
    if (stat.isDirectory()) for (const name of readdirSync(join(root, path)).sort()) visit(path ? `${path}/${name}` : name);
  }
  visit("");
  return entries;
}

test("check accepts a current package and reports missing, extra, or changed bytes without writing", (t) => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  const current = snapshot(f.output);
  assert.equal(f.run("--check").status, 0);
  assert.deepEqual(snapshot(f.output), current);
  for (const drift of ["missing", "extra", "changed", "empty-directory", "source-changed"]) {
    assert.equal(f.run().status, 0);
    if (drift === "missing") rmSync(join(f.output, "LICENSE"));
    if (drift === "extra") writeFileSync(join(f.output, "unpromoted.md"), "unexpected\n");
    if (drift === "changed") writeFileSync(join(f.output, "skills/engineering/tdd/agents/openai.yaml"), "policy changed\n");
    if (drift === "empty-directory") mkdirSync(join(f.output, "skills/misc"));
    if (drift === "source-changed") f.put("skills/productivity/handoff/SKILL.md", "new upstream source\n");
    const before = snapshot(f.output);
    assert.notEqual(f.run("--check").status, 0, drift);
    assert.deepEqual(snapshot(f.output), before, drift);
  }
});

test("symlinks in inputs or the generated destination are rejected without touching their targets", async (t) => {
  for (const path of ["LICENSE", ".claude-plugin", "skills", "skills/engineering/tdd/references/binary.bin", "plugins", "plugins/mattpocock-skills", "plugins/mattpocock-skills/LICENSE"]) await t.test(path, (t) => {
    const f = fixture(t);
    assert.equal(f.run().status, 0);
    f.put("outside/sentinel", "preserve external bytes\n");
    const isDir = lstatSync(join(f.root, path)).isDirectory();
    rmSync(join(f.root, path), { recursive: true, force: true });
    symlinkSync(join(f.root, isDir ? "outside" : "outside/sentinel"), join(f.root, path));
    const before = snapshot(f.root);
    for (const args of [[], ["--check"]]) {
      assert.notEqual(f.run(...args).status, 0);
      assert.deepEqual(snapshot(f.root), before);
    }
  });
});

test("invalid promoted inventory is rejected before replacing an existing package", async (t) => {
  const cases = {
    "omitted promoted skill": (f) => f.manifest.skills.pop(),
    "unlisted promoted skill": (f) => f.put("skills/engineering/new-skill/SKILL.md", "new\n"),
    "duplicate path": (f) => f.manifest.skills.push(f.manifest.skills[0]),
    "non-promoted path": (f) => f.manifest.skills.push("./skills/misc/secret-draft"),
    "path escape": (f) => f.manifest.skills.push("./skills/engineering/../../outside"),
    "missing skill entry": (f) => rmSync(join(f.root, "skills/engineering/tdd/SKILL.md")),
    "ambiguous skill name": (f) => { f.put("skills/productivity/tdd/SKILL.md", "duplicate\n"); f.manifest.skills.push("./skills/productivity/tdd"); },
    "version mismatch": (f) => f.put("package.json", JSON.stringify({ version: "9.9.9" })),
  };
  for (const [name, change] of Object.entries(cases)) await t.test(name, (t) => {
    const f = fixture(t);
    assert.equal(f.run().status, 0);
    const before = snapshot(f.output);
    change(f);
    f.put(".claude-plugin/plugin.json", JSON.stringify(f.manifest));
    for (const args of [[], ["--check"]]) {
      assert.notEqual(f.run(...args).status, 0);
      assert.deepEqual(snapshot(f.output), before);
    }
  });
});

test("rebuilding repairs generated drift while preserving source and sibling packages", (t) => {
  const f = fixture(t);
  f.put("plugins/other-package/sentinel", "unrelated package\n");
  const source = snapshot(join(f.root, "skills"));
  const sibling = snapshot(join(f.root, "plugins/other-package"));
  assert.equal(f.run().status, 0);
  const expected = Object.fromEntries(Object.entries(snapshot(f.output)).map(([path, entry]) => [path, entry.bytes]));
  writeFileSync(join(f.output, "LICENSE"), "stale\n");
  writeFileSync(join(f.output, "extra.txt"), "remove stale generated file\n");
  assert.equal(f.run().status, 0);
  assert.deepEqual(Object.fromEntries(Object.entries(snapshot(f.output)).map(([path, entry]) => [path, entry.bytes])), expected);
  assert.deepEqual(snapshot(join(f.root, "skills")), source);
  assert.deepEqual(snapshot(join(f.root, "plugins/other-package")), sibling);
  assert.equal(f.run("--check").status, 0);
});

test("check reports an absent package without creating it and rejects unknown options", (t) => {
  const f = fixture(t);
  const before = snapshot(f.root);
  assert.notEqual(f.run("--check").status, 0);
  assert.deepEqual(snapshot(f.root), before);
  assert.notEqual(f.run("--chekc").status, 0);
  assert.deepEqual(snapshot(f.root), before);
});

test("supporting scripts retain executable bits and check detects mode drift without changing files", (t) => {
  const f = fixture(t);
  const path = "skills/engineering/tdd/scripts/check.sh";
  f.put(path, "#!/bin/sh\nprintf 'check\\n'\n");
  chmodSync(join(f.root, path), 0o755);
  assert.equal(f.run().status, 0);
  assert.deepEqual(readFileSync(join(f.output, path)), readFileSync(join(f.root, path)));
  assert.equal(lstatSync(join(f.output, path)).mode & 0o111, 0o111);
  assert.equal(f.run("--check").status, 0);

  chmodSync(join(f.output, path), 0o644);
  const drifted = snapshot(f.output);
  assert.notEqual(f.run("--check").status, 0);
  assert.deepEqual(snapshot(f.output), drifted);
  assert.equal(f.run().status, 0);
  assert.equal(lstatSync(join(f.output, path)).mode & 0o111, 0o111);

  chmodSync(join(f.root, path), 0o644);
  assert.notEqual(f.run("--check").status, 0);
  assert.equal(f.run().status, 0);
  assert.equal(lstatSync(join(f.output, path)).mode & 0o111, 0);
  assert.equal(f.run("--check").status, 0);
});
