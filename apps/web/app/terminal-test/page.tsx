"use client";

import { useRef, useState, useCallback } from "react";
import TerminalComponent, {
  type TerminalHandle,
} from "../../components/terminal";

type LogEntry = {
  id: number;
  type: "input" | "resize" | "output";
  data: string;
};

let nextId = 0;

export default function TerminalTestPage() {
  const terminalRef = useRef<TerminalHandle>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const handleInput = useCallback((data: string) => {
    const entry: LogEntry = {
      id: nextId++,
      type: "input",
      data: JSON.stringify(data),
    };
    setLogs((prev) => [...prev.slice(-19), entry]);
    terminalRef.current?.write(data);
  }, []);

  const handleResize = useCallback((cols: number, rows: number) => {
    const entry: LogEntry = {
      id: nextId++,
      type: "resize",
      data: `${cols}x${rows}`,
    };
    setLogs((prev) => [...prev.slice(-19), entry]);
  }, []);

  const handleWriteOutput = useCallback(() => {
    terminalRef.current?.write(
      "\r\nEcho output: Unicode \u00e9\u00e8\u00ea \u65e5\u672c\u8a9e \ud83d\ude00\r\n",
    );
    const entry: LogEntry = {
      id: nextId++,
      type: "output",
      data: "Unicode output written",
    };
    setLogs((prev) => [...prev.slice(-19), entry]);
  }, []);

  return (
    <div style={{ padding: "0.5rem", display: "flex", flexDirection: "column", gap: "0.5rem", height: "100vh", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>Terminal Test Harness</h2>
        <button onClick={handleWriteOutput} data-testid="write-output-btn">
          Write Output
        </button>
      </div>
      <div
        data-testid="event-log"
        style={{
          background: "#0c1219",
          border: "1px solid #283848",
          borderRadius: "0.5rem",
          padding: "0.5rem 0.75rem",
          fontFamily: "monospace",
          fontSize: "0.75rem",
          minHeight: "1.5rem",
          maxHeight: "4.5rem",
          overflow: "auto",
          color: "#f0f4f8",
          flexShrink: 0,
        }}
      >
        {logs.map((entry) => (
          <div key={entry.id} data-testid={`log-${entry.type}`}>
            [{entry.type}] {entry.data}
          </div>
        ))}
        {logs.length === 0 && <span>No events yet</span>}
      </div>
      <div
        style={{
          border: "1px solid #283848",
          borderRadius: "0.5rem",
          flex: 1,
          minHeight: 200,
          overflow: "hidden",
        }}
      >
        <TerminalComponent
          ref={terminalRef}
          onInput={handleInput}
          onResize={handleResize}
        />
      </div>
    </div>
  );
}
