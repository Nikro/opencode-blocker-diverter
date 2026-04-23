/**
 * TUI command registration tests for opencode-blocker-diverter.
 *
 * Verifies that dist/tui.js:
 *   - exports the correct plugin shape (id + tui function)
 *   - registers all expected slash commands via api.command.register
 *   - each command has required title + value fields
 *   - shows an error toast instead of crashing when no session is active
 *
 * Run standalone: bun test tests/tui-commands.test.ts
 */

import { describe, it, expect, mock, beforeEach } from "bun:test";
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
  slash?: { name: string };
  onSelect?: (...args: unknown[]) => unknown;
};

type RouteState =
  | { name: "session"; params: { sessionID: string } }
  | { name: string; params: Record<string, unknown> };

// ---------------------------------------------------------------------------
// Mock factory — re-created for each test
// ---------------------------------------------------------------------------

function buildMockApi(routeOverride?: RouteState) {
  const toasts: unknown[] = [];
  const kvStore = new Map<string, unknown>();
  const commandCbs: Array<() => TuiCommand[]> = [];
  const disposers: Array<() => void> = [];
  const serverCommands: Array<{ sessionID: string; command: string }> = [];

  const mockApi = {
    command: {
      register: mock((cb: () => TuiCommand[]) => {
        commandCbs.push(cb);
        // return an unregister function
        return () => {};
      }),
    },
    route: {
      get current(): RouteState {
        return (
          routeOverride ?? {
            name: "session",
            params: { sessionID: "test-session-id" },
          }
        );
      },
    },
    ui: {
      toast: mock((opts: unknown) => {
        toasts.push(opts);
      }),
    },
    kv: {
      // Synchronous — second arg is default value (matches dist/tui.js usage)
      get: mock(<T>(key: string, defaultValue: T): T => {
        return kvStore.has(key) ? (kvStore.get(key) as T) : defaultValue;
      }),
      set: mock((key: string, value: unknown) => {
        kvStore.set(key, value);
      }),
      delete: mock((key: string) => {
        kvStore.delete(key);
      }),
    },
    client: {
      session: {
        command: mock(
          async (opts: { sessionID: string; command: string }) => {
            serverCommands.push(opts);
          }
        ),
      },
    },
    lifecycle: {
      onDispose: mock((fn: () => void) => {
        disposers.push(fn);
      }),
    },
  };

  const getRegisteredCommands = (): TuiCommand[] =>
    commandCbs.flatMap((cb) => cb());

  return { mockApi, toasts, commandCbs, disposers, serverCommands, getRegisteredCommands };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("dist/tui.js — plugin shape", () => {
  it("has the correct plugin id", () => {
    expect(plugin.id).toBe("opencode-blocker-diverter");
  });

  it("exports a tui function", () => {
    expect(typeof plugin.tui).toBe("function");
  });
});

describe("dist/tui.js — command registration", () => {
  it("calls api.command.register at least once", async () => {
    const { mockApi } = buildMockApi();
    await plugin.tui(mockApi as never, {}, {});
    expect(mockApi.command.register).toHaveBeenCalledTimes(1);
  });

  it("registers exactly 5 commands", async () => {
    const { mockApi, getRegisteredCommands } = buildMockApi();
    await plugin.tui(mockApi as never, {}, {});
    const cmds = getRegisteredCommands();
    expect(cmds.length).toBe(5);
  });

  it("every command has required title and value fields", async () => {
    const { mockApi, getRegisteredCommands } = buildMockApi();
    await plugin.tui(mockApi as never, {}, {});
    const cmds = getRegisteredCommands();
    for (const cmd of cmds) {
      expect(typeof cmd.title).toBe("string");
      expect(cmd.title.length).toBeGreaterThan(0);
      expect(typeof cmd.value).toBe("string");
      expect(cmd.value.length).toBeGreaterThan(0);
    }
  });

  const EXPECTED_VALUES = [
    "blockers.toggle",
    "blockers.on",
    "blockers.off",
    "blockers.status",
    "blockers.list",
  ];

  it.each(EXPECTED_VALUES)(
    "includes command with value '%s'",
    async (expectedValue) => {
      const { mockApi, getRegisteredCommands } = buildMockApi();
      await plugin.tui(mockApi as never, {}, {});
      const values = getRegisteredCommands().map((c) => c.value);
      expect(values).toContain(expectedValue);
    }
  );

  it("all commands belong to the 'Blocker Diverter' category", async () => {
    const { mockApi, getRegisteredCommands } = buildMockApi();
    await plugin.tui(mockApi as never, {}, {});
    const cmds = getRegisteredCommands();
    for (const cmd of cmds) {
      expect(cmd.category).toBe("Blocker Diverter");
    }
  });

  it("all commands expose a slash name via cmd.slash.name", async () => {
    const { mockApi, getRegisteredCommands } = buildMockApi();
    await plugin.tui(mockApi as never, {}, {});
    const cmds = getRegisteredCommands();
    for (const cmd of cmds) {
      expect(cmd.slash?.name).toBeDefined();
      expect(typeof cmd.slash?.name).toBe("string");
    }
  });

  it("slash.name matches command value for all commands", async () => {
    const { mockApi, getRegisteredCommands } = buildMockApi();
    await plugin.tui(mockApi as never, {}, {});
    const cmds = getRegisteredCommands();
    for (const cmd of cmds) {
      expect(cmd.slash?.name).toBe(cmd.value);
    }
  });

  it("toggle command has a keybind (ctrl+b)", async () => {
    const { mockApi, getRegisteredCommands } = buildMockApi();
    await plugin.tui(mockApi as never, {}, {});
    const toggle = getRegisteredCommands().find((c) => c.value === "blockers.toggle");
    expect(toggle?.keybind).toBe("ctrl+b");
  });
});

describe("dist/tui.js — no-session guard", () => {
  it("shows error toast and does NOT throw when no session is active", async () => {
    const noSessionRoute: RouteState = { name: "home", params: {} };
    const { mockApi, toasts, getRegisteredCommands } = buildMockApi(noSessionRoute);
    await plugin.tui(mockApi as never, {}, {});

    const cmds = getRegisteredCommands();
    const onCmd = cmds.find((c) => c.value === "blockers.on")!;
    expect(onCmd).toBeDefined();

    // Should not throw
    await expect(onCmd.onSelect?.()).resolves.toBeUndefined();

    // Should have shown an error toast
    expect(toasts.length).toBeGreaterThan(0);
    const errToast = toasts[0] as Record<string, unknown>;
    expect(errToast.variant).toBe("error");
    expect(errToast.title).toBe("Blocker Diverter");
  });

  it("does not call api.client.session.command when no session is active", async () => {
    const noSessionRoute: RouteState = { name: "home", params: {} };
    const { mockApi, serverCommands, getRegisteredCommands } = buildMockApi(noSessionRoute);
    await plugin.tui(mockApi as never, {}, {});

    const cmds = getRegisteredCommands();
    // trigger all commands — none should reach the server
    for (const cmd of cmds) {
      await cmd.onSelect?.();
    }
    expect(serverCommands.length).toBe(0);
  });
});

describe("dist/tui.js — active session behaviour", () => {
  it("blockers.status reads kv state and shows info toast", async () => {
    const { mockApi, toasts, getRegisteredCommands } = buildMockApi();
    await plugin.tui(mockApi as never, {}, {});

    const statusCmd = getRegisteredCommands().find((c) => c.value === "blockers.status")!;
    statusCmd.onSelect?.();

    expect(toasts.length).toBe(1);
    const t = toasts[0] as Record<string, unknown>;
    expect(t.variant).toBe("info");
    expect(typeof t.message).toBe("string");
  });

  it("blockers.on sends 'blockers.on' server command and shows success toast", async () => {
    const { mockApi, toasts, serverCommands, getRegisteredCommands } = buildMockApi();
    await plugin.tui(mockApi as never, {}, {});

    const onCmd = getRegisteredCommands().find((c) => c.value === "blockers.on")!;
    await onCmd.onSelect?.();

    expect(serverCommands).toEqual([{ sessionID: "test-session-id", command: "blockers.on" }]);
    const successToast = toasts.find(
      (t) => (t as Record<string, unknown>).variant === "success"
    );
    expect(successToast).toBeDefined();
  });

  it("blockers.off sends 'blockers.off' server command", async () => {
    const { mockApi, serverCommands, getRegisteredCommands } = buildMockApi();
    await plugin.tui(mockApi as never, {}, {});

    const offCmd = getRegisteredCommands().find((c) => c.value === "blockers.off")!;
    await offCmd.onSelect?.();

    expect(serverCommands[0]?.command).toBe("blockers.off");
  });

  it("blockers.list sends 'blockers.list' server command", async () => {
    const { mockApi, serverCommands, getRegisteredCommands } = buildMockApi();
    await plugin.tui(mockApi as never, {}, {});

    const listCmd = getRegisteredCommands().find((c) => c.value === "blockers.list")!;
    await listCmd.onSelect?.();

    expect(serverCommands[0]?.command).toBe("blockers.list");
  });

  it("api.lifecycle.onDispose is called with the unregister function", async () => {
    const { mockApi, disposers } = buildMockApi();
    await plugin.tui(mockApi as never, {}, {});

    expect(disposers.length).toBe(1);
    expect(typeof disposers[0]).toBe("function");
  });
});

describe("dist/tui.js — server error handling", () => {
  it("shows error toast when server command throws, does NOT propagate", async () => {
    const { mockApi, toasts, getRegisteredCommands } = buildMockApi();
    // Make server command throw
    mockApi.client.session.command = mock(async () => {
      throw new Error("connection refused");
    });

    await plugin.tui(mockApi as never, {}, {});

    const onCmd = getRegisteredCommands().find((c) => c.value === "blockers.on")!;
    // Should NOT throw to the caller
    await expect(onCmd.onSelect?.()).resolves.toBeUndefined();

    const errToast = toasts.find(
      (t) => (t as Record<string, unknown>).variant === "error"
    );
    expect(errToast).toBeDefined();
    const msg = (errToast as Record<string, unknown>).message as string;
    expect(msg).toContain("connection refused");
  });
});
