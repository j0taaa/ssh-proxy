import { encodeBase64, decodeBase64 } from "@ssh-proxy/protocol";

export type TransportType = "wss" | "http-fallback";
export type ConnectionStatus = "disconnected" | "connecting" | "connected";

export interface ConnectParams {
  host: string;
  port: number;
  username: string;
  password: string;
  cols: number;
  rows: number;
  forceHttp: boolean;
}

export interface TransportCallbacks {
  onOutput: (data: string) => void;
  onError: (code: string, message: string) => void;
  onClose: (reason: string) => void;
  onStatusChange: (status: ConnectionStatus, transport: TransportType | null) => void;
}

const WSS_TIMEOUT_MS = 3000;
const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || "http://localhost:3001";

function generateSessionId(): string {
  return `cl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function getWsUrl(): string {
  const url = new URL(GATEWAY_URL);
  const protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${url.host}/ws/terminal`;
}

export function createTransportClient(callbacks: TransportCallbacks) {
  let currentStatus: ConnectionStatus = "disconnected";
  let activeTransport: TransportType | null = null;
  let sessionId: string | null = null;
  let seq = 0;
  let ws: WebSocket | null = null;
  let eventSource: EventSource | null = null;
  let wssTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;

  const nextSeq = (): number => ++seq;

  function setStatus(newStatus: ConnectionStatus, newTransport: TransportType | null) {
    currentStatus = newStatus;
    activeTransport = newTransport;
    callbacks.onStatusChange(newStatus, newTransport);
  }

  function connect(params: ConnectParams): void {
    if (destroyed || currentStatus !== "disconnected") return;
    seq = 0;
    sessionId = generateSessionId();

    if (params.forceHttp) {
      void connectHttp(params);
    } else {
      connectWss(params);
    }
  }

  function connectWss(params: ConnectParams): void {
    let acknowledged = false;
    let fallbackTriggered = false;

    try {
      ws = new WebSocket(getWsUrl());
    } catch {
      void connectHttp(params);
      return;
    }

    setStatus("connecting", null);

    wssTimeoutTimer = setTimeout(() => {
      if (!acknowledged && !fallbackTriggered) {
        fallbackTriggered = true;
        cleanupWss();
        void connectHttp(params);
      }
    }, WSS_TIMEOUT_MS);

    ws.onopen = () => {
      if (destroyed) { cleanupWss(); return; }
      ws?.send(JSON.stringify({
        type: "connect",
        sessionId,
        seq: nextSeq(),
        host: params.host,
        port: params.port,
        username: params.username,
        password: params.password,
        cols: params.cols,
        rows: params.rows,
      }));
    };

    ws.onmessage = (event: MessageEvent) => {
      if (destroyed) return;
      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(event.data as string);
      } catch {
        return;
      }
      if (!frame || typeof frame.type !== "string") return;

      switch (frame.type) {
        case "connect_ack":
          acknowledged = true;
          if (wssTimeoutTimer) { clearTimeout(wssTimeoutTimer); wssTimeoutTimer = null; }
          setStatus("connected", "wss");
          break;

        case "output":
          if (typeof frame.dataBase64 === "string") {
            try { callbacks.onOutput(decodeBase64(frame.dataBase64)); } catch { /* invalid base64 */ }
          }
          break;

        case "error":
          if (!acknowledged && !fallbackTriggered) {
            if (wssTimeoutTimer) { clearTimeout(wssTimeoutTimer); wssTimeoutTimer = null; }
            cleanupWss();
            setStatus("disconnected", null);
          }
          callbacks.onError(
            typeof frame.code === "string" ? frame.code : "UNKNOWN",
            typeof frame.message === "string" ? frame.message : "Error",
          );
          break;

        case "close":
          cleanupWss();
          setStatus("disconnected", null);
          callbacks.onClose(typeof frame.reason === "string" ? frame.reason : "Session closed");
          break;

        case "ping":
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "pong", sessionId, seq: nextSeq() }));
          }
          break;
      }
    };

    ws.onerror = () => {
      if (!acknowledged && !fallbackTriggered) {
        fallbackTriggered = true;
        cleanupWss();
        void connectHttp(params);
      }
    };

    ws.onclose = () => {
      if (!acknowledged && !fallbackTriggered) {
        fallbackTriggered = true;
        cleanupWss();
        void connectHttp(params);
      } else if (acknowledged) {
        cleanupWss();
        setStatus("disconnected", null);
        callbacks.onClose("WebSocket closed");
      }
    };
  }

  async function connectHttp(params: ConnectParams): Promise<void> {
    if (destroyed) return;

    if (currentStatus !== "connecting") {
      setStatus("connecting", null);
    }

    try {
      const createResponse = await fetch(`${GATEWAY_URL}/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "connect",
          sessionId,
          seq: nextSeq(),
          host: params.host,
          port: params.port,
          username: params.username,
          password: params.password,
          cols: params.cols,
          rows: params.rows,
        }),
      });

      if (destroyed) return;

      if (!createResponse.ok) {
        let code = "CONNECT_FAILED";
        let message = "Failed to create session";
        try {
          const body = await createResponse.json();
          if (typeof body.error === "string") code = body.error;
          if (typeof body.message === "string") message = body.message;
        } catch { /* ignore parse error */ }
        cleanupHttp();
        setStatus("disconnected", null);
        callbacks.onError(code, message);
        return;
      }

      const result = await createResponse.json();
      if (result.sessionId) {
        sessionId = result.sessionId;
      }

      if (destroyed) { cleanupHttp(); return; }

      setStatus("connected", "http-fallback");

      eventSource = new EventSource(`${GATEWAY_URL}/sse/terminal/${sessionId}/events`);

      eventSource.addEventListener("output", ((event: MessageEvent) => {
        try {
          const frame = JSON.parse(event.data as string);
          if (typeof frame.dataBase64 === "string") {
            callbacks.onOutput(decodeBase64(frame.dataBase64));
          }
        } catch { /* ignore */ }
      }) as EventListener);

      eventSource.addEventListener("error", ((event: MessageEvent) => {
        try {
          const frame = JSON.parse(event.data as string);
          callbacks.onError(
            typeof frame.code === "string" ? frame.code : "UNKNOWN",
            typeof frame.message === "string" ? frame.message : "Error",
          );
        } catch { /* ignore */ }
      }) as EventListener);

      eventSource.addEventListener("close", ((event: MessageEvent) => {
        try {
          const frame = JSON.parse(event.data as string);
          cleanupHttp();
          setStatus("disconnected", null);
          callbacks.onClose(typeof frame.reason === "string" ? frame.reason : "Session closed");
        } catch { /* ignore */ }
      }) as EventListener);

      eventSource.onerror = () => {
        if (eventSource?.readyState === EventSource.CLOSED) {
          cleanupHttp();
          setStatus("disconnected", null);
          callbacks.onClose("SSE connection closed");
        }
      };
    } catch {
      if (destroyed) return;
      cleanupHttp();
      setStatus("disconnected", null);
      callbacks.onError("CONNECT_FAILED", "Failed to connect");
    }
  }

  function sendInput(data: string): void {
    if (currentStatus !== "connected" || !sessionId) return;

    const dataBase64 = encodeBase64(data);

    if (activeTransport === "wss" && ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "input", sessionId, seq: nextSeq(), dataBase64 }));
    } else if (activeTransport === "http-fallback") {
      fetch(`${GATEWAY_URL}/sse/terminal/${sessionId}/input`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "input", sessionId, seq: nextSeq(), dataBase64 }),
      }).catch(() => { /* ignore network errors */ });
    }
  }

  function sendResize(cols: number, rows: number): void {
    if (currentStatus !== "connected" || !sessionId) return;

    if (activeTransport === "wss" && ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "resize", sessionId, seq: nextSeq(), cols, rows }));
    } else if (activeTransport === "http-fallback") {
      fetch(`${GATEWAY_URL}/sse/terminal/${sessionId}/input`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "resize", sessionId, seq: nextSeq(), cols, rows }),
      }).catch(() => { /* ignore */ });
    }
  }

  function disconnect(): void {
    if (currentStatus === "disconnected") return;

    if (activeTransport === "wss" && ws?.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "close", sessionId, seq: nextSeq(), reason: "client_disconnect" }));
      } catch { /* ignore */ }
      cleanupWss();
    } else if (activeTransport === "http-fallback" && sessionId) {
      fetch(`${GATEWAY_URL}/sse/terminal/${sessionId}/input`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "close", sessionId, seq: nextSeq(), reason: "client_disconnect" }),
      }).catch(() => { /* ignore */ });
      cleanupHttp();
    } else {
      cleanupWss();
      cleanupHttp();
    }

    setStatus("disconnected", null);
  }

  function cleanupWss(): void {
    if (wssTimeoutTimer) { clearTimeout(wssTimeoutTimer); wssTimeoutTimer = null; }
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      ws = null;
    }
  }

  function cleanupHttp(): void {
    if (eventSource) { eventSource.close(); eventSource = null; }
  }

  function destroy(): void {
    destroyed = true;
    disconnect();
  }

  return { connect, sendInput, sendResize, disconnect, destroy };
}
