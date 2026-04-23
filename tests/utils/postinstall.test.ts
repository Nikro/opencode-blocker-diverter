/**
 * Unit tests for scripts/postinstall.js installer logic.
 * Tests pure file operations and helper functions.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Import helpers from the postinstall script
import {
  writeIfMissing,
  copyIfMissing,
  copyAlways,
  isConsumingProject,
  generateDefaultConfig,
  patchOpencodeConfig,
  patchTuiConfig,
  stripJsonc,
  bootstrap,
} from "../../scripts/postinstall.js";

const PLUGIN_PATH_SPEC = "./node_modules/opencode-blocker-diverter";
const TUI_PLUGIN_PATH_SPEC = "../node_modules/opencode-blocker-diverter";

// ---- helpers ----

let tmpRoot: string;

function makeTmp(suffix = ""): string {
  const dir = join(tmpdir(), `bd-postinstall-test-${Date.now()}${suffix}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

beforeEach(() => {
  tmpRoot = makeTmp();
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

// ---- writeIfMissing ----

describe("writeIfMissing", () => {
  it("writes a new file and returns true", () => {
    const file = join(tmpRoot, "sub", "new.txt");
    const result = writeIfMissing(file, "hello");
    expect(result).toBe(true);
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8")).toBe("hello");
  });

  it("skips an existing file and returns false", () => {
    const file = join(tmpRoot, "existing.txt");
    writeFileSync(file, "original");
    const result = writeIfMissing(file, "new content");
    expect(result).toBe(false);
    expect(readFileSync(file, "utf8")).toBe("original");
  });

  it("creates intermediate directories", () => {
    const file = join(tmpRoot, "a", "b", "c", "file.txt");
    writeIfMissing(file, "deep");
    expect(existsSync(file)).toBe(true);
  });
});

// ---- copyIfMissing ----

describe("copyIfMissing", () => {
  it("copies a file and returns true when destination is absent", () => {
    const src = join(tmpRoot, "src.txt");
    const dest = join(tmpRoot, "dest-dir", "dest.txt");
    writeFileSync(src, "source content");
    const result = copyIfMissing(src, dest);
    expect(result).toBe(true);
    expect(readFileSync(dest, "utf8")).toBe("source content");
  });

  it("skips copy and returns false when destination exists", () => {
    const src = join(tmpRoot, "src.txt");
    const dest = join(tmpRoot, "dest.txt");
    writeFileSync(src, "new");
    writeFileSync(dest, "original");
    const result = copyIfMissing(src, dest);
    expect(result).toBe(false);
    expect(readFileSync(dest, "utf8")).toBe("original");
  });
});

// ---- copyAlways ----

describe("copyAlways", () => {
  it("copies a file when destination is absent and returns true", () => {
    const src = join(tmpRoot, "src.txt");
    const dest = join(tmpRoot, "dest-dir", "dest.txt");
    writeFileSync(src, "source content");
    const result = copyAlways(src, dest);
    expect(result).toBe(true);
    expect(readFileSync(dest, "utf8")).toBe("source content");
  });

  it("overwrites an existing destination and returns true", () => {
    const src = join(tmpRoot, "src.txt");
    const dest = join(tmpRoot, "dest.txt");
    writeFileSync(src, "new content");
    writeFileSync(dest, "old content");
    const result = copyAlways(src, dest);
    expect(result).toBe(true);
    expect(readFileSync(dest, "utf8")).toBe("new content");
  });

  it("returns false when source does not exist", () => {
    const src = join(tmpRoot, "nonexistent.txt");
    const dest = join(tmpRoot, "dest.txt");
    const result = copyAlways(src, dest);
    expect(result).toBe(false);
    expect(existsSync(dest)).toBe(false);
  });

  it("creates intermediate directories", () => {
    const src = join(tmpRoot, "src.txt");
    const dest = join(tmpRoot, "a", "b", "c", "dest.txt");
    writeFileSync(src, "deep");
    copyAlways(src, dest);
    expect(existsSync(dest)).toBe(true);
  });
});

// ---- isConsumingProject ----

describe("isConsumingProject", () => {
  it("returns false when directory has no package.json", () => {
    expect(isConsumingProject(tmpRoot)).toBe(false);
  });

  it("returns true for a foreign package.json", () => {
    writeFileSync(join(tmpRoot, "package.json"), JSON.stringify({ name: "my-app" }));
    expect(isConsumingProject(tmpRoot)).toBe(true);
  });

  it("returns false when package name is opencode-blocker-diverter (self-install)", () => {
    writeFileSync(
      join(tmpRoot, "package.json"),
      JSON.stringify({ name: "opencode-blocker-diverter" }),
    );
    expect(isConsumingProject(tmpRoot)).toBe(false);
  });

  it("returns false when package.json is malformed JSON", () => {
    writeFileSync(join(tmpRoot, "package.json"), "{ not valid json }");
    expect(isConsumingProject(tmpRoot)).toBe(false);
  });
});

// ---- generateDefaultConfig ----

describe("generateDefaultConfig", () => {
  it("returns valid JSON with enabled and defaultDivertBlockers", () => {
    const raw = generateDefaultConfig();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed.enabled).toBe(true);
    expect(parsed.defaultDivertBlockers).toBe(false);
  });
});

// ---- stripJsonc ----

describe("stripJsonc", () => {
  it("strips single-line comments", () => {
    const input = `{ // this is a comment\n  "a": 1\n}`;
    const result = stripJsonc(input);
    expect(() => JSON.parse(result)).not.toThrow();
    expect(JSON.parse(result)).toEqual({ a: 1 });
  });

  it("preserves // inside string literals (e.g. https URLs)", () => {
    const input = `{
  "$schema": "https://opencode.ai/config.json", // comment
  "a": 1,
}`;
    const result = stripJsonc(input);
    expect(() => JSON.parse(result)).not.toThrow();
    expect(JSON.parse(result)).toEqual({
      $schema: "https://opencode.ai/config.json",
      a: 1,
    });
  });

  it("strips trailing commas before }", () => {
    const input = `{ "a": 1, }`;
    const result = stripJsonc(input);
    expect(() => JSON.parse(result)).not.toThrow();
    expect(JSON.parse(result)).toEqual({ a: 1 });
  });

  it("strips trailing commas before ]", () => {
    const input = `{ "arr": [1, 2, 3,] }`;
    const result = stripJsonc(input);
    expect(() => JSON.parse(result)).not.toThrow();
    expect(JSON.parse(result)).toEqual({ arr: [1, 2, 3] });
  });

  it("leaves valid JSON untouched", () => {
    const input = `{ "plugin": ["foo"] }`;
    expect(stripJsonc(input)).toBe(input);
  });
});

// ---- patchOpencodeConfig ----

describe("patchOpencodeConfig", () => {
  it("creates opencode.jsonc when no config exists", () => {
    const { configPath, action } = patchOpencodeConfig(tmpRoot);
    expect(action).toBe("created");
    expect(configPath).toContain("opencode.jsonc");
    expect(existsSync(configPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    expect((parsed.plugin as string[]).includes(PLUGIN_PATH_SPEC)).toBe(true);
  });

  it("patches an existing opencode.jsonc that lacks the plugin", () => {
    const jsoncPath = join(tmpRoot, "opencode.jsonc");
    writeFileSync(jsoncPath, JSON.stringify({ model: "gpt-4" }, null, 2));
    const { action } = patchOpencodeConfig(tmpRoot);
    expect(action).toBe("patched");
    const parsed = JSON.parse(readFileSync(jsoncPath, "utf8")) as Record<string, unknown>;
    expect((parsed.plugin as string[]).includes(PLUGIN_PATH_SPEC)).toBe(true);
    // Preserves existing keys
    expect(parsed.model).toBe("gpt-4");
  });

  it("patches an existing opencode.json fallback", () => {
    const jsonPath = join(tmpRoot, "opencode.json");
    writeFileSync(jsonPath, JSON.stringify({ theme: "dark" }, null, 2));
    const { configPath, action } = patchOpencodeConfig(tmpRoot);
    expect(action).toBe("patched");
    expect(configPath).toContain("opencode.json");
    const parsed = JSON.parse(readFileSync(jsonPath, "utf8")) as Record<string, unknown>;
    expect((parsed.plugin as string[]).includes(PLUGIN_PATH_SPEC)).toBe(true);
  });

  it("is idempotent — skips when plugin already present in opencode.jsonc", () => {
    const jsoncPath = join(tmpRoot, "opencode.jsonc");
    writeFileSync(
      jsoncPath,
      JSON.stringify({ plugin: [PLUGIN_PATH_SPEC] }, null, 2),
    );
    const before = readFileSync(jsoncPath, "utf8");
    const { action } = patchOpencodeConfig(tmpRoot);
    expect(action).toBe("skipped");
    expect(readFileSync(jsoncPath, "utf8")).toBe(before);
  });

  it("migrates package-name plugin spec to node_modules path spec", () => {
    const jsoncPath = join(tmpRoot, "opencode.jsonc");
    writeFileSync(
      jsoncPath,
      JSON.stringify({ plugin: ["opencode-blocker-diverter"], model: "gpt-4" }, null, 2),
    );
    const { action } = patchOpencodeConfig(tmpRoot);
    expect(action).toBe("patched");
    const parsed = JSON.parse(readFileSync(jsoncPath, "utf8")) as Record<string, unknown>;
    expect((parsed.plugin as string[]).includes(PLUGIN_PATH_SPEC)).toBe(true);
    expect((parsed.plugin as string[]).includes("opencode-blocker-diverter")).toBe(false);
    expect(parsed.model).toBe("gpt-4");
  });

  it("handles JSONC with comments and trailing commas", () => {
    const jsoncPath = join(tmpRoot, "opencode.jsonc");
    writeFileSync(
      jsoncPath,
      `{
  // OpenCode config
  "model": "gpt-4", // preferred model
  "plugin": [],
}`,
    );
    const { action } = patchOpencodeConfig(tmpRoot);
    expect(action).toBe("patched");
    const raw = readFileSync(jsoncPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect((parsed.plugin as string[]).includes(PLUGIN_PATH_SPEC)).toBe(true);
  });

  it("skips when file exists but is unparseable JSONC", () => {
    const jsoncPath = join(tmpRoot, "opencode.jsonc");
    writeFileSync(jsoncPath, "totally invalid {{ json }}");
    const { action } = patchOpencodeConfig(tmpRoot);
    expect(action).toBe("skipped");
    // File content must not be corrupted.
    expect(readFileSync(jsoncPath, "utf8")).toBe("totally invalid {{ json }}");
  });

  it("prefers opencode.jsonc over opencode.json when both exist", () => {
    const jsoncPath = join(tmpRoot, "opencode.jsonc");
    const jsonPath  = join(tmpRoot, "opencode.json");
    writeFileSync(jsoncPath, JSON.stringify({ from: "jsonc" }, null, 2));
    writeFileSync(jsonPath,  JSON.stringify({ from: "json"  }, null, 2));
    const { configPath, action } = patchOpencodeConfig(tmpRoot);
    expect(configPath).toBe(jsoncPath);
    expect(action).toBe("patched");
    // json file must remain untouched.
    expect(JSON.parse(readFileSync(jsonPath, "utf8"))).toEqual({ from: "json" });
  });

  it("should not add path spec when versioned npm spec exists (opencode-blocker-diverter@0.2.0)", () => {
    const jsoncPath = join(tmpRoot, "opencode.jsonc");
    writeFileSync(
      jsoncPath,
      JSON.stringify({ plugin: ["opencode-blocker-diverter@0.2.0"] }, null, 2),
    );
    const before = readFileSync(jsoncPath, "utf8");
    const { action } = patchOpencodeConfig(tmpRoot);
    expect(action).toBe("skipped");
    // File must not be touched.
    expect(readFileSync(jsoncPath, "utf8")).toBe(before);
    // The versioned spec must still be there; no second entry added.
    const parsed = JSON.parse(readFileSync(jsoncPath, "utf8")) as Record<string, unknown>;
    expect(parsed.plugin as string[]).toEqual(["opencode-blocker-diverter@0.2.0"]);
  });

  it("should not add path spec when tagged npm spec exists (opencode-blocker-diverter@latest)", () => {
    const jsoncPath = join(tmpRoot, "opencode.jsonc");
    writeFileSync(
      jsoncPath,
      JSON.stringify({ plugin: ["opencode-blocker-diverter@latest"] }, null, 2),
    );
    const before = readFileSync(jsoncPath, "utf8");
    const { action } = patchOpencodeConfig(tmpRoot);
    expect(action).toBe("skipped");
    expect(readFileSync(jsoncPath, "utf8")).toBe(before);
    const parsed = JSON.parse(readFileSync(jsoncPath, "utf8")) as Record<string, unknown>;
    expect(parsed.plugin as string[]).toEqual(["opencode-blocker-diverter@latest"]);
  });
});

// ---- patchTuiConfig ----

describe("patchTuiConfig", () => {
  it("creates .opencode/tui.jsonc when no tui config exists", () => {
    const { configPath, action } = patchTuiConfig(tmpRoot);
    expect(action).toBe("created");
    expect(configPath).toContain(".opencode/tui.jsonc");
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    expect((parsed.plugin as string[]).includes(TUI_PLUGIN_PATH_SPEC)).toBe(true);
  });

  it("patches existing .opencode/tui.jsonc without destroying other keys", () => {
    const tuiPath = join(tmpRoot, ".opencode", "tui.jsonc");
    mkdirSync(join(tmpRoot, ".opencode"), { recursive: true });
    writeFileSync(tuiPath, JSON.stringify({ keybinds: { command_list: "ctrl+p" } }, null, 2));
    const { action } = patchTuiConfig(tmpRoot);
    expect(action).toBe("patched");
    const parsed = JSON.parse(readFileSync(tuiPath, "utf8")) as Record<string, unknown>;
    expect((parsed.plugin as string[]).includes(TUI_PLUGIN_PATH_SPEC)).toBe(true);
    expect((parsed.keybinds as Record<string, unknown>).command_list).toBe("ctrl+p");
  });

  it("migrates package/root plugin spec to .opencode-relative tui spec", () => {
    const tuiPath = join(tmpRoot, ".opencode", "tui.jsonc");
    mkdirSync(join(tmpRoot, ".opencode"), { recursive: true });
    writeFileSync(tuiPath, JSON.stringify({ plugin: ["opencode-blocker-diverter", PLUGIN_PATH_SPEC] }, null, 2));
    const { action } = patchTuiConfig(tmpRoot);
    expect(action).toBe("patched");
    const parsed = JSON.parse(readFileSync(tuiPath, "utf8")) as Record<string, unknown>;
    const plugins = parsed.plugin as string[];
    expect(plugins.includes(TUI_PLUGIN_PATH_SPEC)).toBe(true);
    expect(plugins.includes("opencode-blocker-diverter")).toBe(false);
    expect(plugins.includes(PLUGIN_PATH_SPEC)).toBe(false);
  });

  it("should not add tui spec when versioned npm spec exists (opencode-blocker-diverter@0.2.0)", () => {
    const tuiPath = join(tmpRoot, ".opencode", "tui.jsonc");
    mkdirSync(join(tmpRoot, ".opencode"), { recursive: true });
    writeFileSync(tuiPath, JSON.stringify({ plugin: ["opencode-blocker-diverter@0.2.0"] }, null, 2));
    const before = readFileSync(tuiPath, "utf8");
    const { action } = patchTuiConfig(tmpRoot);
    expect(action).toBe("skipped");
    expect(readFileSync(tuiPath, "utf8")).toBe(before);
    const parsed = JSON.parse(readFileSync(tuiPath, "utf8")) as Record<string, unknown>;
    expect(parsed.plugin as string[]).toEqual(["opencode-blocker-diverter@0.2.0"]);
  });

  it("should not add tui spec when tagged npm spec exists (opencode-blocker-diverter@latest)", () => {
    const tuiPath = join(tmpRoot, ".opencode", "tui.jsonc");
    mkdirSync(join(tmpRoot, ".opencode"), { recursive: true });
    writeFileSync(tuiPath, JSON.stringify({ plugin: ["opencode-blocker-diverter@latest"] }, null, 2));
    const before = readFileSync(tuiPath, "utf8");
    const { action } = patchTuiConfig(tmpRoot);
    expect(action).toBe("skipped");
    expect(readFileSync(tuiPath, "utf8")).toBe(before);
    const parsed = JSON.parse(readFileSync(tuiPath, "utf8")) as Record<string, unknown>;
    expect(parsed.plugin as string[]).toEqual(["opencode-blocker-diverter@latest"]);
  });
});

// ---- bootstrap ----

describe("bootstrap", () => {
  let pkgDir: string;

  beforeEach(() => {
    pkgDir = makeTmp("-pkg");
    // Simulate the package's .opencode/commands directory with some files.
    const commandsDir = join(pkgDir, ".opencode", "commands");
    mkdirSync(commandsDir, { recursive: true });
    for (const name of [
      "blockers.on.md",
      "blockers.off.md",
      "blockers.status.md",
      "blockers.list.md",
      "blockers.clarify.md",
    ]) {
      writeFileSync(join(commandsDir, name), `# ${name}`);
    }
  });

  afterEach(() => {
    rmSync(pkgDir, { recursive: true, force: true });
  });

  it("creates opencode.jsonc and blocker files on a clean project", () => {
    writeFileSync(join(tmpRoot, "package.json"), JSON.stringify({ name: "my-app" }));
    const { written, patched } = bootstrap(tmpRoot, pkgDir);

    // opencode.jsonc should be patched/created
    expect(patched.length).toBeGreaterThan(0);
    const jsoncPath = join(tmpRoot, "opencode.jsonc");
    expect(existsSync(jsoncPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(jsoncPath, "utf8")) as Record<string, unknown>;
    expect((parsed.plugin as string[]).includes(PLUGIN_PATH_SPEC)).toBe(true);

    // blocker config
    expect(existsSync(join(tmpRoot, ".opencode", "blocker-diverter.json"))).toBe(true);
    // root-level blocker config
    expect(existsSync(join(tmpRoot, "blocker-diverter.json"))).toBe(true);
    const rootCfg = JSON.parse(readFileSync(join(tmpRoot, "blocker-diverter.json"), "utf8")) as Record<string, unknown>;
    expect(rootCfg.enabled).toBe(true);
    expect(rootCfg.defaultDivertBlockers).toBe(false);
    // tui config for Ctrl+P plugin runtime
    expect(existsSync(join(tmpRoot, ".opencode", "tui.jsonc"))).toBe(true);
    const tuiParsed = JSON.parse(readFileSync(join(tmpRoot, ".opencode", "tui.jsonc"), "utf8")) as Record<string, unknown>;
    expect((tuiParsed.plugin as string[]).includes(TUI_PLUGIN_PATH_SPEC)).toBe(true);
    // commands
    expect(existsSync(join(tmpRoot, ".opencode", "commands", "blockers.on.md"))).toBe(true);

    // No merged shim should be created
    expect(existsSync(join(tmpRoot, ".opencode", "plugins", "opencode-blocker-diverter.ts"))).toBe(false);
  });

  it("does NOT create the merged server+tui shim (incompatible with OpenCode 1.4)", () => {
    writeFileSync(join(tmpRoot, "package.json"), JSON.stringify({ name: "my-app" }));
    bootstrap(tmpRoot, pkgDir);
    const shimPath = join(tmpRoot, ".opencode", "plugins", "opencode-blocker-diverter.ts");
    expect(existsSync(shimPath)).toBe(false);
  });

  it("is idempotent on second run — opencode.jsonc not rewritten, command files overwritten", () => {
    writeFileSync(join(tmpRoot, "package.json"), JSON.stringify({ name: "my-app" }));
    bootstrap(tmpRoot, pkgDir);
    const jsoncPath = join(tmpRoot, "opencode.jsonc");
    const beforeContent = readFileSync(jsoncPath, "utf8");

    const { written, patched } = bootstrap(tmpRoot, pkgDir);
    // Config files must not be re-patched.
    expect(patched.length).toBe(0);
    // opencode.jsonc content must not change.
    expect(readFileSync(jsoncPath, "utf8")).toBe(beforeContent);
    // Command files are always overwritten (plugin-owned).
    const commandsWritten = written.filter((f) => f.includes("commands"));
    expect(commandsWritten.length).toBe(5);
  });

  it("does not overwrite a user-edited config", () => {
    writeFileSync(join(tmpRoot, "package.json"), JSON.stringify({ name: "my-app" }));
    const configPath = join(tmpRoot, ".opencode", "blocker-diverter.json");
    mkdirSync(join(tmpRoot, ".opencode"), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ enabled: false, custom: true }));
    bootstrap(tmpRoot, pkgDir);
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    expect(parsed.enabled).toBe(false);
    expect(parsed.custom).toBe(true);
  });

  it("does not overwrite existing root blocker-diverter.json on re-run", () => {
    writeFileSync(join(tmpRoot, "package.json"), JSON.stringify({ name: "my-app" }));
    const rootCfgPath = join(tmpRoot, "blocker-diverter.json");
    writeFileSync(rootCfgPath, JSON.stringify({ enabled: false, custom: "user-value" }));
    bootstrap(tmpRoot, pkgDir);
    const parsed = JSON.parse(readFileSync(rootCfgPath, "utf8")) as Record<string, unknown>;
    expect(parsed.enabled).toBe(false);
    expect(parsed.custom).toBe("user-value");
  });

  it("patches existing opencode.jsonc non-destructively", () => {
    writeFileSync(join(tmpRoot, "package.json"), JSON.stringify({ name: "my-app" }));
    const jsoncPath = join(tmpRoot, "opencode.jsonc");
    writeFileSync(jsoncPath, JSON.stringify({ model: "gpt-4", theme: "dark" }, null, 2));
    bootstrap(tmpRoot, pkgDir);
    const parsed = JSON.parse(readFileSync(jsoncPath, "utf8")) as Record<string, unknown>;
    expect(parsed.model).toBe("gpt-4");
    expect(parsed.theme).toBe("dark");
    expect((parsed.plugin as string[]).includes(PLUGIN_PATH_SPEC)).toBe(true);
  });

  it("skips missing command source files gracefully", () => {
    writeFileSync(join(tmpRoot, "package.json"), JSON.stringify({ name: "my-app" }));
    // Use an empty pkgDir without commands
    const emptyPkg = makeTmp("-empty");
    try {
      const { written } = bootstrap(tmpRoot, emptyPkg);
      // No commands written
      const commandsWritten = written.filter((f) => f.includes("commands"));
      expect(commandsWritten.length).toBe(0);
    } finally {
      rmSync(emptyPkg, { recursive: true, force: true });
    }
  });

  it("should overwrite existing command files on reinstall", () => {
    writeFileSync(join(tmpRoot, "package.json"), JSON.stringify({ name: "my-app" }));
    // Pre-seed a stale version of a command file in the dest.
    const commandsDest = join(tmpRoot, ".opencode", "commands");
    mkdirSync(commandsDest, { recursive: true });
    writeFileSync(join(commandsDest, "blockers.on.md"), "# stale old content");

    bootstrap(tmpRoot, pkgDir);

    // File must now contain the new source content, not the stale content.
    const content = readFileSync(join(commandsDest, "blockers.on.md"), "utf8");
    expect(content).toBe("# blockers.on.md");
    expect(content).not.toBe("# stale old content");
  });
});
