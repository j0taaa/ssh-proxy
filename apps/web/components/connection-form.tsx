"use client";

import { useState, useEffect, useCallback, useId } from "react";
import type { ConnectionStatus, TransportType } from "../lib/transport";

interface FormFields {
  host: string;
  port: string;
  username: string;
  password: string;
  rememberPassword: boolean;
  forceHttp: boolean;
}

interface ValidationErrors {
  host?: string;
  port?: string;
  username?: string;
  password?: string;
}

export interface ConnectionFormProps {
  status: ConnectionStatus;
  transport: TransportType | null;
  errorMessage: string | null;
  onConnect: (fields: FormFields) => void;
  onDisconnect: () => void;
}

const STORAGE_KEYS = {
  host: "ssh-proxy-host",
  port: "ssh-proxy-port",
  username: "ssh-proxy-username",
  password: "ssh-proxy-password",
  rememberPassword: "ssh-proxy-remember",
} as const;

const DEFAULT_PORT = "22";

function loadStoredValues(): Partial<FormFields> | null {
  if (typeof window === "undefined") return null;
  try {
    const remember =
      localStorage.getItem(STORAGE_KEYS.rememberPassword) === "true";
    return {
      host: localStorage.getItem(STORAGE_KEYS.host) || "",
      port: localStorage.getItem(STORAGE_KEYS.port) || DEFAULT_PORT,
      username: localStorage.getItem(STORAGE_KEYS.username) || "",
      password: remember
        ? localStorage.getItem(STORAGE_KEYS.password) || ""
        : "",
      rememberPassword: remember,
    };
  } catch {
    return null;
  }
}

function saveToStorage(fields: FormFields): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEYS.host, fields.host);
    localStorage.setItem(STORAGE_KEYS.port, fields.port);
    localStorage.setItem(STORAGE_KEYS.username, fields.username);
    localStorage.setItem(
      STORAGE_KEYS.rememberPassword,
      String(fields.rememberPassword),
    );
    if (fields.rememberPassword) {
      localStorage.setItem(STORAGE_KEYS.password, fields.password);
    } else {
      localStorage.removeItem(STORAGE_KEYS.password);
    }
  } catch {
    return;
  }
}

function validateForm(fields: FormFields): ValidationErrors {
  const errors: ValidationErrors = {};

  if (!fields.host.trim()) {
    errors.host = "Host is required";
  } else if (/\s/.test(fields.host)) {
    errors.host = "Host must not contain whitespace";
  }

  const portNum = Number(fields.port);
  if (
    !fields.port ||
    !Number.isInteger(portNum) ||
    portNum < 1 ||
    portNum > 65535
  ) {
    errors.port = "Port must be between 1 and 65535";
  }

  if (!fields.username) {
    errors.username = "Username is required";
  }

  if (!fields.password) {
    errors.password = "Password is required";
  }

  return errors;
}

export default function ConnectionForm({
  status,
  transport,
  errorMessage,
  onConnect,
  onDisconnect,
}: ConnectionFormProps) {
  const [host, setHost] = useState("");
  const [port, setPort] = useState(DEFAULT_PORT);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberPassword, setRememberPassword] = useState(false);
  const [forceHttp, setForceHttp] = useState(false);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [hydrated, setHydrated] = useState(false);

  const hostId = useId();
  const portId = useId();
  const usernameId = useId();
  const passwordId = useId();
  const rememberId = useId();
  const forceHttpId = useId();

  useEffect(() => {
    const stored = loadStoredValues();
    if (stored) {
      if (stored.host !== undefined) setHost(stored.host);
      if (stored.port !== undefined) setPort(stored.port);
      if (stored.username !== undefined) setUsername(stored.username);
      if (stored.password !== undefined) setPassword(stored.password);
      if (stored.rememberPassword !== undefined)
        setRememberPassword(stored.rememberPassword);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated && !rememberPassword) {
      try {
        localStorage.removeItem(STORAGE_KEYS.password);
      } catch {
        return;
      }
    }
  }, [rememberPassword, hydrated]);

  const clearFieldError = useCallback(
    (field: keyof ValidationErrors) => {
      if (errors[field]) {
        setErrors((prev) => {
          const next = { ...prev };
          delete next[field];
          return next;
        });
      }
    },
    [errors],
  );

  const handleConnect = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      const fields: FormFields = {
        host,
        port,
        username,
        password,
        rememberPassword,
        forceHttp,
      };
      const newErrors = validateForm(fields);

      if (Object.keys(newErrors).length > 0) {
        setErrors(newErrors);
        return;
      }

      setErrors({});
      saveToStorage(fields);
      onConnect(fields);
    },
    [host, port, username, password, rememberPassword, forceHttp, onConnect],
  );

  const handleDisconnect = useCallback(() => {
    onDisconnect();
  }, [onDisconnect]);

  const statusLabel: Record<ConnectionStatus, string> = {
    disconnected: "Disconnected",
    connecting: "Connecting\u2026",
    connected: "Connected",
  };

  const statusDotClass: Record<ConnectionStatus, string> = {
    disconnected: "status-dot status-disconnected",
    connecting: "status-dot status-connecting",
    connected: "status-dot status-connected",
  };

  const isFormDisabled = status === "connecting" || status === "connected";

  return (
    <div className="form-card">
      <div className="form-header">
        <p className="eyebrow">Browser SSH Proxy</p>
        <h1>Connect to SSH Server</h1>
      </div>

      <div
        className="warning-box"
        data-testid="warning-box"
        role="alert"
      >
        <p className="warning-title">Unsafe by Design</p>
        <ul className="warning-list">
          <li>
            No built-in application authentication &mdash; anyone with
            network access can use this tool
          </li>
          <li>
            Arbitrary SSH targets are allowed &mdash; the gateway can reach
            any host visible to it
          </li>
          <li>
            Passwords stored in browser localStorage when remembered &mdash;
            this is not encrypted storage
          </li>
          <li>
            SSH host keys are automatically accepted &mdash; connections are
            vulnerable to man-in-the-middle attacks
          </li>
        </ul>
      </div>

      <form
        onSubmit={handleConnect}
        data-testid="connection-form"
        noValidate
      >
        <div className="form-row">
          <div className="form-group form-group-grow">
            <label htmlFor={hostId}>Host</label>
            <input
              id={hostId}
              type="text"
              value={host}
              onChange={(e) => {
                setHost(e.target.value);
                clearFieldError("host");
              }}
              placeholder="e.g. 192.168.1.1"
              disabled={isFormDisabled}
              data-testid="host-input"
              aria-invalid={!!errors.host}
              aria-describedby={errors.host ? `${hostId}-error` : undefined}
              autoComplete="off"
              spellCheck={false}
            />
            {errors.host && (
              <span
                id={`${hostId}-error`}
                className="field-error"
                data-testid="host-error"
                role="alert"
              >
                {errors.host}
              </span>
            )}
          </div>

          <div className="form-group form-group-port">
            <label htmlFor={portId}>Port</label>
            <input
              id={portId}
              type="number"
              value={port}
              onChange={(e) => {
                setPort(e.target.value);
                clearFieldError("port");
              }}
              step={1}
              min={1}
              max={65535}
              disabled={isFormDisabled}
              data-testid="port-input"
              aria-invalid={!!errors.port}
              aria-describedby={errors.port ? `${portId}-error` : undefined}
              autoComplete="off"
            />
            {errors.port && (
              <span
                id={`${portId}-error`}
                className="field-error"
                data-testid="port-error"
                role="alert"
              >
                {errors.port}
              </span>
            )}
          </div>
        </div>

        <div className="form-group">
          <label htmlFor={usernameId}>Username</label>
          <input
            id={usernameId}
            type="text"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              clearFieldError("username");
            }}
            placeholder="SSH username"
            disabled={isFormDisabled}
            data-testid="username-input"
            aria-invalid={!!errors.username}
            aria-describedby={
              errors.username ? `${usernameId}-error` : undefined
            }
            autoComplete="off"
            spellCheck={false}
          />
          {errors.username && (
            <span
              id={`${usernameId}-error`}
              className="field-error"
              data-testid="username-error"
              role="alert"
            >
              {errors.username}
            </span>
          )}
        </div>

        <div className="form-group">
          <label htmlFor={passwordId}>Password</label>
          <input
            id={passwordId}
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              clearFieldError("password");
            }}
            placeholder="SSH password"
            disabled={isFormDisabled}
            data-testid="password-input"
            aria-invalid={!!errors.password}
            aria-describedby={
              errors.password ? `${passwordId}-error` : undefined
            }
            autoComplete="off"
          />
          {errors.password && (
            <span
              id={`${passwordId}-error`}
              className="field-error"
              data-testid="password-error"
              role="alert"
            >
              {errors.password}
            </span>
          )}
        </div>

        <div className="checkbox-group">
          <input
            id={rememberId}
            type="checkbox"
            checked={rememberPassword}
            onChange={(e) => setRememberPassword(e.target.checked)}
            disabled={isFormDisabled}
            data-testid="remember-password-checkbox"
          />
          <label htmlFor={rememberId}>
            Remember password on this browser
          </label>
        </div>

        <div className="checkbox-group">
          <input
            id={forceHttpId}
            type="checkbox"
            checked={forceHttp}
            onChange={(e) => setForceHttp(e.target.checked)}
            disabled={isFormDisabled}
            data-testid="force-http-checkbox"
          />
          <label htmlFor={forceHttpId}>Force HTTP fallback</label>
        </div>

        <div className="form-actions">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={isFormDisabled}
            data-testid="connect-button"
          >
            Connect
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={status === "disconnected"}
            onClick={handleDisconnect}
            data-testid="disconnect-button"
          >
            Disconnect
          </button>
        </div>
      </form>

      <div
        className="status-bar"
        data-testid="connection-status"
        role="status"
      >
        <span className={statusDotClass[status]} />
        <span>{statusLabel[status]}</span>
        {transport && (
          <span
            className="transport-label"
            data-testid="transport-type"
          >
            via {transport === "wss" ? "WSS" : "HTTP fallback"}
          </span>
        )}
      </div>

      {errorMessage && (
        <div
          className="error-message"
          data-testid="error-message"
          role="alert"
        >
          {errorMessage}
        </div>
      )}
    </div>
  );
}
