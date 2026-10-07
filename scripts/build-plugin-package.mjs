#!/usr/bin/env node
import { chmodSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(repo, "plugins/mattpocock-skills");
const check = process.argv.includes("--check");
if (process.argv.slice(2).some((arg) => arg !== "--check") || process.argv.slice(2).length > 1) throw new Error("Usage: node scripts/build-plugin-package.mjs [--check]");

function requirePath(path, directory, optional = false) {
  const parts = path.split("/");
  for (let index = 0; index < parts.length; index++) {
    const current = parts.slice(0, index + 1).join("/");
    let stat;
    try { stat = lstatSync(join(repo, current)); }
    catch (error) {
      if (optional && error.code === "ENOENT") return false;
      throw error;
    }
    const wantDirectory = index < parts.length - 1 || directory;
    if (wantDirectory ? !stat.isDirectory() : !stat.isFile()) throw new Error(`Expected a regular ${wantDirectory ? "directory" : "file"}, without symlinks: ${current}`);
  }
  return true;
}

for (const path of [".claude-plugin/plugin.json", "package.json", "LICENSE"]) requirePath(path, false);
for (const bucket of ["engineering", "productivity"]) requirePath(`skills/${bucket}`, true);
const manifestBytes = readFileSync(join(repo, ".claude-plugin/plugin.json"));
const manifest = JSON.parse(manifestBytes);
const { version } = JSON.parse(readFileSync(join(repo, "package.json")));
if (manifest.name !== "mattpocock-skills" || manifest.version !== version) throw new Error("Source plugin identity or version does not match package.json.");
if (!Array.isArray(manifest.skills) || !manifest.skills.length) throw new Error("Source manifest must list promoted skills.");
const selected = new Set();
const names = new Set();
for (const path of manifest.skills) {
  if (typeof path !== "string" || !/^\.\/skills\/(engineering|productivity)\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(path)) throw new Error(`Invalid promoted skill path: ${path}`);
  const name = path.split("/").at(-1);
  if (selected.has(path) || names.has(name)) throw new Error(`Duplicate promoted skill: ${path}`);
  selected.add(path);
  names.add(name);
}
const promoted = new Set();
for (const bucket of ["engineering", "productivity"]) {
  for (const entry of readdirSync(join(repo, "skills", bucket), { withFileTypes: true })) {
    if (entry.isDirectory()) promoted.add(`./skills/${bucket}/${entry.name}`);
    else if (entry.name !== "README.md" || !entry.isFile()) throw new Error(`Unexpected promoted bucket entry: skills/${bucket}/${entry.name}`);
  }
}
if (promoted.size !== selected.size || [...promoted].some((path) => !selected.has(path))) throw new Error("Source manifest and promoted buckets disagree.");
for (const path of selected) requirePath(`${path.slice(2)}/SKILL.md`, false);
const files = new Map([
  ["LICENSE", readFileSync(join(repo, "LICENSE"))],
  [".claude-plugin/plugin.json", manifestBytes],
  [".codex-plugin/plugin.json", Buffer.from(JSON.stringify({
    ...manifest,
    interface: {
      displayName: "Skills for Real Engineers",
      shortDescription: "Skills by Matt Pocock",
      developerName: "Matt Pocock",
      category: "Developer Tools",
      capabilities: ["Interactive"],
    },
  }, null, 2) + "\n")],
]);
const directories = new Set([".claude-plugin", ".codex-plugin", "skills"]);

function collect(path) {
  directories.add(path);
  for (const entry of readdirSync(join(repo, path), { withFileTypes: true })) {
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory()) collect(child);
    else if (entry.isFile()) files.set(child, readFileSync(join(repo, child)));
    else throw new Error(`Unsupported source entry, including symlink: ${child}`);
  }
}

for (const path of manifest.skills) {
  directories.add(dirname(path.slice(2)));
  collect(path.slice(2));
}
const executableBits = new Map([...files.keys()].map((path) => [
  path,
  path === ".codex-plugin/plugin.json" ? 0 : lstatSync(join(repo, path)).mode & 0o111,
]));
const actual = new Map();
const actualExecutableBits = new Map();
const exists = requirePath("plugins/mattpocock-skills", true, true);
if (exists) {
  function inspect(path = "") {
    for (const entry of readdirSync(join(output, path), { withFileTypes: true })) {
      const child = path ? `${path}/${entry.name}` : entry.name;
      if (!entry.isDirectory() && !entry.isFile()) throw new Error(`Unsupported generated entry, including symlink: ${child}`);
      actual.set(child, entry.isDirectory() ? null : readFileSync(join(output, child)));
      if (entry.isFile()) actualExecutableBits.set(child, lstatSync(join(output, child)).mode & 0o111);
      if (entry.isDirectory()) inspect(child);
    }
  }
  inspect();
}
if (check) {
  const expected = new Map([...directories].map((path) => [path, null]).concat([...files]));
  const drift = [];
  for (const [path, bytes] of expected) {
    if (!actual.has(path)) drift.push(`missing: ${path}`);
    else if (bytes === null ? actual.get(path) !== null : !Buffer.isBuffer(actual.get(path)) || !bytes.equals(actual.get(path))) drift.push(`changed: ${path}`);
    else if (bytes !== null && executableBits.get(path) !== actualExecutableBits.get(path)) drift.push(`executable bits changed: ${path}`);
  }
  for (const path of actual.keys()) if (!expected.has(path)) drift.push(`extra: ${path}`);
  if (drift.length) {
    console.error(drift.sort().join("\n"));
    process.exit(1);
  }
  console.log(`Package matches ${manifest.skills.length} promoted skills.`);
} else {
  rmSync(output, { recursive: true, force: true });
  for (const path of [...directories].sort()) mkdirSync(join(output, path), { recursive: true });
  for (const path of [...files.keys()].sort()) {
    writeFileSync(join(output, path), files.get(path));
    chmodSync(join(output, path), 0o644 | executableBits.get(path));
  }
  console.log(`Built ${manifest.skills.length} promoted skills in plugins/mattpocock-skills.`);
}
