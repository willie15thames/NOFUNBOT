# services Navigation

This folder contains the heaviest business logic.

## Prioritize these files when debugging
- `*State*` files: source-of-truth and persistence
- `*Guard*`, `*Dedup*`, `*Claim*`, `*Lock*`: duplicate-prevention
- `*Message*`, `*Response*`: outbound UX behavior
- `*Wizard*`: onboarding/setup flow
- `*Workflow*`, `*Process*`, `*Event*`: orchestration and automation

## Editing rule
If you add a new process or execution path, update file headers and patch notes in the same pass.
