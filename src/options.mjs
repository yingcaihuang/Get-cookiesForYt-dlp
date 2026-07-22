import {
  clearSyncLogs,
  getDomainEntries,
  getDomainEntry,
  getServerConfig,
  getServerConfigs,
  getSyncLogs,
  removeDomainEntry,
  removeServerConfig,
  saveDomainEntry,
  saveServerConfig,
} from './modules/storage.mjs';
import { validateServerConfig } from './modules/validation.mjs';

// --- Tab Navigation ---

const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');

for (const btn of tabButtons) {
  btn.addEventListener('click', () => {
    for (const b of tabButtons) {
      b.classList.remove('active');
      b.setAttribute('aria-selected', 'false');
    }
    for (const p of tabPanels) {
      p.classList.remove('active');
      p.hidden = true;
    }

    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
    const panel = document.getElementById(`tab-${btn.dataset.tab}`);
    panel.classList.add('active');
    panel.hidden = false;

    // Load data for the active tab
    if (btn.dataset.tab === 'domains') loadDomains();
    if (btn.dataset.tab === 'servers') loadServers();
    if (btn.dataset.tab === 'history') loadHistory();
  });
}

// --- Domain Management (Task 9.3) ---

const domainList = document.getElementById('domain-list');
const addDomainBtn = document.getElementById('add-domain-btn');
const addDomainForm = document.getElementById('add-domain-form');
const cancelDomainBtn = document.getElementById('cancel-domain-btn');
const domainInput = document.getElementById('domain-input');

addDomainBtn.addEventListener('click', () => {
  addDomainForm.hidden = false;
  domainInput.value = '';
  domainInput.focus();
});

cancelDomainBtn.addEventListener('click', () => {
  addDomainForm.hidden = true;
});

addDomainForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const domain = domainInput.value.trim();
  if (!domain) return;

  const existing = await getDomainEntry(domain);
  if (existing) {
    alert(`Domain "${domain}" is already in the blacklist.`);
    return;
  }

  const entry = {
    domain,
    enabled: true,
    lastSyncTime: null,
    syncCount: 0,
    failureCount: 0,
    consecutiveFailures: 0,
    createdAt: Date.now(),
  };

  await saveDomainEntry(entry);
  chrome.runtime.sendMessage({ type: 'domain-added', domain });
  addDomainForm.hidden = true;
  await loadDomains();
});

async function loadDomains() {
  const entries = await getDomainEntries();

  if (entries.length === 0) {
    domainList.innerHTML =
      '<p class="empty-state">No domains blacklisted. Domains added here will be excluded from all sync operations.</p>';
    return;
  }

  domainList.innerHTML = '';
  for (const entry of entries) {
    domainList.appendChild(renderDomainItem(entry));
  }
}

function renderDomainItem(entry) {
  const item = document.createElement('div');
  item.className = 'domain-item';

  const lastSync = entry.lastSyncTime
    ? new Date(entry.lastSyncTime).toLocaleString()
    : 'Never';

  item.innerHTML = `
    <div class="item-header">
      <span class="item-title">${escapeHtml(entry.domain)}</span>
      <div class="item-actions">
        <label class="toggle" title="${entry.enabled ? 'Disable' : 'Enable'} sync">
          <input type="checkbox" ${entry.enabled ? 'checked' : ''} data-domain="${escapeHtml(entry.domain)}" />
          <span class="toggle-slider"></span>
        </label>
        <button class="btn btn-danger" data-remove-domain="${escapeHtml(entry.domain)}">Remove</button>
      </div>
    </div>
    <div class="item-meta">
      <span>Last sync: ${lastSync}</span>
      <span>Syncs: ${entry.syncCount}</span>
      <span>Failures: ${entry.failureCount}</span>
    </div>
  `;

  // Toggle enable/disable
  const toggle = item.querySelector('input[type="checkbox"]');
  toggle.addEventListener('change', async () => {
    const enabled = toggle.checked;
    const updatedEntry = await getDomainEntry(entry.domain);
    if (updatedEntry) {
      updatedEntry.enabled = enabled;
      await saveDomainEntry(updatedEntry);
      chrome.runtime.sendMessage({
        type: 'domain-toggled',
        domain: entry.domain,
        enabled,
      });
    }
  });

  // Remove domain
  const removeBtn = item.querySelector('[data-remove-domain]');
  removeBtn.addEventListener('click', async () => {
    const confirmed = confirm(
      `Remove "${entry.domain}" from blacklist? This domain will be synced again.`,
    );
    if (!confirmed) return;
    await removeDomainEntry(entry.domain);
    chrome.runtime.sendMessage({
      type: 'domain-removed',
      domain: entry.domain,
    });
    await loadDomains();
  });

  return item;
}

// --- Server Configuration (Task 9.4) ---

const serverList = document.getElementById('server-list');
const addServerBtn = document.getElementById('add-server-btn');
const addServerForm = document.getElementById('add-server-form');
const cancelServerBtn = document.getElementById('cancel-server-btn');
const serverLabelInput = document.getElementById('server-label-input');
const serverUrlInput = document.getElementById('server-url-input');
const serverAuthHeaderInput = document.getElementById(
  'server-auth-header-input',
);
const serverAuthInput = document.getElementById('server-auth-input');
const serverRoleInput = document.getElementById('server-role-input');
const debugToggle = document.getElementById('debug-toggle');

let editingServerId = null;
let debugMode = false;

debugToggle.addEventListener('change', () => {
  debugMode = debugToggle.checked;
});

addServerBtn.addEventListener('click', () => {
  editingServerId = null;
  addServerForm.hidden = false;
  serverLabelInput.value = '';
  serverUrlInput.value = '';
  serverAuthHeaderInput.value = '';
  serverAuthInput.value = '';
  serverRoleInput.value = 'none';
  serverLabelInput.focus();
});

cancelServerBtn.addEventListener('click', () => {
  addServerForm.hidden = true;
  editingServerId = null;
});

addServerForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const config = {
    id: editingServerId || crypto.randomUUID(),
    label: serverLabelInput.value.trim(),
    url: serverUrlInput.value.trim(),
    authHeaderName: serverAuthHeaderInput.value.trim() || 'Authorization',
    authKey: serverAuthInput.value,
    role: serverRoleInput.value,
    createdAt: Date.now(),
  };

  // Preserve createdAt when editing
  if (editingServerId) {
    const existing = await getServerConfig(editingServerId);
    if (existing) {
      config.createdAt = existing.createdAt;
    }
  }

  const validation = validateServerConfig(config);
  if (!validation.valid) {
    alert(validation.errors.join('\n'));
    return;
  }

  if (!config.label) {
    alert('Label is required.');
    return;
  }

  await saveServerConfig(config);
  addServerForm.hidden = true;
  editingServerId = null;
  await loadServers();
});

async function loadServers() {
  const configs = await getServerConfigs();

  if (configs.length === 0) {
    serverList.innerHTML =
      '<p class="empty-state">No servers configured. Add a server to enable cookie sync.</p>';
    return;
  }

  serverList.innerHTML = '';

  // Check if any server has primary or backup role
  const hasPrimary = configs.some((c) => c.role === 'primary');
  const hasBackup = configs.some((c) => c.role === 'backup');

  if (!hasPrimary && !hasBackup) {
    const warning = document.createElement('div');
    warning.className = 'role-warning';
    warning.innerHTML = `
      <strong>⚠️ No server has a role assigned!</strong><br>
      Sync will not work until you set at least one server as <strong>Primary</strong> or <strong>Backup</strong>.<br>
      Click "Set Primary" on a server below to enable syncing.
    `;
    serverList.appendChild(warning);
  } else if (!hasPrimary) {
    const warning = document.createElement('div');
    warning.className = 'role-warning';
    warning.innerHTML = `
      <strong>💡 Tip:</strong> No Primary server is set. Only the Backup server will receive synced cookies.
      Consider setting a server as Primary for reliable sync.
    `;
    serverList.appendChild(warning);
  }

  for (const config of configs) {
    serverList.appendChild(renderServerItem(config));
  }
}

function renderServerItem(config) {
  const item = document.createElement('div');
  item.className = 'server-item';

  const maskedUrl = maskUrl(config.url);
  const roleBadgeClass =
    config.role === 'primary'
      ? 'badge'
      : config.role === 'backup'
        ? 'badge badge-backup'
        : 'badge badge-none';
  const authHeaderMeta =
    config.authHeaderName && config.authHeaderName !== 'Authorization'
      ? `<span>Auth Header: ${escapeHtml(config.authHeaderName)}</span>`
      : '';

  item.innerHTML = `
    <div class="item-header">
      <span class="item-title">${escapeHtml(config.label)}</span>
      <div class="item-actions">
        <span class="${roleBadgeClass}">${config.role}</span>
        <button class="btn btn-secondary" data-edit-server="${escapeHtml(config.id)}">Edit</button>
        <button class="btn btn-danger" data-remove-server="${escapeHtml(config.id)}">Remove</button>
      </div>
    </div>
    <div class="item-meta">
      <span>URL: ${escapeHtml(maskedUrl)}</span>
      <span>Role: ${config.role}</span>
      ${authHeaderMeta}
    </div>
    <div class="role-actions">
      <button class="btn btn-role-primary${config.role === 'primary' ? ' btn-role-active' : ''}" data-role-server="${escapeHtml(config.id)}" data-role="primary">
        ⚡ Primary
      </button>
      <button class="btn btn-role-backup${config.role === 'backup' ? ' btn-role-active' : ''}" data-role-server="${escapeHtml(config.id)}" data-role="backup">
        🛡️ Backup
      </button>
      <button class="btn btn-role-none${config.role === 'none' ? ' btn-role-active' : ''}" data-role-server="${escapeHtml(config.id)}" data-role="none">
        ⏸️ None
      </button>
      <button class="btn btn-test" data-test-server="${escapeHtml(config.id)}">
        🔗 Test
      </button>
    </div>
    <div class="test-result" data-test-result="${escapeHtml(config.id)}" style="margin-top: 6px; font-size: 0.8rem;" hidden></div>
  `;

  // Edit server
  const editBtn = item.querySelector('[data-edit-server]');
  editBtn.addEventListener('click', () => {
    editingServerId = config.id;
    addServerForm.hidden = false;
    serverLabelInput.value = config.label;
    serverUrlInput.value = config.url;
    serverAuthHeaderInput.value = config.authHeaderName || '';
    serverAuthInput.value = config.authKey;
    serverRoleInput.value = config.role;
    serverLabelInput.focus();
  });

  // Remove server
  const removeBtn = item.querySelector('[data-remove-server]');
  removeBtn.addEventListener('click', async () => {
    const allConfigs = await getServerConfigs();
    if (allConfigs.length === 1) {
      const confirmed = confirm(
        'This is the last server. Removing it will disable all cookie sync. Continue?',
      );
      if (!confirmed) return;
    } else {
      const confirmed = confirm(
        `Remove server "${config.label}"? This cannot be undone.`,
      );
      if (!confirmed) return;
    }
    await removeServerConfig(config.id);
    await loadServers();
  });

  // Role toggle buttons
  const roleButtons = item.querySelectorAll('[data-role-server]');
  for (const roleBtn of roleButtons) {
    roleBtn.addEventListener('click', async () => {
      const newRole = roleBtn.dataset.role;
      const updated = await getServerConfig(config.id);
      if (updated) {
        updated.role = newRole;
        await saveServerConfig(updated);
        await loadServers();
      }
    });
  }

  // Test connection button
  const testBtn = item.querySelector('[data-test-server]');
  const testResult = item.querySelector('[data-test-result]');
  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true;
    testBtn.textContent = 'Testing...';
    testResult.hidden = false;
    testResult.textContent = 'Sending test request...';
    testResult.style.color = 'var(--color-text-muted)';

    // Remove any existing debug output
    const existingDebug = item.querySelector('.debug-output');
    if (existingDebug) existingDebug.remove();

    const authHeader = config.authHeaderName || 'Authorization';
    const requestBody = 'test connection';
    const requestHeaders = {
      'Content-Type': 'text/plain',
      [authHeader]: config.authKey,
    };

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(config.url, {
        method: 'POST',
        headers: requestHeaders,
        body: requestBody,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      let responseBody = '';
      try {
        responseBody = await response.text();
      } catch (e) {
        responseBody = '[unable to read body]';
      }

      if (response.status === 200) {
        testResult.textContent = '\u2713 Connection successful (HTTP 200)';
        testResult.style.color = 'var(--color-success)';
      } else {
        testResult.textContent = `\u2717 Server returned HTTP ${response.status}`;
        testResult.style.color = 'var(--color-error)';
      }

      // Show debug info if debug mode is on
      if (debugMode) {
        const responseHeaders = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });

        const debugInfo = `=== REQUEST ===
URL: ${config.url}
Method: POST
Headers:
${Object.entries(requestHeaders)
  .map(([k, v]) => `  ${k}: ${v}`)
  .join('\n')}
Body: ${requestBody}

=== RESPONSE ===
Status: ${response.status} ${response.statusText}
Headers:
${Object.entries(responseHeaders)
  .map(([k, v]) => `  ${k}: ${v}`)
  .join('\n')}
Body:
${responseBody}`;

        showDebugOutput(item, debugInfo);
      }
    } catch (error) {
      const msg =
        error.name === 'AbortError' ? 'Request timed out (10s)' : error.message;
      testResult.textContent = `\u2717 Connection failed: ${msg}`;
      testResult.style.color = 'var(--color-error)';

      if (debugMode) {
        const debugInfo = `=== REQUEST ===
URL: ${config.url}
Method: POST
Headers:
${Object.entries(requestHeaders)
  .map(([k, v]) => `  ${k}: ${v}`)
  .join('\n')}
Body: ${requestBody}

=== ERROR ===
${error.name}: ${error.message}`;

        showDebugOutput(item, debugInfo);
      }
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = '🔗 Test';
      // Only auto-hide result if debug mode is off
      if (!debugMode) {
        setTimeout(() => {
          testResult.hidden = true;
        }, 5000);
      }
    }
  });

  return item;
}

function maskUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    if (host.length <= 8) return `${parsed.protocol}//${host}/***`;
    return `${parsed.protocol}//${host.slice(0, 4)}***${host.slice(-4)}/***`;
  } catch {
    return '***';
  }
}

// --- Sync History (Task 9.5) ---

const historyList = document.getElementById('history-list');
const historyDomainFilter = document.getElementById('history-domain-filter');
const clearLogsBtn = document.getElementById('clear-logs-btn');

historyDomainFilter.addEventListener('change', () => {
  loadHistory();
});

clearLogsBtn.addEventListener('click', async () => {
  const selectedDomain = historyDomainFilter.value;
  const target = selectedDomain || 'all domains';
  const confirmed = confirm(`Clear sync logs for ${target}?`);
  if (!confirmed) return;

  if (selectedDomain) {
    await clearSyncLogs(selectedDomain);
  } else {
    // Clear logs for all domains
    const entries = await getDomainEntries();
    for (const entry of entries) {
      await clearSyncLogs(entry.domain);
    }
  }
  await loadHistory();
});

async function loadHistory() {
  // Populate domain filter dropdown
  const entries = await getDomainEntries();
  const currentFilter = historyDomainFilter.value;

  // Preserve selection while rebuilding options
  historyDomainFilter.innerHTML = '<option value="">All domains</option>';
  for (const entry of entries) {
    const option = document.createElement('option');
    option.value = entry.domain;
    option.textContent = entry.domain;
    if (entry.domain === currentFilter) option.selected = true;
    historyDomainFilter.appendChild(option);
  }

  // Gather logs
  const selectedDomain = historyDomainFilter.value;
  let logs = [];

  if (selectedDomain) {
    logs = await getSyncLogs(selectedDomain);
  } else {
    // Get logs for all domains and merge
    for (const entry of entries) {
      const domainLogs = await getSyncLogs(entry.domain);
      logs = logs.concat(domainLogs);
    }
    // Sort newest first
    logs.sort((a, b) => b.timestamp - a.timestamp);
  }

  if (logs.length === 0) {
    historyList.innerHTML =
      '<p class="empty-state">No sync history available.</p>';
    return;
  }

  historyList.innerHTML = '';
  for (const log of logs) {
    historyList.appendChild(renderLogItem(log));
  }
}

function renderLogItem(log) {
  const item = document.createElement('div');
  item.className = 'domain-item';

  const time = new Date(log.timestamp).toLocaleString();
  const statusClass = log.success
    ? 'color: var(--color-success)'
    : 'color: var(--color-error)';
  const statusText = log.success ? 'Success' : 'Failed';
  const trigger = log.trigger || 'unknown';

  let serverDetails = '';
  if (log.serverResults && log.serverResults.length > 0) {
    serverDetails = log.serverResults
      .map((r) => {
        const icon = r.success ? '\u2713' : '\u2717';
        const status = r.statusCode ? `HTTP ${r.statusCode}` : 'No response';
        const error = r.error ? ` \u2014 ${r.error}` : '';
        return `${icon} ${r.serverId || 'server'}: ${status}${error}`;
      })
      .join('\n');
  }

  item.innerHTML = `
    <div class="item-header">
      <span class="item-title">${escapeHtml(log.domain)}</span>
      <span style="${statusClass}; font-weight: 600;">${statusText}</span>
    </div>
    <div class="item-meta">
      <span>${time}</span>
      <span>Trigger: ${escapeHtml(trigger)}</span>
    </div>
    ${serverDetails ? `<pre class="server-details" style="margin: 6px 0 0; font-size: 0.75rem; color: ${log.success ? 'var(--color-success)' : 'var(--color-error)'}; white-space: pre-wrap; word-break: break-all;">${escapeHtml(serverDetails)}</pre>` : ''}
  `;

  return item;
}

// --- Utilities ---

function showDebugOutput(container, debugInfo) {
  const debugDiv = document.createElement('div');
  debugDiv.className = 'debug-output';
  debugDiv.style.cssText =
    'margin-top: 8px; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius); padding: 12px; position: relative;';

  const pre = document.createElement('pre');
  pre.style.cssText =
    'margin: 0; font-size: 0.75rem; white-space: pre-wrap; word-break: break-all; max-height: 300px; overflow: auto;';
  pre.textContent = debugInfo;

  const copyBtn = document.createElement('button');
  copyBtn.className = 'btn btn-secondary';
  copyBtn.style.cssText =
    'margin-top: 8px; font-size: 0.75rem; padding: 4px 10px;';
  copyBtn.textContent = 'Copy Debug Info';
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(debugInfo);
    copyBtn.textContent = 'Copied!';
    setTimeout(() => {
      copyBtn.textContent = 'Copy Debug Info';
    }, 2000);
  });

  debugDiv.appendChild(pre);
  debugDiv.appendChild(copyBtn);
  container.appendChild(debugDiv);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- Initial Load ---

loadDomains();
