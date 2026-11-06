# Invocation of promoted skills

The promoted engineering and productivity skills are reachable by the user and by the agent. Omit `disable-model-invocation` in Claude frontmatter and `policy.allow_implicit_invocation: false` in Codex metadata for these skills. Keep descriptions clear about when each skill fits. Invocation does not grant authority to perform effects or answer questions reserved for the user. Higher-priority instructions and each skill’s explicit decision boundaries still apply.

Non-promoted skills remain outside this convention; preserve their existing metadata unless their scope is separately approved.

## Dependencies between them

Dependencies are expressed as an explicit instruction to **call the Skill tool** with the named skill (`Call the Skill tool with "grilling"`), not deep `../other-skill/FILE.md` cross-references, and not a bare `/skill`-style mention left for the model to interpret. Naming the tool is what gets it fired: most harnesses expose skill invocation as a tool the model calls, and spelling that out gets a higher hit rate than dropping a `/name` into prose and hoping it's read as a command. Dropping the leading `/` also keeps this harness-neutral rather than less: a skill name on its own carries no assumption about which harness's trigger syntax it belongs to. Shared reference docs live inside the skill that owns them; other skills reach that material by calling the Skill tool with it, not by linking across folders.

This is about **operative** instructions: a skill's own steps telling the agent to go run another skill right now. Router prose that just names skills for a human to pick from (`ask-matt`, bucket `README.md`s) isn't invoking anything, so it keeps `/skill`-style names as plain labels.

The Skill tool takes one skill per call. A step that needs two skills is two calls, not one call with two names: say so (`Call the Skill tool twice, for "grilling" and "domain-modeling"`), not "call it with X and Y," which reads as a single call taking both.

Call a skill only if it is eligible for agent invocation and its actions are within the current authority. A missing setup prerequisite may be addressed by invoking `setup-matt-pocock-skills` only when governing instructions permit; otherwise tell the user to invoke it. The setup skill’s draft and consequential decisions still require confirmation.

## Passive vs active domain work

Merely _reading_ `GLOSSARY.md` for vocabulary is a one-line prose pointer, not the `domain-modeling` skill. Only the active build/sharpen discipline (challenge terms, edge-case scenarios, write ADRs, update `GLOSSARY.md` inline) is `domain-modeling`.
