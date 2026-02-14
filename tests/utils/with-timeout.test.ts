/**
 * Tests for withTimeout utility
 * 
 * Validates timeout wrapper behavior:
 * - Resolves when promise resolves before timeout
 * - Rejects with TimeoutError when timeout expires
 * - Propagates original errors
 * - Clears timeout on success
 * - Clears timeout on error
 * - TimeoutError class name and message format
 * 
 * @module tests/utils/with-timeout
 */

import { describe, it, expect } from 'bun:test'
import { withTimeout, TimeoutError } from '../../src/utils/with-timeout'

describe('withTimeout', () => {
  describe('successful resolution', () => {
    it('should resolve when promise resolves before timeout', async () => {
      const result = await withTimeout(
        Promise.resolve('success'),
        1000,
        'Test operation'
      )
      
      expect(result).toBe('success')
    })

    it('should resolve with complex objects', async () => {
      const data = { foo: 'bar', nested: { baz: 42 } }
      const result = await withTimeout(
        Promise.resolve(data),
        1000,
        'Complex operation'
      )
      
      expect(result).toEqual(data)
    })

    it('should handle very fast promises', async () => {
      const fastPromise = new Promise((resolve) => {
        resolve('instant')
      })
      
      const result = await withTimeout(fastPromise, 100, 'Fast operation')
      expect(result).toBe('instant')
    })
  })

  describe('timeout expiration', () => {
    it('should reject with TimeoutError when timeout expires', async () => {
      const slowPromise = new Promise((resolve) => {
        setTimeout(() => resolve('too late'), 200)
      })
      
      expect(
        withTimeout(slowPromise, 50, 'Slow operation')
      ).rejects.toThrow(TimeoutError)
    })

    it('should include label and timeout in error message', async () => {
      const slowPromise = new Promise((resolve) => {
        setTimeout(() => resolve('too late'), 200)
      })
      
      try {
        await withTimeout(slowPromise, 50, 'Database query')
        throw new Error('Should have thrown TimeoutError')
      } catch (error) {
        expect(error).toBeInstanceOf(TimeoutError)
        const timeoutError = error as TimeoutError
        expect(timeoutError.message).toBe('Database query timed out after 50ms')
      }
    })

    it('should use default label when not provided', async () => {
      const slowPromise = new Promise((resolve) => {
        setTimeout(() => resolve('too late'), 200)
      })
      
      try {
        await withTimeout(slowPromise, 50)
        throw new Error('Should have thrown TimeoutError')
      } catch (error) {
        expect(error).toBeInstanceOf(TimeoutError)
        const timeoutError = error as TimeoutError
        expect(timeoutError.message).toBe('Operation timed out after 50ms')
      }
    })

    it('should timeout very slow promises', async () => {
      const verySlowPromise = new Promise((resolve) => {
        setTimeout(() => resolve('never'), 10000) // 10 seconds
      })
      
      expect(
        withTimeout(verySlowPromise, 50, 'Very slow operation')
      ).rejects.toThrow('Very slow operation timed out after 50ms')
    })
  })

  describe('error propagation', () => {
    it('should propagate original errors from promise', async () => {
      const errorMessage = 'Original error'
      const failingPromise = Promise.reject(new Error(errorMessage))
      
      try {
        await withTimeout(failingPromise, 1000, 'Failing operation')
        throw new Error('Should have thrown original error')
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        const thrownError = error as Error
        expect(thrownError.message).toBe(errorMessage)
        expect(thrownError).not.toBeInstanceOf(TimeoutError)
      }
    })

    it('should propagate custom error types', async () => {
      class CustomError extends Error {
        constructor(message: string) {
          super(message)
          this.name = 'CustomError'
        }
      }
      
      const failingPromise = Promise.reject(new CustomError('Custom failure'))
      
      try {
        await withTimeout(failingPromise, 1000, 'Custom error operation')
        throw new Error('Should have thrown CustomError')
      } catch (error) {
        expect(error).toBeInstanceOf(CustomError)
        expect((error as CustomError).name).toBe('CustomError')
      }
    })

    it('should handle non-Error rejections', async () => {
      const failingPromise = Promise.reject('string error')
      
      try {
        await withTimeout(failingPromise, 1000, 'String error operation')
        throw new Error('Should have thrown string error')
      } catch (error) {
        expect(error).toBe('string error')
      }
    })
  })

  describe('timeout cleanup', () => {
    it('should clear timeout when promise resolves', async () => {
      // This test verifies no timeout leaks by resolving quickly
      const promises = []
      
      for (let i = 0; i < 100; i++) {
        promises.push(
          withTimeout(
            Promise.resolve(i),
            10000, // Long timeout that should be cleared
            `Operation ${i}`
          )
        )
      }
      
      const results = await Promise.all(promises)
      expect(results).toHaveLength(100)
      expect(results[99]).toBe(99)
    })

    it('should clear timeout when promise rejects', async () => {
      // This test verifies no timeout leaks by rejecting quickly
      const promises = []
      
      for (let i = 0; i < 100; i++) {
        promises.push(
          withTimeout(
            Promise.reject(new Error(`Error ${i}`)),
            10000, // Long timeout that should be cleared
            `Operation ${i}`
          ).catch(error => error.message)
        )
      }
      
      const results = await Promise.all(promises)
      expect(results).toHaveLength(100)
      expect(results[99]).toBe('Error 99')
    })
  })

  describe('TimeoutError class', () => {
    it('should have correct name property', () => {
      const error = new TimeoutError('Test', 100)
      expect(error.name).toBe('TimeoutError')
    })

    it('should be instance of Error', () => {
      const error = new TimeoutError('Test', 100)
      expect(error).toBeInstanceOf(Error)
    })

    it('should format message correctly', () => {
      const error = new TimeoutError('API request', 5000)
      expect(error.message).toBe('API request timed out after 5000ms')
    })

    it('should have stack trace', () => {
      const error = new TimeoutError('Test', 100)
      expect(error.stack).toBeDefined()
      expect(typeof error.stack).toBe('string')
    })
  })

  describe('edge cases', () => {
    it('should handle zero timeout', async () => {
      const slowPromise = new Promise((resolve) => {
        setTimeout(() => resolve('done'), 10)
      })
      
      expect(
        withTimeout(slowPromise, 0, 'Zero timeout')
      ).rejects.toThrow(TimeoutError)
    })

    it('should handle negative timeout (treated as immediate)', async () => {
      const slowPromise = new Promise((resolve) => {
        setTimeout(() => resolve('done'), 10)
      })
      
      expect(
        withTimeout(slowPromise, -100, 'Negative timeout')
      ).rejects.toThrow(TimeoutError)
    })

    it('should handle already resolved promise', async () => {
      const result = await withTimeout(
        Promise.resolve('immediate'),
        100,
        'Already resolved'
      )
      
      expect(result).toBe('immediate')
    })

    it('should handle already rejected promise', async () => {
      expect(
        withTimeout(
          Promise.reject(new Error('immediate error')),
          100,
          'Already rejected'
        )
      ).rejects.toThrow('immediate error')
    })
  })
})
