# Agent instructions

- Start each task in a dedicated Git worktree on a unique local task branch based on the latest `origin/main`. Fetch before creating it. If the app has no Worktree option, create a linked checkout with `git worktree add -b codex/<task> <new-checkout-path> origin/main` and run the task there. If a separate checkout is unavailable, take turns using the shared checkout.
- Commit only the changes for your task. Review the staged diff before committing, including individual changes in files touched by others.
- After completing each task, fetch `origin/main`, rebase your task commits onto it, and review the resulting diff against `origin/main`. Run the relevant checks on the rebased result.
- Publish directly to `main` with `git push origin HEAD:main`. If the push is rejected because `main` advanced, fetch, rebase, review, and rerun the relevant checks before retrying. Never force-push `main`.
- When running Listo instances concurrently, use a separate port and SQLite database for each instance.
