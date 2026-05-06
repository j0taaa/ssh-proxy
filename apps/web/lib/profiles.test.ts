import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  slugify,
  getProfiles,
  getProfile,
  saveProfile,
  clearSavedPassword,
  deleteProfile,
} from "./profiles";

function mockLocalStorage() {
  const store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      for (const k of Object.keys(store)) delete store[k];
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((_index: number) => null),
    _store: store,
  };
}

let ls: ReturnType<typeof mockLocalStorage>;

beforeEach(() => {
  ls = mockLocalStorage();
  vi.stubGlobal("localStorage", ls);
  vi.stubGlobal("window", {});
});

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Dev One")).toBe("dev-one");
  });

  it("passes already-slugified names through", () => {
    expect(slugify("dev-one")).toBe("dev-one");
  });

  it("collapses multiple separators", () => {
    expect(slugify("My  Cool   Server")).toBe("my-cool-server");
  });

  it("trims leading/trailing hyphens", () => {
    expect(slugify("--server--")).toBe("server");
  });

  it("returns empty for non-alphanumeric input", () => {
    expect(slugify("---")).toBe("");
  });
});

describe("saveProfile", () => {
  it("stores a profile with deterministic slug id", () => {
    const result = saveProfile({
      displayName: "dev-one",
      host: "10.0.0.1",
      port: "22",
      username: "admin",
      password: "secret",
      rememberPassword: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.id).toBe("dev-one");
    expect(result.profile.displayName).toBe("dev-one");
  });

  it("excludes password when rememberPassword is false", () => {
    saveProfile({
      displayName: "no-pass",
      host: "10.0.0.1",
      port: "22",
      username: "admin",
      password: "testpass",
      rememberPassword: false,
    });
    const stored = JSON.parse(ls._store["ssh-proxy-profiles"]);
    expect(stored[0].password).toBeUndefined();
  });

  it("includes password when rememberPassword is true", () => {
    saveProfile({
      displayName: "with-pass",
      host: "10.0.0.2",
      port: "2222",
      username: "deploy",
      password: "testpass",
      rememberPassword: true,
    });
    const stored = JSON.parse(ls._store["ssh-proxy-profiles"]);
    expect(stored[0].password).toBe("testpass");
    expect(stored[0].rememberPassword).toBe(true);
  });

  it("rejects duplicate profile names", () => {
    saveProfile({
      displayName: "duplicate",
      host: "10.0.0.1",
      port: "22",
      username: "admin",
      password: "",
      rememberPassword: false,
    });
    const result = saveProfile({
      displayName: "duplicate",
      host: "10.0.0.2",
      port: "22",
      username: "other",
      password: "",
      rememberPassword: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("already exists");
    }
  });

  it("does not overwrite existing profile on duplicate", () => {
    saveProfile({
      displayName: "prod",
      host: "10.0.0.1",
      port: "22",
      username: "admin",
      password: "",
      rememberPassword: false,
    });
    saveProfile({
      displayName: "prod",
      host: "10.0.0.99",
      port: "22",
      username: "hacker",
      password: "",
      rememberPassword: false,
    });
    const profiles = getProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0].host).toBe("10.0.0.1");
  });

  it("rejects empty-slug names", () => {
    const result = saveProfile({
      displayName: "---",
      host: "10.0.0.1",
      port: "22",
      username: "admin",
      password: "",
      rememberPassword: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("alphanumeric");
    }
  });

  it("preserves optional transport metadata", () => {
    const result = saveProfile({
      displayName: "http-only",
      host: "10.0.0.1",
      port: "22",
      username: "admin",
      password: "",
      rememberPassword: false,
      transport: "http-fallback",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.transport).toBe("http-fallback");
  });
});

describe("clearSavedPassword", () => {
  it("removes password while keeping connection fields", () => {
    saveProfile({
      displayName: "secure",
      host: "10.0.0.5",
      port: "2222",
      username: "deploy",
      password: "testpass",
      rememberPassword: true,
    });

    const cleared = clearSavedPassword("secure");
    expect(cleared).toBe(true);

    const profile = getProfile("secure")!;
    expect(profile.password).toBeUndefined();
    expect(profile.rememberPassword).toBe(false);
    expect(profile.host).toBe("10.0.0.5");
    expect(profile.port).toBe("2222");
    expect(profile.username).toBe("deploy");
    expect(profile.displayName).toBe("secure");
  });

  it("returns false for nonexistent profile", () => {
    expect(clearSavedPassword("nope")).toBe(false);
  });
});

describe("getProfiles", () => {
  it("returns empty array when no profiles stored", () => {
    expect(getProfiles()).toEqual([]);
  });

  it("returns all stored profiles", () => {
    saveProfile({
      displayName: "alpha",
      host: "10.0.0.1",
      port: "22",
      username: "a",
      password: "",
      rememberPassword: false,
    });
    saveProfile({
      displayName: "beta",
      host: "10.0.0.2",
      port: "22",
      username: "b",
      password: "",
      rememberPassword: false,
    });
    expect(getProfiles()).toHaveLength(2);
  });
});

describe("deleteProfile", () => {
  it("removes a profile by id", () => {
    saveProfile({
      displayName: "gone",
      host: "10.0.0.1",
      port: "22",
      username: "admin",
      password: "",
      rememberPassword: false,
    });
    expect(deleteProfile("gone")).toBe(true);
    expect(getProfile("gone")).toBeUndefined();
  });

  it("returns false for nonexistent profile", () => {
    expect(deleteProfile("nope")).toBe(false);
  });
});

describe("SSR safety", () => {
  it("returns empty array when window is undefined", () => {
    vi.unstubAllGlobals();
    expect(getProfiles()).toEqual([]);
  });
});
