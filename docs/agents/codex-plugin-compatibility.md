# Native Codex plugin compatibility

This fork uses `.codex-plugin/plugin.json` and its repository marketplace to select the original promoted skill directories. Read this reference when changing the manifest, marketplace routing, or Codex compatibility checks, and follow [the packaging procedure](plugin-packaging.md) before publication or dependent use.

## Governing route

Codex's native loader accepts a `skills` array, recursively scans declared roots, and permits an interface without `longDescription`. These behaviors are deliberate upstream choices. A recognized portable Agent Plugins manifest at root `plugin.json` selects a different discovery mode, so the package check rejects that file.

The inspected implementation is Codex `0.160.1`, source commit [`d27764b`](https://github.com/openai/codex/tree/d27764b82f7118f674371e6d6e76271d9d606edb). That source inspection establishes neither a supported version range nor compatibility with every executable reporting that version. Record the actual executable version and passing regression result for each producer or consumer check. Test the consumer's Codex before dependent execution, even when the source contract and another version's result are already known.

OpenAI's [submission requirements](https://developers.openai.com/plugins/deploy/submission) and [submission errors](https://developers.openai.com/plugins/deploy/submission-errors) govern additional ingestion and listing checks. The error reference describes a single skills directory, immediate child skills, and a required long description; the submission reference also documents arrays. These differing requirements do not redefine the native implementation. Some shared ingestion checks can apply outside the public submission portal, so native discovery is not evidence of acceptance by those routes.

## Upstream intent

- **Multiple selected roots:** [commit `e12dd73`](https://github.com/openai/codex/commit/e12dd73b7d5a2aa2b8d0933a2053e7eb5eba6fbb) added skills arrays because packages need multiple directories, with tests for explicit roots and deduplication. It deliberately left bundled plugin-creator assets outside its scope. The final implementation selects declared roots instead of adding the default `skills/` root, following [the review decision](https://github.com/openai/codex/pull/28790#discussion_r3432792362). Its commit summary retains an obsolete bullet claiming otherwise; the final code and tests control.
- **Native recursion:** [commit `56b82e6`](https://github.com/openai/codex/commit/56b82e676cc56ccd550362fc5055c76ba3445849) introduced format-specific runtime boundaries while preserving legacy behavior. The [release loader](https://github.com/openai/codex/blob/d27764b82f7118f674371e6d6e76271d9d606edb/codex-rs/core-plugins/src/loader.rs#L1044-L1073) explicitly assigns recursive discovery to native compatibility manifests and direct-child discovery to portable Agent Plugins.
- **Optional long description:** [commit `0243734`](https://github.com/openai/codex/commit/0243734300a9421ac887906d79252deda9b9667a) introduced optional interface metadata. Its [marketplace test](https://github.com/openai/codex/blob/0243734300a9421ac887906d79252deda9b9667a/codex-rs/core/src/plugins/marketplace.rs#L621-L685) omits descriptions and explicitly expects `long_description: None`.

These sources resolve intent; the real Codex regression remains required.

## What the regression must establish

The check must exercise Codex's actual discovery route, not a local imitation of its parser:

- The repository-root package returns exactly the promoted inventory from `.claude-plugin/plugin.json`, with original bucket paths and no non-promoted skills. A fixture with declared roots and an undeclared default-root skill verifies that arrays control selection, rather than being ignored in favor of a fallback scan.
- A native fixture discovers a skill nested beneath a declared bucket root. A portable fixture discovers its direct child and excludes a deeper skill. A bucket name in an explicit per-skill path alone does not prove recursive descent.
- A native manifest containing other interface metadata but omitting `longDescription` loads successfully and returns a null long description.

Retain the reviewed package revision, actual Codex version, command result, and observed inventory with the completion evidence. A changed package or relevant dependency requires a fresh affected check. An unavailable executable or failing contract check leaves Codex compatibility unverified and blocks the dependent publication or use.

Discovery verifies manifest parsing and inventory for the tested executable. Installation, skill invocation policy enforcement, and execution of skill instructions each require separate observations. Preserve those claim boundaries when recording acceptance or handing the package to another consumer.
