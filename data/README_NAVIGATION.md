# data Navigation

JSON files here store config and runtime state.

JSON does not support inline comments, so use this file and the root navigation docs to understand ownership.

## Sensitive ownership hints
- wizard-related state should prefer the active state service as source of truth
- patch-note publishing state should stay private/staff-scoped
- process/workflow registries should be updated atomically when possible
