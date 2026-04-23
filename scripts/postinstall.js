#!/usr/bin/env node
/**
 * postinstall.js — Auto-seeds the consuming project with Blocker Diverter
 * config/commands so no manual opencode.jsonc edits are required.
 *
 * Safety rules:
 *   - Skip global installs (npm_config_global === "true")
 *   - Skip if INIT_CWD has no package.json (not a real project)
 *   - Never overwrite existing user files (idempotent)
 *   - Graceful failure (never break npm install)
 *
 * OpenCode 1.4 compatibility:
 *   - Does NOT create a merged server+tui shim (incompatible with v1 plugin contract)
 *   - Instead patches project-level opencode.jsonc to add
 *     "./node_modules/opencode-blocker-diverter" to the "plugin" array
 *     — the supported registration path without global config edits.
 */

import { existsSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const PKG_DIR = resolve(fileURLToPath(import.meta.url), "..", "..");
const TARGET_DIR = process.env.INIT_CWD ?? process.cwd();

/**
 * Write a file only if it does not already exist.
 * @param {string} filePath - Absolute path to write.
 * @param {string} content  - Content to write.
 * @returns {boolean} true if written, false if skipped.
 */
export function writeIfMissing(filePath, content) {
  if (existsSync(filePath)) return false;
  mkdirSync(resolve(filePath, ".."), { recursive: true });
  writeFileSync(filePath, content, "utf8");
  return true;
}

/**
 * Copy a file only if the destination does not already exist.
 * @param {string} src  - Source absolute path.
 * @param {string} dest - Destination absolute path.
 * @returns {boolean} true if copied, false if skipped.
 */
export function copyIfMissing(src, dest) {
  if (existsSync(dest)) return false;
  mkdirSync(resolve(dest, ".."), { recursive: true });
  copyFileSync(src, dest);
  return true;
}

/**
 * Copy a file unconditionally, overwriting the destination if it exists.
 * @param {string} src  - Source absolute path.
 * @param {string} dest - Destination absolute path.
 * @returns {boolean} true if the file was written (source existed), false if source missing.
 */
export function copyAlways(src, dest) {
  if (!existsSync(src)) return false;
  mkdirSync(resolve(dest, ".."), { recursive: true });
  copyFileSync(src, dest);
  return true;
}

/**
 * Check whether a directory is a real consuming project (has package.json,
 * and is not the plugin package itself).
 * @param {string} dir - Directory to check.
 * @returns {boolean}
 */
export function isConsumingProject(dir) {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    // Don't seed ourselves during our own development install.
    if (pkg.name === "opencode-blocker-diverter") return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Check whether a directory is the OpenCode global config directory.
 * On most systems this is ~/.config/opencode (or $XDG_CONFIG_HOME/opencode).
 * When the plugin is installed into the global config dir, OpenCode scans
 * `commands/` directly (not `.opencode/commands/`), so templates must be
 * written there as well.
 * @param {string} dir - Directory to check.
 * @returns {boolean}
 */
export function isOpenCodeGlobalConfigDir(dir) {
  const xdgConfig = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  const globalDir = join(xdgConfig, "opencode");

  /**
   * Resolve canonical paths so that symlinks are followed before comparison.
   * Falls back to path.resolve() when realpathSync fails (e.g. path does not
   * exist yet), keeping behaviour unchanged for non-symlink paths.
   * @param {string} p
   * @returns {string}
   */
  function canonical(p) {
    try {
      return realpathSync(p);
    } catch {
      return resolve(p);
    }
  }

  return canonical(dir) === canonical(globalDir);
}

/**
 * Strip JSONC line comments and trailing commas so the result can be parsed
 * with JSON.parse.  This is intentionally simple — it handles the common
 * opencode.jsonc style and is NOT a full JSONC parser.
 * @param {string} text - Raw JSONC source.
 * @returns {string} JSON-safe string.
 */
export function stripJsonc(text) {
  let output = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inString) {
      output += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      output += ch;
      continue;
    }

    // Strip single-line comments only when outside strings.
    if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      if (i < text.length) output += "\n";
      continue;
    }

    output += ch;
  }

  // Strip trailing commas before } or ].
  return output.replace(/,(\s*[}\]])/g, "$1");
}

/**
 * Idempotently patch the project-level opencode config to include this plugin.
 *
 * Search order for existing config:
 *   1. opencode.jsonc
 *   2. opencode.json
 *   (creates opencode.jsonc when neither exists)
 *
 * The "plugin" key is patched to include the local node_modules path spec
 * "./node_modules/opencode-blocker-diverter".
 *
 * @param {string} targetDir - Root of the consuming project.
 * @returns {{ configPath: string, action: "created"|"patched"|"skipped" }}
 */
export function patchOpencodeConfig(targetDir) {
  const PLUGIN_NAME = "opencode-blocker-diverter";
  const PLUGIN_PATH_SPEC = "./node_modules/opencode-blocker-diverter";
  const jsoncPath = join(targetDir, "opencode.jsonc");
  const jsonPath  = join(targetDir, "opencode.json");

  // Determine which file to use.
  let configPath;
  let rawContent;
  if (existsSync(jsoncPath)) {
    configPath = jsoncPath;
    rawContent = readFileSync(jsoncPath, "utf8");
  } else if (existsSync(jsonPath)) {
    configPath = jsonPath;
    rawContent = readFileSync(jsonPath, "utf8");
  } else {
    // Neither exists — create a minimal opencode.jsonc.
    configPath = jsoncPath;
    const minimal = JSON.stringify({ plugin: [PLUGIN_PATH_SPEC] }, null, 2) + "\n";
    mkdirSync(resolve(configPath, ".."), { recursive: true });
    writeFileSync(configPath, minimal, "utf8");
    return { configPath, action: "created" };
  }

  // Fast-path idempotency check — avoid full parse when possible.
  if (rawContent.includes(`"${PLUGIN_PATH_SPEC}"`)) {
    return { configPath, action: "skipped" };
  }

  // Parse (stripping JSONC comments/trailing commas).
  let config;
  try {
    config = JSON.parse(stripJsonc(rawContent));
  } catch {
    // Unparseable config — don't corrupt it, just skip.
    return { configPath, action: "skipped" };
  }

  // Ensure "plugin" is an array and append.
  if (!Array.isArray(config.plugin)) config.plugin = [];

  // Normalize plugin spec:
  // - If package name exists, replace with node_modules path spec
  // - If tuple form [spec, options] uses package name, replace tuple head only
  // - If neither exists, append path spec
  let hasPathSpec = false;
  let migratedPackageName = false;

  config.plugin = config.plugin.map((entry) => {
    if (typeof entry === "string") {
      if (entry === PLUGIN_PATH_SPEC) {
        hasPathSpec = true;
        return entry;
      }
      if (entry === PLUGIN_NAME) {
        migratedPackageName = true;
        hasPathSpec = true;
        return PLUGIN_PATH_SPEC;
      }
      // Versioned/tagged npm spec e.g. "opencode-blocker-diverter@0.2.0" — leave untouched.
      if (entry.startsWith(PLUGIN_NAME)) {
        hasPathSpec = true;
        return entry;
      }
      return entry;
    }

    if (Array.isArray(entry) && typeof entry[0] === "string") {
      if (entry[0] === PLUGIN_PATH_SPEC) {
        hasPathSpec = true;
        return entry;
      }
      if (entry[0] === PLUGIN_NAME) {
        migratedPackageName = true;
        hasPathSpec = true;
        const cloned = [...entry];
        cloned[0] = PLUGIN_PATH_SPEC;
        return cloned;
      }
    }

    return entry;
  });

  let appendedPathSpec = false;
  if (!hasPathSpec) {
    config.plugin.push(PLUGIN_PATH_SPEC);
    appendedPathSpec = true;
  }

  // If nothing changed after parse, keep file untouched.
  if (!migratedPackageName && !appendedPathSpec && hasPathSpec) {
    return { configPath, action: "skipped" };
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
  return { configPath, action: "patched" };
}

/**
 * Idempotently patch project-level TUI config under .opencode/ to include
 * blocker diverter TUI plugin registration.
 *
 * Search order for existing config:
 *   1. .opencode/tui.jsonc
 *   2. .opencode/tui.json
 *   (creates .opencode/tui.jsonc when neither exists)
 *
 * Uses path spec relative to .opencode/: "../node_modules/opencode-blocker-diverter"
 *
 * @param {string} targetDir - Root of the consuming project.
 * @returns {{ configPath: string, action: "created"|"patched"|"skipped" }}
 */
export function patchTuiConfig(targetDir) {
  const PLUGIN_NAME = "opencode-blocker-diverter";
  const ROOT_SPEC = "./node_modules/opencode-blocker-diverter";
  const TUI_SPEC = "../node_modules/opencode-blocker-diverter";
  const jsoncPath = join(targetDir, ".opencode", "tui.jsonc");
  const jsonPath = join(targetDir, ".opencode", "tui.json");

  let configPath;
  let rawContent;
  if (existsSync(jsoncPath)) {
    configPath = jsoncPath;
    rawContent = readFileSync(jsoncPath, "utf8");
  } else if (existsSync(jsonPath)) {
    configPath = jsonPath;
    rawContent = readFileSync(jsonPath, "utf8");
  } else {
    configPath = jsoncPath;
    const minimal = JSON.stringify({ plugin: [TUI_SPEC] }, null, 2) + "\n";
    mkdirSync(resolve(configPath, ".."), { recursive: true });
    writeFileSync(configPath, minimal, "utf8");
    return { configPath, action: "created" };
  }

  if (rawContent.includes(`"${TUI_SPEC}"`)) {
    return { configPath, action: "skipped" };
  }

  let config;
  try {
    config = JSON.parse(stripJsonc(rawContent));
  } catch {
    return { configPath, action: "skipped" };
  }

  if (!Array.isArray(config.plugin)) config.plugin = [];

  let hasTuiSpec = false;
  let migrated = false;
  let appended = false;

  config.plugin = config.plugin.map((entry) => {
    if (typeof entry === "string") {
      if (entry === TUI_SPEC) {
        hasTuiSpec = true;
        return entry;
      }
      if (entry === PLUGIN_NAME || entry === ROOT_SPEC) {
        hasTuiSpec = true;
        migrated = true;
        return TUI_SPEC;
      }
      // Versioned/tagged npm spec e.g. "opencode-blocker-diverter@0.2.0" — leave untouched.
      if (entry.startsWith(PLUGIN_NAME)) {
        hasTuiSpec = true;
        return entry;
      }
      return entry;
    }

    if (Array.isArray(entry) && typeof entry[0] === "string") {
      if (entry[0] === TUI_SPEC) {
        hasTuiSpec = true;
        return entry;
      }
      if (entry[0] === PLUGIN_NAME || entry[0] === ROOT_SPEC) {
        hasTuiSpec = true;
        migrated = true;
        const cloned = [...entry];
        cloned[0] = TUI_SPEC;
        return cloned;
      }
    }

    return entry;
  });

  if (!hasTuiSpec) {
    config.plugin.push(TUI_SPEC);
    appended = true;
  }

  if (!migrated && !appended && hasTuiSpec) {
    return { configPath, action: "skipped" };
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
  return { configPath, action: "patched" };
}

/**
 * Generate minimal default config content.
 * @returns {string}
 */
export function generateDefaultConfig() {
  return JSON.stringify(
    {
      enabled: true,
      defaultDivertBlockers: false,
    },
    null,
    2,
  ) + "\n";
}

/**
 * Main bootstrap — seeds the consuming project.
 * Exported for testability; the default export also calls this.
 * @param {string} targetDir - Root of the consuming project.
 * @param {string} pkgDir    - Root of the installed npm package.
 * @returns {{ written: string[], skipped: string[], patched: string[] }}
 */
export function bootstrap(targetDir, pkgDir) {
  const written  = [];
  const skipped  = [];
  const patched  = [];

  const record = (path, didWrite) =>
    didWrite ? written.push(path) : skipped.push(path);

  // 1. Patch / create project-level opencode.jsonc with plugin registration.
  const { configPath, action } = patchOpencodeConfig(targetDir);
  if (action === "created" || action === "patched") {
    patched.push(configPath);
  } else {
    skipped.push(configPath);
  }

  // 2. Default blocker-diverter config (never overwrite user edits).
  // For the OpenCode global config dir (~/.config/opencode), OpenCode loads
  // blocker-diverter.json directly from the root — do NOT create a duplicate
  // under .opencode/ which would cause confusion on reinstall.
  if (!isOpenCodeGlobalConfigDir(targetDir)) {
    const bdConfigPath = join(targetDir, ".opencode", "blocker-diverter.json");
    record(bdConfigPath, writeIfMissing(bdConfigPath, generateDefaultConfig()));
  }

  // 2b. Root-level blocker-diverter.json (the canonical location for global
  // config installs; also convenient for project installs).
  const rootBdConfigPath = join(targetDir, "blocker-diverter.json");
  record(rootBdConfigPath, writeIfMissing(rootBdConfigPath, generateDefaultConfig()));

  // 3. Patch/create .opencode/tui.jsonc so Ctrl+P commands are available.
  const tuiPatch = patchTuiConfig(targetDir);
  if (tuiPatch.action === "created" || tuiPatch.action === "patched") {
    patched.push(tuiPatch.configPath);
  } else {
    skipped.push(tuiPatch.configPath);
  }

  // 4. Seed command markdown files so OpenCode can find them for server-side
  //    slash command dispatch (api.client.session.command()).
  //    For the global config dir, OpenCode scans commands/ at the root.
  //    For project installs, commands live under .opencode/commands/.
  //    Use copyIfMissing so user edits are never overwritten.
  const commandsSrc = join(pkgDir, ".opencode", "commands");
  const commandsDest = isOpenCodeGlobalConfigDir(targetDir)
    ? join(targetDir, "commands")
    : join(targetDir, ".opencode", "commands");

  const BLOCKER_COMMANDS = [
    "blockers.on.md",
    "blockers.off.md",
    "blockers.status.md",
    "blockers.list.md",
    "blockers.clarify.md",
  ];
  for (const file of BLOCKER_COMMANDS) {
    const src = join(commandsSrc, file);
    const dest = join(commandsDest, file);
    if (existsSync(src)) {
      record(dest, copyIfMissing(src, dest));
    }
  }

  return { written, skipped, patched };
}

// ---- CLI entry point ----
// Only runs when executed directly (not when imported for tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  // Skip global installs.
  if (process.env.npm_config_global === "true") {
    console.log("[blocker-diverter] Global install detected — skipping project bootstrap.");
    process.exit(0);
  }

  if (!isConsumingProject(TARGET_DIR)) {
    console.log("[blocker-diverter] No consuming project found at INIT_CWD — skipping bootstrap.");
    process.exit(0);
  }

  try {
    const { written, skipped, patched } = bootstrap(TARGET_DIR, PKG_DIR);
    if (patched.length > 0) {
      console.log("[blocker-diverter] opencode.jsonc patched with plugin registration:");
      for (const f of patched) console.log(`  ~ ${f}`);
    }
    if (written.length > 0) {
      console.log("[blocker-diverter] Bootstrap complete. Files created:");
      for (const f of written) console.log(`  + ${f}`);
    }
    if (skipped.length > 0) {
      console.log("[blocker-diverter] Files already exist (skipped):");
      for (const f of skipped) console.log(`  ~ ${f}`);
    }
    console.log(
      "[blocker-diverter] Restart OpenCode and use /blockers.on to activate autonomous mode.",
    );
  } catch (err) {
    // Never let postinstall break the install.
    console.warn("[blocker-diverter] Bootstrap failed (non-fatal):", err instanceof Error ? err.message : String(err));
  }
}
