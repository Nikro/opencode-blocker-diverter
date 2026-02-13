# 🚨 CRITICAL STRUCTURE CORRECTION

## The Problem

We've been building the Blocker Diverter plugin in the WRONG location with the WRONG structure.

### What We Did Wrong

```
.opencode/plugin/blocker-diverter/
├── types.ts
├── config.ts
├── state.ts
├── utils/
│   ├── logging.ts
│   ├── dedupe.ts
│   └── templates.ts
└── tests/
```

**This is INCORRECT** for an OpenCode plugin distributed via npm!

### What The Correct Structure Should Be

Based on analysis of [oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode) and [official docs](https://opencode.ai/docs/plugins/):

```
opencode-blocker-diverter/   (npm package root)
├── package.json             (npm package manifest)
├── tsconfig.json            (TypeScript config)
├── src/                     (SOURCE CODE - gets built to dist/)
│   ├── index.ts             (plugin entry point)
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
│   │   └── ...
│   └── commands/
│       └── blockers-cmd.ts
├── tests/                   (TESTS - at root or in src/)
│   ├── types.test.ts
│   ├── config.test.ts
│   └── utils/
│       ├── logging.test.ts
│       ├── dedupe.test.ts
│       └── templates.test.ts
├── dist/                    (BUILD OUTPUT - ignored by git)
│   ├── index.js
│   ├── index.d.ts
│   └── ...
└── .opencode/               (OPTIONAL - only for commands/skills)
    ├── commands/
    └── skills/
```

## Key Differences

### 1. **NPM Package Structure** (oh-my-opencode pattern)

- **Root-level npm package** with `package.json`
- **`src/` directory** for source code
- **`dist/` directory** for built output (TypeScript → JavaScript)
- **Build script**: `bun build src/index.ts --outdir dist`
- **Entry point**: `"main": "dist/index.js"`
- **Published to npm**: Users install via `npm i opencode-blocker-diverter`

### 2. **Local Plugin Pattern** (simple .opencode/ plugins)

- **Direct JavaScript/TypeScript files** in `.opencode/plugins/`
- **No build step** - loaded directly by OpenCode
- **No npm package** - local to project or global config
- **Entry point**: `.opencode/plugins/blocker-diverter.ts`

## What OpenCode Official Docs Say

From https://opencode.ai/docs/plugins/:

### From Local Files
> Place JavaScript or TypeScript files in the plugin directory:
> - `.opencode/plugins/` - Project-level plugins
> - `~/.config/opencode/plugins/` - Global plugins

**Use case**: Simple plugins, prototypes, personal tools

### From NPM
> Specify npm packages in your config file:
> ```json
> {
>   "plugin": ["opencode-helicone-session", "opencode-wakatime"]
> }
> ```

**Use case**: Distributable plugins, complex projects, community packages

## What We Should Do

### Option 1: Local Plugin (Simple, Quick)

**Pros**:
- No npm publishing needed
- Simpler structure
- Faster iteration

**Cons**:
- Not distributable
- Users must manually copy files
- No dependency management

**Structure**:
```
.opencode/plugins/blocker-diverter.ts  (single file)
OR
.opencode/plugins/blocker-diverter/
├── index.ts
├── types.ts
├── config.ts
└── utils/
```

**Installation**:
```bash
# User copies files to their project
cp -r .opencode/plugins/blocker-diverter ~/.config/opencode/plugins/
```

### Option 2: NPM Package (Professional, Distributable)

**Pros**:
- Distributable via npm
- Proper dependency management
- Professional structure
- Follows community standards

**Cons**:
- Requires npm publishing
- More complex setup
- Need build step

**Structure**:
```
opencode-blocker-diverter/  (npm package)
├── package.json
├── src/
│   ├── index.ts
│   └── ...
├── dist/  (built output)
└── tests/
```

**Installation**:
```bash
# User installs from npm
npm install opencode-blocker-diverter
```

**Config**:
```json
{
  "plugin": ["opencode-blocker-diverter"]
}
```

## Recommendation

Given that:
1. **This is a pre-release** (v0.1.0)
2. **We're experimenting** with the meta-agent pattern
3. **Community distribution is a goal** (from README)
4. **We have complex dependencies** (Zod, multiple modules)

**→ We should use Option 2 (NPM Package structure)**

But for **development**, we can:
1. Develop as local plugin first (`.opencode/plugins/`)
2. Refactor to npm package structure when ready for v1.0.0

## Immediate Action Plan

### Phase 1: Fix Current Development (Local Plugin)

1. **Move files to correct location**:
   ```bash
   mkdir -p .opencode/plugins/blocker-diverter
   mv .opencode/plugin/blocker-diverter/* .opencode/plugins/blocker-diverter/
   rm -rf .opencode/plugin
   ```

2. **Update import paths** (if needed)

3. **Update documentation**:
   - `AGENTS.md`: Correct directory path
   - `README.md`: Installation instructions
   - `plan.md`: Project structure

4. **Continue development** with current approach

### Phase 2: Prepare for NPM Distribution (v1.0.0)

1. **Restructure as npm package**:
   ```bash
   mkdir src
   mv .opencode/plugins/blocker-diverter/* src/
   ```

2. **Add build tooling**:
   - Update `package.json` with build scripts
   - Add `tsconfig.json` for proper compilation
   - Set up `dist/` output

3. **Test npm package locally**:
   ```bash
   npm link
   cd ~/test-project
   npm link opencode-blocker-diverter
   ```

4. **Publish to npm** when ready

## Examples from the Wild

### Simple Local Plugin (opencode docs example)

```typescript
// .opencode/plugins/notification.js
export const NotificationPlugin = async ({ client, $ }) => {
  return {
    event: async ({ event }) => {
      if (event.type === "session.idle") {
        await $`osascript -e 'display notification "Done!"'`
      }
    },
  }
}
```

### Complex NPM Plugin (oh-my-opencode)

```typescript
// src/index.ts
import type { Plugin } from "@opencode-ai/plugin"
import { createHooks } from "./create-hooks"
import { createTools } from "./create-tools"

export const OhMyOpenCode: Plugin = async (ctx) => {
  const hooks = await createHooks(ctx)
  const tools = await createTools(ctx)
  
  return {
    ...hooks,
    tool: tools,
  }
}
```

## Conclusion

**For now (development)**:
- Move to `.opencode/plugins/blocker-diverter/`
- Continue TDD workflow
- Focus on functionality

**For v1.0.0 (release)**:
- Restructure as npm package
- Add build tooling
- Publish to npm registry

**Critical files to update**:
1. `AGENTS.md` - Project structure section
2. `README.md` - Installation instructions  
3. `plan.md` - Architecture documentation
4. `.specify/memory/constitution.md` - Directory standards

---

**Sources**:
- https://opencode.ai/docs/plugins/ (Official docs)
- https://github.com/code-yeongyu/oh-my-opencode (Reference implementation)
- https://opencode.ai/docs/ecosystem#plugins (Community examples)
