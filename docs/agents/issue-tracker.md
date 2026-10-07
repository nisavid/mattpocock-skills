# Issue tracker

Track fork packaging, distribution, and maintenance work in GitHub Issues at `nisavid/mattpocock-skills`. Upstream contributions and upstream tickets require explicit direction. Use `gh-axi` where it supports the operation; use GitHub's API or `gh` for native relationships it cannot express.

## Conventions

Read issue bodies and operator-owned checklists before editing. Use descriptive titles and literal multiline bodies. Preserve reviewer-owned checklists and unrelated issue content.

PRs as a request surface: no.

Use the canonical triage vocabulary in `docs/agents/triage-labels.md` for implementation issues. `SCOPE.md` governs proposals to change upstream skills. Fork packaging and operations are in scope when authorized by the active task.

## Wayfinding operations

A map is a GitHub issue labelled `wayfinder:map`. Decision tickets are native sub-issues labelled with exactly their applicable `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task` type. Create missing labels with those exact names. Wayfinder issues carry no triage labels.

Claim a decision ticket before working it by assigning it to `nisavid`. Record the active worker and owning chat in its coordination note so concurrent sessions can distinguish claims made through the shared account.

Use GitHub's native blocking dependencies. Create issues first, then add sub-issue and blocking relationships using their observed IDs. If the repository does not support a native relationship, record the missing capability and use an explicit linked body convention until native support is available.

The frontier consists of open, unassigned map children with no open blocking dependency, in map order. A blocked issue remains blocked even when another independent branch can proceed.

Record a decision as a resolution comment, close its issue, and add a short linked gist to the map's Decisions so far. Refer to every issue by its linked title in human-facing prose.

Keep concurrency, coordination, and join instructions in the map's Notes. When an effort includes implementation, state that extension explicitly; otherwise Wayfinder remains planning work.
