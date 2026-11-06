# Issue creation and label-event constraints

## Observed repository behavior

The default-branch [`triage-label.yml`](https://github.com/nisavid/real-skills/blob/main/.github/workflows/triage-label.yml) subscribes only to `issues.opened` and unconditionally adds `needs-triage` using the job's `github.token`. GitHub issue event reads on this pass returned the following label events, in UTC:

- [First-release confirmation](https://github.com/nisavid/real-skills/issues/50): `nisavid` added `wayfinder:task` at 07:35:44; `github-actions[bot]` added `needs-triage` six seconds later.
- [Negative-discovery qualification](https://github.com/nisavid/real-skills/issues/55): `nisavid` added `wayfinder:task` at 22:39:30; `github-actions[bot]` added `needs-triage` seven seconds later.
- [Integrated release-pipeline decision](https://github.com/nisavid/real-skills/issues/56): `nisavid` added `wayfinder:grilling` at 00:39:34; `github-actions[bot]` added `needs-triage` eight seconds later.

These histories show those actors and orderings; they do not establish all creation routes, the full payload of `opened`, the execution timing of each workflow step, Linear propagation, or a general ordering guarantee.

## Documented behavior

- GitHub Actions recognizes `issues` activities including `opened`, `labeled`, and `unlabeled`; the workflow file must exist on the default branch. [Events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#issues).
- GitHub gives an example in which an issue opened with two labels causes three independent runs when both `opened` and `labeled` are selected. This does not promise their execution order or make the runs atomic. [Triggering a workflow](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow#using-event-activity-types).
- Events caused by the repository's `GITHUB_TOKEN` ordinarily do not create new workflow runs. GitHub explicitly demonstrates that its label-add operation does not trigger workflows listening for label additions. Dispatch events are exceptions; certain pull-request events have separate approval-required behavior. [Triggering a workflow](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow#triggering-a-workflow-from-a-workflow).
- GitHub says webhook deliveries can be delayed and arrive out of order. This is a statement about webhook delivery, not proof of Actions scheduling. [Troubleshooting webhooks](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/troubleshooting-webhooks#webhooks-deliveries-are-out-of-order).
- GitHub's REST API exposes add-label and set-label operations; the latter replaces existing labels, while add-label adds to them. [REST labels API](https://docs.github.com/en/rest/issues/labels#add-labels-to-an-issue).
- Linear documents bidirectional synchronization of labels for GitHub issue sync. The cited overview does not establish a timing or ordering guarantee for the linked repository. [GitHub Issues Sync](https://linear.app/changelog/2023-12-14-github-issues-sync).

## Remaining evidence

Establish the selected creation path's actual initial payload and label application order, actor and token for each writer, and observed propagation and repair behavior in both trackers. No live fixture or qualification was performed. These facts do not choose the required consistency guarantee or a maintained mechanism.
