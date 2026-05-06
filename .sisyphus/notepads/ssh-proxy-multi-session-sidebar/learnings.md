# Learnings

## 2026-05-06 Start Work: Initial inherited wisdom
- Backend already supports concurrent sessions via `SessionManager`; frontend is currently singleton.
- Terminal component already uses xterm FitAddon + ResizeObserver; sizing problem is parent layout/CSS.
- Restricted-network risk areas: URL derivation, SSE readiness/error surfacing, swallowed POST failures, CORS/origin behavior.
- User decisions: persist profiles and optional passwords locally, tabs-only multi-session, HTTPS/SSE-first transport.

## 2026-05-07 Task 2: Transport hardening
- `apps/web/lib/transport.ts` now derives gateway URLs dynamically, honoring `NEXT_PUBLIC_GATEWAY_URL` first and otherwise mapping web port `3000` to gateway port `3001` while preserving the current scheme for HTTPS dev hosts.
- Browser transport now starts with SSE+POST and only reports `connected` after an SSE `connect_ack`; WSS remains available as the secondary path when the HTTP/SSE setup fails before readiness.
- HTTP fallback input, resize, close, SSE readiness, invalid SSE error/close events, and disallowed gateway origins now surface visible errors instead of silent drops.
- Verification passed: focused URL derivation tests, focused SSE readiness/failure tests, web transport tests, gateway HTTP/WSS transport tests, `npm run typecheck`, `npm test`, and `npm run build`.

## 2026-05-07 Task 1: Session state foundation
- Added `apps/web/lib/session-state.ts` as a pure frontend model: saved profile references, active session tabs, per-tab status/transport/error, terminal metadata, active tab selection, deterministic selector helpers, and reducer transitions.
- Root Vitest already includes `apps/**/*.test.ts`, so `apps/web/lib/session-state.test.ts` runs without adding a web-specific Vitest config.
- Stable selectors preserve the existing default `connect-button` while adding deterministic suffixes such as `profile-card-dev-one`, `session-tab-dev-one-1`, `terminal-pane-dev-one-1`, and `transport-error-dev-one-1`.
- Verification passed: `npx vitest run apps/web/lib/session-state.test.ts`, removal-focused Vitest, `npm run typecheck`, and `npm run lint`.

## 2026-05-07 Task 3: localStorage profile persistence
- Created `apps/web/lib/profiles.ts` with `slugify`, `getProfiles`, `getProfile`, `saveProfile`, `clearSavedPassword`, `deleteProfile`.
- Storage key is `ssh-proxy-profiles` (JSON array), consistent with existing `ssh-proxy-*` prefix pattern in connection-form.
- `saveProfile` returns a discriminated union (`{ ok: true; profile } | { ok: false; error }`) for clean validation error handling.
- Duplicate detection is by slug ID (not display name casing), so "Dev-One" and "dev-one" collide as expected.
- `clearSavedPassword` zeroes password AND sets `rememberPassword: false` in one atomic store update, keeping all connection fields intact.
- Tests mock `localStorage` and `window` via `vi.stubGlobal`; module's `typeof window === "undefined"` guard enables SSR safety without jsdom.
- 19 tests pass, typecheck clean across all workspaces.
