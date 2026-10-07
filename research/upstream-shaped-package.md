# Preserve upstream bucket paths in the shared package

Use one generated, filtered package that preserves `skills/engineering/` and `skills/productivity/`, the upstream Claude manifest, and every promoted skill file. Add a native Codex manifest selecting the same paths. Both marketplaces point to that package.

This supersedes the flat-layout recommendation in the earlier research report, whose SHA-256 is `b64264e0f591d18912798800d616309b84e2bf54a179e3413d9179c98c5cf919`. Its observations remain valid. The additional comparison establishes that flattening is unnecessary for the selected Codex and Claude marketplace routes.

## Compare the three choices

| Choice | Skill discovery | Physical package contents | Decision |
| --- | --- | --- | --- |
| Existing repository root with a Codex manifest | Current Codex source supports selecting the existing promoted-path array; Claude already declares it | The root also contains 11 non-promoted skill files | Reject: hiding those skills from discovery does not exclude their files from the package |
| Generated filtered bucket tree | Actual Codex probe discovers exactly the 27 promoted skills; Claude manifests pass strict validation | Only promoted skill subtrees and required package files | Select: meets physical exclusion while preserving upstream relative paths and Claude manifest bytes |
| Generated filtered flat tree | Earlier Codex probe discovers exactly 27 skills; Claude manifests pass strict validation | Only promoted skill subtrees and required package files | Reject as unnecessary relocation: it changes skill paths and requires a different Claude manifest without improving the selected delivery routes |

The repository-root alternative is the smallest source change but does not meet physical exclusion. Codex's install copy routine copies regular directories and files from the selected plugin root, rather than filtering the payload using the `skills` declarations. The temporary root-shaped candidate contained 11 non-promoted `SKILL.md` files. [Install copy routine](https://github.com/openai/codex/blob/d27764b82f7118f674371e6d6e76271d9d606edb/codex-rs/core-plugins/src/store.rs#L736)

## Selected shape

```text
marketplace-root/
  .agents/plugins/marketplace.json
  .claude-plugin/marketplace.json
  plugins/mattpocock-skills/
    .codex-plugin/plugin.json
    .claude-plugin/plugin.json
    LICENSE
    skills/
      engineering/<promoted-skill>/<complete subtree>
      productivity/<promoted-skill>/<complete subtree>
```

The package's `.claude-plugin/plugin.json` is copied byte-for-byte from upstream. The new `.codex-plugin/plugin.json` uses the identical 27-path `skills` array and provides **Skills for Real Engineers** as `interface.displayName`. Retain namespace `mattpocock-skills`, matching version metadata, attribution, the MIT license, and every skill's invocation metadata and supporting files. The outer catalogs both reference `./plugins/mattpocock-skills`.

Do not add portable root `plugin.json` to this layout. Codex gives that format precedence and discovers only direct-child skills. The native compatibility manifest accepts string arrays and discovers recursively within the selected roots. The array limitation recorded in upstream ADR 0002 is stale for Codex 0.160.1. [Array parser](https://github.com/openai/codex/blob/d27764b82f7118f674371e6d6e76271d9d606edb/codex-rs/core-plugins/src/manifest.rs#L134), [discovery modes](https://github.com/openai/codex/blob/d27764b82f7118f674371e6d6e76271d9d606edb/codex-rs/core-plugins/src/loader.rs#L897), [manifest precedence](https://github.com/openai/codex/blob/d27764b82f7118f674371e6d6e76271d9d606edb/codex-rs/utils/plugins/src/plugin_namespace.rs#L43)

## Observed candidate evidence

The filtered bucket candidate was prepared from immutable source `f3fc5632f401156837ee3872f14fe33ccf1024ea`. Construction checked all 79 promoted files against source bytes, preserved executable file modes, and copied the Claude manifest unchanged. Static inspection found exactly 27 skill files, every one selected by both manifests, no symlinks, and no `deprecated`, `in-progress`, or `misc` directories. The license is included. Bucket preservation also retains the package-local link behavior checked in the earlier report.

Codex 0.160.1 app-server `plugin/read` successfully read this candidate through its explicit local marketplace manifest. Inspection of the response confirmed exact set equality with the 27 promoted names, the `mattpocock-skills:` namespace, bucket-preserving paths, version `1.3.1`, and display name **Skills for Real Engineers**. Plugin summary values were `installed: false` and `enabled: false`. The JSONL response SHA-256 is `2ef138f4f11f7eaf4d20411b13641c9b63a91f421c53c593aae8941cb221bdaf`.

Claude Code 2.1.292 strict JSON validation of the filtered candidate's plugin directory and outer Claude marketplace both exited 0 with `success: true`, no manifest errors, and no warnings. Both returned `contents: []`. This remains manifest acceptance, not an observed Claude runtime inventory. [Claude validation reference](https://code.claude.com/docs/en/plugins/cli-reference)

## Supported delivery and remaining checks

OpenAI's current ChatGPT workspace-import documentation explicitly accepts marketplace entries referencing native `.codex-plugin/plugin.json`, Claude-compatible plugins, or Agent Plugins 1.0 packages. The selected legacy format therefore has a documented ChatGPT marketplace route; a portable root manifest is not required for that route. Actual ChatGPT import was not exercised. [ChatGPT supported marketplace formats](https://learn.chatgpt.com/docs/enterprise/plugin-management#supported-formats), [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins)

A direct public Claude archive upload has a separate prerequisite: at least one skill at `skills/<skill-name>/SKILL.md`. That upload route was not selected and does not justify relocating this marketplace package. [Public Claude archive submission](https://developers.openai.com/plugins/guides/submit-claude-plugin#prepare-and-upload-the-archive)

The remaining checks in this packaging-and-loading increment are Claude runtime inventory and observing invocation-policy loading. Per-skill enabled flags can reflect host overrides independently of plugin installation and implicit-invocation policy. Discovery and preserved metadata do not establish behavioral enforcement. Workflow execution and harness-specific skill-call behavior are outside this increment. No production generator, drift check, installation, or publication is established by these temporary compatibility probes.
