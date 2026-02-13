import { describe, it, expect } from 'bun:test'
import { 
  getBlockerResponse, 
  getStopPrompt, 
  getPermissionPrompt,
  sanitizeInput,
  BLOCKER_RESPONSE_MESSAGE,
  DEFAULT_COMPLETION_MARKER,
  type PromptMessage 
} from '../../src/utils/templates'
import type { PluginConfig } from '../../src/types'

describe('templates utility', () => {
  describe('PromptMessage structure validation', () => {
    it('getBlockerResponse returns correct structure', () => {
      const result = getBlockerResponse('test-session-123')
      
      expect(result).toHaveProperty('path')
      expect(result).toHaveProperty('body')
      expect(result.path).toHaveProperty('id')
      expect(result.body).toHaveProperty('parts')
      expect(Array.isArray(result.body.parts)).toBe(true)
      expect(result.body.parts).toHaveLength(1)
    })

    it('getStopPrompt returns correct structure', () => {
      const config: PluginConfig = {
        enabled: true,
        defaultDivertBlockers: true,
        blockersFile: 'blockers.md',
        maxBlockersPerRun: 20,
        cooldownMs: 60000,
        maxReprompts: 3,
        repromptWindowMs: 300000,
        completionMarker: 'DONE'
      }
      
      const result = getStopPrompt('test-session-456', config)
      
      expect(result).toHaveProperty('path')
      expect(result).toHaveProperty('body')
      expect(result.path).toHaveProperty('id')
      expect(result.body).toHaveProperty('parts')
      expect(Array.isArray(result.body.parts)).toBe(true)
      expect(result.body.parts).toHaveLength(1)
    })

    it('getPermissionPrompt returns correct structure', () => {
      const result = getPermissionPrompt('test-session-789', 'bash')
      
      expect(result).toHaveProperty('path')
      expect(result).toHaveProperty('body')
      expect(result.path).toHaveProperty('id')
      expect(result.body).toHaveProperty('parts')
      expect(Array.isArray(result.body.parts)).toBe(true)
      expect(result.body.parts).toHaveLength(1)
    })
  })

  describe('getBlockerResponse', () => {
    it('returns message with correct sessionId in path', () => {
      const sessionId = 'session-abc-123'
      const result = getBlockerResponse(sessionId)
      
      expect(result.path.id).toBe(sessionId)
    })

    it('contains exact text from FR-009', () => {
      const result = getBlockerResponse('test-session')
      
      expect(result.body.parts[0].text).toBe(BLOCKER_RESPONSE_MESSAGE)
    })

    it('has parts array with single text element', () => {
      const result = getBlockerResponse('test-session')
      
      expect(result.body.parts).toHaveLength(1)
      expect(result.body.parts[0].type).toBe('text')
      expect(typeof result.body.parts[0].text).toBe('string')
      expect(result.body.parts[0].text.length).toBeGreaterThan(0)
    })

    it('text is non-empty string', () => {
      const result = getBlockerResponse('test-session')
      
      expect(result.body.parts[0].text).toBeTruthy()
      expect(result.body.parts[0].text.trim().length).toBeGreaterThan(0)
    })
  })

  describe('getStopPrompt', () => {
    const mockConfig: PluginConfig = {
      enabled: true,
      defaultDivertBlockers: true,
      blockersFile: 'blockers.md',
      maxBlockersPerRun: 20,
      cooldownMs: 60000,
      maxReprompts: 3,
      repromptWindowMs: 300000,
      completionMarker: 'BLOCKER_DIVERTER_DONE!'
    }

    it('returns correct message body with sessionId in path', () => {
      const sessionId = 'session-xyz-789'
      const result = getStopPrompt(sessionId, mockConfig)
      
      expect(result.path.id).toBe(sessionId)
    })

    it('includes default completionMarker', () => {
      const result = getStopPrompt('test-session', mockConfig)
      
      expect(result.body.parts[0].text).toContain(DEFAULT_COMPLETION_MARKER)
    })

    it('uses custom completionMarker when provided', () => {
      const customConfig: PluginConfig = {
        ...mockConfig,
        completionMarker: 'CUSTOM_MARKER_XYZ'
      }
      
      const result = getStopPrompt('test-session', customConfig)
      
      expect(result.body.parts[0].text).toContain('CUSTOM_MARKER_XYZ')
      expect(result.body.parts[0].text).not.toContain(DEFAULT_COMPLETION_MARKER)
    })

    it('instructs agent to check progress', () => {
      const result = getStopPrompt('test-session', mockConfig)
      const text = result.body.parts[0].text.toLowerCase()
      
      expect(text).toContain('progress')
    })

    it('instructs agent to say completion marker', () => {
      const result = getStopPrompt('test-session', mockConfig)
      const text = result.body.parts[0].text
      
      // Should instruct to "say" the marker
      expect(text.toLowerCase()).toContain('say')
      expect(text).toContain(mockConfig.completionMarker)
    })

    it('text is non-empty string', () => {
      const result = getStopPrompt('test-session', mockConfig)
      
      expect(result.body.parts[0].text).toBeTruthy()
      expect(result.body.parts[0].text.trim().length).toBeGreaterThan(0)
    })

    it('handles empty completionMarker gracefully', () => {
      const emptyMarkerConfig: PluginConfig = {
        ...mockConfig,
        completionMarker: ''
      }
      
      const result = getStopPrompt('test-session', emptyMarkerConfig)
      
      // Should fall back to default marker
      expect(result.body.parts[0].text).toContain(DEFAULT_COMPLETION_MARKER)
      expect(result.body.parts[0].text.trim().length).toBeGreaterThan(0)
    })
  })

  describe('getPermissionPrompt', () => {
    it('returns correct message body with sessionId', () => {
      const sessionId = 'session-perm-123'
      const result = getPermissionPrompt(sessionId, 'bash')
      
      expect(result.path.id).toBe(sessionId)
    })

    it('mentions the permission being asked', () => {
      const permission = 'external_directory'
      const result = getPermissionPrompt('test-session', permission)
      
      expect(result.body.parts[0].text).toContain(permission)
    })

    it('instructs to use blocker tool', () => {
      const result = getPermissionPrompt('test-session', 'bash')
      const text = result.body.parts[0].text.toLowerCase()
      
      expect(text).toContain('blocker')
    })

    it('suggests continuing with work', () => {
      const result = getPermissionPrompt('test-session', 'bash')
      const text = result.body.parts[0].text.toLowerCase()
      
      expect(text).toContain('continue')
    })

    it('handles different permission types', () => {
      const permissions = ['bash', 'edit', 'external_directory', 'custom_tool']
      
      permissions.forEach(permission => {
        const result = getPermissionPrompt('test-session', permission)
        
        expect(result.body.parts[0].text).toContain(permission)
        expect(result.body.parts[0].text.length).toBeGreaterThan(0)
      })
    })

    it('text is non-empty string', () => {
      const result = getPermissionPrompt('test-session', 'bash')
      
      expect(result.body.parts[0].text).toBeTruthy()
      expect(result.body.parts[0].text.trim().length).toBeGreaterThan(0)
    })

    it('provides clear and actionable instruction', () => {
      const result = getPermissionPrompt('test-session', 'bash')
      const text = result.body.parts[0].text
      
      // Should be instructive (imperative mood)
      expect(text.toLowerCase()).toMatch(/log|record|note|continue|proceed/)
    })
  })

  describe('Edge cases', () => {
    it('handles special characters in sessionId', () => {
      const sessionId = 'session-with-dashes_and_underscores.123'
      
      expect(() => getBlockerResponse(sessionId)).not.toThrow()
      expect(() => getStopPrompt(sessionId, {
        enabled: true,
        defaultDivertBlockers: true,
        blockersFile: 'test.md',
        maxBlockersPerRun: 10,
        cooldownMs: 1000,
        maxReprompts: 3,
        repromptWindowMs: 300000,
        completionMarker: 'DONE'
      })).not.toThrow()
      expect(() => getPermissionPrompt(sessionId, 'bash')).not.toThrow()
    })

    it('handles special characters in permission name', () => {
      const permission = 'custom:tool/with-chars_123'
      
      const result = getPermissionPrompt('test-session', permission)
      expect(result.body.parts[0].text).toContain(permission)
    })

    it('handles very long sessionIds', () => {
      const longSessionId = 'a'.repeat(1000)
      
      expect(() => getBlockerResponse(longSessionId)).not.toThrow()
      expect(() => getStopPrompt(longSessionId, {
        enabled: true,
        defaultDivertBlockers: true,
        blockersFile: 'test.md',
        maxBlockersPerRun: 10,
        cooldownMs: 1000,
        maxReprompts: 3,
        repromptWindowMs: 300000,
        completionMarker: 'DONE'
      })).not.toThrow()
      expect(() => getPermissionPrompt(longSessionId, 'bash')).not.toThrow()
    })
  })

  describe('sanitizeInput', () => {
    it('strips newlines from input', () => {
      const input = 'bash\n\nmalicious'
      const result = sanitizeInput(input)
      
      expect(result).toBe('bashmalicious')
      expect(result).not.toContain('\n')
    })

    it('strips carriage returns from input', () => {
      const input = 'bash\r\nmalicious'
      const result = sanitizeInput(input)
      
      expect(result).toBe('bashmalicious')
      expect(result).not.toContain('\r')
    })

    it('strips tabs from input', () => {
      const input = 'bash\t\tmalicious'
      const result = sanitizeInput(input)
      
      expect(result).toBe('bashmalicious')
      expect(result).not.toContain('\t')
    })

    it('trims leading and trailing whitespace', () => {
      const input = '  spaced  '
      const result = sanitizeInput(input)
      
      expect(result).toBe('spaced')
    })

    it('limits length to 200 characters', () => {
      const input = 'a'.repeat(300)
      const result = sanitizeInput(input)
      
      expect(result.length).toBe(200)
      expect(result).toBe('a'.repeat(200))
    })

    it('handles empty string', () => {
      const result = sanitizeInput('')
      
      expect(result).toBe('')
    })

    it('handles string with only control characters', () => {
      const input = '\n\r\t'
      const result = sanitizeInput(input)
      
      expect(result).toBe('')
    })

    it('preserves safe alphanumeric content', () => {
      const input = 'bash_permission_123'
      const result = sanitizeInput(input)
      
      expect(result).toBe(input)
    })

    it('preserves safe special characters', () => {
      const input = 'custom:tool/permission-v2'
      const result = sanitizeInput(input)
      
      expect(result).toBe(input)
    })

    it('handles mixed control characters and content', () => {
      const input = 'before\nmiddle\rtab\tend'
      const result = sanitizeInput(input)
      
      expect(result).toBe('beforemiddletabend')
      expect(result).not.toMatch(/[\n\r\t]/)
    })
  })

  describe('Security: Sanitization applied in all templates', () => {
    it('getPermissionPrompt sanitizes permission parameter', () => {
      const maliciousPermission = 'bash\n\nmalicious_prompt'
      const result = getPermissionPrompt('test-session', maliciousPermission)
      
      expect(result.body.parts[0].text).not.toContain('\n')
      expect(result.body.parts[0].text).toContain('bashmalicious_prompt')
    })

    it('getStopPrompt sanitizes completionMarker', () => {
      const config: PluginConfig = {
        enabled: true,
        defaultDivertBlockers: true,
        blockersFile: 'test.md',
        maxBlockersPerRun: 10,
        cooldownMs: 1000,
        maxReprompts: 3,
        repromptWindowMs: 300000,
        completionMarker: 'DONE\n\nmalicious'
      }
      
      const result = getStopPrompt('test-session', config)
      
      expect(result.body.parts[0].text).not.toContain('\n\n')
      expect(result.body.parts[0].text).toContain('DONEmalicious')
    })

    it('sanitization prevents prompt injection attacks', () => {
      const injectionAttempt = "bash'; DROP TABLE users--"
      const result = getPermissionPrompt('test-session', injectionAttempt)
      
      // Should still contain the content but without control chars
      expect(result.body.parts[0].text).toContain("bash'; DROP TABLE users--")
      expect(result.body.parts[0].text).not.toMatch(/[\n\r\t]/)
    })

    it('long inputs are truncated to prevent bloat', () => {
      const longPermission = 'a'.repeat(500)
      const result = getPermissionPrompt('test-session', longPermission)
      
      // Should be truncated to max 200 chars for the permission part
      const textParts = result.body.parts[0].text
      // Extract just the permission substring (between "Log this " and " permission")
      const match = textParts.match(/Log this (.+) permission/)
      if (match) {
        expect(match[1].length).toBeLessThanOrEqual(200)
      }
    })
  })
})
