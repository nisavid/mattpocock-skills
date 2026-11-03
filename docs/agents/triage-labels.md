# Triage Labels

The triage vocabulary has two category roles and five state roles. This file maps those canonical roles to the label strings used in this repo's issue tracker.

Every triaged implementation issue carries exactly one category role and one state role. Wayfinder issues carry no triage labels; their relationships and labels are governed by [Wayfinding operations](issue-tracker.md#wayfinding-operations).

## Category roles

| Canonical role | Label in our tracker | Meaning |
| --- | --- | --- |
| `bug` | `bug` | Something is broken |
| `enhancement` | `enhancement` | New feature or improvement |

## State roles

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Judge every issue against [`SCOPE.md`](../../SCOPE.md) before picking a state. Rejections close as "not planned".
