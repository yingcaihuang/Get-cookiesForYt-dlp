/**
 * Default retry configuration with exponential backoff intervals.
 * @type {{intervals: number[], maxRetries: number}}
 */
export const DEFAULT_RETRY_CONFIG = {
  intervals: [60_000, 120_000, 240_000],
  maxRetries: 3,
};

/**
 * Get the backoff delay for a given retry count (0-indexed).
 * Returns the interval at the given index, capped at the last interval
 * if retryCount exceeds the array length.
 * @param {number} retryCount - 0-based retry index
 * @param {{intervals: number[]}} config - Retry config with intervals array
 * @returns {number} Delay in milliseconds
 */
export function getBackoffDelay(retryCount, config = DEFAULT_RETRY_CONFIG) {
  const { intervals } = config;
  const index = Math.min(retryCount, intervals.length - 1);
  return intervals[index];
}

/**
 * Execute a function with exponential backoff retry.
 * @param {() => Promise<{success: boolean, retriable?: boolean, error?: string}>} fn - The async function to retry
 * @param {{intervals: number[], maxRetries: number}} config - Retry configuration
 * @returns {Promise<{success: boolean, attempts: number, lastError?: string}>}
 */
export async function withRetry(fn, config = DEFAULT_RETRY_CONFIG) {
  const { maxRetries } = config;
  let attempts = 0;
  let lastError;

  for (let i = 0; i <= maxRetries; i++) {
    attempts++;
    const result = await fn();

    if (result.success) {
      return { success: true, attempts };
    }

    lastError = result.error;

    // Don't retry non-retriable errors (e.g. 4xx)
    if (result.retriable === false) {
      return { success: false, attempts, lastError };
    }

    // Don't wait after the last attempt
    if (i < maxRetries) {
      const delay = getBackoffDelay(i, config);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  return { success: false, attempts, lastError };
}
