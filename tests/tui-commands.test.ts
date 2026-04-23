/**
 * TUI command registration tests for opencode-blocker-diverter.
 *
 * Architecture:
 *  - Ctrl+P palette:       api.command.register() entries — TUI-only, no slash field
 *  - Slash autocomplete:   .opencode/commands/*.md files via sync.data.command
 *
 * These are two separate systems. Omitting `slash` from TUI commands keeps them
 * Ctrl+P-only and eliminates duplicates with the .md slash commands.
 *
 * Run standalone: bun test tests/tui-commands.test.ts
 */

import { describe, it, expect, mock } from "bun:test";
import plugin from "../dist/tui.js";

// ---------------------------------------------------------------------------
// Types (local, no SDK import needed)
// ---------------------------------------------------------------------------

type TuiCommand = {
  title: string;
  value: string;
  description?: string;
  category?: string;
  keybind?: string;
  slash?: { name: string; aliases?: string[] };
  onSelect?: (...args: unknown[]) => unknown;
};

type RouteState =
  | { name: "session"; params: { sessionID: string } }
  | { name: string; params: Record<string, unknown> };

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

function buildMockApi(routeOverride?: RouteState) {
  const toasts: unknown[] = [];
  const kvStore = new Map<string, unknown>();
  const commandCbs: Array<() => TuiCommand[]> = [];
  const disposers: Array<() => void> = [];
  const serverCommands: Array<{
    sessionID: string;
    command: string;
    arguments?: string;
    throwOnError?: boolean;
  }> = [];

  const mockApi = {
    command: {
      register: mock((cb: () => TuiCommand[]) => {
        commandCbs.push(cb);
        return () => {};
      }),
    },
    route: {
      get current(): RouteState {
        return routeOverride ?? { name: "session", params: { sessionID: "test-session-id" } };
      },
    },
    ui: {
      toast: mock((opts: unknown) => { toasts.push(opts); }),
    },
    kv: {
      get: mock(<T>(key: string, defaultValue: T): T =>
        kvStore.has(key) ? (kvStore.get(key) as T) : defaultValue),
      set: mock((key: string, value: unknown) => { kvStore.set(key, value); }),
      delete: mock((key: string) => { kvStore.delete(key); }),
    },
    client: {
      session: {
        command: mock(
          async (
            opts: { sessionID: string; command: string; arguments?: string },
            reqOptions?: { throwOnError?: boolean },
          ) => {
            serverCommands.push({ ...opts, throwOnError: reqOptions?.throwOnError });
          },
        ),
      },
    },
    lifecycle: {
      onDispose: mock((fn: () => void) => { disposers.push(fn); }),
    },
  };

  const getRegisteredCommands = (): TuiCommand[] => commandCbs.flatMap((cb) => cb());

  return { mockApi, toasts, commandCbs, disposers, serverCommands, getRegisteredCommands, kvStore };
}

// ---------------------------------------------------------------------------
// Plugin shape
// ---------------------------------------------------------------------------

describe("dist/tui.js — plugin shape", () => {
  it("has the correct plugin id", () => {
    expect(plugin.id).toBe("opencode-blocker-diverter");
  });

  it("exports a tui function", () => {
    expect(typeof plugin.tui).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

describe("dist/tui.js — command registration", () => {
  it("calls api.command.register exactly once", async () => {
    const { mockApi } = buildMockApi();
    await plugin.tui(mockApi as never, {}, {});
    expect(mockApi.command.register).toHaveBeenCalledTimes(1);
  });

  it("registers exactly 5 commands", async () => {
    const { mockApi, getRegisteredCommands } = buildMockApi();
    await plugin.tui(mockApi as never, {}, {});
    expect(getRegisteredCommands().length).toBe(5);
  });

  const EXPECTED_VALUES = [
    "blockers.toggle",
    "blockers.on",
    "blockers.off",
    "blockers.status",
    "blockers.list",
  ] as const;

  it.each(EXPECTED_VALUES)("includes command with value '%s'", async (val) => {
    const { mockApi, getRegisteredCommands } = buildMockApi();
    await plugin.tui(mockApi as never, {}, {});
    expect(getRegisteredCommands().map((c) => c.value)).toContain(val);
  });

  it("NO command has a slash field — prevents duplicates with .md slash commands", async () => {
    const { mockApi, getRegisteredCommands } = buildMockApi();
    await plugin.tui(mockApi as never, {}, {});
    for (const cmd of getRegisteredCommands()) {
      expect(cmd.slash).toBeUndefined();
    }
  });

  it("all commands belong to the 'Blocker Diverter' category", async () => {
    const { mockApi, getRegisteredCommands } = buildMockApi();
    await plugin.tui(mockApi as never, {}, {});
    for (const cmd of getRegisteredCommands()) {
      expect(cmd.category).toBe("Blocker Diverter");
    }
  });

  it("every command has a non-empty title and value", async () => {
    const { mockApi, getRegisteredCommands } = buildMockApi();
    await plugin.tui(mockApi as never, {}, {});
    for (const cmd of getRegisteredCommands()) {
      expect(typeof cmd.title).toBe("string");
      expect(cmd.title.length).toBeGreaterThan(0);
      expect(typeof cmd.value).toBe("string");
      expect(cmd.value.length).toBeGreaterThan(0);
    }
  });

  it("toggle command has keybind ctrl+b", async () => {
    const { mockApi, getRegisteredCommands } = buildMockApi();
    await plugin.tui(mockApi as never, {}, {});
    const toggle = getRegisteredCommands().find((c) => c.value === "blockers.toggle")!;
    expect(toggle.keybind).toBe("ctrl+b");
  });

  it("api.lifecycle.onDispose is called with the unregister function", async () => {
    const { mockApi, disposers } = buildMockApi();
    await plugin.tui(mockApi as never, {}, {});
    expect(disposers.length).toBe(1);
    expect(typeof disposers[0]).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// No-session guard
// ---------------------------------------------------------------------------

describe("dist/tui.js — no-session guard", () => {
  it("shows error toast and does NOT throw when no session is active", async () => {
    const { mockApi, toasts, getRegisteredCommands } = buildMockApi({ name: "home", params: {} });
    await plugin.tui(mockApi as never, {}, {});
    const toggle = getRegisteredCommands().find((c) => c.value === "blockers.toggle")!;
    await expect(toggle.onSelect?.()).resolves.toBeUndefined();
    expect(toasts.length).toBeGreaterThan(0);
    const t = toasts[0] as Record<string, unknown>;
    expect(t.variant).toBe("error");
    expect(t.title).toBe("Blocker Diverter");
  });

  it("does not call session.command when no session is active", async () => {
    const { mockApi, serverCommands, getRegisteredCommands } = buildMockApi({ name: "home", params: {} });
    await plugin.tui(mockApi as never, {}, {});
    for (const cmd of getRegisteredCommands()) await cmd.onSelect?.();
    expect(serverCommands.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Active session — direct dispatch behaviour
// ---------------------------------------------------------------------------

describe("dist/tui.js — active session behaviour", () => {
  it("blockers.on sends 'blockers.on' server command and shows success toast", async () => {
    const { mockApi, toasts, serverCommands, getRegisteredCommands } = buildMockApi();
    await plugin.tui(mockApi as never, {}, {});
    const cmd = getRegisteredCommands().find((c) => c.value === "blockers.on")!;
    await cmd.onSelect?.();
    expect(serverCommands).toEqual([
      { sessionID: "test-session-id", command: "blockers.on", arguments: "", throwOnError: true },
    ]);
    expect(toasts.find((t) => (t as Record<string, unknown>).variant === "success")).toBeDefined();
  });

  it("blockers.off sends 'blockers.off' server command and shows success toast", async () => {
    const { mockApi, toasts, serverCommands, getRegisteredCommands } = buildMockApi();
    await plugin.tui(mockApi as never, {}, {});
    const cmd = getRegisteredCommands().find((c) => c.value === "blockers.off")!;
    await cmd.onSelect?.();
    expect(serverCommands[0]?.command).toBe("blockers.off");
    expect(serverCommands[0]?.arguments).toBe("");
    expect(toasts.find((t) => (t as Record<string, unknown>).variant === "success")).toBeDefined();
  });

  it("blockers.status reads kv and shows info toast", async () => {
    const { mockApi, toasts, getRegisteredCommands } = buildMockApi();
    await plugin.tui(mockApi as never, {}, {});
    const cmd = getRegisteredCommands().find((c) => c.value === "blockers.status")!;
    cmd.onSelect?.();
    expect(toasts.length).toBe(1);
    expect((toasts[0] as Record<string, unknown>).variant).toBe("info");
  });

  it("blockers.list sends 'blockers.list' server command", async () => {
    const { mockApi, serverCommands, getRegisteredCommands } = buildMockApi();
    await plugin.tui(mockApi as never, {}, {});
    const cmd = getRegisteredCommands().find((c) => c.value === "blockers.list")!;
    await cmd.onSelect?.();
    expect(serverCommands[0]?.command).toBe("blockers.list");
    expect(serverCommands[0]?.arguments).toBe("");
  });

  it("toggle sends 'blockers.on' when currently disabled", async () => {
    const { mockApi, serverCommands, getRegisteredCommands } = buildMockApi();
    await plugin.tui(mockApi as never, {}, {});
    const cmd = getRegisteredCommands().find((c) => c.value === "blockers.toggle")!;
    await cmd.onSelect?.();
    expect(serverCommands[0]?.command).toBe("blockers.on");
  });

  it("toggle sends 'blockers.off' when currently enabled", async () => {
    const { mockApi, serverCommands, getRegisteredCommands, kvStore } = buildMockApi();
    kvStore.set("blocker:test-session-id", true);
    await plugin.tui(mockApi as never, {}, {});
    const cmd = getRegisteredCommands().find((c) => c.value === "blockers.toggle")!;
    await cmd.onSelect?.();
    expect(serverCommands[0]?.command).toBe("blockers.off");
  });
});

// ---------------------------------------------------------------------------
// Server error handling
// ---------------------------------------------------------------------------

describe("dist/tui.js — server error handling", () => {
  it("shows error toast when server command throws, does NOT propagate", async () => {
    const { mockApi, toasts, getRegisteredCommands } = buildMockApi();
    mockApi.client.session.command = mock(async () => { throw new Error("connection refused"); });
    await plugin.tui(mockApi as never, {}, {});
    const cmd = getRegisteredCommands().find((c) => c.value === "blockers.on")!;
    await expect(cmd.onSelect?.()).resolves.toBeUndefined();
    const t = toasts.find((x) => (x as Record<string, unknown>).variant === "error") as Record<string, unknown>;
    expect(t).toBeDefined();
    expect(String(t.message)).toContain("connection refused");
  });

  it("surfaces structured object errors without [object Object]", async () => {
    const { mockApi, toasts, getRegisteredCommands } = buildMockApi();
    mockApi.client.session.command = mock(async () => {
      throw { data: { message: "Command not found: blockers.on" } };
    });
    await plugin.tui(mockApi as never, {}, {});
    const cmd = getRegisteredCommands().find((c) => c.value === "blockers.on")!;
    await expect(cmd.onSelect?.()).resolves.toBeUndefined();
    const t = toasts.find((x) => (x as Record<string, unknown>).variant === "error") as Record<string, unknown>;
    expect(t).toBeDefined();
    expect(String(t.message)).toContain("Command not found: blockers.on");
    expect(String(t.message)).not.toContain("[object Object]");
  });
});
