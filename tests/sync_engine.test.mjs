import { beforeEach, describe, expect, it, vi } from 'vitest';
import chrome, { resetAll, setCookies } from './mocks/chrome.mjs';

// Make chrome globally available
vi.stubGlobal('chrome', chrome);

// Mock fetch for http_client.mjs
vi.stubGlobal('fetch', vi.fn());

import {
  getDomainEntry,
  getSyncLogs,
  saveDomainEntry,
  saveServerConfig,
} from '../src/modules/storage.mjs';
import {
  syncAllCookies,
  syncDomain,
  updateDomainStats,
} from '../src/modules/sync_engine.mjs';

function makeDomainEntry(domain, overrides = {}) {
  return {
    domain,
    enabled: true,
    lastSyncTime: null,
    syncCount: 0,
    failureCount: 0,
    consecutiveFailures: 0,
    createdAt: Date.now(),
    ...overrides,
  };
}

function makeServerConfig(id, overrides = {}) {
  return {
    id,
    label: `Server ${id}`,
    url: `https://${id}.example.com/sync`,
    authKey: `key-${id}`,
    role: 'none',
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('sync_engine.mjs', () => {
  beforeEach(() => {
    resetAll();
    vi.resetAllMocks();
  });

  describe('syncDomain()', () => {
    it('retrieves cookies for the given domain', async () => {
      const cookies = [
        {
          domain: '.example.com',
          path: '/',
          secure: true,
          name: 'sid',
          value: 'abc',
          expirationDate: 1700000000,
        },
      ];
      setCookies(cookies);

      await saveServerConfig(makeServerConfig('s1', { role: 'primary' }));
      await saveDomainEntry(makeDomainEntry('example.com'));

      // Mock fetch to return success
      fetch.mockResolvedValue({ status: 200 });

      const result = await syncDomain('example.com', { includeRetry: false });

      expect(result.domain).toBe('example.com');
      expect(result.success).toBe(true);
    });

    it('formats cookies in Netscape format and sends via POST', async () => {
      const cookies = [
        {
          domain: '.example.com',
          path: '/',
          secure: true,
          name: 'sid',
          value: 'abc123',
          expirationDate: 1700000000,
        },
      ];
      setCookies(cookies);

      await saveServerConfig(makeServerConfig('s1', { role: 'primary' }));
      await saveDomainEntry(makeDomainEntry('example.com'));

      fetch.mockResolvedValue({ status: 200 });

      await syncDomain('example.com', { includeRetry: false });

      // Verify fetch was called with correct body containing Netscape format
      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, opts] = fetch.mock.calls[0];
      expect(url).toBe('https://s1.example.com/sync');
      expect(opts.body).toContain('.example.com');
      expect(opts.body).toContain('sid');
      expect(opts.body).toContain('abc123');
      expect(opts.body).toContain('# Netscape HTTP Cookie File');
      expect(opts.headers.Authorization).toBe('key-s1');
    });

    it('dispatches to both primary and backup servers in parallel', async () => {
      setCookies([
        {
          domain: '.example.com',
          path: '/',
          secure: false,
          name: 'a',
          value: '1',
          expirationDate: 0,
        },
      ]);

      await saveServerConfig(makeServerConfig('p1', { role: 'primary' }));
      await saveServerConfig(makeServerConfig('b1', { role: 'backup' }));
      await saveDomainEntry(makeDomainEntry('example.com'));

      fetch.mockResolvedValue({ status: 200 });

      const result = await syncDomain('example.com', { includeRetry: false });

      expect(fetch).toHaveBeenCalledTimes(2);
      expect(result.serverResults).toHaveLength(2);
      expect(result.success).toBe(true);
    });

    it('returns success=true if at least one server succeeds', async () => {
      setCookies([
        {
          domain: '.example.com',
          path: '/',
          secure: false,
          name: 'a',
          value: '1',
          expirationDate: 0,
        },
      ]);

      await saveServerConfig(makeServerConfig('p1', { role: 'primary' }));
      await saveServerConfig(makeServerConfig('b1', { role: 'backup' }));
      await saveDomainEntry(makeDomainEntry('example.com'));

      // Primary succeeds, backup fails
      fetch
        .mockResolvedValueOnce({ status: 200 })
        .mockResolvedValueOnce({ status: 500 });

      const result = await syncDomain('example.com', { includeRetry: false });

      expect(result.success).toBe(true);
      expect(result.serverResults[0].success).toBe(true);
      expect(result.serverResults[1].success).toBe(false);
    });

    it('returns success=false if all servers fail', async () => {
      setCookies([
        {
          domain: '.example.com',
          path: '/',
          secure: false,
          name: 'a',
          value: '1',
          expirationDate: 0,
        },
      ]);

      await saveServerConfig(makeServerConfig('p1', { role: 'primary' }));
      await saveServerConfig(makeServerConfig('b1', { role: 'backup' }));
      await saveDomainEntry(makeDomainEntry('example.com'));

      fetch.mockResolvedValue({ status: 500 });

      const result = await syncDomain('example.com', { includeRetry: false });

      expect(result.success).toBe(false);
      expect(result.serverResults.every((r) => !r.success)).toBe(true);
    });

    it('handles no servers configured (returns empty results)', async () => {
      setCookies([
        {
          domain: '.example.com',
          path: '/',
          secure: false,
          name: 'a',
          value: '1',
          expirationDate: 0,
        },
      ]);
      await saveDomainEntry(makeDomainEntry('example.com'));

      const result = await syncDomain('example.com', { includeRetry: false });

      // No servers configured means no requests, and no successful server
      expect(result.serverResults).toHaveLength(0);
      expect(result.success).toBe(false);
    });

    it('persists a sync log after completion', async () => {
      setCookies([
        {
          domain: '.example.com',
          path: '/',
          secure: false,
          name: 'a',
          value: '1',
          expirationDate: 0,
        },
      ]);

      await saveServerConfig(makeServerConfig('p1', { role: 'primary' }));
      await saveDomainEntry(makeDomainEntry('example.com'));

      fetch.mockResolvedValue({ status: 200 });

      await syncDomain('example.com', { includeRetry: false });

      const logs = await getSyncLogs('example.com');
      expect(logs).toHaveLength(1);
      expect(logs[0].success).toBe(true);
      expect(logs[0].domain).toBe('example.com');
      expect(logs[0].trigger).toBe('manual');
    });

    it('uses the trigger option in the sync log', async () => {
      setCookies([
        {
          domain: '.example.com',
          path: '/',
          secure: false,
          name: 'a',
          value: '1',
          expirationDate: 0,
        },
      ]);

      await saveServerConfig(makeServerConfig('p1', { role: 'primary' }));
      await saveDomainEntry(makeDomainEntry('example.com'));

      fetch.mockResolvedValue({ status: 200 });

      await syncDomain('example.com', {
        includeRetry: false,
        trigger: 'scheduled',
      });

      const logs = await getSyncLogs('example.com');
      expect(logs[0].trigger).toBe('scheduled');
    });

    it('includes per-server results with serverId', async () => {
      setCookies([
        {
          domain: '.example.com',
          path: '/',
          secure: false,
          name: 'a',
          value: '1',
          expirationDate: 0,
        },
      ]);

      await saveServerConfig(
        makeServerConfig('primary-srv', { role: 'primary' }),
      );
      await saveDomainEntry(makeDomainEntry('example.com'));

      fetch.mockResolvedValue({ status: 200 });

      const result = await syncDomain('example.com', { includeRetry: false });

      expect(result.serverResults[0].serverId).toBe('primary-srv');
      expect(result.serverResults[0].success).toBe(true);
      expect(result.serverResults[0].statusCode).toBe(200);
    });

    it('passes custom authHeaderName to postCookies', async () => {
      setCookies([
        {
          domain: '.example.com',
          path: '/',
          secure: false,
          name: 'a',
          value: '1',
          expirationDate: 0,
        },
      ]);

      await saveServerConfig(
        makeServerConfig('p1', {
          role: 'primary',
          authHeaderName: 'x-api-key',
        }),
      );
      await saveDomainEntry(makeDomainEntry('example.com'));

      fetch.mockResolvedValue({ status: 200 });

      await syncDomain('example.com', { includeRetry: false });

      expect(fetch).toHaveBeenCalledTimes(1);
      const [, opts] = fetch.mock.calls[0];
      expect(opts.headers['x-api-key']).toBe('key-p1');
      expect(opts.headers.Authorization).toBeUndefined();
    });
  });

  describe('updateDomainStats()', () => {
    it('increments syncCount and sets lastSyncTime on success', async () => {
      await saveDomainEntry(makeDomainEntry('example.com', { syncCount: 2 }));

      const timestamp = Date.now();
      await updateDomainStats('example.com', { success: true, timestamp });

      const entry = await getDomainEntry('example.com');
      expect(entry.syncCount).toBe(3);
      expect(entry.lastSyncTime).toBe(timestamp);
    });

    it('resets consecutiveFailures on success', async () => {
      await saveDomainEntry(
        makeDomainEntry('example.com', { consecutiveFailures: 5 }),
      );

      await updateDomainStats('example.com', {
        success: true,
        timestamp: Date.now(),
      });

      const entry = await getDomainEntry('example.com');
      expect(entry.consecutiveFailures).toBe(0);
    });

    it('increments failureCount and consecutiveFailures on failure', async () => {
      await saveDomainEntry(
        makeDomainEntry('example.com', {
          failureCount: 1,
          consecutiveFailures: 1,
        }),
      );

      await updateDomainStats('example.com', {
        success: false,
        timestamp: Date.now(),
      });

      const entry = await getDomainEntry('example.com');
      expect(entry.failureCount).toBe(2);
      expect(entry.consecutiveFailures).toBe(2);
    });

    it('does nothing if domain entry does not exist', async () => {
      // Should not throw
      await updateDomainStats('nonexistent.com', {
        success: true,
        timestamp: Date.now(),
      });

      const entry = await getDomainEntry('nonexistent.com');
      expect(entry).toBeNull();
    });
  });

  describe('syncAllCookies()', () => {
    it('sends all cookies in ONE request per server (batch)', async () => {
      const cookies = [
        {
          domain: '.example.com',
          path: '/',
          secure: true,
          name: 'sid',
          value: 'abc',
          expirationDate: 1700000000,
        },
        {
          domain: '.other.com',
          path: '/',
          secure: false,
          name: 'uid',
          value: 'xyz',
          expirationDate: 1700000000,
        },
      ];
      setCookies(cookies);

      await saveServerConfig(makeServerConfig('p1', { role: 'primary' }));

      fetch.mockResolvedValue({ status: 200 });

      const result = await syncAllCookies({ includeRetry: false });

      // Only ONE fetch call (one server), not two (one per domain)
      expect(fetch).toHaveBeenCalledTimes(1);
      const [, opts] = fetch.mock.calls[0];
      // Body contains cookies from BOTH domains
      expect(opts.body).toContain('.example.com');
      expect(opts.body).toContain('.other.com');
      expect(opts.body).toContain('sid');
      expect(opts.body).toContain('uid');
      expect(result.success).toBe(true);
      expect(result.domain).toBe('all');
      expect(result.cookieCount).toBe(2);
      expect(result.domainCount).toBe(2);
    });

    it('filters out blacklisted domains', async () => {
      const cookies = [
        {
          domain: '.example.com',
          path: '/',
          secure: true,
          name: 'sid',
          value: 'abc',
          expirationDate: 1700000000,
        },
        {
          domain: '.blocked.com',
          path: '/',
          secure: false,
          name: 'uid',
          value: 'xyz',
          expirationDate: 1700000000,
        },
      ];
      setCookies(cookies);

      await saveServerConfig(makeServerConfig('p1', { role: 'primary' }));

      fetch.mockResolvedValue({ status: 200 });

      const result = await syncAllCookies({
        includeRetry: false,
        blacklist: new Set(['blocked.com']),
      });

      expect(fetch).toHaveBeenCalledTimes(1);
      const [, opts] = fetch.mock.calls[0];
      expect(opts.body).toContain('.example.com');
      expect(opts.body).not.toContain('.blocked.com');
      expect(result.cookieCount).toBe(1);
      expect(result.domainCount).toBe(1);
    });

    it('sends to both primary and backup servers', async () => {
      setCookies([
        {
          domain: '.example.com',
          path: '/',
          secure: true,
          name: 'a',
          value: '1',
          expirationDate: 0,
        },
      ]);

      await saveServerConfig(makeServerConfig('p1', { role: 'primary' }));
      await saveServerConfig(makeServerConfig('b1', { role: 'backup' }));

      fetch.mockResolvedValue({ status: 200 });

      const result = await syncAllCookies({ includeRetry: false });

      expect(fetch).toHaveBeenCalledTimes(2);
      expect(result.serverResults).toHaveLength(2);
      expect(result.success).toBe(true);
    });

    it('returns success=false when all servers fail', async () => {
      setCookies([
        {
          domain: '.example.com',
          path: '/',
          secure: true,
          name: 'a',
          value: '1',
          expirationDate: 0,
        },
      ]);

      await saveServerConfig(makeServerConfig('p1', { role: 'primary' }));

      fetch.mockResolvedValue({ status: 500 });

      const result = await syncAllCookies({ includeRetry: false });

      expect(result.success).toBe(false);
    });

    it("persists a sync log with domain='all'", async () => {
      setCookies([
        {
          domain: '.example.com',
          path: '/',
          secure: true,
          name: 'a',
          value: '1',
          expirationDate: 0,
        },
      ]);

      await saveServerConfig(makeServerConfig('p1', { role: 'primary' }));

      fetch.mockResolvedValue({ status: 200 });

      await syncAllCookies({ includeRetry: false });

      const logs = await getSyncLogs('all');
      expect(logs).toHaveLength(1);
      expect(logs[0].domain).toBe('all');
      expect(logs[0].success).toBe(true);
    });

    it('handles no servers configured', async () => {
      setCookies([
        {
          domain: '.example.com',
          path: '/',
          secure: true,
          name: 'a',
          value: '1',
          expirationDate: 0,
        },
      ]);

      const result = await syncAllCookies({ includeRetry: false });

      expect(fetch).not.toHaveBeenCalled();
      expect(result.serverResults).toHaveLength(0);
      expect(result.success).toBe(false);
    });
  });
});
