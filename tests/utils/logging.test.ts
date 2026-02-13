/**
 * Tests for utils/logging.ts
 * 
 * Test strategy:
 * - Mock client.app.log to verify correct parameters
 * - Test all log levels (info, warn, error, debug)
 * - Test with and without extra context
 * - Test error parameter handling in logError
 * - Test graceful degradation when client is undefined
 * - Verify service name is always 'blocker-diverter'
 * 
 * @module tests/utils/logging
 */

import { describe, it, expect, mock } from 'bun:test'
import { logInfo, logWarn, logError, logDebug } from '../../src/utils/logging'
import type { LogClient } from '../../src/config'

describe('utils/logging', () => {
  describe('logInfo', () => {
    it('should call client.app.log with correct info parameters', async () => {
      const mockLog = mock(() => Promise.resolve())
      const client: LogClient = {
        app: { log: mockLog }
      }

      await logInfo(client, 'Test info message')

      expect(mockLog).toHaveBeenCalledTimes(1)
      expect(mockLog).toHaveBeenCalledWith({
        service: 'blocker-diverter',
        level: 'info',
        message: 'Test info message'
      })
    })

    it('should include extra context when provided', async () => {
      const mockLog = mock(() => Promise.resolve())
      const client: LogClient = {
        app: { log: mockLog }
      }

      await logInfo(client, 'Info with context', { sessionId: 'abc123', count: 5 })

      expect(mockLog).toHaveBeenCalledTimes(1)
      expect(mockLog).toHaveBeenCalledWith({
        service: 'blocker-diverter',
        level: 'info',
        message: 'Info with context',
        extra: { sessionId: 'abc123', count: 5 }
      })
    })

    it('should not fail when client is undefined', async () => {
      await expect(logInfo(undefined, 'Test message')).resolves.toBeUndefined()
    })

    it('should not fail when client.app is undefined', async () => {
      const client: LogClient = {}
      await expect(logInfo(client, 'Test message')).resolves.toBeUndefined()
    })

    it('should not fail when client.app.log is undefined', async () => {
      const client: LogClient = { app: {} }
      await expect(logInfo(client, 'Test message')).resolves.toBeUndefined()
    })

    it('should handle logging errors gracefully', async () => {
      const mockLog = mock(() => Promise.reject(new Error('Logging service down')))
      const client: LogClient = {
        app: { log: mockLog }
      }

      await expect(logInfo(client, 'Test message')).resolves.toBeUndefined()
    })
  })

  describe('logWarn', () => {
    it('should call client.app.log with correct warn parameters', async () => {
      const mockLog = mock(() => Promise.resolve())
      const client: LogClient = {
        app: { log: mockLog }
      }

      await logWarn(client, 'Test warning message')

      expect(mockLog).toHaveBeenCalledTimes(1)
      expect(mockLog).toHaveBeenCalledWith({
        service: 'blocker-diverter',
        level: 'warn',
        message: 'Test warning message'
      })
    })

    it('should include extra context when provided', async () => {
      const mockLog = mock(() => Promise.resolve())
      const client: LogClient = {
        app: { log: mockLog }
      }

      await logWarn(client, 'Warn with context', { path: '/test/path', reason: 'invalid' })

      expect(mockLog).toHaveBeenCalledTimes(1)
      expect(mockLog).toHaveBeenCalledWith({
        service: 'blocker-diverter',
        level: 'warn',
        message: 'Warn with context',
        extra: { path: '/test/path', reason: 'invalid' }
      })
    })

    it('should not fail when client is undefined', async () => {
      await expect(logWarn(undefined, 'Test warning')).resolves.toBeUndefined()
    })

    it('should handle logging errors gracefully', async () => {
      const mockLog = mock(() => Promise.reject(new Error('Logging service down')))
      const client: LogClient = {
        app: { log: mockLog }
      }

      await expect(logWarn(client, 'Test warning')).resolves.toBeUndefined()
    })
  })

  describe('logError', () => {
    it('should call client.app.log with correct error parameters', async () => {
      const mockLog = mock(() => Promise.resolve())
      const client: LogClient = {
        app: { log: mockLog }
      }

      await logError(client, 'Test error message')

      expect(mockLog).toHaveBeenCalledTimes(1)
      expect(mockLog).toHaveBeenCalledWith({
        service: 'blocker-diverter',
        level: 'error',
        message: 'Test error message'
      })
    })

    it('should include error details when error provided', async () => {
      const mockLog = mock(() => Promise.resolve())
      const client: LogClient = {
        app: { log: mockLog }
      }

      const error = new Error('Something went wrong')
      error.stack = 'Error: Something went wrong\n  at test.ts:10:5'

      await logError(client, 'Operation failed', error)

      expect(mockLog).toHaveBeenCalledTimes(1)
      expect(mockLog).toHaveBeenCalledWith(
        expect.objectContaining({
          service: 'blocker-diverter',
          level: 'error',
          message: 'Operation failed',
          extra: expect.objectContaining({
            error: 'Something went wrong',
            stack: 'Error: Something went wrong\n  at test.ts:10:5'
          })
        })
      )
    })

    it('should merge error details with extra context', async () => {
      const mockLog = mock(() => Promise.resolve())
      const client: LogClient = {
        app: { log: mockLog }
      }

      const error = new Error('File not found')
      await logError(client, 'Read failed', error, { path: '/test/file.txt', attempt: 1 })

      expect(mockLog).toHaveBeenCalledTimes(1)
      expect(mockLog).toHaveBeenCalledWith(
        expect.objectContaining({
          service: 'blocker-diverter',
          level: 'error',
          message: 'Read failed',
          extra: expect.objectContaining({
            error: 'File not found',
            stack: error.stack,
            path: '/test/file.txt',
            attempt: 1
          })
        })
      )
    })

    it('should include extra context without error', async () => {
      const mockLog = mock(() => Promise.resolve())
      const client: LogClient = {
        app: { log: mockLog }
      }

      await logError(client, 'Operation failed', undefined, { sessionId: 'xyz789' })

      expect(mockLog).toHaveBeenCalledTimes(1)
      expect(mockLog).toHaveBeenCalledWith({
        service: 'blocker-diverter',
        level: 'error',
        message: 'Operation failed',
        extra: { sessionId: 'xyz789' }
      })
    })

    it('should not fail when client is undefined', async () => {
      const error = new Error('Test error')
      await expect(logError(undefined, 'Error message', error)).resolves.toBeUndefined()
    })

    it('should handle logging errors gracefully', async () => {
      const mockLog = mock(() => Promise.reject(new Error('Logging service down')))
      const client: LogClient = {
        app: { log: mockLog }
      }

      const error = new Error('Original error')
      await expect(logError(client, 'Test error', error)).resolves.toBeUndefined()
    })
  })

  describe('logDebug', () => {
    it('should call client.app.log with correct debug parameters', async () => {
      const mockLog = mock(() => Promise.resolve())
      const client: LogClient = {
        app: { log: mockLog }
      }

      await logDebug(client, 'Test debug message')

      expect(mockLog).toHaveBeenCalledTimes(1)
      expect(mockLog).toHaveBeenCalledWith({
        service: 'blocker-diverter',
        level: 'debug',
        message: 'Test debug message'
      })
    })

    it('should include extra context when provided', async () => {
      const mockLog = mock(() => Promise.resolve())
      const client: LogClient = {
        app: { log: mockLog }
      }

      await logDebug(client, 'Debug with context', { 
        operation: 'deduplication', 
        hash: 'abc123',
        cooldownRemaining: 25000 
      })

      expect(mockLog).toHaveBeenCalledTimes(1)
      expect(mockLog).toHaveBeenCalledWith({
        service: 'blocker-diverter',
        level: 'debug',
        message: 'Debug with context',
        extra: { 
          operation: 'deduplication', 
          hash: 'abc123',
          cooldownRemaining: 25000 
        }
      })
    })

    it('should not fail when client is undefined', async () => {
      await expect(logDebug(undefined, 'Test debug')).resolves.toBeUndefined()
    })

    it('should handle logging errors gracefully', async () => {
      const mockLog = mock(() => Promise.reject(new Error('Logging service down')))
      const client: LogClient = {
        app: { log: mockLog }
      }

      await expect(logDebug(client, 'Test debug')).resolves.toBeUndefined()
    })
  })

  describe('edge cases', () => {
    it('should handle empty string messages', async () => {
      const mockLog = mock(() => Promise.resolve())
      const client: LogClient = {
        app: { log: mockLog }
      }

      await logInfo(client, '')

      expect(mockLog).toHaveBeenCalledWith({
        service: 'blocker-diverter',
        level: 'info',
        message: ''
      })
    })

    it('should handle empty extra objects', async () => {
      const mockLog = mock(() => Promise.resolve())
      const client: LogClient = {
        app: { log: mockLog }
      }

      await logInfo(client, 'Test', {})

      expect(mockLog).toHaveBeenCalledWith({
        service: 'blocker-diverter',
        level: 'info',
        message: 'Test',
        extra: {}
      })
    })

    it('should handle complex nested extra data', async () => {
      const mockLog = mock(() => Promise.resolve())
      const client: LogClient = {
        app: { log: mockLog }
      }

      const complexData = {
        blocker: {
          id: 'test-123',
          category: 'permission',
          metadata: {
            timestamp: Date.now(),
            nested: { deep: 'value' }
          }
        },
        array: [1, 2, 3]
      }

      await logInfo(client, 'Complex data', complexData)

      expect(mockLog).toHaveBeenCalledWith({
        service: 'blocker-diverter',
        level: 'info',
        message: 'Complex data',
        extra: complexData
      })
    })
  })
})
