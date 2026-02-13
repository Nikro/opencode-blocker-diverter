# 🎯 Plugin Structure Fix - Action Plan

## Current Situation (WRONG)

```
/var/www/opencode-blocker-diverter/
├── .opencode/plugin/blocker-diverter/  ❌ WRONG LOCATION
│   ├── types.ts
│   ├── config.ts
│   ├── state.ts
│   ├── utils/
│   └── tests/
├── utils/templates.ts                   ❌ WRONG LOCATION (orphaned)
├── tests/utils/templates.test.ts        ❌ WRONG LOCATION (orphaned)
└── package.json                         ✅ Correct (but needs updates)
```

## Correct NPM Plugin Structure

Based on analysis of **subtask2** (simple, clean) and **oh-my-opencode** (comprehensive), here's the proper structure for distributable OpenCode plugins:

```
opencode-blocker-diverter/              (npm package root)
├── package.json                        (npm manifest with build scripts)
├── tsconfig.json                       (TypeScript compilation config)
├── index.ts                            (Entry point: exports the plugin)
├── src/                                (Source code - compiled to dist/)
│   ├── types.ts
│   ├── config.ts
│   ├── state.ts
│   ├── utils/
│   │   ├── logging.ts
│   │   ├── dedupe.ts
│   │   └── templates.ts
│   ├── hooks/
│   │   ├── permission.ts
│   │   ├── session.ts
│   │   ├── stop.ts
│   │   └── ...
│   ├── commands/
│   │   └── blockers-cmd.ts
│   └── core/
│       └── plugin.ts                   (Plugin factory function)
├── tests/                              (Test files)
│   ├── types.test.ts
│   ├── config.test.ts
│   └── utils/
│       ├── logging.test.ts
│       ├── dedupe.test.ts
│       └── templates.test.ts
├── dist/                               (Build output - gitignored)
│   ├── index.js
│   ├── index.d.ts
│   └── ...
├── .opencode/                          (OPTIONAL - only for example commands)
│   └── commands/
│       └── example-blocker.md
├── README.md
├── .gitignore
└── .npmignore
```

### Key Points from Reference Plugins

#### subtask2 Pattern (Simple & Clean)
- **Entry**: `index.ts` → `export default createPlugin`
- **Core**: `src/core/plugin.ts` (factory function)
- **Features**: `src/features/`, `src/hooks/`, `src/commands/`
- **Build**: `"main": "./dist/index.js"`
- **Published**: `@spoons-and-mirrors/subtask2`

#### oh-my-opencode Pattern (Comprehensive)
- **Entry**: `src/index.ts` → `export const OhMyOpenCode: Plugin`
- **Organized**: `src/agents/`, `src/hooks/`, `src/tools/`, `src/mcp/`
- **Build**: Complex with Bun + native binaries
- **Config**: `.opencode/` for commands/skills (user-facing)

## What We Need to Fix

### 1. Move Files to Correct Locations

```bash
# Create proper structure
mkdir -p src/{hooks,commands,utils,core}
mkdir -p tests/utils

# Move existing files
mv .opencode/plugin/blocker-diverter/types.ts src/
mv .opencode/plugin/blocker-diverter/config.ts src/
mv .opencode/plugin/blocker-diverter/state.ts src/
mv .opencode/plugin/blocker-diverter/utils/* src/utils/
mv .opencode/plugin/blocker-diverter/tests/*.test.ts tests/
mv .opencode/plugin/blocker-diverter/tests/utils/*.test.ts tests/utils/

# Move orphaned files
mv utils/templates.ts src/utils/
mv tests/utils/templates.test.ts tests/utils/

# Clean up old structure
rm -rf .opencode/plugin
rm -rf utils tests
```

### 2. Create Entry Point

**`index.ts`** (root):
```typescript
/**
 * Blocker Diverter Plugin - Main Entry Point
 * 
 * Enables autonomous overnight AI coding sessions by intercepting blocker
 * questions and allowing agents to self-triage and continue working.
 */

import { createPlugin } from "./src/core/plugin"

export default createPlugin
```

**`src/core/plugin.ts`**:
```typescript
import type { Plugin } from "@opencode-ai/plugin"

export const createPlugin: Plugin = async ({ client, project, $, directory, worktree }) => {
  // Load config
  const config = await loadConfig(project.worktree)
  
  // Initialize state
  const sessions = new Map()
  
  // Return hooks
  return {
    "permission.asked": async (input, output) => {
      // Permission hook logic
    },
    
    event: async ({ event }) => {
      if (event.type === "session.idle") {
        // Session idle logic
      }
    },
    
    stop: async (input) => {
      // Stop prevention logic
    },
    
    // ... other hooks
  }
}
```

### 3. Update package.json

```json
{
  "name": "opencode-blocker-diverter",
  "version": "0.1.0",
  "description": "OpenCode plugin for autonomous session management via blocker self-triage",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": [
    "dist/",
    "README.md",
    "LICENSE"
  ],
  "scripts": {
    "build": "tsc && cp src/**/*.md dist/ || true",
    "clean": "rm -rf dist",
    "test": "bun test tests/**/*.test.ts",
    "typecheck": "tsc --noEmit",
    "prepublishOnly": "bun run clean && bun run build"
  },
  "keywords": [
    "opencode",
    "opencode-plugin",
    "plugin",
    "autonomous",
    "blocker",
    "overnight",
    "meta-agent"
  ],
  "peerDependencies": {
    "@opencode-ai/plugin": "^1.0.0"
  },
  "dependencies": {
    "@opencode-ai/sdk": "latest",
    "zod": "^4.1.8"
  },
  "devDependencies": {
    "@opencode-ai/plugin": "^1.1.19",
    "bun-types": "^1.3.6",
    "typescript": "^5.7.3"
  }
}
```

### 4. Update tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "lib": ["ES2022"],
    "moduleResolution": "bundler",
    "outDir": "./dist",
    "rootDir": ".",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "types": ["bun-types"]
  },
  "include": [
    "index.ts",
    "src/**/*"
  ],
  "exclude": [
    "node_modules",
    "dist",
    "tests"
  ]
}
```

### 5. Update .gitignore

```gitignore
# Build output
dist/
*.tsbuildinfo

# Dependencies
node_modules/
bun.lockb

# Environment
.env
.env.local

# IDE
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Test coverage
coverage/
.nyc_output/
```

### 6. Create .npmignore

```npmignore
# Source files
src/
tests/
*.ts
!dist/**/*.d.ts

# Development files
.opencode/
specs/
.specify/
tsconfig.json
.gitignore
.prettierrc
.eslintrc.*

# Documentation (keep README.md, exclude others)
AGENTS.md
STRUCTURE-*.md
PLAN.md

# Git
.git/
.github/
```

### 7. Update Import Paths

After moving files to `src/`, update all import statements:

**Before** (`.opencode/plugin/blocker-diverter/`):
```typescript
import { SessionState } from './types'
import { loadConfig } from './config'
import { getState } from './state'
```

**After** (`src/`):
```typescript
import { SessionState } from './types'
import { loadConfig } from './config'
import { getState } from './state'
```

**Tests** (`tests/`):
```typescript
import { SessionState } from '../src/types'
import { loadConfig } from '../src/config'
```

## Installation Methods (After Fix)

### Method 1: NPM (Recommended for users)

```bash
# Publish to npm
npm publish

# Users install
npm install opencode-blocker-diverter
```

**User config** (`opencode.json`):
```json
{
  "plugin": ["opencode-blocker-diverter"]
}
```

### Method 2: Local (Development)

```bash
# Link locally
npm link

# In test project
npm link opencode-blocker-diverter
```

### Method 3: Direct File (Quick testing)

**NOT RECOMMENDED** - but possible for quick tests:

```bash
# Copy built plugin
cp -r dist ~/.config/opencode/plugins/blocker-diverter
```

## Migration Checklist

- [ ] Create `src/`, `tests/`, `dist/` directories
- [ ] Move all implementation files to `src/`
- [ ] Move all test files to `tests/`
- [ ] Create `index.ts` (root entry point)
- [ ] Create `src/core/plugin.ts` (plugin factory)
- [ ] Update `package.json` (main, types, exports, scripts)
- [ ] Update `tsconfig.json` (outDir, rootDir, include)
- [ ] Create `.npmignore` (exclude source, keep dist)
- [ ] Update `.gitignore` (add dist/)
- [ ] Fix all import paths (relative to `src/`)
- [ ] Update test imports (relative to `../src/`)
- [ ] Run `bun run build` - verify dist/ is created
- [ ] Run `bun test` - verify all tests pass
- [ ] Run `bun run typecheck` - verify no errors
- [ ] Update documentation:
  - [ ] `README.md` (installation instructions)
  - [ ] `AGENTS.md` (project structure)
  - [ ] `plan.md` (architecture)
  - [ ] `.specify/memory/constitution.md` (directory standards)

## Post-Migration Workflow

### Development
```bash
# Make changes in src/
vim src/hooks/permission.ts

# Run tests
bun test

# Type check
bun run typecheck

# Build
bun run build

# Test built plugin locally
npm link
```

### Publishing
```bash
# Ensure clean build
bun run clean
bun run build

# Test package contents
npm pack --dry-run

# Publish
npm publish
```

### User Installation
```bash
# Install from npm
npm install opencode-blocker-diverter

# Or from git
npm install git+https://github.com/yourusername/opencode-blocker-diverter.git
```

## Why This Structure?

### Pros of NPM Plugin Structure
✅ **Distributable** - Users install via `npm install`
✅ **Dependency management** - npm/Bun handles transitive deps
✅ **Versioning** - Semantic versioning with npm
✅ **Professional** - Standard package structure
✅ **Build tooling** - TypeScript compilation, type definitions
✅ **Community standard** - Matches ecosystem examples

### Cons of Old `.opencode/plugin/` Structure  
❌ **Not distributable** - Users must manually copy files
❌ **No dependency management** - Zod, etc. not installed
❌ **No versioning** - Hard to track updates
❌ **Non-standard** - Doesn't match community patterns
❌ **No build step** - Can't use TypeScript features fully

## References

- **subtask2**: https://github.com/spoons-and-mirrors/subtask2
  - Simple, clean npm plugin structure
  - Single entry point pattern
  - Modular `src/` organization
  
- **oh-my-opencode**: https://github.com/code-yeongyu/oh-my-opencode
  - Comprehensive plugin with many features
  - Professional build tooling
  - `.opencode/` for user-facing commands only

- **OpenCode Docs**: https://opencode.ai/docs/plugins/
  - Official plugin guidelines
  - NPM vs local file patterns
  - Hook reference

## Next Steps

1. **Execute migration** (follow checklist above)
2. **Update all documentation** to reflect new structure
3. **Continue development** with proper structure
4. **Prepare for v0.1.0 release** when MVP complete
5. **Publish to npm** for community distribution

---

**TL;DR**: We need to restructure as a proper npm package with `src/` → `dist/` build flow, not a local `.opencode/plugin/` directory. This matches community standards and enables distribution.
