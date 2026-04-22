/**
 * TUI plugin entry point for opencode-blocker-diverter.
 * Exported as a TuiPluginModule — separate from the server plugin in index.ts.
 * OpenCode loads this via package.json exports["./tui"].
 */
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";

const KV_PREFIX = "blocker:";

const tui: TuiPlugin = async (api, _options, _meta) => {
  const getSessionID = (): string | null => {
    const route = api.route.current;
    if (route.name !== "session") return null;
    // params is narrowed but TypeScript doesn't fully narrow the union;
    // cast to the known session params shape.
    const params = route.params as { sessionID: string };
    return params.sessionID;
  };

  const requireSession = (): string | null => {
    const id = getSessionID();
    if (!id) {
      api.ui.toast({
        variant: "error",
        title: "Blocker Diverter",
        message: "No active session — open a session first",
        duration: 4000,
      });
    }
    return id;
  };

  const kvKey = (sessionID: string) => KV_PREFIX + sessionID;

  const getState = (sessionID: string): boolean =>
    api.kv.get<boolean>(kvKey(sessionID), false);

  const setState = (sessionID: string, enabled: boolean) =>
    api.kv.set(kvKey(sessionID), enabled);

  const execServerCommand = async (
    sessionID: string,
    command: string,
  ): Promise<void> => {
    try {
      await api.client.session.command({ sessionID, command });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      api.ui.toast({
        variant: "error",
        title: "Blocker Diverter",
        message: `Command failed: ${msg}`,
        duration: 5000,
      });
      throw err; // re-throw so callers can skip kv update
    }
  };

  const unregister = api.command.register(() => [
    // 1. Toggle (ctrl+b)
    {
      title: "Blocker Diverter: Toggle",
      value: "blockers.toggle",
      description: "Toggle the blocker diverter on or off for this session",
      category: "Blocker Diverter",
      keybind: "ctrl+b",
      slash: { name: "blockers.toggle" },
      onSelect: async () => {
        const sessionID = requireSession();
        if (!sessionID) return;
        const current = getState(sessionID);
        const next = !current;
        const command = next ? "blockers.on" : "blockers.off";
        try {
          await execServerCommand(sessionID, command);
          setState(sessionID, next);
          api.ui.toast({
            variant: "success",
            title: "Blocker Diverter",
            message: next
              ? "✅ Blocker diverter enabled for this session"
              : "⏹ Blocker diverter disabled for this session",
            duration: 3000,
          });
        } catch {
          // error toast already shown by execServerCommand
        }
      },
    },

    // 2. Explicitly enable
    {
      title: "Blocker Diverter: Enable",
      value: "blockers.on",
      description: "Enable the blocker diverter for this session",
      category: "Blocker Diverter",
      slash: { name: "blockers.on" },
      onSelect: async () => {
        const sessionID = requireSession();
        if (!sessionID) return;
        try {
          await execServerCommand(sessionID, "blockers.on");
          setState(sessionID, true);
          api.ui.toast({
            variant: "success",
            title: "Blocker Diverter",
            message: "✅ Blocker diverter enabled for this session",
            duration: 3000,
          });
        } catch {
          // error toast already shown
        }
      },
    },

    // 3. Explicitly disable
    {
      title: "Blocker Diverter: Disable",
      value: "blockers.off",
      description: "Disable the blocker diverter for this session",
      category: "Blocker Diverter",
      slash: { name: "blockers.off" },
      onSelect: async () => {
        const sessionID = requireSession();
        if (!sessionID) return;
        try {
          await execServerCommand(sessionID, "blockers.off");
          setState(sessionID, false);
          api.ui.toast({
            variant: "success",
            title: "Blocker Diverter",
            message: "⏹ Blocker diverter disabled for this session",
            duration: 3000,
          });
        } catch {
          // error toast already shown
        }
      },
    },

    // 4. Status
    {
      title: "Blocker Diverter: Status",
      value: "blockers.status",
      description: "Show the current blocker diverter state for this session",
      category: "Blocker Diverter",
      slash: { name: "blockers.status" },
      onSelect: () => {
        const sessionID = requireSession();
        if (!sessionID) return;
        const enabled = getState(sessionID);
        api.ui.toast({
          variant: "info",
          title: "Blocker Diverter",
          message: enabled
            ? "✅ Currently ENABLED for this session"
            : "⏹ Currently DISABLED for this session",
          duration: 4000,
        });
      },
    },

    // 5. List blockers
    {
      title: "Blocker Diverter: List",
      value: "blockers.list",
      description: "List all blockers logged in this session",
      category: "Blocker Diverter",
      slash: { name: "blockers.list" },
      onSelect: async () => {
        const sessionID = requireSession();
        if (!sessionID) return;
        try {
          await execServerCommand(sessionID, "blockers.list");
        } catch {
          // error toast already shown by execServerCommand
        }
      },
    },
  ]);

  api.lifecycle.onDispose(unregister);
};

export default {
  id: "opencode-blocker-diverter",
  tui,
} satisfies TuiPluginModule & { id: string };
