import type { TransportType } from "./transport";

export interface ConnectionProfile {
  id: string;
  displayName: string;
  host: string;
  port: string;
  username: string;
  password?: string;
  rememberPassword: boolean;
  transport?: TransportType;
}

const STORAGE_KEY = "ssh-proxy-profiles";

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function readStore(): ConnectionProfile[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStore(profiles: ConnectionProfile[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
  } catch {
    return;
  }
}

export function getProfiles(): ConnectionProfile[] {
  return readStore();
}

export function getProfile(id: string): ConnectionProfile | undefined {
  return readStore().find((p) => p.id === id);
}

export type SaveResult =
  | { ok: true; profile: ConnectionProfile }
  | { ok: false; error: string };

export function saveProfile(
  input: Omit<ConnectionProfile, "id">,
): SaveResult {
  const slug = slugify(input.displayName);
  if (!slug) {
    return { ok: false, error: "Profile name must contain alphanumeric characters" };
  }

  const profiles = readStore();
  const existing = profiles.find((p) => p.id === slug);
  if (existing) {
    return { ok: false, error: `Profile "${input.displayName}" already exists` };
  }

  const profile: ConnectionProfile = {
    ...input,
    id: slug,
    password: input.rememberPassword ? input.password : undefined,
  };

  writeStore([...profiles, profile]);
  return { ok: true, profile };
}

export function clearSavedPassword(id: string): boolean {
  const profiles = readStore();
  const idx = profiles.findIndex((p) => p.id === id);
  if (idx === -1) return false;

  profiles[idx] = { ...profiles[idx], password: undefined, rememberPassword: false };
  writeStore(profiles);
  return true;
}

export function deleteProfile(id: string): boolean {
  const profiles = readStore();
  const filtered = profiles.filter((p) => p.id !== id);
  if (filtered.length === profiles.length) return false;
  writeStore(filtered);
  return true;
}
