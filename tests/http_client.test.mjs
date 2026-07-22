import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { postCookies } from '../src/modules/http_client.mjs';

describe('http_client - postCookies', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('sends POST with correct headers and body', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 200 });

    const promise = postCookies(
      'https://example.com/sync',
      'cookie-data',
      'my-key',
    );
    const result = await promise;

    expect(global.fetch).toHaveBeenCalledWith(
      'https://example.com/sync',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          Authorization: 'my-key',
        },
        body: 'cookie-data',
      }),
    );
    expect(result.success).toBe(true);
  });

  it('uses custom auth header name when provided', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 200 });

    const result = await postCookies(
      'https://example.com/sync',
      'cookie-data',
      'my-api-key-value',
      'x-api-key',
    );

    expect(global.fetch).toHaveBeenCalledWith(
      'https://example.com/sync',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          'x-api-key': 'my-api-key-value',
        },
        body: 'cookie-data',
      }),
    );
    expect(result.success).toBe(true);
  });

  it('returns success for 2xx responses', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 201 });

    const result = await postCookies('https://example.com/sync', 'data', 'key');

    expect(result).toEqual({
      success: true,
      statusCode: 201,
      retriable: false,
    });
  });

  it('returns non-retriable error for 4xx responses', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 403 });

    const result = await postCookies('https://example.com/sync', 'data', 'key');

    expect(result).toEqual({
      success: false,
      statusCode: 403,
      error: 'Client error: 403',
      retriable: false,
    });
  });

  it('returns retriable error for 5xx responses', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 502 });

    const result = await postCookies('https://example.com/sync', 'data', 'key');

    expect(result).toEqual({
      success: false,
      statusCode: 502,
      error: 'Server error: 502',
      retriable: true,
    });
  });

  it('returns retriable error on timeout (AbortError)', async () => {
    global.fetch = vi.fn().mockImplementation((_url, opts) => {
      return new Promise((_resolve, reject) => {
        opts.signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });

    const promise = postCookies('https://example.com/sync', 'data', 'key');
    vi.advanceTimersByTime(30_000);
    const result = await promise;

    expect(result).toEqual({
      success: false,
      statusCode: 0,
      error: 'Request timed out',
      retriable: true,
    });
  });

  it('returns retriable error on network failure', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    const result = await postCookies('https://example.com/sync', 'data', 'key');

    expect(result).toEqual({
      success: false,
      statusCode: 0,
      error: 'Failed to fetch',
      retriable: true,
    });
  });

  it('handles unexpected status codes as non-retriable', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 301 });

    const result = await postCookies('https://example.com/sync', 'data', 'key');

    expect(result).toEqual({
      success: false,
      statusCode: 301,
      error: 'Unexpected status: 301',
      retriable: false,
    });
  });
});
