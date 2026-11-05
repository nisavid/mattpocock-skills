# Build and verify release archives

Use this procedure when preparing the portable agent-plugins and Claude release ZIPs. For native repository packaging, use [the native package procedure](plugin-packaging.md). Ordinary skill use does not invoke either release build.

## Inputs

Load this procedure and `scripts/build-release-archives.py` from their reviewed procedure revision. Record that revision separately from the pinned source commit: the source commit supplies package data, while the procedure revision supplies the builder and instructions. Preserve the reviewed builder bytes. Its `build(raw, expected_sha256, revision, base, release)` boundary requires Python 3 and PyYAML; record the actual Python, PyYAML, Git, and gzip versions used.

Select a full, lowercase, 40-character Git source commit, its expected source-tar SHA-256, and the incorporated upstream base version `M.m.U`. Verify the upstream release tag and commit independently, then account for every difference between that tagged source and the candidate, including the approved fork changes; ancestry alone does not establish this provenance. The builder cannot establish it from the supplied base alone. Both native source manifests and `package.json` must agree on the allocated full release version, which differs from the upstream base.

Allocate one release version for both archives and all supported surfaces: `M.m.P+from.M.m.U`. For the same major/minor line, set `P` to one more than the greater of the highest previously exposed fork patch in that line and `U`. For a new higher major/minor line with no exposed fork release, use `U + 1`. Check the release and account records for previously exposed versions, retain the evidence, and stop if that inventory or the upstream baseline is uncertain. The builder checks the supplied base and release relationship; it cannot establish the highest previously exposed fork patch. Reuse the allocated version across formats and surfaces; a consumer-specific exception requires evidence that the uniform version cannot work. The release version must already be present in the reviewed source commit and is retained in generated artifacts; it does not assert an independent downstream major/minor compatibility policy.

Before freezing the release source, write the allocated full release version to `package.json`, run `node scripts/sync-plugin-version.mjs` to synchronize the Claude manifest, and run `npm run build-plugin-package` to regenerate the Codex manifest. Verify that all three versions equal the allocation, retain the promoted skill bytes and invocation settings, and run the native package procedure. Commit and independently review the resulting release candidate before using it as the source commit. Do not advance `stable-vanilla-plus` to the candidate until the GitHub release and archive checks are complete; then point it at that same reviewed commit and qualify repository-marketplace installation and updates separately for each selected harness.

Use a gzip-compressed Git tar with root `mattpocock-skills-<full SHA>/` and `tar.umask=0022`. Bind the expected hash to those exact input bytes; a hash alone does not prove their Git origin.

Treat manifests, skills, supporting files, and license text as data. Execute only the reviewed builder and verification tools. Preserve upstream skill bytes and invocation settings.

When changing the builder or its tests, install pytest and PyYAML and run `python3 -m pytest -q tests/release_archive`; a failure blocks use.

## Build

Run the following Bash block from the checkout containing the reviewed procedure and builder. Supply the five environment variables named below. `OUTPUT_DIR` must name a new directory outside the checkout; keep the source commit available in this checkout's Git object database. Set `SOURCE_SHA256` from the retained, independently identified source tar, rather than deriving it inside this invocation. If preparing that tar for the first time, generate it with the same Git archive and gzip command, record its hash and source provenance, and use those fixed bytes for verification.

```bash
set -euo pipefail
: "${SOURCE_COMMIT:?full source commit required}"
: "${SOURCE_SHA256:?expected source tar SHA-256 required}"
: "${BASE_VERSION:?base version required}"
: "${RELEASE_VERSION:?release version required}"
: "${OUTPUT_DIR:?new output directory required}"
test "$(git rev-parse --verify "${SOURCE_COMMIT}^{commit}")" = "$SOURCE_COMMIT"
procedure_revision=$(git rev-parse HEAD)
builder="$PWD/scripts/build-release-archives.py"
git cat-file blob "${procedure_revision}:scripts/build-release-archives.py" | cmp - "$builder"
mkdir -- "$OUTPUT_DIR"
output=$(cd -- "$OUTPUT_DIR" && pwd)
printf '%s\n' "$procedure_revision" > "$output/procedure-revision.txt"
sha256sum -- "$builder" > "$output/builder.sha256"
{
  python3 --version
  python3 -c 'import yaml; print("PyYAML", yaml.__version__)'
  git --version
  gzip --version
} > "$output/tool-versions.txt"
git -c tar.umask=0022 archive --format=tar \
  --prefix="mattpocock-skills-${SOURCE_COMMIT}/" "$SOURCE_COMMIT" \
  | gzip -n > "$output/source.tar.gz"
for run in first second; do
  mkdir -- "$output/$run"
  python3 - "$builder" "$output/source.tar.gz" "$SOURCE_SHA256" \
    "$SOURCE_COMMIT" "$BASE_VERSION" "$RELEASE_VERSION" "$output/$run" <<'PYTHON'
import json
import pathlib
import runpy
import sys

builder, source, expected, revision, base, release, destination = sys.argv[1:]
build = runpy.run_path(builder)["build"]
outputs, report = build(pathlib.Path(source).read_bytes(), expected, revision, base, release)
root = pathlib.Path(destination)
for name, data in outputs.items():
    with (root / name).open("xb") as stream:
        stream.write(data)
with (root / "report.json").open("x", encoding="utf-8", newline="\n") as stream:
    json.dump(report, stream, ensure_ascii=False, sort_keys=True, indent=2)
    stream.write("\n")
PYTHON
 done
for format in agent-plugins claude; do
  name="skills-for-real-engineers-${RELEASE_VERSION}-${format}.zip"
  cmp -- "$output/first/$name" "$output/second/$name"
done
cmp -- "$output/first/report.json" "$output/second/report.json"
(cd -- "$output" && sha256sum source.tar.gz first/*.zip > SHA256SUMS)
(cd -- "$output" && sha256sum --check SHA256SUMS)
```

Each run starts a separate Python process from the same immutable input. Require both to succeed and their ZIPs and reports to match byte for byte. The builder's own repeated encoding check is additional evidence, not the second build. A hash mismatch or any validation failure stops this candidate; resolve the input or projection issue before rebuilding.

## Verify against Git

Compare the ZIPs directly with the source commit, independently of the builder's report and tar reader. Read the commit's manifests and blobs with Git object commands, such as `git ls-tree -r -z` and `git cat-file blob`. Derive the selected inventory from that tree and require agreement between the Claude manifest, the native manifest, and every promoted skill root. Account for every selected file, including supporting files, and for `LICENSE`. Reject selected links, special entries, nested skills, duplicate destination names, and unexpected archive members. Git archive attributes can omit or substitute content; a successful tar build does not replace this comparison.

Require ZIP member bytes and Unix modes to match the Git blobs: Git mode `100644` maps to `0644`, and `100755` maps to `0755`. Both ZIPs contain the source `LICENSE` bytes and mode. Every selected `SKILL.md` and `agents/openai.yaml` remains byte-identical, with paired user-invocation controls. Check the following complete layouts:

- `skills-for-real-engineers-<release>-agent-plugins.zip`: root `plugin.json`, `LICENSE`, and `RELEASE.json`; each complete selected tree maps from `skills/<bucket>/<name>/` to `skills/<name>/`.
- `skills-for-real-engineers-<release>-claude.zip`: `.claude-plugin/plugin.json`, `LICENSE`, and `RELEASE.json`; each complete selected tree retains `skills/<bucket>/<name>/`.

Generated manifest and provenance files have mode `0644`. Review the generated manifests against their source JSON: the builder's fixed fork repository URL is a deliberate transform; the release version must agree with the source; the portable manifest omits Claude's `skills`, adds the schema URL, and copies the native `interface` into `extensions.com.openai.interface`. The Claude manifest copies `displayName` from the native interface. Other Claude fields remain as the builder defines. Verify `RELEASE.json` identifies the source commit, source hash, fork source version, upstream base and release versions, format, manifest transform, and complete selected-file mapping with hashes and modes. Verify its license hash. These records describe the transformation; the direct Git comparison establishes content preservation.

## Evidence and gates

Retain the source commit and tar hash, reviewed procedure revision and builder hash, dependency versions, both independent build results, direct Git comparison, reports, and verified checksums. The link scanner checks only its supported inline Markdown links outside recognized fenced blocks, and only relative file or directory existence. It does not establish complete Markdown-link coverage, fragment validity, external URL reachability, or general security. Review relocation-sensitive links beyond that coverage when the selected inputs need it. Package checks establish neither license clearance beyond preserving the source license nor harness behavior.

Before publication, complete the native procedure's applicable source checks and the repository's independent review on the final procedure and candidate inputs. Record review evidence for the release artifacts and rerun affected checks whenever inputs, builder bytes, or relevant dependencies change. Before claiming discovery or qualifying an installation, exercise discovery for the selected ZIP through its intended harness route: compare observed names with the promoted inventory, confirm non-promoted names are absent, and record harness versions and observed invocation controls. Source metadata alone does not establish runtime enforcement. Unavailable or failed required review or direct verification blocks the affected release. Unavailable or failed discovery blocks the corresponding consumer qualification.

Follow the standing Git publication workflow for authorized repository changes. Release upload or publication, final installation, host configuration changes, and official-directory submission each retain their own authorization and acceptance requirements. Archive construction and discovery do not complete those actions. Consumers load the reviewed procedure revision and verify its required evidence before dependent use; useful corrections return to this maintained procedure and its builder.
