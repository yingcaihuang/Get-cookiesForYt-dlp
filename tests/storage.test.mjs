import { beforeEach, describe, expect, it, vi } from 'vitest';
import chrome, { resetAll } from './mocks/chrome.mjs';

// Make chrome globally available for the storage module
vi.stubGlobal('chrome', chrome);

import {
  addSyncLog,
  clearSyncLogs,
  getBackupServer,
  getDomainEntries,
  getDomainEntry,
  getPrimaryServer,
  getServerConfig,
  getServerConfigs,
  getSyncLogs,
  removeDomainEntry,
  removeServerConfig,
  saveDomainEntry,
  saveServerConfig,
} from '../src/modules/storage.mjs';

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

describe('storage.mjs - Domain Entry CRUD', () => {
  beforeEach(() => {
    resetAll();
  });

  describe('getDomainEntries()', () => {
    it('returns empty array when no entries exist', async () => {
      const entries = await getDomainEntries();
      expect(entries).toEqual([]);
    });

    it('returns all saved domain entries', async () => {
      const entry1 = makeDomainEntry('example.com');
      const entry2 = makeDomainEntry('test.org');

      await saveDomainEntry(entry1);
      await saveDomainEntry(entry2);

      const entries = await getDomainEntries();
      expect(entries).toHaveLength(2);
      expect(entries).toContainEqual(entry1);
      expect(entries).toContainEqual(entry2);
    });
  });

  describe('getDomainEntry()', () => {
    it('returns null for non-existent domain', async () => {
      const entry = await getDomainEntry('nonexistent.com');
      expect(entry).toBeNull();
    });

    it('returns the saved entry for an existing domain', async () => {
      const entry = makeDomainEntry('example.com', { syncCount: 5 });
      await saveDomainEntry(entry);

      const retrieved = await getDomainEntry('example.com');
      expect(retrieved).toEqual(entry);
    });
  });

  describe('saveDomainEntry()', () => {
    it('creates a new entry and adds to domain list index', async () => {
      const entry = makeDomainEntry('example.com');
      await saveDomainEntry(entry);

      const retrieved = await getDomainEntry('example.com');
      expect(retrieved).toEqual(entry);

      // Check the meta:domainList index
      const data = await chrome.storage.local.get('meta:domainList');
      expect(data['meta:domainList']).toContain('example.com');
    });

    it('updates an existing entry without duplicating in domain list', async () => {
      const entry = makeDomainEntry('example.com');
      await saveDomainEntry(entry);

      const updated = { ...entry, syncCount: 10, lastSyncTime: Date.now() };
      await saveDomainEntry(updated);

      const retrieved = await getDomainEntry('example.com');
      expect(retrieved).toEqual(updated);

      // Should not have duplicates in domain list
      const data = await chrome.storage.local.get('meta:domainList');
      expect(
        data['meta:domainList'].filter((d) => d === 'example.com'),
      ).toHaveLength(1);
    });
  });

  describe('removeDomainEntry()', () => {
    it('removes an existing entry and updates domain list index', async () => {
      const entry = makeDomainEntry('example.com');
      await saveDomainEntry(entry);

      await removeDomainEntry('example.com');

      const retrieved = await getDomainEntry('example.com');
      expect(retrieved).toBeNull();

      const data = await chrome.storage.local.get('meta:domainList');
      expect(data['meta:domainList']).not.toContain('example.com');
    });

    it('does not affect other entries when removing one', async () => {
      const entry1 = makeDomainEntry('example.com');
      const entry2 = makeDomainEntry('test.org');
      await saveDomainEntry(entry1);
      await saveDomainEntry(entry2);

      await removeDomainEntry('example.com');

      const remaining = await getDomainEntries();
      expect(remaining).toHaveLength(1);
      expect(remaining[0]).toEqual(entry2);
    });

    it('handles removing non-existent domain gracefully', async () => {
      await removeDomainEntry('nonexistent.com');
      const entries = await getDomainEntries();
      expect(entries).toEqual([]);
    });
  });

  describe('storage key format', () => {
    it('uses domain:{domainName} key format', async () => {
      const entry = makeDomainEntry('example.com');
      await saveDomainEntry(entry);

      const data = await chrome.storage.local.get('domain:example.com');
      expect(data['domain:example.com']).toEqual(entry);
    });

    it('maintains meta:domainList as the index', async () => {
      await saveDomainEntry(makeDomainEntry('a.com'));
      await saveDomainEntry(makeDomainEntry('b.com'));
      await saveDomainEntry(makeDomainEntry('c.com'));

      const data = await chrome.storage.local.get('meta:domainList');
      expect(data['meta:domainList']).toEqual(['a.com', 'b.com', 'c.com']);
    });
  });
});

describe('storage.mjs - Server Configuration CRUD', () => {
  beforeEach(() => {
    resetAll();
  });

  describe('getServerConfigs()', () => {
    it('returns empty array when no servers exist', async () => {
      const configs = await getServerConfigs();
      expect(configs).toEqual([]);
    });

    it('returns all saved server configurations', async () => {
      const config1 = makeServerConfig('s1');
      const config2 = makeServerConfig('s2');

      await saveServerConfig(config1);
      await saveServerConfig(config2);

      const configs = await getServerConfigs();
      expect(configs).toHaveLength(2);
      expect(configs).toContainEqual(config1);
      expect(configs).toContainEqual(config2);
    });
  });

  describe('getServerConfig()', () => {
    it('returns null for non-existent server', async () => {
      const config = await getServerConfig('nonexistent');
      expect(config).toBeNull();
    });

    it('returns the saved config for an existing server', async () => {
      const config = makeServerConfig('s1', { role: 'primary' });
      await saveServerConfig(config);

      const retrieved = await getServerConfig('s1');
      expect(retrieved).toEqual(config);
    });
  });

  describe('saveServerConfig()', () => {
    it('creates a new config and adds to server list index', async () => {
      const config = makeServerConfig('s1');
      await saveServerConfig(config);

      const retrieved = await getServerConfig('s1');
      expect(retrieved).toEqual(config);

      const data = await chrome.storage.local.get('meta:serverList');
      expect(data['meta:serverList']).toContain('s1');
    });

    it('updates an existing config without duplicating in server list', async () => {
      const config = makeServerConfig('s1');
      await saveServerConfig(config);

      const updated = { ...config, label: 'Updated Server' };
      await saveServerConfig(updated);

      const retrieved = await getServerConfig('s1');
      expect(retrieved).toEqual(updated);

      const data = await chrome.storage.local.get('meta:serverList');
      expect(data['meta:serverList'].filter((id) => id === 's1')).toHaveLength(
        1,
      );
    });

    it('demotes existing primary server when saving a new primary', async () => {
      const primary1 = makeServerConfig('s1', { role: 'primary' });
      const primary2 = makeServerConfig('s2', { role: 'primary' });

      await saveServerConfig(primary1);
      await saveServerConfig(primary2);

      const s1 = await getServerConfig('s1');
      const s2 = await getServerConfig('s2');

      expect(s1.role).toBe('none');
      expect(s2.role).toBe('primary');
    });

    it('demotes existing backup server when saving a new backup', async () => {
      const backup1 = makeServerConfig('s1', { role: 'backup' });
      const backup2 = makeServerConfig('s2', { role: 'backup' });

      await saveServerConfig(backup1);
      await saveServerConfig(backup2);

      const s1 = await getServerConfig('s1');
      const s2 = await getServerConfig('s2');

      expect(s1.role).toBe('none');
      expect(s2.role).toBe('backup');
    });

    it("does not demote servers when saving with role 'none'", async () => {
      const primary = makeServerConfig('s1', { role: 'primary' });
      const none = makeServerConfig('s2', { role: 'none' });

      await saveServerConfig(primary);
      await saveServerConfig(none);

      const s1 = await getServerConfig('s1');
      expect(s1.role).toBe('primary');
    });

    it('allows re-saving the same server as primary without demoting itself', async () => {
      const config = makeServerConfig('s1', { role: 'primary' });
      await saveServerConfig(config);

      // Re-save the same server with updated label but still primary
      const updated = { ...config, label: 'Updated' };
      await saveServerConfig(updated);

      const retrieved = await getServerConfig('s1');
      expect(retrieved.role).toBe('primary');
      expect(retrieved.label).toBe('Updated');
    });

    it('enforces at most one primary at all times', async () => {
      await saveServerConfig(makeServerConfig('s1', { role: 'primary' }));
      await saveServerConfig(makeServerConfig('s2', { role: 'primary' }));
      await saveServerConfig(makeServerConfig('s3', { role: 'primary' }));

      const configs = await getServerConfigs();
      const primaries = configs.filter((c) => c.role === 'primary');
      expect(primaries).toHaveLength(1);
      expect(primaries[0].id).toBe('s3');
    });

    it('enforces at most one backup at all times', async () => {
      await saveServerConfig(makeServerConfig('s1', { role: 'backup' }));
      await saveServerConfig(makeServerConfig('s2', { role: 'backup' }));
      await saveServerConfig(makeServerConfig('s3', { role: 'backup' }));

      const configs = await getServerConfigs();
      const backups = configs.filter((c) => c.role === 'backup');
      expect(backups).toHaveLength(1);
      expect(backups[0].id).toBe('s3');
    });

    it('allows one primary and one backup to coexist', async () => {
      await saveServerConfig(makeServerConfig('s1', { role: 'primary' }));
      await saveServerConfig(makeServerConfig('s2', { role: 'backup' }));

      const s1 = await getServerConfig('s1');
      const s2 = await getServerConfig('s2');

      expect(s1.role).toBe('primary');
      expect(s2.role).toBe('backup');
    });
  });

  describe('removeServerConfig()', () => {
    it('removes an existing config and updates server list index', async () => {
      const config = makeServerConfig('s1');
      await saveServerConfig(config);

      await removeServerConfig('s1');

      const retrieved = await getServerConfig('s1');
      expect(retrieved).toBeNull();

      const data = await chrome.storage.local.get('meta:serverList');
      expect(data['meta:serverList']).not.toContain('s1');
    });

    it('does not affect other configs when removing one', async () => {
      const config1 = makeServerConfig('s1');
      const config2 = makeServerConfig('s2');
      await saveServerConfig(config1);
      await saveServerConfig(config2);

      await removeServerConfig('s1');

      const remaining = await getServerConfigs();
      expect(remaining).toHaveLength(1);
      expect(remaining[0]).toEqual(config2);
    });

    it('handles removing non-existent server gracefully', async () => {
      await removeServerConfig('nonexistent');
      const configs = await getServerConfigs();
      expect(configs).toEqual([]);
    });
  });

  describe('getPrimaryServer()', () => {
    it('returns null when no primary server exists', async () => {
      await saveServerConfig(makeServerConfig('s1', { role: 'none' }));
      const primary = await getPrimaryServer();
      expect(primary).toBeNull();
    });

    it('returns the primary server when one exists', async () => {
      const config = makeServerConfig('s1', { role: 'primary' });
      await saveServerConfig(config);

      const primary = await getPrimaryServer();
      expect(primary).toEqual(config);
    });

    it('returns null when no servers exist at all', async () => {
      const primary = await getPrimaryServer();
      expect(primary).toBeNull();
    });
  });

  describe('getBackupServer()', () => {
    it('returns null when no backup server exists', async () => {
      await saveServerConfig(makeServerConfig('s1', { role: 'none' }));
      const backup = await getBackupServer();
      expect(backup).toBeNull();
    });

    it('returns the backup server when one exists', async () => {
      const config = makeServerConfig('s1', { role: 'backup' });
      await saveServerConfig(config);

      const backup = await getBackupServer();
      expect(backup).toEqual(config);
    });

    it('returns null when no servers exist at all', async () => {
      const backup = await getBackupServer();
      expect(backup).toBeNull();
    });
  });

  describe('storage key format', () => {
    it('uses server:{id} key format', async () => {
      const config = makeServerConfig('abc123');
      await saveServerConfig(config);

      const data = await chrome.storage.local.get('server:abc123');
      expect(data['server:abc123']).toEqual(config);
    });

    it('maintains meta:serverList as the index', async () => {
      await saveServerConfig(makeServerConfig('s1'));
      await saveServerConfig(makeServerConfig('s2'));
      await saveServerConfig(makeServerConfig('s3'));

      const data = await chrome.storage.local.get('meta:serverList');
      expect(data['meta:serverList']).toEqual(['s1', 's2', 's3']);
    });
  });
});

function makeSyncLogEntry(domain, timestamp, overrides = {}) {
  return {
    domain,
    timestamp,
    success: true,
    serverResults: [{ serverId: 'srv1', success: true, statusCode: 200 }],
    trigger: 'manual',
    ...overrides,
  };
}

describe('storage.mjs - Sync Log Operations', () => {
  beforeEach(() => {
    resetAll();
  });

  describe('addSyncLog()', () => {
    it('stores a log entry with the correct key format', async () => {
      const entry = makeSyncLogEntry('example.com', 1700000000);
      await addSyncLog(entry);

      const data = await chrome.storage.local.get('log:example.com:1700000000');
      expect(data['log:example.com:1700000000']).toEqual(entry);
    });

    it('maintains a meta:logIndex:{domain} with timestamps', async () => {
      const entry = makeSyncLogEntry('example.com', 1700000000);
      await addSyncLog(entry);

      const data = await chrome.storage.local.get('meta:logIndex:example.com');
      expect(data['meta:logIndex:example.com']).toEqual([1700000000]);
    });

    it('appends multiple timestamps to the index', async () => {
      await addSyncLog(makeSyncLogEntry('example.com', 1700000001));
      await addSyncLog(makeSyncLogEntry('example.com', 1700000002));
      await addSyncLog(makeSyncLogEntry('example.com', 1700000003));

      const data = await chrome.storage.local.get('meta:logIndex:example.com');
      expect(data['meta:logIndex:example.com']).toEqual([
        1700000001, 1700000002, 1700000003,
      ]);
    });

    it('prunes oldest entries when count exceeds 100', async () => {
      // Add 102 entries
      for (let i = 0; i < 102; i++) {
        await addSyncLog(makeSyncLogEntry('example.com', 1700000000 + i));
      }

      // Should only have 100 entries in the index
      const data = await chrome.storage.local.get('meta:logIndex:example.com');
      const timestamps = data['meta:logIndex:example.com'];
      expect(timestamps).toHaveLength(100);

      // The oldest 2 should have been pruned
      expect(timestamps[0]).toBe(1700000002);
      expect(timestamps[timestamps.length - 1]).toBe(1700000101);

      // The pruned keys should no longer exist in storage
      const pruned1 = await chrome.storage.local.get(
        'log:example.com:1700000000',
      );
      expect(pruned1['log:example.com:1700000000']).toBeUndefined();

      const pruned2 = await chrome.storage.local.get(
        'log:example.com:1700000001',
      );
      expect(pruned2['log:example.com:1700000001']).toBeUndefined();

      // A remaining key should still exist
      const remaining = await chrome.storage.local.get(
        'log:example.com:1700000002',
      );
      expect(remaining['log:example.com:1700000002']).toBeDefined();
    });

    it('keeps logs for different domains independent', async () => {
      await addSyncLog(makeSyncLogEntry('a.com', 1700000001));
      await addSyncLog(makeSyncLogEntry('b.com', 1700000002));

      const dataA = await chrome.storage.local.get('meta:logIndex:a.com');
      const dataB = await chrome.storage.local.get('meta:logIndex:b.com');

      expect(dataA['meta:logIndex:a.com']).toEqual([1700000001]);
      expect(dataB['meta:logIndex:b.com']).toEqual([1700000002]);
    });
  });

  describe('getSyncLogs()', () => {
    it('returns empty array when no logs exist for a domain', async () => {
      const logs = await getSyncLogs('example.com');
      expect(logs).toEqual([]);
    });

    it('returns logs sorted newest first', async () => {
      await addSyncLog(makeSyncLogEntry('example.com', 1700000001));
      await addSyncLog(makeSyncLogEntry('example.com', 1700000003));
      await addSyncLog(makeSyncLogEntry('example.com', 1700000002));

      const logs = await getSyncLogs('example.com');
      expect(logs).toHaveLength(3);
      expect(logs[0].timestamp).toBe(1700000003);
      expect(logs[1].timestamp).toBe(1700000002);
      expect(logs[2].timestamp).toBe(1700000001);
    });

    it('respects the limit parameter', async () => {
      await addSyncLog(makeSyncLogEntry('example.com', 1700000001));
      await addSyncLog(makeSyncLogEntry('example.com', 1700000002));
      await addSyncLog(makeSyncLogEntry('example.com', 1700000003));

      const logs = await getSyncLogs('example.com', 2);
      expect(logs).toHaveLength(2);
      expect(logs[0].timestamp).toBe(1700000003);
      expect(logs[1].timestamp).toBe(1700000002);
    });

    it('returns all logs when limit exceeds total count', async () => {
      await addSyncLog(makeSyncLogEntry('example.com', 1700000001));
      await addSyncLog(makeSyncLogEntry('example.com', 1700000002));

      const logs = await getSyncLogs('example.com', 50);
      expect(logs).toHaveLength(2);
    });

    it('returns full log entry data', async () => {
      const entry = makeSyncLogEntry('example.com', 1700000001, {
        success: false,
        trigger: 'scheduled',
        serverResults: [
          {
            serverId: 'srv1',
            success: false,
            statusCode: 500,
            error: 'Server error',
          },
        ],
      });
      await addSyncLog(entry);

      const logs = await getSyncLogs('example.com');
      expect(logs[0]).toEqual(entry);
    });
  });

  describe('clearSyncLogs()', () => {
    it('removes all log entries for a domain', async () => {
      await addSyncLog(makeSyncLogEntry('example.com', 1700000001));
      await addSyncLog(makeSyncLogEntry('example.com', 1700000002));
      await addSyncLog(makeSyncLogEntry('example.com', 1700000003));

      await clearSyncLogs('example.com');

      const logs = await getSyncLogs('example.com');
      expect(logs).toEqual([]);
    });

    it('removes the log index for the domain', async () => {
      await addSyncLog(makeSyncLogEntry('example.com', 1700000001));
      await clearSyncLogs('example.com');

      const data = await chrome.storage.local.get('meta:logIndex:example.com');
      expect(data['meta:logIndex:example.com']).toBeUndefined();
    });

    it('removes individual log storage keys', async () => {
      await addSyncLog(makeSyncLogEntry('example.com', 1700000001));
      await clearSyncLogs('example.com');

      const data = await chrome.storage.local.get('log:example.com:1700000001');
      expect(data['log:example.com:1700000001']).toBeUndefined();
    });

    it('does not affect logs for other domains', async () => {
      await addSyncLog(makeSyncLogEntry('a.com', 1700000001));
      await addSyncLog(makeSyncLogEntry('b.com', 1700000002));

      await clearSyncLogs('a.com');

      const logsA = await getSyncLogs('a.com');
      const logsB = await getSyncLogs('b.com');

      expect(logsA).toEqual([]);
      expect(logsB).toHaveLength(1);
      expect(logsB[0].domain).toBe('b.com');
    });

    it('handles clearing logs for a domain with no logs gracefully', async () => {
      await clearSyncLogs('nonexistent.com');
      const logs = await getSyncLogs('nonexistent.com');
      expect(logs).toEqual([]);
    });
  });
});
