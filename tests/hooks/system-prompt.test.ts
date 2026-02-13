import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test'
import type { Plugin, PluginConfig } from "../../src/types"
import { createSystemPromptHook } from "../../src/hooks/system-prompt"
import { getState, cleanupState } from "../../src/state"
import * as templates from "../../src/utils/templates"

describe("System Prompt Hook", () => {
  let mockContext: Parameters<Plugin>[0]
  let mockConfig: PluginConfig
  const testSessionId = "test-session-system-prompt"
  
  beforeEach(() => {
    // Clean up state from previous tests
    cleanupState(testSessionId)
    
    // Setup mock config
    mockConfig = {
      enabled: true,
      defaultDivertBlockers: true,
      blockersFile: "blockers.md",
      maxBlockersPerRun: 20,
      cooldownMs: 60000,
      maxReprompts: 3,
      repromptWindowMs: 300000,
      completionMarker: "BLOCKER_DIVERTER_DONE!"
    }
    
    // Setup mock context
    mockContext = {
      client: {
        app: { 
          log: mock(() => Promise.resolve()) 
        }
      },
      project: { 
        id: "test-project", 
        worktree: "/test/worktree",
        name: "test-project",
        vcs: { type: "git" as const }
      },
      $: mock(() => ({})),
      directory: "/test/worktree",
      worktree: "/test/worktree"
    } as unknown as Parameters<Plugin>[0]
  })

  afterEach(() => {
    // Clean up state after tests
    cleanupState(testSessionId)
  })

  describe("Basic Injection Logic", () => {
    it("should inject system prompt when divertBlockers enabled", async () => {
      const hooks = createSystemPromptHook(mockContext, mockConfig)
      const state = getState(testSessionId)
      state.divertBlockers = true
      
      const output = { system: ["existing prompt"] }
      
      await hooks["experimental.chat.system.transform"](
        { sessionID: testSessionId, model: { id: "gpt-4" } },
        output
      )
      
      expect(output.system).toHaveLength(2)
      expect(output.system[1]).toContain("<blocker-diverter-mode")
    })

    it("should not inject when no sessionID provided", async () => {
      const hooks = createSystemPromptHook(mockContext, mockConfig)
      const output = { system: ["existing prompt"] }
      
      await hooks["experimental.chat.system.transform"](
        { model: { id: "gpt-4" } },
        output
      )
      
      expect(output.system).toHaveLength(1)
      expect(output.system[0]).toBe("existing prompt")
    })

    it("should not inject when divertBlockers disabled", async () => {
      const hooks = createSystemPromptHook(mockContext, mockConfig)
      const state = getState(testSessionId)
      state.divertBlockers = false
      
      const output = { system: ["existing prompt"] }
      
      await hooks["experimental.chat.system.transform"](
        { sessionID: testSessionId, model: { id: "gpt-4" } },
        output
      )
      
      expect(output.system).toHaveLength(1)
      expect(output.system[0]).toBe("existing prompt")
    })

    it("should append to existing system array (not replace)", async () => {
      const hooks = createSystemPromptHook(mockContext, mockConfig)
      const state = getState(testSessionId)
      state.divertBlockers = true
      
      const output = { system: ["existing1", "existing2"] }
      
      await hooks["experimental.chat.system.transform"](
        { sessionID: testSessionId, model: { id: "gpt-4" } },
        output
      )
      
      expect(output.system).toHaveLength(3)
      expect(output.system[0]).toBe("existing1")
      expect(output.system[1]).toBe("existing2")
      expect(output.system[2]).toContain("<blocker-diverter-mode")
    })

    it("should work with empty system array", async () => {
      const hooks = createSystemPromptHook(mockContext, mockConfig)
      const state = getState(testSessionId)
      state.divertBlockers = true
      
      const output = { system: [] }
      
      await hooks["experimental.chat.system.transform"](
        { sessionID: testSessionId, model: { id: "gpt-4" } },
        output
      )
      
      expect(output.system).toHaveLength(1)
      expect(output.system[0]).toContain("<blocker-diverter-mode")
    })
  })

  describe("Template Content Validation", () => {
    it("should include blocker-diverter-mode tags", async () => {
      const hooks = createSystemPromptHook(mockContext, mockConfig)
      const state = getState(testSessionId)
      state.divertBlockers = true
      
      const output = { system: [] }
      
      await hooks["experimental.chat.system.transform"](
        { sessionID: testSessionId, model: { id: "gpt-4" } },
        output
      )
      
      const injected = output.system[0]
      expect(injected).toMatch(/<blocker-diverter-mode/)
      expect(injected).toMatch(/<\/blocker-diverter-mode>/)
    })

    it("should include HARD blocker examples", async () => {
      const hooks = createSystemPromptHook(mockContext, mockConfig)
      const state = getState(testSessionId)
      state.divertBlockers = true
      
      const output = { system: [] as string[] }
      
      await hooks["experimental.chat.system.transform"](
        { sessionID: testSessionId, model: { id: "gpt-4" } },
        output
      )
      
      const injected = output.system[0] as string
      expect(injected).toMatch(/HARD\s+(BLOCKERS?|\()/i)
      expect(injected.toLowerCase()).toMatch(/framework|security|destructive/)
    })

    it("should include SOFT question examples", async () => {
      const hooks = createSystemPromptHook(mockContext, mockConfig)
      const state = getState(testSessionId)
      state.divertBlockers = true
      
      const output = { system: [] as string[] }
      
      await hooks["experimental.chat.system.transform"](
        { sessionID: testSessionId, model: { id: "gpt-4" } },
        output
      )
      
      const injected = output.system[0] as string
      expect(injected).toMatch(/SOFT\s+(QUESTIONS?|\()/i)
      expect(injected.toLowerCase()).toMatch(/naming|formatting/)
    })

    it("should include completion marker", async () => {
      const hooks = createSystemPromptHook(mockContext, mockConfig)
      const state = getState(testSessionId)
      state.divertBlockers = true
      
      const output = { system: [] }
      
      await hooks["experimental.chat.system.transform"](
        { sessionID: testSessionId, model: { id: "gpt-4" } },
        output
      )
      
      const injected = output.system[0]
      // Marker should be sanitized (underscores escaped)
      expect(injected).toContain("BLOCKER\\_DIVERTER\\_DONE!")
    })

    it("should include decision framework section", async () => {
      const hooks = createSystemPromptHook(mockContext, mockConfig)
      const state = getState(testSessionId)
      state.divertBlockers = true
      
      const output = { system: [] }
      
      await hooks["experimental.chat.system.transform"](
        { sessionID: testSessionId, model: { id: "gpt-4" } },
        output
      )
      
      const injected = output.system[0]
      expect(injected).toMatch(/Decision\s+Framework/i)
    })
  })

  describe("Dynamic Content", () => {
    it("should include current blockers section when blockers exist", async () => {
      const hooks = createSystemPromptHook(mockContext, mockConfig)
      const state = getState(testSessionId)
      state.divertBlockers = true
      state.blockers = [
        {
          id: "b1",
          question: "Which framework to use?",
          context: "Building API",
          category: "architecture",
          timestamp: new Date().toISOString(),
          sessionId: testSessionId,
          blocksProgress: true
        },
        {
          id: "b2",
          question: "Should we use JWT?",
          context: "Auth system",
          category: "security",
          timestamp: new Date().toISOString(),
          sessionId: testSessionId,
          blocksProgress: true
        }
      ]
      
      const output = { system: [] }
      
      await hooks["experimental.chat.system.transform"](
        { sessionID: testSessionId, model: { id: "gpt-4" } },
        output
      )
      
      const injected = output.system[0]
      expect(injected).toMatch(/Current\s+Session\s+Context|Blockers\s+Logged/i)
      expect(injected).toContain("Which framework to use?")
      expect(injected).toContain("Should we use JWT?")
    })

    it("should not include blockers section when no blockers", async () => {
      const hooks = createSystemPromptHook(mockContext, mockConfig)
      const state = getState(testSessionId)
      state.divertBlockers = true
      state.blockers = []
      
      const output = { system: [] }
      
      await hooks["experimental.chat.system.transform"](
        { sessionID: testSessionId, model: { id: "gpt-4" } },
        output
      )
      
      const injected = output.system[0]
      expect(injected).not.toMatch(/Current\s+Session\s+Context/i)
    })

    it("should show last 3 blockers only (when >3 exist)", async () => {
      const hooks = createSystemPromptHook(mockContext, mockConfig)
      const state = getState(testSessionId)
      state.divertBlockers = true
      const baseTime = Date.now()
      state.blockers = [
        { id: "b1", question: "Q1", context: "C1", category: "architecture", timestamp: new Date(baseTime).toISOString(), sessionId: testSessionId, blocksProgress: true },
        { id: "b2", question: "Q2", context: "C2", category: "security", timestamp: new Date(baseTime + 1).toISOString(), sessionId: testSessionId, blocksProgress: true },
        { id: "b3", question: "Q3", context: "C3", category: "destructive", timestamp: new Date(baseTime + 2).toISOString(), sessionId: testSessionId, blocksProgress: true },
        { id: "b4", question: "Q4", context: "C4", category: "architecture", timestamp: new Date(baseTime + 3).toISOString(), sessionId: testSessionId, blocksProgress: true },
        { id: "b5", question: "Q5", context: "C5", category: "security", timestamp: new Date(baseTime + 4).toISOString(), sessionId: testSessionId, blocksProgress: true }
      ]
      
      const output = { system: [] }
      
      await hooks["experimental.chat.system.transform"](
        { sessionID: testSessionId, model: { id: "gpt-4" } },
        output
      )
      
      const injected = output.system[0]
      expect(injected).not.toContain("Q1")
      expect(injected).not.toContain("Q2")
      expect(injected).toContain("Q3")
      expect(injected).toContain("Q4")
      expect(injected).toContain("Q5")
    })
  })

  describe("Logging & Observability", () => {
    it("should log injection with session and model info", async () => {
      const hooks = createSystemPromptHook(mockContext, mockConfig)
      const state = getState(testSessionId)
      state.divertBlockers = true
      
      const output = { system: [] }
      const logMock = mockContext.client.app.log as ReturnType<typeof mock>
      
      await hooks["experimental.chat.system.transform"](
        { sessionID: testSessionId, model: { id: "gpt-4-turbo" } },
        output
      )
      
      expect(logMock).toHaveBeenCalled()
      const logCall = logMock.mock.calls.find((call: unknown[]) => {
        const arg = call[0] as { level?: string; message?: string; extra?: Record<string, unknown> }
        return arg.level === "debug" && arg.message?.includes("Injected")
      })
      
      expect(logCall).toBeDefined()
      const logArg = logCall?.[0] as { extra?: { sessionId?: string; modelId?: string; templateLength?: number } }
      expect(logArg.extra?.sessionId).toBe(testSessionId)
      expect(logArg.extra?.modelId).toBe("gpt-4-turbo")
      expect(logArg.extra?.templateLength).toBeGreaterThan(0)
    })

    it("should handle template generation errors gracefully", async () => {
      const hooks = createSystemPromptHook(mockContext, mockConfig)
      const state = getState(testSessionId)
      state.divertBlockers = true
      
      const output = { system: ["existing"] }
      const logMock = mockContext.client.app.log as ReturnType<typeof mock>
      
      // Spy on getSystemPromptTemplate to throw an error
      const templateSpy = spyOn(templates, "getSystemPromptTemplate").mockImplementation(() => {
        throw new Error("Template generation failed")
      })
      
      await hooks["experimental.chat.system.transform"](
        { sessionID: testSessionId, model: { id: "gpt-4" } },
        output
      )
      
      // Restore original function
      templateSpy.mockRestore()
      
      // Should log error (not throw)
      const errorLog = logMock.mock.calls.find((call: unknown[]) => {
        const arg = call[0] as { level?: string; message?: string }
        return arg.level === "error"
      })
      
      expect(errorLog).toBeDefined()
      expect((errorLog?.[0] as { message?: string }).message).toContain("Failed to inject system prompt")
    })
  })

  // NOTE: Security and injection tests moved to system-prompt.security.test.ts
  // to comply with constitution 500-line limit per file
})
