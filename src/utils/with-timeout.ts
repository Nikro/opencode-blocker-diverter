/**
 * Timeout wrapper utility for promises
 * 
 * Provides a timeout mechanism for any promise to prevent indefinite hangs.
 * Uses Promise.race to ensure the wrapped promise resolves or rejects
 * within the specified timeout period.
 * 
 * @module utils/with-timeout
 */

/**
 * Custom error thrown when a promise times out
 * 
 * Extends Error with a descriptive message including the operation label
 * and timeout duration for debugging purposes.
 */
export class TimeoutError extends Error {
  /**
   * Create a TimeoutError
   * 
   * @param label - Human-readable label for the operation that timed out
   * @param timeoutMs - Timeout duration in milliseconds
   */
  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${timeoutMs}ms`)
    this.name = 'TimeoutError'
  }
}

/**
 * Wraps a promise with a timeout
 * 
 * Uses Promise.race to ensure the wrapped promise resolves or rejects
 * within the specified timeout period. If the timeout expires first,
 * the promise rejects with a TimeoutError.
 * 
 * The timeout is cleared when the promise resolves or rejects to prevent
 * timer leaks and unnecessary callbacks.
 * 
 * @param promise - The promise to wrap
 * @param timeoutMs - Timeout in milliseconds
 * @param label - Optional label for the timeout error message
 * @returns The original promise result or TimeoutError
 * 
 * @example
 * ```typescript
 * // API call with 30 second timeout
 * const result = await withTimeout(
 *   fetch('https://api.example.com/data'),
 *   30000,
 *   'API fetch'
 * )
 * ```
 * 
 * @example
 * ```typescript
 * // Handle timeout error
 * try {
 *   await withTimeout(slowOperation(), 5000, 'Slow operation')
 * } catch (error) {
 *   if (error instanceof TimeoutError) {
 *     console.error('Operation timed out')
 *   } else {
 *     console.error('Operation failed:', error)
 *   }
 * }
 * ```
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string = 'Operation'
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>
  
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new TimeoutError(label, timeoutMs))
    }, timeoutMs)
  })
  
  try {
    const result = await Promise.race([promise, timeoutPromise])
    clearTimeout(timeoutId!)
    return result
  } catch (error) {
    clearTimeout(timeoutId!)
    throw error
  }
}
