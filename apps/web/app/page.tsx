"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import ConnectionForm from "../components/connection-form";
import TerminalComponent, { type TerminalHandle } from "../components/terminal";
import {
  createTransportClient,
  type TransportType,
  type ConnectionStatus,
} from "../lib/transport";

const OUTPUT_BUFFER_MAX = 8192;

function sanitizeErrorMessage(message: string): string {
  if (message.length > 200) return message.slice(0, 200) + "\u2026";
  return message;
}

interface FormFields {
  host: string;
  port: string;
  username: string;
  password: string;
  forceHttp: boolean;
}

export default function Home() {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [transport, setTransport] = useState<TransportType | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const terminalRef = useRef<TerminalHandle>(null);
  const pendingOutputRef = useRef("");
  const transportRef = useRef<ReturnType<typeof createTransportClient> | null>(
    null,
  );

  useEffect(() => {
    transportRef.current = createTransportClient({
      onOutput: (data) => {
        if (terminalRef.current) {
          terminalRef.current.write(data);
        } else {
          const next = pendingOutputRef.current + data;
          pendingOutputRef.current =
            next.length > OUTPUT_BUFFER_MAX
              ? next.slice(-OUTPUT_BUFFER_MAX)
              : next;
        }
      },
      onError: (_code, message) => {
        setErrorMessage(sanitizeErrorMessage(message));
      },
      onClose: () => {
        setErrorMessage(null);
      },
      onStatusChange: (newStatus, newTransport) => {
        setStatus(newStatus);
        setTransport(newTransport);
        if (newStatus === "connecting") {
          setErrorMessage(null);
        }
      },
    });

    return () => {
      transportRef.current?.destroy();
      transportRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (
      status === "connected" &&
      terminalRef.current &&
      pendingOutputRef.current
    ) {
      terminalRef.current.write(pendingOutputRef.current);
      pendingOutputRef.current = "";
    }
  }, [status]);

  const handleConnect = useCallback((fields: FormFields) => {
    transportRef.current?.connect({
      host: fields.host,
      port: Number(fields.port),
      username: fields.username,
      password: fields.password,
      cols: 80,
      rows: 24,
      forceHttp: fields.forceHttp,
    });
  }, []);

  const handleDisconnect = useCallback(() => {
    transportRef.current?.disconnect();
  }, []);

  const handleTerminalInput = useCallback((data: string) => {
    transportRef.current?.sendInput(data);
  }, []);

  const handleTerminalResize = useCallback((cols: number, rows: number) => {
    transportRef.current?.sendResize(cols, rows);
  }, []);

  const isConnected = status === "connected";

  return (
    <div
      className="page-layout"
      data-connected={isConnected || undefined}
    >
      <ConnectionForm
        status={status}
        transport={transport}
        errorMessage={errorMessage}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
      />
      {isConnected ? (
        <div
          className="terminal-connected"
          data-testid="terminal-connected"
        >
          <TerminalComponent
            ref={terminalRef}
            onInput={handleTerminalInput}
            onResize={handleTerminalResize}
          />
        </div>
      ) : (
        <div
          className="terminal-placeholder"
          data-testid="terminal-placeholder"
        >
          <p>Terminal will appear here after connecting</p>
        </div>
      )}
    </div>
  );
}
