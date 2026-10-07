# Build and verify the promoted plugin package

The shared plugin package delivers the promoted engineering and productivity skills to Claude Code and Codex at their original bucket paths. Both fork marketplace catalogs select `plugins/mattpocock-skills`.

## Inputs and ownership

Use this procedure when rebuilding after an authorized source or packaging change, checking generated drift, changing marketplace routing, or preparing a consumer of the packaged skills. Ordinary skill use and unrelated documentation edits do not require a rebuild.

The maintained sources are `skills/engineering/`, `skills/productivity/`, `.claude-plugin/plugin.json`, and `LICENSE`. Preserve upstream skill bytes and invocation settings. The source manifest must list every skill directory in those two buckets exactly once. Every selected directory must have `SKILL.md`, and its entire regular-file tree is copied, including `agents/openai.yaml` and references. Copied files retain their source executable bits; generated files use regular read permissions and owner write permission. Symlinks, duplicate skill names, paths outside those buckets, and version disagreement with `package.json` stop generation.

`scripts/build-plugin-package.mjs` owns the generated tree. It copies the Claude manifest and license byte for byte and derives the native Codex manifest from the same metadata and skill array. The package name and version follow the source manifest. The Codex display name is "Skills for Real Engineers", with Matt Pocock named as its developer. Installation selects this directory, whose physical contents include only promoted skills, the license, and native manifests. The repository root retains the upstream Claude source manifest.

Use Node.js 22 or newer. The build and tests use Node's built-in modules and require no dependency installation.

## Procedure

1. Record the source revision with `git rev-parse HEAD` and inspect `git status --short`. Confirm authorization for the intended source or packaging changes and preserve unrelated work. A downstream consumer loads this procedure at its reviewed revision and verifies that the relevant source and package changes have a clean review before dependent execution. During producer self-use, record the candidate revision and rerun the checks below before review.
2. For a rebuild, run `npm run build-plugin-package`. Generation validates all source inputs and the destination before replacing only `plugins/mattpocock-skills`. Treat files inside that directory as generated. Keep sibling packages and source trees intact. If input validation fails, resolve the source or routing decision first; if a filesystem error interrupts writing, rebuild and verify before using the package.
3. For verification, run `npm test`, `npm run check-plugin-version`, and `npm run check-plugin-package`. Check mode performs no writes and reports missing, extra, or changed files and directories, including executable-bit drift. If only the generated tree has drifted, rebuild and rerun verification. If the inventory, path, or identity is invalid, resolve it in the maintained sources within the task's authority.
4. After manifest or marketplace changes, run `claude plugin validate plugins/mattpocock-skills --strict` and `claude plugin validate .claude-plugin/marketplace.json --strict`. Validate the delivered package and the marketplace separately. The root-level `claude plugin validate . --strict` also inspects repository material such as `CLAUDE.md`, which is outside the delivered package; record any root-only warning separately from package validation.
5. Before publication or dependent use, inspect the generated diff and verify that both `.claude-plugin/marketplace.json` and `.agents/plugins/marketplace.json` point to `./plugins/mattpocock-skills`. Complete the repository's independent review on the final revision, then follow `checkpointing-and-publishing-git-work` for publication. Consumers record that reviewed revision and run check mode on the same inputs before relying on the package.

The version workflow rebuilds after synchronizing the upstream Claude manifest version. The package check in CI rejects stale generated contents.

## Completion evidence

Retain the reviewed source revision, passing command results, the generated diff, and validation of each changed catalog or native manifest. Byte equality, executable-bit preservation, and catalog validation establish package integrity. Harness discovery and invocation settings require separate harness evidence on the delivered candidate; a schema validator's reported contents are not a complete skill inventory. Installation or host configuration changes need their own task authorization.

Capture useful corrections in this maintained procedure and rerun the affected checks and independent review. Publication, consumer acceptance, and changes to upstream skill behavior keep their existing owners.
