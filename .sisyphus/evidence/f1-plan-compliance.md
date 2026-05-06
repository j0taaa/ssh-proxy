# F1 Plan Compliance Audit

VERDICT: APPROVE

## Summary

F1 initially rejected because WSS/SSE output paths could emit a single `output` frame larger than `DATA_FRAME_MAX_DECODED_BYTES`. The follow-up fix added `apps/gateway/src/output-frame-chunks.ts`, wired both transports through it, and added WSS/SSE tests for a single SSH output chunk larger than 4096 bytes.

## Evidence

- WSS output path chunks before sending: `apps/gateway/src/terminal-ws.ts`.
- SSE output path chunks before sending: `apps/gateway/src/terminal-http.ts`.
- Shared helper caps decoded output payloads to `DATA_FRAME_MAX_DECODED_BYTES`: `apps/gateway/src/output-frame-chunks.ts`.
- WSS large-output test verifies split frames: `apps/gateway/src/terminal-ws.test.ts`.
- HTTP fallback large-output test verifies split SSE output frames: `apps/gateway/src/terminal-http.test.ts`.
- Mock SSH server emits a single large output chunk via `single-large-output`: `apps/gateway/src/test-utils/mock-ssh-server.ts`.
- F1 rerun confirmed no remaining `DATA_FRAME_MAX_DECODED_BYTES + 8` output-frame allowance.

## Verification

- Targeted gateway transport tests: passed, 2 files / 15 tests.
- Latest F1 rerun verdict: APPROVE.
- Forbidden-scope search remained clean for app auth, SSH key auth, SFTP/file transfer, port forwarding, RBAC/users, DB persistence, terminal recording, Kubernetes, and TLS automation.
