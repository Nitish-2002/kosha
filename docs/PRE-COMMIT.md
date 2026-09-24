# Pre-commit security scan (Flyingduck)

Every `git commit` runs the Flyingduck Duck Defender scan (SCA, secrets, SAST) in Docker. The hook lives at `.git/hooks/pre-commit`.

## What was fixed

| Problem | Fix |
|---|---|
| The hook was named `precommit`, so Git never looked at it | Renamed it to `pre-commit` |
| The first line was blank, so the `#!/usr/bin/env bash` shebang didn't work | Removed the blank line so the shebang is line 1 |
| `core.hooksPath` in `.git/config` pointed to `.github/hooks.`, which doesn't exist, so Git skipped `.git/hooks` | Ran `git config --unset core.hooksPath` |
| Docker Desktop wasn't running, so `docker run` failed with exit code 125 | Start Docker Desktop before committing |
| Git Bash rewrites `--entrypoint /bin/bash` into a Windows path | Added `export MSYS_NO_PATHCONV=1` at the top of the hook |

The executable bit (`chmod +x`) is set, but on Windows it isn't needed. Git for Windows runs hooks through its bundled bash either way.

## One-time setup (per machine)

1. Install Docker Desktop, start it, and wait for "Engine running".
2. Log in to Duck Defender. This has to be interactive, so run it in your own terminal:
   ```bash
   docker run -it -v ${PWD}:/src --rm --entrypoint /bin/bash flyingduckio/duckdefender:latest -c "duckdefender login"
   ```
   In Git Bash, put `MSYS_NO_PATHCONV=1` at the start of that command.
3. Put the hook at `.git/hooks/pre-commit` (see below).

## Check that it works

```bash
git hook run pre-commit      # runs the hook the same way a commit does
```

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Scan passed, commit goes ahead |
| 1 | Security issues found, commit blocked |
| 2 | Not logged in to Duck Defender (see setup step 2) |
| 125 | Docker isn't running |

## Note for teammates

Git doesn't commit anything under `.git/hooks`, so each developer has to copy the hook there themselves. To share it through the repo instead, commit it as `.github/hooks/pre-commit` and have everyone run `git config core.hooksPath .github/hooks` once. There's no trailing dot in that path.
