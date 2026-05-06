# ssh-proxy

Browser SSH proxy with a Next.js web UI and a separate long-lived Node gateway. Type into a terminal in your browser, and the gateway bridges that I/O to a real SSH session on a remote host using password authentication.

Designed for restrictive networks that block direct SSH, large requests, or certain socket types. Runs over HTTPS/WSS by default with an SSE+POST fallback for environments where WebSocket connections fail.

## What this is

A single-user tool that lets you SSH into any host from a browser tab. You pick the host, port, username, and password. The gateway opens an SSH session on your behalf and streams terminal output back to an xterm.js terminal in the page.

This is a personal utility, not a multi-user service. It has no login system, no user accounts, and no access control. See the [Unsafe by Design](#unsafe-by-design--single-user-mode) section before deploying.

## Architecture

```
Browser (Next.js app, port 3000)
  |
  |  WSS primary: GET /ws/terminal
  |  or
  |  SSE+POST fallback:
  |    POST /sessions
  |    GET  /sse/terminal/:sessionId/events
  |    POST /sse/terminal/:sessionId/input
  |
Gateway (Node HTTP server, port 3001)
  |
  |  ssh2 password auth, PTY shell
  |
SSH target (any host:port the user enters)
```

The project is a TypeScript monorepo with three npm workspace packages:

- `apps/web` - Next.js browser UI with xterm.js terminal and connection form
- `apps/gateway` - Long-lived Node HTTP server that manages SSH sessions
- `packages/protocol` - Shared frame types, validation, constants, and base64 helpers

Both `web` and `gateway` depend on `packages/protocol` for the frame contract. The gateway never runs inside Next.js. It is a standalone Node process.

## Quick start

### Prerequisites

- Node.js 20 or later
- npm 10 or later
- Docker and Docker Compose (for production builds)

### Development

```bash
# Install dependencies
npm install

# Start both web and gateway in dev mode
npm run dev
```

This runs the Next.js dev server on port `3000` and the gateway on port `3001`, bound to all interfaces so you can open the app from another machine at `http://<server-hostname>:3000`. The default dev origin allowlist includes `hwctools.site`; set `NEXT_ALLOWED_DEV_ORIGINS` to a comma-separated list if you use another hostname. When `NEXT_PUBLIC_GATEWAY_URL` is not set, the browser derives the gateway URL from the page URL, so `http://hwctools.site:3000` uses `http://hwctools.site:3001` automatically.

You can also run each service individually:

```bash
npm run dev:web       # Next.js only, port 3000
npm run dev:gateway   # Gateway only, port 3001
```

### Verification commands

```bash
npm install           # Install dependencies
npm run typecheck     # TypeScript type checking across all workspaces
npm run lint          # ESLint across the repo
npm test              # Vitest unit and integration tests (mock SSH server)
npm run test:e2e      # Playwright browser tests (mock SSH server)
npm run docker:smoke  # Build Docker images, run production smoke, tear down
```

The dev command (`npm run dev`) is documented here for reference. Do not leave it running unattended.

## Transport behavior

The browser tries two transport modes in order:

1. **WSS (primary)**. Opens a WebSocket to `GET /ws/terminal`. Sends a `connect` frame after the socket opens. If the server responds with `connect_ack`, the session stays on WSS. If WSS fails to open within 3 seconds, or closes/errors before `connect_ack`, the client falls back automatically.

2. **SSE+POST (fallback)**. Creates a session via `POST /sessions`, opens a server-sent events stream for output, and sends input and resize frames as individual POST requests. This works over plain HTTPS without WebSocket support.

You can force the HTTP fallback by checking "Force HTTP fallback" in the connection form. This skips the WSS attempt entirely and goes straight to SSE+POST.

Both transports carry the same JSON frames and use the same gateway session machinery.

## Protocol

All frames are JSON objects. Terminal data is base64-encoded. Each frame has `type`, `sessionId`, and `seq` fields.

| Frame type | Direction | Purpose |
|---|---|---|
| `connect` | client to gateway | Start SSH session (host, port, username, password, cols, rows) |
| `connect_ack` | gateway to client | SSH shell is ready |
| `input` | client to gateway | Keystrokes or pasted text (base64 `dataBase64`) |
| `output` | gateway to client | Terminal output from SSH (base64 `dataBase64`) |
| `resize` | client to gateway | Resize PTY (cols, rows) |
| `error` | gateway to client | Sanitized error with code and message |
| `close` | either direction | Session ended |
| `ping` / `pong` | both | Heartbeat every 25 seconds |

### Limits

| Parameter | Value |
|---|---|
| Decoded data frame max | 4,096 bytes |
| POST body max | 8 KiB |
| Resize cols | 20 to 300 |
| Resize rows | 5 to 120 |
| SSH connect timeout | 15 seconds |
| Idle timeout | 15 minutes |
| Max session duration | 8 hours |
| Max concurrent sessions | 5 |
| Heartbeat interval | 25 seconds |

Validation rejects empty host, empty username, empty password, invalid port, malformed base64, oversized data frames, unknown frame types, and resize values outside bounds.

## Production Docker

Build and start the production containers:

```bash
docker compose build
docker compose up -d
```

The default compose file binds the web UI and gateway only to localhost because this app has no built-in authentication:

- Web: `127.0.0.1:3000`
- Gateway: `127.0.0.1:3001`

Both services expose `GET /healthz` and have Docker healthchecks. Override `WEB_PORT`, `GATEWAY_PORT`, or `NEXT_PUBLIC_GATEWAY_URL` only when the replacement endpoint is still protected by your deployment boundary.

### Docker smoke validation

```bash
npm run docker:smoke
```

Builds the images, starts compose, waits for service health, starts a local mocked SSH server, exercises WSS and forced HTTP fallback through the running containers, writes `.sisyphus/evidence/task-11-docker-smoke.txt`, and tears compose down on success or failure.

### Reverse proxy setup

For internet-facing use, put an external reverse proxy in front of the services. Terminate HTTPS on port 443 there, proxy WSS traffic for `/ws/terminal`, and proxy the gateway HTTP fallback routes for `/sessions` and `/sse/terminal/*`. Keep the compose host bindings private unless the reverse proxy, firewall, or private network provides access control.

The gateway sends heartbeat frames every 25 seconds. Make sure your reverse proxy idle timeout is higher than this, or the proxy will close connections that look idle.

## Unsafe by Design / Single-User Mode

This project is a personal tool with deliberate security tradeoffs. Read this section before you deploy it.

**No built-in application authentication.** Anyone who can reach the web UI or gateway can open SSH sessions to arbitrary hosts. The app has no login, no API keys, no user accounts, and no RBAC. Protect it at the network level: run it behind a firewall, on localhost, or behind a reverse proxy with external auth.

**localStorage password storage is unsafe.** If you check "Remember password on this browser," the password is stored in browser localStorage. Any script running on the same origin can read it. This is a convenience tradeoff for a single-user personal tool. Do not enable it on shared machines.

**Auto-accepted SSH host keys.** The gateway accepts any SSH host key without verification. This means connections are vulnerable to man-in-the-middle attacks. An attacker on the network path between the gateway and the SSH target could intercept the session.

**Arbitrary SSH targets.** The gateway will attempt to connect to any host and port the user enters. If the gateway runs on a server with access to internal networks, anyone who reaches the web UI can use it to probe and connect to hosts on those networks.

**Do not expose publicly without external protection.** This app is designed for localhost use or private networks. If you need to access it over the internet, you must add your own authentication layer (HTTP basic auth via reverse proxy, VPN, zero-trust network, or similar). The Docker compose file binds to `127.0.0.1` by default for this reason.

## What this project does NOT include

These features are intentionally out of scope. They have not been implemented and should not be expected:

- SSH key authentication (password only)
- SFTP or file transfer
- SSH port forwarding
- Terminal recording or session replay
- User accounts, RBAC, or admin allowlists
- Database persistence (sessions are in-memory only)
- Built-in TLS certificate management
- Kubernetes deployment manifests

## Environment variables

| Variable | Default | Used by | Purpose |
|---|---|---|---|
| `PORT` | `3001` | Gateway | HTTP listen port |
| `HOST` | `0.0.0.0` | Gateway | HTTP listen host |
| `NEXT_PUBLIC_GATEWAY_URL` | derived from page URL | Web (browser) | Optional gateway base URL override for the transport client |
| `WEB_PORT` | `3000` | Docker Compose | Host port for the web service |
| `GATEWAY_PORT` | `3001` | Docker Compose | Host port for the gateway service |
| `NODE_ENV` | `development` | Both | `production` in Docker, `development` otherwise |

## Tech stack

- **Next.js 16** with React 19 for the browser UI
- **xterm.js** (`@xterm/xterm` + `@xterm/addon-fit`) for the terminal component
- **ssh2** for server-side SSH client connections
- **ws** for the WebSocket transport on the gateway
- **Vitest** for unit and integration tests
- **Playwright** for end-to-end browser tests
- **TypeScript** across all packages

## Testing

The test suite uses a mock SSH server built with `ssh2.Server`. No real SSH host or external network access is required.

```bash
# Unit and integration tests
npm test

# End-to-end browser tests (installs Chromium, then runs Playwright)
npm run test:e2e

# TypeScript type checking
npm run typecheck

# Linting
npm run lint
```

The mock SSH server accepts `testuser`/`testpass`, rejects other credentials, echoes commands, and records resize and input events. Integration tests cover WSS round trips, SSE+POST round trips, bad credentials, oversized frames, idle timeouts, Unicode, multiline paste, and session cleanup.
