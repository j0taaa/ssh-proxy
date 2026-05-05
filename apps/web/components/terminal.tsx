"use client";

import "@xterm/xterm/css/xterm.css";

import {
  useEffect,
  useRef,
  forwardRef,
  useImperativeHandle,
} from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import {
  RESIZE_COLS_MIN,
  RESIZE_COLS_MAX,
  RESIZE_ROWS_MIN,
  RESIZE_ROWS_MAX,
} from "@ssh-proxy/protocol";

export interface TerminalHandle {
  write: (data: string) => void;
}

export interface TerminalProps {
  onInput?: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
  className?: string;
}

const FIT_DEBOUNCE_MS = 100;

const TerminalComponent = forwardRef<TerminalHandle, TerminalProps>(
  function TerminalComponent({ onInput, onResize, className }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const terminalRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const lastColsRef = useRef(0);
    const lastRowsRef = useRef(0);
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
      null,
    );
    const resizeObserverRef = useRef<ResizeObserver | null>(null);
    const disposablesRef = useRef<Array<{ dispose(): void }>>([]);

    const onInputRef = useRef(onInput);
    onInputRef.current = onInput;

    const onResizeRef = useRef(onResize);
    onResizeRef.current = onResize;

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const terminal = new Terminal({
        cursorBlink: true,
        fontFamily:
          'SFMono-Regular, Cascadia Code, Fira Code, Consolas, monospace',
        fontSize: 14,
        lineHeight: 1.2,
        scrollback: 1000,
        theme: {
          background: "#0c1219",
          foreground: "#f0f4f8",
          cursor: "#9cc9ff",
          selectionBackground: "#264f78",
          black: "#0c1219",
          red: "#fc8181",
          green: "#68d391",
          yellow: "#f0b429",
          blue: "#9cc9ff",
          magenta: "#d670d6",
          cyan: "#29b8db",
          white: "#f0f4f8",
          brightBlack: "#556680",
          brightRed: "#fc8181",
          brightGreen: "#68d391",
          brightYellow: "#f0b429",
          brightBlue: "#9cc9ff",
          brightMagenta: "#d670d6",
          brightCyan: "#29b8db",
          brightWhite: "#ffffff",
        },
      });

      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(container);

      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;

      try {
        fitAddon.fit();
        lastColsRef.current = terminal.cols;
        lastRowsRef.current = terminal.rows;
      } catch {
        /* container not yet visible */
      }

      const dataDisposable = terminal.onData((data) => {
        onInputRef.current?.(data);
      });
      disposablesRef.current.push(dataDisposable);

      function debouncedFit() {
        if (debounceTimerRef.current !== null) {
          clearTimeout(debounceTimerRef.current);
        }
        debounceTimerRef.current = setTimeout(() => {
          const term = terminalRef.current;
          const addon = fitAddonRef.current;
          if (!term || !addon) return;

          try {
            addon.fit();
          } catch {
            return;
          }

          const { cols, rows } = term;
          if (cols === lastColsRef.current && rows === lastRowsRef.current) {
            return;
          }

          if (
            cols >= RESIZE_COLS_MIN &&
            cols <= RESIZE_COLS_MAX &&
            rows >= RESIZE_ROWS_MIN &&
            rows <= RESIZE_ROWS_MAX
          ) {
            lastColsRef.current = cols;
            lastRowsRef.current = rows;
            onResizeRef.current?.(cols, rows);
          }
        }, FIT_DEBOUNCE_MS);
      }

      const observer = new ResizeObserver(() => {
        debouncedFit();
      });
      observer.observe(container);
      resizeObserverRef.current = observer;

      return () => {
        if (debounceTimerRef.current !== null) {
          clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = null;
        }

        for (const d of disposablesRef.current) {
          try { d.dispose(); } catch { /* already disposed */ }
        }
        disposablesRef.current = [];

        observer.disconnect();
        resizeObserverRef.current = null;

        try { fitAddon.dispose(); } catch { /* addon already disposed */ }
        fitAddonRef.current = null;

        terminal.dispose();
        terminalRef.current = null;
      };
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        write: (data: string) => {
          terminalRef.current?.write(data);
        },
      }),
      [],
    );

    return (
      <div
        ref={containerRef}
        className={className}
        data-testid="terminal-container"
      />
    );
  },
);

TerminalComponent.displayName = "TerminalComponent";

export default TerminalComponent;
