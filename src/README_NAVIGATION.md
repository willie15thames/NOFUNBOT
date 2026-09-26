# src Navigation

## Folder map
- `handlers/`: event/message handlers
- `routing/`: dispatch and consumer selection
- `services/`: reusable logic, safety rails, state, rendering, messaging
- `microservices/`: multi-step orchestration
- `storage/` and `infra/`: persistence and adapters
- `queue/`: async/background work
- `config/`: constants and config surfaces
- `utils/` and `parsers/`: helper and transform logic

## Best debugging pattern
Start at the event source, then follow routing, then the handler, then the service that owns state changes.
