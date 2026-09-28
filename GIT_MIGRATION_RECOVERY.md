# NOFUNBOT new-folder Git migration recovery

## What happened

The initial `git switch -c fix/v1-onboarding-export-receiver origin/main` was attempted while the newly extracted build was still untracked. Git correctly aborted rather than overwrite those files. The later `git add -A && git commit` therefore created a root commit on the local default `main` branch instead of attaching the build to the existing NOFUNBOT history. The push failed because `fix/v1-onboarding-export-receiver` had never been created locally.

Do **not** force-push that root `main` commit.

## Safe recovery in the current new folder

Run from:

`~/Downloads/NOFUNBOT_v1.0.0_Public_Beta_League_Onboarding_Export_Receiver_Fix`

```bash
# 1) Preserve the exact current tree/commit as a local safety branch.
git branch -m backup/onboarding-export-root

# 2) Create the real feature branch from the previous clean-slate/multi-party line.
git switch -c fix/v1-onboarding-export-receiver origin/fix/v1-clean-slate-multiparty

# 3) Restore the exact files from the safety branch onto the real feature branch.
git restore --source=backup/onboarding-export-root --staged --worktree .

# 4) Confirm the repo is attached to NOFUNBOT and only this folder is the repo root.
git rev-parse --show-toplevel
git branch --show-current
git remote -v
git status

# 5) Validate before committing.
npm test
npm run tsc

# 6) Commit and push only after both gates pass.
git add -A
git commit -m "Add league onboarding and temporary export receiver"
git push -u origin fix/v1-onboarding-export-receiver
```

Expected repository root:

`/Users/williethames/Downloads/NOFUNBOT_v1.0.0_Public_Beta_League_Onboarding_Export_Receiver_Fix`

Expected branch:

`fix/v1-onboarding-export-receiver`

## Why the feature branch starts from fix/v1-clean-slate-multiparty

This build contains and extends the clean-slate, hidden-league, conversation, provider-gate, onboarding, and export-receiver work. Starting from the clean-slate/multi-party branch preserves that history and makes the onboarding/export work a normal incremental commit instead of a disconnected root repository.
