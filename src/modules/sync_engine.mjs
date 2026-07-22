/**
 * Sync Engine — Orchestrates sending cookie data to configured remote servers.
 */

import { formatMap } from './cookie_format.mjs';
import { postCookies } from './http_client.mjs';
import { withRetry } from './retry.mjs';
import {
  addSyncLog,
  getBackupServer,
  getDomainEntry,
  getPrimaryServer,
  saveDomainEntry,
} from './storage.mjs';

/**
 * Sync cookies for a given domain to all configured servers.
 * @param {string} domain - The domain to sync cookies for
 * @param {Object} [options]
 * @param {boolean} [options.includeRetry=true] - Whether to use retry logic
 * @param {'manual'|'scheduled'} [options.trigger='manual'] - What initiated the sync
 * @returns {Promise<SyncResult>}
 *
 * @typedef {Object} SyncResult
 * @property {boolean} success - Overall success (true if at least one server succeeded)
 * @property {ServerSyncResult[]} serverResults - Per-server results
 * @property {string} domain
 * @property {number} timestamp
 *
 * @typedef {Object} ServerSyncResult
 * @property {string} serverId
 * @property {boolean} success
 * @property {number} statusCode
 * @property {string} [error]
 */
export async function syncDomain(domain, options = {}) {
  const { includeRetry = true, trigger = 'manual' } = options;

  // 1. Retrieve cookies for the domain
  const cookies = await chrome.cookies.getAll({ domain });

  // 2. Format cookies in Netscape format
  const cookieText = formatMap.netscape.serializer(cookies);

  // 3. Get server configurations
  const primary = await getPrimaryServer();
  const backup = await getBackupServer();

  // 4. Build array of servers to sync to (filter out null)
  const servers = [primary, backup].filter(Boolean);

  // 5. Build request functions for each server
  const requestFns = servers.map((server) => {
    const fn = () =>
      postCookies(
        server.url,
        cookieText,
        server.authKey,
        server.authHeaderName || 'Authorization',
      );

    if (includeRetry) {
      // 6. Wrap with retry when includeRetry is true
      return { server, execute: () => withRetry(fn) };
    }
    return { server, execute: fn };
  });

  // 7. Dispatch all requests in parallel via Promise.allSettled
  const settled = await Promise.allSettled(requestFns.map((r) => r.execute()));

  // 8. Build SyncResult
  const timestamp = Date.now();
  const serverResults = settled.map((outcome, index) => {
    const server = requestFns[index].server;

    if (outcome.status === 'fulfilled') {
      const result = outcome.value;
      return {
        serverId: server.id,
        success: result.success,
        statusCode: result.statusCode || 0,
        ...(result.error || result.lastError
          ? { error: result.error || result.lastError }
          : {}),
      };
    }

    // Promise rejected (unexpected error)
    return {
      serverId: server.id,
      success: false,
      statusCode: 0,
      error: outcome.reason?.message || 'Unknown error',
    };
  });

  const success = serverResults.some((r) => r.success);

  const syncResult = {
    success,
    serverResults,
    domain,
    timestamp,
  };

  // 9. Persist stats and log
  await updateDomainStats(domain, syncResult);
  await addSyncLog({
    domain,
    timestamp,
    success,
    serverResults,
    trigger,
  });

  return syncResult;
}

/**
 * Sync ALL cookies (from all non-blacklisted domains) in a single batch request.
 * @param {Object} [options]
 * @param {boolean} [options.includeRetry=true]
 * @param {'manual'|'scheduled'} [options.trigger='manual']
 * @param {Set<string>} [options.blacklist] - Set of blacklisted domain names to exclude
 * @returns {Promise<SyncResult>}
 */
export async function syncAllCookies(options = {}) {
  const {
    includeRetry = true,
    trigger = 'manual',
    blacklist = new Set(),
  } = options;

  // 1. Retrieve ALL cookies
  const allCookies = await chrome.cookies.getAll({});

  // 2. Filter out blacklisted domains
  const filteredCookies = allCookies.filter((cookie) => {
    const domain = cookie.domain.replace(/^\./, '');
    return !blacklist.has(domain);
  });

  // 3. Format all cookies into ONE Netscape format text
  const cookieText = formatMap.netscape.serializer(filteredCookies);

  // 4. Get server configurations
  const primary = await getPrimaryServer();
  const backup = await getBackupServer();
  const servers = [primary, backup].filter(Boolean);

  // 5. Build request functions for each server
  const requestFns = servers.map((server) => {
    const fn = () =>
      postCookies(
        server.url,
        cookieText,
        server.authKey,
        server.authHeaderName || 'Authorization',
      );
    if (includeRetry) {
      return { server, execute: () => withRetry(fn) };
    }
    return { server, execute: fn };
  });

  // 6. Dispatch all requests in parallel
  const settled = await Promise.allSettled(requestFns.map((r) => r.execute()));

  // 7. Build SyncResult
  const timestamp = Date.now();
  const serverResults = settled.map((outcome, index) => {
    const server = requestFns[index].server;
    if (outcome.status === 'fulfilled') {
      const result = outcome.value;
      return {
        serverId: server.id,
        success: result.success,
        statusCode: result.statusCode || 0,
        ...(result.error || result.lastError
          ? { error: result.error || result.lastError }
          : {}),
      };
    }
    return {
      serverId: server.id,
      success: false,
      statusCode: 0,
      error: outcome.reason?.message || 'Unknown error',
    };
  });

  const success = serverResults.some((r) => r.success);

  const syncResult = {
    success,
    serverResults,
    domain: 'all',
    timestamp,
    cookieCount: filteredCookies.length,
    domainCount: new Set(
      filteredCookies.map((c) => c.domain.replace(/^\./, '')),
    ).size,
  };

  // 8. Log the sync
  await addSyncLog({
    domain: 'all',
    timestamp,
    success,
    serverResults,
    trigger,
  });

  return syncResult;
}

/**
 * Update domain sync statistics based on a sync result.
 * - On success: increment syncCount, set lastSyncTime, reset consecutiveFailures
 * - On failure: increment failureCount, increment consecutiveFailures
 * @param {string} domain
 * @param {SyncResult} result
 * @returns {Promise<void>}
 */
export async function updateDomainStats(domain, result) {
  const entry = await getDomainEntry(domain);
  if (!entry) return;

  if (result.success) {
    entry.syncCount = (entry.syncCount || 0) + 1;
    entry.lastSyncTime = result.timestamp;
    entry.consecutiveFailures = 0;
  } else {
    entry.failureCount = (entry.failureCount || 0) + 1;
    entry.consecutiveFailures = (entry.consecutiveFailures || 0) + 1;
  }

  await saveDomainEntry(entry);
}
