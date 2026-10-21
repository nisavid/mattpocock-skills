---
"mattpocock-skills": patch
---

Harden this fork's generated wizard environment-file access. Read and write operations now reject symlinked destinations, parent traversal, non-regular files, and paths outside the launch project directory. Saved-default access errors stop prompts, and failed writes do not report success.

The wizard requires Python 3 and replaces valid destinations atomically. New files use mode 0600; existing access permissions are retained. Atomic replacement changes the inode and leaves other hard links unchanged. This fork-specific policy supersedes the symlink write-through behavior described in the earlier wizard-template fixes for #811. Regenerate existing wizards to adopt the hardened library.
