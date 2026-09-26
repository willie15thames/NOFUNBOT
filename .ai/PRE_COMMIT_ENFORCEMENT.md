# Pre-Commit Enforcement

This repo now includes a local Git pre-commit gate to reduce regressions before code is committed.

## What it blocks
- staged source changes with no patch-note update
- known risky wizard-state read patterns
- failed `npm run tsc` checks

## What it warns on
- high-risk flow surfaces like message sending, retry paths, and lock code
- missing accountability files

## Activate it
```bash
git config core.hooksPath .githooks
```

Or run:
```bash
npm run hooks:install
```

## Manual run
```bash
npm run precommit:run
```
