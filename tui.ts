/**
 * TUI plugin entry point for opencode-blocker-diverter.
 * Exported as a TuiPluginModule — separate from the server plugin in index.ts.
 * OpenCode loads this via package.json exports["./tui"].
 */
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";

const KV_PREFIX = "blocker:";

const tui: TuiPlugin = async (api, _options, _meta) => {
  const formatError = (err: unknown): string => {
    if (err instanceof Error && err.message) return err.message;
    if (typeof err === "string") return err;
    if (err && typeof err === "object") {
      const e = err as {
        message?: unknown;
        data?: { message?: unknown };
        error?: { message?: unknown; detail?: unknown };
        body?: { message?: unknown; error?: { message?: unknown } };
      };
      const candidates = [
        e.message,
        e.data?.message,
        e.error?.message,
        e.error?.detail,
        e.body?.message,
        e.body?.error?.message,
      ];
      for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.trim().length > 0) {
          return candidate;
        }
      }
      try {
        const asJson = JSON.stringify(err);
        if (asJson && asJson !== "{}") return asJson;
      } catch {
        // ignore stringify errors, fall through to String(err)
      }
    }
    return String(err);
  };

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
      await api.client.session.command(
        { sessionID, command, arguments: "" },
        { throwOnError: true },
      );
    } catch (err) {
      const msg = formatError(err);
      api.ui.toast({
        variant: "error",
        title: "Blocker Diverter",
        message: `Command failed: ${msg}`,
        duration: 5000,
      });
      throw err; // re-throw so callers can skip kv update
    }
  };

  // NOTE: no `slash` field on any command below — that would add them to the
  // slash autocomplete (when typing "/") where .opencode/commands/*.md files
  // already register the same names via sync.data.command.  Omitting `slash`
  // keeps these entries Ctrl+P-only and eliminates duplicates.
  const unregister = api.command.register(() => [
    {
      title: "Blocker Diverter: Toggle",
      value: "blockers.toggle",
      description: "Toggle the blocker diverter on or off for this session",
      category: "Blocker Diverter",
      keybind: "ctrl+b",
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
    {
      title: "Blocker Diverter: Enable",
      value: "blockers.on",
      description: "Enable the blocker diverter for this session",
      category: "Blocker Diverter",
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
    {
      title: "Blocker Diverter: Disable",
      value: "blockers.off",
      description: "Disable the blocker diverter for this session",
      category: "Blocker Diverter",
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
    {
      title: "Blocker Diverter: Status",
      value: "blockers.status",
      description: "Show the current blocker diverter state for this session",
      category: "Blocker Diverter",
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
    {
      title: "Blocker Diverter: List",
      value: "blockers.list",
      description: "List all blockers logged in this session",
      category: "Blocker Diverter",
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
