# Report 004: Docs-only changes run only the formatting check

Status: done

## Summary
Implemented optional documentation-only project checks for AB-132. The server selects the check set from changed paths between the merge base and the committed HEAD, records the selected set and its reason on the review, and shows both in the Changes tab. Existing projects without the setting keep their full checks.

## Done
- Added nullable `docsOnlyChecks` project setting with default documentation glob patterns and a Prettier command.
- Added a database migration, Drizzle metadata, strict Zod contracts, API transport and project settings UI.
- Added safe quoting and substitution for `<changed files>` in documentation commands.
- Recorded `review.checkSet` and `review.checkReason` without changing audit behavior.
- Updated API documentation, unit tests, server integration tests, API tests and web tests.
- Created branch `chatgpt/004-docs-only-checks` and draft PR #5.

## Not done (and why)
- The test suite, formatting, lint and typecheck were not executed. The handoff protocol requires leaving validation to CI and the agent-band review gate.

## Assumptions
- An empty diff runs full checks, because there is no documentation diff to classify.
- Shell commands are trusted project configuration. The substituted file list is shell-quoted and protected by `--`.
- Glob matching uses Node 22 `path.matchesGlob`; hidden files follow its glob semantics.
- An explicitly configured documentation-only setting must have at least one glob and at least one check.
- Old review objects can omit `checkSet` and `checkReason`.

## Questions for the architect
- Should deletion-only documentation changes skip the formatter when the target files no longer exist?

## Suggested next tasks
- Verify handling of deleted/renamed documentation files in the CI check gate, including filenames requiring Git quoting.
