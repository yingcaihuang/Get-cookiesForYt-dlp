/**
 * Storage module for managing domain sync entries, server configurations,
 * and sync logs in chrome.storage.local.
 */

// --- Domain Sync Entry CRUD ---

/**
 * Get all domain sync entries.
 * Uses the meta:domainList index for efficient listing.
 * @returns {Promise<DomainSyncEntry[]>}
 */
export async function getDomainEntries() {
  const { 'meta:domainList': domainList = [] } =
    await chrome.storage.local.get('meta:domainList');
  if (domainList.length === 0) return [];

  const keys = domainList.map((domain) => `domain:${domain}`);
  const data = await chrome.storage.local.get(keys);

  return keys.map((key) => data[key]).filter(Boolean);
}

/**
 * Get a single domain sync entry by domain name.
 * @param {string} domain - The domain name (e.g., "example.com")
 * @returns {Promise<DomainSyncEntry|null>}
 */
export async function getDomainEntry(domain) {
  const key = `domain:${domain}`;
  const data = await chrome.storage.local.get(key);
  return data[key] || null;
}

/**
 * Save (create or update) a domain sync entry.
 * Adds the domain to the meta:domainList index if not already present.
 * @param {DomainSyncEntry} entry - The domain sync entry to save
 * @returns {Promise<void>}
 */
export async function saveDomainEntry(entry) {
  const key = `domain:${entry.domain}`;
  await chrome.storage.local.set({ [key]: entry });

  // Update the domain list index
  const { 'meta:domainList': domainList = [] } =
    await chrome.storage.local.get('meta:domainList');
  if (!domainList.includes(entry.domain)) {
    domainList.push(entry.domain);
    await chrome.storage.local.set({ 'meta:domainList': domainList });
  }
}

/**
 * Remove a domain sync entry by domain name.
 * Also removes the domain from the meta:domainList index.
 * @param {string} domain - The domain name to remove
 * @returns {Promise<void>}
 */
export async function removeDomainEntry(domain) {
  const key = `domain:${domain}`;
  await chrome.storage.local.remove(key);

  // Update the domain list index
  const { 'meta:domainList': domainList = [] } =
    await chrome.storage.local.get('meta:domainList');
  const updatedList = domainList.filter((d) => d !== domain);
  await chrome.storage.local.set({ 'meta:domainList': updatedList });
}

// --- Server Configuration CRUD ---

/**
 * Get all server configurations.
 * Uses the meta:serverList index for efficient listing.
 * @returns {Promise<ServerConfiguration[]>}
 */
export async function getServerConfigs() {
  const { 'meta:serverList': serverList = [] } =
    await chrome.storage.local.get('meta:serverList');
  if (serverList.length === 0) return [];

  const keys = serverList.map((id) => `server:${id}`);
  const data = await chrome.storage.local.get(keys);

  return keys.map((key) => data[key]).filter(Boolean);
}

/**
 * Get a single server configuration by ID.
 * @param {string} id - The server configuration ID
 * @returns {Promise<ServerConfiguration|null>}
 */
export async function getServerConfig(id) {
  const key = `server:${id}`;
  const data = await chrome.storage.local.get(key);
  return data[key] || null;
}

/**
 * Save (create or update) a server configuration.
 * Enforces the invariant that at most one server can be 'primary' and at most one can be 'backup'.
 * When saving a server with role 'primary', any existing primary server has its role set to 'none'.
 * When saving a server with role 'backup', any existing backup server has its role set to 'none'.
 * @param {ServerConfiguration} config - The server configuration to save
 * @returns {Promise<void>}
 */
export async function saveServerConfig(config) {
  // Enforce role uniqueness invariant
  if (config.role === 'primary' || config.role === 'backup') {
    const allConfigs = await getServerConfigs();
    for (const existing of allConfigs) {
      if (existing.id !== config.id && existing.role === config.role) {
        existing.role = 'none';
        const existingKey = `server:${existing.id}`;
        await chrome.storage.local.set({ [existingKey]: existing });
      }
    }
  }

  const key = `server:${config.id}`;
  await chrome.storage.local.set({ [key]: config });

  // Update the server list index
  const { 'meta:serverList': serverList = [] } =
    await chrome.storage.local.get('meta:serverList');
  if (!serverList.includes(config.id)) {
    serverList.push(config.id);
    await chrome.storage.local.set({ 'meta:serverList': serverList });
  }
}

/**
 * Remove a server configuration by ID.
 * Also removes the server from the meta:serverList index.
 * @param {string} id - The server configuration ID to remove
 * @returns {Promise<void>}
 */
export async function removeServerConfig(id) {
  const key = `server:${id}`;
  await chrome.storage.local.remove(key);

  // Update the server list index
  const { 'meta:serverList': serverList = [] } =
    await chrome.storage.local.get('meta:serverList');
  const updatedList = serverList.filter((sid) => sid !== id);
  await chrome.storage.local.set({ 'meta:serverList': updatedList });
}

/**
 * Get the server configuration designated as the primary server.
 * @returns {Promise<ServerConfiguration|null>}
 */
export async function getPrimaryServer() {
  const configs = await getServerConfigs();
  return configs.find((c) => c.role === 'primary') || null;
}

/**
 * Get the server configuration designated as the backup server.
 * @returns {Promise<ServerConfiguration|null>}
 */
export async function getBackupServer() {
  const configs = await getServerConfigs();
  return configs.find((c) => c.role === 'backup') || null;
}

// --- Sync Log Operations ---

/**
 * Get all domain names that have sync logs.
 * Scans storage for meta:logIndex:* keys.
 * @returns {Promise<string[]>}
 */
export async function getLoggedDomains() {
  const allData = await chrome.storage.local.get(null);
  const prefix = 'meta:logIndex:';
  return Object.keys(allData)
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length));
}

const MAX_LOGS_PER_DOMAIN = 100;

/**
 * Add a sync log entry for a domain.
 * Stores the entry with key `log:{domain}:{timestamp}` and maintains
 * a `meta:logIndex:{domain}` array of timestamps for efficient retrieval.
 * Prunes oldest logs when count exceeds 100 per domain.
 * @param {SyncLogEntry} logEntry - The sync log entry to store
 * @returns {Promise<void>}
 */
export async function addSyncLog(logEntry) {
  const { domain, timestamp } = logEntry;
  const logKey = `log:${domain}:${timestamp}`;
  const indexKey = `meta:logIndex:${domain}`;

  // Store the log entry
  await chrome.storage.local.set({ [logKey]: logEntry });

  // Update the log index
  const data = await chrome.storage.local.get(indexKey);
  const timestamps = data[indexKey] || [];
  timestamps.push(timestamp);

  // Prune if exceeds limit
  if (timestamps.length > MAX_LOGS_PER_DOMAIN) {
    const toRemove = timestamps.splice(
      0,
      timestamps.length - MAX_LOGS_PER_DOMAIN,
    );
    const keysToRemove = toRemove.map((ts) => `log:${domain}:${ts}`);
    await chrome.storage.local.remove(keysToRemove);
  }

  await chrome.storage.local.set({ [indexKey]: timestamps });
}

/**
 * Get sync logs for a domain, sorted newest first.
 * @param {string} domain - The domain to get logs for
 * @param {number} [limit] - Maximum number of logs to return (optional, returns all if omitted)
 * @returns {Promise<SyncLogEntry[]>}
 */
export async function getSyncLogs(domain, limit) {
  const indexKey = `meta:logIndex:${domain}`;
  const data = await chrome.storage.local.get(indexKey);
  const timestamps = data[indexKey] || [];

  if (timestamps.length === 0) return [];

  // Sort newest first
  const sorted = [...timestamps].sort((a, b) => b - a);
  const selected = limit !== undefined ? sorted.slice(0, limit) : sorted;

  const logKeys = selected.map((ts) => `log:${domain}:${ts}`);
  const logData = await chrome.storage.local.get(logKeys);

  return logKeys.map((key) => logData[key]).filter(Boolean);
}

/**
 * Clear all sync logs for a domain.
 * Removes all individual log entries and the log index.
 * @param {string} domain - The domain to clear logs for
 * @returns {Promise<void>}
 */
export async function clearSyncLogs(domain) {
  const indexKey = `meta:logIndex:${domain}`;
  const data = await chrome.storage.local.get(indexKey);
  const timestamps = data[indexKey] || [];

  if (timestamps.length > 0) {
    const logKeys = timestamps.map((ts) => `log:${domain}:${ts}`);
    await chrome.storage.local.remove(logKeys);
  }

  await chrome.storage.local.remove(indexKey);
}
