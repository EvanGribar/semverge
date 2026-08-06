# SemVerge Agent Rules & Guidelines

Welcome! This repository uses a versioned release planning and publication engine. When working on SemVerge, follow these guidelines.

## Development Workflows

- **Testing**: Run the full vitest suite using `npm run test`.
- **Validation**: Always run `npm run typecheck && npm run build && npm run bundle` before final verification.
- **Convention**: Commits should follow conventional commit rules (e.g., `feat:`, `fix:`, `chore:`, `test:`, `docs:`) to ensure correct automated version bump calculation.

## Plugins & Transactional Side Effects

- Plugins must target API version `1`.
- Side effects must be modeled as serializable effect descriptors in hooks (`publish`, `recover`, etc.).
- Executors must be registered in the plugin for all effect kinds.
- Implement the `detect` interface in executors to verify if a side effect has already occurred. This ensures idempotency during recovery reruns.
- The `recover` hook must actively reconcile state rather than simply log it.

## Branch Security

- Privilege-critical plugin logic should only load from the merged/default-branch workspace, never from untrusted PR branches.
