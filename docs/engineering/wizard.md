## What it does

`wizard` generates an interactive bash script that walks a human, step by step, through a manual procedure: wiring up third-party services, running a one-off migration, moving a project from state A to state B. It opens each URL, says what to click and copy, captures what comes back, and writes it into `.env` files and GitHub Actions secrets.

The [agent](https://www.aihero.dev/ai-coding-dictionary/agent) writes the script; it never runs it. You do, on your own machine. A wizard is a program, not a list of instructions. The script runs each step in order and keeps the values you enter. Your part is to click, paste, and press Enter.

## When to reach for it

You can type `/wizard`, and the agent can also reach for it on its own. When it hits a step you have to take (a key it can't mint, a dashboard it can't click), it builds you a wizard instead of writing the instructions into the chat, where they scroll away.

Reach for it when the next thing blocking you is a trip through a dashboard:

| Situation | What the wizard does |
| --- | --- |
| A new dev needs six services configured before the app boots | Opens each dashboard in order, captures the keys, writes them to `.env` and CI |
| A one-off migration needs switches flipped in a specific order | Sequences the irreversible steps behind confirmation gates |
| A project has to move from state A to state B once | Walks the transition and reports what it could not do |
| You are about to write those steps into a README | Writes an executable version instead, which fails visibly when a step goes stale |

Don't reach for it to *decide* what to build; for that, [grill-with-docs](https://aihero.dev/skills-grill-with-docs) and [to-spec](https://aihero.dev/skills-to-spec) are the tools.

## Prerequisites

None to generate one. Run the generated wizard using Bash and Python 3 on Linux, macOS, or WSL. Local values stay under the project directory you confirm before the first stage. Python runs in isolated mode so modules in the project or `PYTHONPATH` cannot replace its filesystem helpers. If a shell variable is already exported, the updated value stays exported for child processes launched by stages. The wizard's own helpers use the commands and exported scalar environment selected during destination setup; exported shell functions are excluded, and exported namerefs are refused. Wizard variables must be assignable plain scalars; readonly, nameref, integer, array, and value-transforming targets are refused. `PATH`, `ENV_FILE`, and names beginning `_WIZARD_` are reserved for the wizard. Shell tracing is disabled because it can expose secrets; do not re-enable it in stages.

The wizard uses `gh` when a stage sets a GitHub secret or variable. If `gh` is missing or not authenticated, the run does not fail. That stage shows a warning, and the closing summary tells you what to set by hand.

Before entering values, you confirm the displayed project root, env file, and GitHub repository. The env file must stay inside the project with an existing parent directory and no symlinked components or parent traversal. New files use mode `0600`; existing files retain their access permissions. Repository destinations include their host, so later working-directory or GitHub environment changes cannot send a credential elsewhere. A wizard without a repository destination runs in local-only mode and reports skipped GitHub writes.

## Stages

A **stage** is one focused task on one screen. The script clears the terminal between stages, so a stage that overflows the screen loses the part that scrolled away. You author stages in dependency order and set `TOTAL_STAGES` to a non-negative integer before configuring destinations. The first successful configuration fixes the progress count for the run, even if you reconfigure destinations.

The [skill](https://www.aihero.dev/ai-coding-dictionary/skill) scopes the procedure before it writes any script. It reads the repo instead of asking cold: `.env*`, `docker-compose*`, framework config, and every `secrets.*` / `vars.*` reference in `.github/workflows/`. Each of those references is a value the wizard has to produce. It then shows you the ordered stage list to confirm. Only after you confirm does it map each stage to the exact path a human follows ("Dashboard → Developers → API keys → Reveal test key → copy"). Where it doesn't know the current UI, it asks you or checks the docs rather than inventing clicks.

For each captured value, scoping decides where it goes:

| Destination | When |
| --- | --- |
| `.env` only | Local dev needs it, CI doesn't |
| GitHub secret | CI reads it, and it's sensitive |
| GitHub variable | CI reads it, and it's public |
| Both `.env` and a secret | Local dev and CI both need it |
| Nowhere | The stage is a pure action: a switch flipped, a plan upgraded |

## The template already solves the UX

The [template](https://github.com/mattpocock/skills/blob/main/skills/engineering/wizard/template.sh) ships the whole experience: progress with time remaining, confirmation gates, cross-platform URL opening including WSL, hidden entry for secrets, idempotent `.env` upserts, `gh secret` / `gh variable` writes, and a closing summary of everything it had to skip. Everything above the `STAGES` marker is a fixed library, identical in every wizard and never hand-edited. Because the library never changes, every wizard behaves the same way. The only work per wizard is to scope the procedure and author its stages.

The agent that writes a wizard never runs it end to end, because the script opens browsers and waits for human input. The agent checks it statically instead: `bash -n`, `shellcheck` where available, and a trace that every value lands where scoping said it would, with every `set_secret` name matching a real `secrets.*` reference in CI. So the first run is yours, and that run is the test.

## Ephemeral by default

| What you have | What to do with the script |
| --- | --- |
| A one-off migration, a personal setup, a transition you'll never repeat | Save it to a scratch or `scripts/` path, run it, delete it |
| A setup path the next person on the repo will also need | Commit it and link it from the README, so they run the script instead of re-asking an agent |

## Common questions

**Can `.env` be a symlink or live outside my project?**

This fork rejects those destinations before reading saved defaults or writing values. `ENV_FILE` may pass through existing subdirectories or use an absolute path under the confirmed physical project directory, but its components must not be symlinks or contain `..`. The destination itself must be absent for creation or an existing regular file. Directories, FIFOs, and other non-regular destinations are rejected. Unsafe access stops the prompt or write instead of continuing with an empty default.

New files are private (`0600`). Existing files retain their owner, group, mode, access-control lists, and extended attributes; an update fails before replacement if that metadata cannot be retained. Intended sharing remains possible, so you still need to check who can read an existing destination. Atomic replacement requires write access to its parent directory, changes the inode, and leaves other hard links pointing to the old contents. This fork supersedes upstream's deliberate symlink write-through behavior.

These safeguards apply to newly generated scripts. Regenerate an older wizard to update its library. Atomic replacement avoids exposing a partially copied destination during an ordinary failed update; it does not promise recovery after power loss or protect against a hostile process moving an already-open project directory elsewhere. Keep the project directory under your control while running a wizard.

**How do I clean up after an interrupted env write?**

In a wizard generated with this fork's current template, an interrupted write can leave a hidden `.wizard-env-` staging folder beside the env file. The folder can contain a partial copy of saved values, including secrets. Its contents are not a backup to restore. The wizard does not automatically remove a folder left by an interrupted run.

1. Stop the interrupted wizard and any other wizard writing in the same directory. Wait for them to exit, and do not restart them during cleanup. Keep the project directory under your control and stop other processes that might change these entries. If you cannot keep the entries stable or establish that all writers have stopped, leave the folder alone. Removing an active staging file can make a running write fail.
2. Find the env file's confirmed parent directory inside the project. Show hidden files in your file manager. A staging folder is named `.wizard-env-` followed by 32 lowercase hexadecimal characters. The name alone does not prove the folder belongs to your wizard: proceed only if you can associate it with the interrupted run.
3. Check the folder's properties without opening its files. It should be owned by you, private to you, and a directory rather than a symlink. It may be empty or contain one regular file named `value`. Do not follow symlinks in the path or inside the folder, and do not open, copy, or share `value`. If the path, ownership, permissions, or contents are unexpected, leave them alone for further inspection.
4. Permanently delete the `value` file, if present, then delete the empty staging folder. Do not delete the env file or replace it with the staged file. Deletion does not erase copies in backups or filesystem snapshots.

Before rerunning the wizard, check the env file's saved values privately. An interruption can happen before or after replacement, and a new env file may not have been created yet. Determine which values were saved rather than assuming the write failed or completed.

**Do my API keys end up in the model's context?**

No. The agent writes a script; it doesn't run it. You run the script yourself, and it captures the key with hidden terminal entry and writes it straight to `.env` or `gh secret`. The wizard is a CLI, and the model is not connected to it. This holds only for values the wizard captures at runtime. If you paste a key into the chat while scoping the procedure, it's in the [context](https://www.aihero.dev/ai-coding-dictionary/context) like any other pasted text.

**Can I go back and fix a value I mistyped?**

Not mid-run. There is no back button. The stages run forward, and a wrong answer on stage 3 means Ctrl-C and re-run. Re-running is cheap, because a saved value in `.env` is offered back as a default, so you press Enter through the stages you got right and retype only the wrong one. Simple double-quoted values are unquoted; double-quoted values containing escapes, dollar signs, or embedded double quotes must be entered again. Users asked for this in launch week, and it is still open: "loved it! One thing though, is there a way to go back and correct what you've entered?"

**What if I run it from another directory?**

Check the absolute destinations shown before the first stage. Reject them if they name the wrong project or repository. Those destinations stay fixed until the script calls `configure_destinations` again and you confirm the replacements. The final summary keeps each env write and secret's original destination. Relative `ENV_FILE` overrides resolve inside the chosen project root. A successful call sets `ENV_FILE` to the confirmed absolute path. Before selecting a different root, set `ENV_FILE` to the intended path inside that root, for example `ENV_FILE=.env` to resolve it relative to the new root, then configure and confirm again. The script author sets the root and repository in `configure_destinations`; the template example also accepts `PROJECT_ROOT` and `WIZARD_GITHUB_REPO` when launched. No repository means no GitHub writes.

Before confirming, check that the existing env file's readers are intended. The wizard preserves its access settings, including group permissions and ACLs, so anyone with read access can see values written there. The wizard does not detect changes to those settings during a run; review access again if it changes. If you are unsure who can read the file, inspect its permissions and ACLs before confirming.

**Does it know what I've already set up?**

Partly, and less than the launch reactions assumed. It reads the repo before it asks (your `.env` files, `docker-compose`, framework config, the `secrets.*` references in CI), so it scopes to values that are missing rather than starting from zero the way a README does. What it doesn't do is check the third-party service. If a key exists in your `.env` the wizard offers it back and Enter keeps it; if you already created the Stripe account but never saved the key, the wizard still sends you to the dashboard for it.

**Where does it sit in the workflow, after grilling and the spec?**

Nowhere in particular. It's a standalone, not a chain step. The common guess is `/grill-with-docs → /to-spec → /wizard`, and that sequence is fine, but the trigger is a manual procedure showing up, which can happen at any point: before you start, mid-build, or long after ship. It also works as a discovery tool. Scoping finds the hidden prerequisites of a task, like the three API keys you hadn't thought about, before you commit to the work.

**Does it work outside Claude Code?**

The script does. It's plain bash, and it runs the same whatever [harness](https://www.aihero.dev/ai-coding-dictionary/harness) generated it. The skill itself is model-invoked, so it's listed everywhere: type `/wizard` in Claude Code or `$wizard` in Codex, or just describe the setup you're stuck on. Being model-invoked also keeps it clear of [#693](https://github.com/mattpocock/skills/issues/693), where Claude's desktop and web apps drop *user-invoked* skills from the [model](https://www.aihero.dev/ai-coding-dictionary/model)'s listing and report them as not installed.

**Didn't this used to be user-invoked?**

It did. It's now model-invoked, so the agent reaches for it unprompted when it hits a step you have to take. Nothing you could do before stopped working. Model invocation lets the agent call the skill as well as you, so `/wizard` behaves as it did. The change fixes one failure. Before, an agent that hit a credentials wall mid-build dumped six numbered steps into the chat for you to follow by hand. Now it writes a wizard.

**It used to be in `in-progress/`. Where is it now?**

`engineering/`, as of v1.2. It graduated out of the beta bucket and now ships in the plugin, so it arrives with the rest of the promoted set rather than needing an individual install. Its behaviour didn't change on graduation.

## It's working if

- You're shown an ordered list of stages, and the values each one produces, and asked to confirm, before any script exists.
- Every URL is opened before the value from that page is asked for. You're never asked to paste something you haven't been sent to fetch.
- Secrets are typed blind. Nothing sensitive echoes into your scrollback.
- You confirm the project, env file, and repository before the wizard reads or captures values.
- Each stage fits one screen. Nothing you still need has scrolled away.
- Ctrl-C and re-run picks up where you left off, offering the values already saved as defaults.
- The final screen lists what it wrote, and separately lists what it couldn't do and you have to finish by hand.

## Where it fits

`wizard` is a reach-for-it-anytime standalone, sitting at the line where automation stops and a human has to click. Its nearest neighbour is [setup-matt-pocock-skills](https://aihero.dev/skills-setup-matt-pocock-skills), because both exist to get a repo into a working state. That one configures this skill set, and `wizard` generates a setup path for everything else. It also pairs with [implement](https://aihero.dev/skills-implement): when a build lands a feature that needs credentials or a manual cutover, a wizard covers the steps only a human can do. When you're unsure which skill fits the moment, [ask-matt](https://aihero.dev/skills-ask-matt) routes you.
