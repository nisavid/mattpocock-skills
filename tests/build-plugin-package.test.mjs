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
  put(".agents/plugins/marketplace.json", JSON.stringify({plugins:[{name:"mattpocock-skills",source:{source:"local",path:"./"}}]}));
  put(".claude-plugin/marketplace.json", JSON.stringify({plugins:[{name:"mattpocock-skills",source:"./"}]}));
  put("skills/engineering/tdd/SKILL.md", "---\nname: tdd\n---\n# TDD\n");
  put("skills/engineering/tdd/agents/openai.yaml", "policy:\n  allow_implicit_invocation: false\n");
  put("skills/engineering/tdd/references/binary.bin", Buffer.from([0, 255, 13, 10]));
  put("skills/productivity/handoff/SKILL.md", "---\nname: handoff\ndisable-model-invocation: true\n---\n# Handoff\n");
  put("skills/productivity/handoff/agents/openai.yaml", "policy:\n  allow_implicit_invocation: false\n");
  put("skills/misc/secret-draft/SKILL.md", "Excluded draft\n");
  mkdirSync(join(root, "scripts"), { recursive: true });
  copyFileSync(join(repo, "scripts/build-plugin-package.mjs"), join(root, "scripts/build-plugin-package.mjs"));
  const run = (...args) => spawnSync(process.execPath, [join(root, "scripts/build-plugin-package.mjs"), ...args], { encoding: "utf8" });
  return { root, put, run, manifest };
}

test("build selects original promoted directories from the repository root without copying or changing source bytes", (t) => {
  const f = fixture(t);
  const sources = snapshot(join(f.root, "skills"));
  const claude = readFileSync(join(f.root, ".claude-plugin/plugin.json"));
  const license = readFileSync(join(f.root, "LICENSE"));
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(snapshot(join(f.root, "skills")), sources);
  assert.deepEqual(readFileSync(join(f.root, ".claude-plugin/plugin.json")), claude);
  assert.deepEqual(readFileSync(join(f.root, "LICENSE")), license);
  assert.throws(() => lstatSync(join(f.root, "plugins/mattpocock-skills")), { code: "ENOENT" });
  const codex = JSON.parse(readFileSync(join(f.root, ".codex-plugin/plugin.json")));
  assert.deepEqual(codex.skills, f.manifest.skills);
  assert.equal(codex.name, "mattpocock-skills");
  assert.equal(codex.version, "1.3.1");
  assert.equal(codex.interface.displayName, "Skills for Real Engineers");
  assert.equal(codex.interface.developerName, "Matt Pocock");
  assert.equal(readFileSync(join(f.root, "skills/misc/secret-draft/SKILL.md"), "utf8"), "Excluded draft\n");
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

test("check detects native manifest drift without writing and rebuild repairs only that manifest", (t) => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  const sources = snapshot(join(f.root, "skills"));
  const current = snapshot(f.root);
  assert.equal(f.run("--check").status, 0);
  assert.deepEqual(snapshot(f.root), current);
  f.put(".codex-plugin/plugin.json", '{"skills":"./skills"}');
  const changed = snapshot(f.root);
  assert.notEqual(f.run("--check").status, 0);
  assert.deepEqual(snapshot(f.root), changed);
  assert.equal(f.run().status, 0);
  assert.deepEqual(snapshot(join(f.root, "skills")), sources);
  assert.equal(f.run("--check").status, 0);
});

test("invalid promoted inventory is rejected before changing the native manifest", async (t) => {
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
    change(f);
    f.put(".claude-plugin/plugin.json", JSON.stringify(f.manifest));
    const before = snapshot(f.root);
    for (const args of [[], ["--check"]]) {
      assert.notEqual(f.run(...args).status, 0);
      assert.deepEqual(snapshot(f.root), before);
    }
  });
});

test("check reports an absent native manifest without creating it and rejects unknown options", (t) => {
  const f = fixture(t);
  const before = snapshot(f.root);
  assert.notEqual(f.run("--check").status, 0);
  assert.deepEqual(snapshot(f.root), before);
  assert.notEqual(f.run("--chekc").status, 0);
  assert.deepEqual(snapshot(f.root), before);
});

test("build preserves executable source bits and unrelated repository contents", (t) => {
  const f = fixture(t);
  f.put("plugins/other-package/sentinel", "unrelated package\n");
  f.put("skills/engineering/tdd/scripts/check.sh", "#!/bin/sh\nexit 0\n");
  chmodSync(join(f.root, "skills/engineering/tdd/scripts/check.sh"), 0o755);
  const source = snapshot(join(f.root, "skills"));
  const unrelated = snapshot(join(f.root, "plugins"));
  assert.equal(f.run().status, 0);
  assert.deepEqual(snapshot(join(f.root, "skills")), source);
  assert.deepEqual(snapshot(join(f.root, "plugins")), unrelated);
  assert.equal(f.run("--check").status, 0);
});

test("catalogs must resolve the native repository root and retain the plugin identity", async (t) => {
  const cases = {
    "Claude copied-tree routing": (f) => f.put(".claude-plugin/marketplace.json", JSON.stringify({plugins:[{name:"mattpocock-skills",source:"./plugins/mattpocock-skills"}]})),
    "Codex copied-tree routing": (f) => f.put(".agents/plugins/marketplace.json", JSON.stringify({plugins:[{name:"mattpocock-skills",source:{source:"local",path:"./plugins/mattpocock-skills"}}]})),
    "changed plugin identity": (f) => f.put(".agents/plugins/marketplace.json", JSON.stringify({plugins:[{name:"renamed",source:{source:"local",path:"./"}}]})),
    "portable discovery override": (f) => f.put("plugin.json", JSON.stringify({name:"mattpocock-skills"})),
  };
  for (const [name, change] of Object.entries(cases)) await t.test(name, (t) => {
    const f = fixture(t);
    assert.equal(f.run().status, 0);
    change(f);
    const before = snapshot(f.root);
    assert.notEqual(f.run("--check").status, 0);
    assert.deepEqual(snapshot(f.root), before);
  });
});

test("recursive native roots reject hidden extra skills and symlinked source or output paths", async (t) => {
  const cases = {
    "nested skill": (f) => f.put("skills/engineering/tdd/references/hidden/SKILL.md", "extra skill\n"),
    "source reference symlink": (f) => { rmSync(join(f.root, "skills/engineering/tdd/references/binary.bin")); symlinkSync(join(f.root, "LICENSE"), join(f.root, "skills/engineering/tdd/references/binary.bin")); },
    "source bucket symlink": (f) => { rmSync(join(f.root, "skills/productivity"), {recursive:true}); symlinkSync(join(f.root, "skills/misc"), join(f.root, "skills/productivity")); },
    "native manifest symlink": (f) => { rmSync(join(f.root, ".codex-plugin/plugin.json")); symlinkSync(join(f.root, "LICENSE"), join(f.root, ".codex-plugin/plugin.json")); },
  };
  for (const [name, change] of Object.entries(cases)) await t.test(name, (t) => {
    const f = fixture(t);
    assert.equal(f.run().status, 0);
    change(f);
    const before = snapshot(f.root);
    for (const args of [[], ["--check"]]) {
      assert.notEqual(f.run(...args).status, 0);
      assert.deepEqual(snapshot(f.root), before);
    }
  });
});
