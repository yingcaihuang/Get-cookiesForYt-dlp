import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_RETRY_CONFIG,
  getBackoffDelay,
  withRetry,
} from '../src/modules/retry.mjs';

describe('retry - DEFAULT_RETRY_CONFIG', () => {
  it('has intervals [60000, 120000, 240000] and maxRetries 3', () => {
    expect(DEFAULT_RETRY_CONFIG).toEqual({
      intervals: [60_000, 120_000, 240_000],
      maxRetries: 3,
    });
  });
});

describe('retry - getBackoffDelay', () => {
  it('returns first interval for retryCount 0', () => {
    expect(getBackoffDelay(0)).toBe(60_000);
  });

  it('returns second interval for retryCount 1', () => {
    expect(getBackoffDelay(1)).toBe(120_000);
  });

  it('returns third interval for retryCount 2', () => {
    expect(getBackoffDelay(2)).toBe(240_000);
  });

  it('caps at last interval for retryCount beyond array length', () => {
    expect(getBackoffDelay(5)).toBe(240_000);
  });

  it('uses custom config when provided', () => {
    const config = { intervals: [1000, 2000], maxRetries: 2 };
    expect(getBackoffDelay(0, config)).toBe(1000);
    expect(getBackoffDelay(1, config)).toBe(2000);
    expect(getBackoffDelay(2, config)).toBe(2000);
  });
});

describe('retry - withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns success on first attempt when fn succeeds', async () => {
    const fn = vi.fn().mockResolvedValue({ success: true });

    const promise = withRetry(fn, { intervals: [100], maxRetries: 3 });
    const result = await promise;

    expect(result).toEqual({ success: true, attempts: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries and succeeds on second attempt', async () => {
    const fn = vi
      .fn()
      .mockResolvedValueOnce({ success: false, error: 'fail', retriable: true })
      .mockResolvedValue({ success: true });

    const config = { intervals: [100, 200, 400], maxRetries: 3 };
    const promise = withRetry(fn, config);

    // advance past the first delay
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect(result).toEqual({ success: true, attempts: 2 });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-retriable errors (4xx)', async () => {
    const fn = vi.fn().mockResolvedValue({
      success: false,
      error: 'Client error: 403',
      retriable: false,
    });

    const config = { intervals: [100, 200, 400], maxRetries: 3 };
    const result = await withRetry(fn, config);

    expect(result).toEqual({
      success: false,
      attempts: 1,
      lastError: 'Client error: 403',
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('exhausts all retries and returns failure', async () => {
    const fn = vi.fn().mockResolvedValue({
      success: false,
      error: 'Server error: 500',
      retriable: true,
    });

    const config = { intervals: [100, 200, 400], maxRetries: 3 };
    const promise = withRetry(fn, config);

    // Advance through all delays
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(200);
    await vi.advanceTimersByTimeAsync(400);
    const result = await promise;

    expect(result).toEqual({
      success: false,
      attempts: 4,
      lastError: 'Server error: 500',
    });
    expect(fn).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
  });

  it('total attempts never exceed maxRetries + 1', async () => {
    const fn = vi.fn().mockResolvedValue({
      success: false,
      error: 'fail',
      retriable: true,
    });

    const config = { intervals: [10, 20, 30], maxRetries: 3 };
    const promise = withRetry(fn, config);

    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(20);
    await vi.advanceTimersByTimeAsync(30);
    const result = await promise;

    expect(result.attempts).toBe(4);
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('uses default config when no config provided', async () => {
    const fn = vi.fn().mockResolvedValue({ success: true });

    const result = await withRetry(fn);

    expect(result).toEqual({ success: true, attempts: 1 });
  });
});
