# One shared skill package for Codex and Claude

One flat unpacked tree can serve both Codex and Claude marketplaces while preserving the promoted upstream skill bytes. Codex discovered all 27 skills from the temporary shared candidate without installing or enabling it. Claude accepted its manifests; Claude runtime inventory and invocation enforcement remain unverified.

## Scope and evidence

Research date: 2026-10-07. Installed tools observed: Codex 0.160.1 and Claude Code 2.1.292. The immutable skill baseline is `f3fc5632f401156837ee3872f14fe33ccf1024ea`; promoted skill files are unchanged at setup revision `51f8b2626f134148481ec08c3430978da956751b`.

OpenAI source references below use commit `d27764b82f7118f674371e6d6e76271d9d606edb`, resolved from the official `rust-v0.160.1` tag. Official documentation and Context7 retrieval informed this compatibility research. This research establishes package compatibility and discovery evidence. It does not establish production implementation, installation, or behavioral qualification.

## Shared tree

```text
marketplace-root/
  .agents/plugins/marketplace.json
  .claude-plugin/marketplace.json
  plugins/mattpocock-skills/
    plugin.json
    .claude-plugin/plugin.json
    LICENSE
    skills/
      <existing-skill-name>/
        SKILL.md
        agents/openai.yaml
        <all supporting files>
```

Both catalog entries point to `./plugins/mattpocock-skills`. Codex uses portable root `plugin.json`; Claude uses `.claude-plugin/plugin.json`. Keep matching identity, version, author attribution, repository, and license metadata. Set OpenAI `extensions.com.openai.interface.displayName` to **Skills for Real Engineers**. Preserve the existing machine name for skill namespaces. A separate Codex compatibility manifest is unnecessary for the observed target. An archive is an optional delivery container, not a reason for another payload tree.

Portable packages use the Agent Plugins 1.0 schema and discover direct children at `skills/<name>/SKILL.md`. Codex's legacy manifest parser now accepts a string or string array and discovers recursively, superseding ADR 0002's older single-path limitation. A portable root manifest retains fixed skill discovery even when an overlay exists. Both formats can use this flat tree. Codex installation still skips symlinks, so distribute regular copied files.

Sources: [OpenAI packaging](https://developers.openai.com/plugins/build/plugins), [portable discovery mode](https://github.com/openai/codex/blob/d27764b82f7118f674371e6d6e76271d9d606edb/codex-rs/core-plugins/src/loader.rs#L897), [legacy array parsing](https://github.com/openai/codex/blob/d27764b82f7118f674371e6d6e76271d9d606edb/codex-rs/core-plugins/src/manifest.rs#L134), [portable paths and overlay](https://github.com/openai/codex/blob/d27764b82f7118f674371e6d6e76271d9d606edb/codex-rs/core-plugins/src/agent_plugin_manifest.rs#L169), [copy routine](https://github.com/openai/codex/blob/d27764b82f7118f674371e6d6e76271d9d606edb/codex-rs/core-plugins/src/store.rs#L736), [Claude components](https://code.claude.com/docs/en/plugins/components).

Claude's catalog requires `name`, `owner`, and `plugins`; add a description for strict validation. Its local entry uses a path string. Codex's catalog supports a local-source object with the same path, policy, and category. Neither catalog needs a second payload. [Claude marketplace reference](https://code.claude.com/docs/en/plugins/marketplace-reference)

## Observed probes

### Codex discovery

App-server `plugin/read` ran against the temporary candidate's explicit `.agents/plugins/marketplace.json`. Inspection of the JSONL response confirmed the inventory below. Its SHA-256 digest is `ffb16ff75385ad01c3f6184c125912c1ace7bdb2debc4edef7b65c6f96941b1d`.

The response contains exactly 27 namespaced skills, each under the shared candidate's flat `skills/` directory; version `1.3.1`; display name **Skills for Real Engineers**; and plugin summary `installed: false`, `enabled: false`. This establishes local package parsing and skill discovery without candidate installation. It does not establish execution or invocation-policy enforcement.

The inventory contains all promoted names: ask-matt, code-review, codebase-design, diagnosing-bugs, domain-modeling, grill-me, grill-with-docs, grilling, handoff, implement, implement-spec, improve-codebase-architecture, pr, prototype, research, retro, setup-matt-pocock-skills, tdd, teach, to-questionnaire, to-spec, to-tickets, triage, wait-what, wayfinder, wizard, and writing-for-agents.

Per-skill `SkillSummary.enabled` applies host overrides independently of the plugin's installed/enabled status and independently of `allow_implicit_invocation`. Name-based overrides match the full namespaced name exactly, not by basename or glob. A disabled skill can therefore remain present in a successful discovery inventory; its flag does not establish a package failure or an implicit-invocation restriction.

Sources: [exact-name rule matching](https://github.com/openai/codex/blob/d27764b82f7118f674371e6d6e76271d9d606edb/codex-rs/config/src/skills_config.rs#L90), [user/session rule layers](https://github.com/openai/codex/blob/d27764b82f7118f674371e6d6e76271d9d606edb/codex-rs/config/src/skills_config.rs#L149), [SkillSummary conversion](https://github.com/openai/codex/blob/d27764b82f7118f674371e6d6e76271d9d606edb/codex-rs/app-server/src/request_processors/plugins.rs#L68).

### Claude validation

`claude plugin validate --strict --json` ran separately against the candidate plugin directory, Claude marketplace manifest, and flat `skills/` directory. All exited 0 with `success: true`; manifest errors and warnings were empty. All reports also contained `contents: []`. These results establish validator acceptance, not enumeration or execution of the 27 skills.

For later runtime discovery, the installed CLI supports `claude --plugin-dir "$PLUGIN_DIR"` for session-only loading without marketplace installation. This command was not run here. [Claude validation behavior](https://code.claude.com/docs/en/plugins/cli-reference), [session-only local plugins](https://code.claude.com/docs/en/plugins/dependencies)

## Discovery interface

Codex CLI `plugin list` is not an unregistered-repository discovery probe: its implementation passes an empty working-directory list. The empty CLI result therefore did not show package rejection. [CLI implementation](https://github.com/openai/codex/blob/d27764b82f7118f674371e6d6e76271d9d606edb/codex-rs/cli/src/plugin_cmd.rs#L244)

The explicit app-server request is:

```json
{"id":2,"method":"plugin/read","params":{"marketplacePath":"<absolute candidate marketplace manifest path>","pluginName":"mattpocock-skills"}}
```

Use the supported initialization handshake first. `result.plugin.skills` exposes names, descriptions, UI metadata, paths, and enabled flags. The local-source path returns the existing directory without copying or installation. An existing app server can be reached with `codex app-server proxy`; a new stdio server can perform normal startup/cache/log work, so process startup is not claimed to be filesystem-pure. No HOME or CODEX_HOME override is needed.

Sources: [request schema](https://github.com/openai/codex/blob/d27764b82f7118f674371e6d6e76271d9d606edb/codex-rs/app-server-protocol/schema/typescript/v2/PluginReadParams.ts), [skill summary schema](https://github.com/openai/codex/blob/d27764b82f7118f674371e6d6e76271d9d606edb/codex-rs/app-server-protocol/schema/typescript/v2/SkillSummary.ts), [local-source materialization](https://github.com/openai/codex/blob/d27764b82f7118f674371e6d6e76271d9d606edb/codex-rs/core-plugins/src/loader.rs#L1752).

## Preserved content and remaining gaps

The frozen promoted set has 27 unique basenames and 79 tracked files, with no symlinks. The temporary candidate construction check reported that all copied files match their source bytes. A link scan found 41 relative Markdown links: 37 resolve within their own skill subtree; four are intentional examples/placeholders in `wayfinder/SKILL.md:44` and `domain-modeling/GLOSSARY-FORMAT.md:43-45`. No promoted text contains `../`, `skills/engineering`, or `skills/productivity`. Copying complete skill subtrees preserves real package-local links, including setup templates and `wizard/template.sh`. Consumer-workspace paths such as `GLOSSARY.md` remain intentional workflow inputs and outputs.

All 16 user-only skills have matching `disable-model-invocation: true` and `policy.allow_implicit_invocation: false`; the other 11 are model-invoked. Preserve both forms and all attribution, including the root MIT copyright notice and per-skill credits. [Codex metadata parser](https://github.com/openai/codex/blob/d27764b82f7118f674371e6d6e76271d9d606edb/codex-rs/ext/skills/src/loader/metadata.rs#L50)

Remaining acceptance evidence: Claude runtime discovery of all 27 skills; enforcement of user-only invocation in each harness; and resolution of literal Skill-tool calls and skill names in each runtime. `SkillSummary` does not expose implicit-invocation policy, so inventory alone cannot close that gap. Host tools, permissions, and external workflow dependencies can differ despite identical packaged bytes. Shared bytes and manifests establish a common package, not identical execution across harnesses.
