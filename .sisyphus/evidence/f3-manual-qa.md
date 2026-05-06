# F3 Real Manual QA

VERDICT: APPROVE

## Browser QA Coverage

- `npm run test:e2e` passed after the output-frame chunking fix: 11 Chromium tests passed.
- WSS browser flow passed: Playwright connects to the mock SSH server, status shows WSS, types `echo e2e-wss`, and verifies terminal buffer output contains `e2e-wss`.
- Forced HTTP fallback browser flow passed: Playwright checks the Force HTTP fallback option, connects through SSE+POST, types `echo e2e-http`, and verifies terminal buffer output contains `e2e-http`.
- Automatic WSS failure fallback passed: browser WebSocket failure is simulated and the UI falls back to HTTP with live terminal output.
- Bad credential flow passed: wrong password shows a visible sanitized error, does not expose the wrong password, and returns to disconnected state.
- Additional browser checks passed for localStorage opt-in behavior, invalid form validation, terminal resize, Unicode output, multiline paste, and explicit disconnect.

## Evidence Paths

- WSS/HTTP screenshots refreshed by E2E: `.sisyphus/evidence/task-10-e2e-wss.png`, `.sisyphus/evidence/task-10-e2e-http.png`.
- Existing E2E spec: `tests/e2e/ssh-terminal.spec.ts`.

## Cleanup

- Playwright global teardown stopped the web dev process, gateway, mock SSH server, and test-state server.
- `npm run test:e2e` ran `node scripts/sanitize-next-env.mjs` after the suite.
