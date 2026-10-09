#!/usr/bin/env node
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = ".codex-plugin/plugin.json";
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

for (const path of [".claude-plugin/plugin.json", ".claude-plugin/marketplace.json", ".agents/plugins/marketplace.json", "package.json", "LICENSE"]) requirePath(path, false);
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
function validateSkillTree(path, root) {
  for (const entry of readdirSync(join(repo, path), { withFileTypes: true })) {
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory()) validateSkillTree(child, root);
    else if (!entry.isFile()) throw new Error(`Unsupported source entry, including symlink: ${child}`);
    else if (entry.name === "SKILL.md" && path !== root) throw new Error(`Nested skill would expand native discovery: ${child}`);
  }
}
for (const path of selected) {
  const root = path.slice(2);
  requirePath(`${root}/SKILL.md`, false);
  requirePath(`${root}/agents/openai.yaml`, false);
  validateSkillTree(root, root);
}
for (const [path, source] of [
  [".claude-plugin/marketplace.json", "claude"],
  [".agents/plugins/marketplace.json", "codex"],
]) {
  const catalog = JSON.parse(readFileSync(join(repo, path)));
  const plugins = catalog.plugins?.filter((plugin) => plugin.name === manifest.name);
  const route = plugins?.[0]?.source;
  if (plugins?.length !== 1 || (source === "claude" ? route !== "./" : route?.source !== "local" || route?.path !== "./")) {
    throw new Error(`Marketplace must select the native repository root for ${manifest.name}: ${path}`);
  }
}
try {
  lstatSync(join(repo, "plugin.json"));
  throw new Error("Root plugin.json would override native discovery. Use the native manifests.");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const expected = Buffer.from(JSON.stringify({
  ...manifest,
  interface: {
    displayName: "Skills for Real Engineers",
    shortDescription: "Skills by Matt Pocock",
    developerName: "Matt Pocock",
    category: "Developer Tools",
    capabilities: ["Interactive"],
  },
}, null, 2) + "\n");
const exists = requirePath(outputPath, false, true);
if (check) {
  if (!exists || !readFileSync(join(repo, outputPath)).equals(expected)) {
    console.error(`Native Codex manifest is missing or stale: ${outputPath}. Run npm run build-plugin-package.`);
    process.exit(1);
  }
  console.log(`Native manifests select ${manifest.skills.length} original promoted skill directories.`);
} else {
  mkdirSync(join(repo, ".codex-plugin"), { recursive: true });
  writeFileSync(join(repo, outputPath), expected);
  console.log(`Updated ${outputPath} for ${manifest.skills.length} original promoted skill directories.`);
}
