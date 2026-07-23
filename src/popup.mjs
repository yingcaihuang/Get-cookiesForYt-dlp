import { formatMap, jsonToNetscapeMapper } from './modules/cookie_format.mjs';
import getAllCookies from './modules/get_all_cookies.mjs';
import _saveToFile from './modules/save_to_file.mjs';
import {
  getBackupServer,
  getDomainEntries,
  getDomainEntry,
  getPrimaryServer,
  getServerConfigs,
  removeDomainEntry,
  saveDomainEntry,
} from './modules/storage.mjs';
import { syncAllCookies, syncDomain } from './modules/sync_engine.mjs';

/** Promise to get URL of Active Tab */
const getUrlPromise = chrome.tabs
  .query({ active: true, currentWindow: true })
  .then(([{ url }]) => new URL(url));

// ----------------------------------------------
// Functions
// ----------------------------------------------

/**
 * Get Stringified Cookies Text and Format Data
 * @param {chrome.cookies.GetAllDetails} details
 * @returns {Promise<{ text: string, format: Format }>}
 */
const getCookieText = async (details) => {
  const cookies = await getAllCookies(details);
  const format = formatMap[document.querySelector('#format').value];
  if (!format) throw new Error('Invalid format');
  const text = format.serializer(cookies);
  return { text, format };
};

// TODO: use offscreen API to integrate implementation in chrome and firefox
/**
 * Save text data as a file
 * Firefox cannot use saveAs in a popup, so the background script handles it.
 * @param {string} text
 * @param {string} name
 * @param {Format} format
 * @param {boolean} saveAs
 */
const saveToFile = async (text, name, { ext, mimeType }, saveAs = false) => {
  const format = { ext, mimeType };
  const isFirefox =
    chrome.runtime.getManifest().browser_specific_settings !== undefined;
  if (isFirefox) {
    await chrome.runtime.sendMessage({
      type: 'save',
      target: 'background',
      data: { text, name, format, saveAs },
    });
  } else {
    await _saveToFile(text, name, format, saveAs);
  }
};

/**
 * Copy text data to the clipboard
 * @param {string} text
 */
const setClipboard = async (text) => {
  await navigator.clipboard.writeText(text);
  const copyButton = document.getElementById('copy');
  copyButton.classList.add('copied');
  setTimeout(() => {
    copyButton.classList.remove('copied');
  }, 2000);
};

// ----------------------------------------------
// Actions after resolving the promise
// ----------------------------------------------

/** Set URL in the header */
getUrlPromise.then((url) => {
  const location = document.querySelector('#location');
  location.textContent = location.href = url.href;
});

/** Set Cookies data to the table */
getUrlPromise
  .then((url) =>
    getAllCookies({
      url: url.href,
      partitionKey: { topLevelSite: url.origin },
    }),
  )
  .then((cookies) => {
    const netscape = jsonToNetscapeMapper(cookies);
    const tableRows = netscape.map((row) => {
      const tr = document.createElement('tr');
      tr.replaceChildren(
        ...row.map((v) => {
          const td = document.createElement('td');
          td.textContent = v;
          return td;
        }),
      );
      return tr;
    });
    document.querySelector('table tbody').replaceChildren(...tableRows);
  });

// ----------------------------------------------
// Event Listeners
// ----------------------------------------------

document.querySelector('#export').addEventListener('click', async () => {
  const url = await getUrlPromise;
  const details = { url: url.href, partitionKey: { topLevelSite: url.origin } };
  const { text, format } = await getCookieText(details);
  saveToFile(text, `${url.hostname}_cookies`, format);
});

document.querySelector('#exportAs').addEventListener('click', async () => {
  const url = await getUrlPromise;
  const details = { url: url.href, partitionKey: { topLevelSite: url.origin } };
  const { text, format } = await getCookieText(details);
  saveToFile(text, `${url.hostname}_cookies`, format, true);
});

document.querySelector('#copy').addEventListener('click', async () => {
  const url = await getUrlPromise;
  const details = { url: url.href, partitionKey: { topLevelSite: url.origin } };
  const { text } = await getCookieText(details);
  setClipboard(text);
});

document.querySelector('#exportAll').addEventListener('click', async () => {
  const { text, format } = await getCookieText({ partitionKey: {} });
  saveToFile(text, 'cookies', format);
});

/** Set last used format value */
const formatSelect = document.querySelector('#format');

const selectedFormat = localStorage.getItem('selectedFormat');
if (selectedFormat) {
  formatSelect.value = selectedFormat;
}

formatSelect.addEventListener('change', () => {
  localStorage.setItem('selectedFormat', formatSelect.value);
});

// ----------------------------------------------
// Add/Del Domain Button Logic
// ----------------------------------------------

const toggleDomainBtn = document.getElementById('toggleDomain');

// Check current domain status and set initial button state
getUrlPromise.then(async (url) => {
  const domain = url.hostname;
  const entry = await getDomainEntry(domain);
  if (entry) {
    toggleDomainBtn.classList.remove('add-domain');
    toggleDomainBtn.classList.add('del-domain');
  } else {
    toggleDomainBtn.classList.remove('del-domain');
    toggleDomainBtn.classList.add('add-domain');
  }
});

toggleDomainBtn.addEventListener('click', async () => {
  const url = await getUrlPromise;
  const domain = url.hostname;
  const entry = await getDomainEntry(domain);

  if (entry) {
    // Domain exists — remove it
    await removeDomainEntry(domain);
    chrome.runtime.sendMessage({ type: 'domain-removed', domain });
    toggleDomainBtn.classList.remove('del-domain');
    toggleDomainBtn.classList.add('add-domain');
  } else {
    // Domain not in list — add it
    const newEntry = {
      domain,
      enabled: true,
      lastSyncTime: null,
      syncCount: 0,
      failureCount: 0,
      consecutiveFailures: 0,
      createdAt: Date.now(),
    };
    await saveDomainEntry(newEntry);
    chrome.runtime.sendMessage({ type: 'domain-added', domain });
    toggleDomainBtn.classList.remove('add-domain');
    toggleDomainBtn.classList.add('del-domain');
  }
});

// ----------------------------------------------
// Sync Button Logic
// ----------------------------------------------

const syncButton = document.getElementById('sync');
const syncTooltip = document.getElementById('sync-tooltip');

// Check if servers are configured and have roles assigned
Promise.all([getServerConfigs(), getPrimaryServer(), getBackupServer()]).then(
  ([configs, primary, backup]) => {
    if (configs.length === 0) {
      syncButton.disabled = true;
      syncButton.title = 'Configure a server in Settings to enable sync';
      if (syncTooltip) syncTooltip.hidden = false;
      syncTooltip.innerHTML =
        '⚠️ 未配置服务器，请前往 Settings → Server Configuration 添加。<br>⚠️ No servers configured. Go to Settings → Server Configuration to add one.';
    } else if (!primary && !backup) {
      syncButton.disabled = true;
      syncButton.title =
        'Set a server role (Primary or Backup) in Settings to enable sync';
      if (syncTooltip) syncTooltip.hidden = false;
      syncTooltip.innerHTML =
        '⚠️ 没有服务器设置为 Primary 或 Backup 角色。请前往 Settings → Server Configuration，将至少一个服务器设为 Primary。<br>⚠️ No server has a Primary or Backup role. Go to Settings → Server Configuration and set at least one server as Primary.';
    }
  },
);

// Sync button click handler
syncButton.addEventListener('click', async () => {
  if (syncButton.disabled) return;

  const syncDebug = document.getElementById('sync-debug');
  syncDebug.hidden = true;

  try {
    const url = await getUrlPromise;
    const domain = url.hostname;

    // Check blacklist
    const blacklisted = await getDomainEntry(domain);
    if (blacklisted) {
      syncButton.classList.add('sync-error');
      setTimeout(() => syncButton.classList.remove('sync-error'), 3000);
      syncDebug.innerHTML = '';
      const pre = document.createElement('pre');
      pre.style.cssText =
        'margin: 0; font-size: inherit; white-space: pre-wrap;';
      pre.textContent = [
        `⚠️ 域名 "${domain}" 在黑名单中。`,
        '   请先点击上方 "Unblock" 解除屏蔽，',
        '   或前往 Settings → Blacklist 中移除。',
        '',
        `⚠️ Domain "${domain}" is blacklisted.`,
        '   Click "Unblock" above, or remove it',
        '   from Settings → Blacklist.',
      ].join('\n');
      syncDebug.appendChild(pre);
      syncDebug.hidden = false;
      return;
    }

    const result = await syncDomain(domain, {
      includeRetry: false,
      trigger: 'manual',
    });

    if (result.success) {
      syncButton.classList.add('sync-success');
      setTimeout(() => syncButton.classList.remove('sync-success'), 2000);
    } else {
      syncButton.classList.add('sync-error');
      setTimeout(() => syncButton.classList.remove('sync-error'), 3000);

      // Show debug details
      syncDebug.innerHTML = '';
      const pre = document.createElement('pre');
      pre.style.cssText =
        'margin: 0; font-size: inherit; white-space: pre-wrap;';

      if (result.serverResults.length === 0) {
        pre.textContent =
          'Sync failed: No target servers found.\n\n' +
          '\u{1F4A1} Fix: Go to Settings \u2192 Server Configuration\n' +
          '   and set at least one server\'s role to "Primary" or "Backup".\n\n' +
          '   Currently all your servers have role "None",\n' +
          '   which means the sync engine has nowhere to send cookies.';
      } else {
        const details = result.serverResults
          .map((r) => {
            const status = r.statusCode
              ? `HTTP ${r.statusCode}`
              : 'No response';
            const error = r.error || 'Unknown error';
            return `[${r.serverId}] ${status} — ${error}`;
          })
          .join('\n');
        pre.textContent = `Sync failed for ${result.domain}\n\n${details}`;
      }

      const copyBtn = document.createElement('button');
      copyBtn.className = 'copy-debug-btn';
      copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(pre.textContent);
        copyBtn.textContent = 'Copied!';
        setTimeout(() => {
          copyBtn.textContent = 'Copy';
        }, 2000);
      });

      syncDebug.appendChild(pre);
      syncDebug.appendChild(copyBtn);
      syncDebug.hidden = false;
    }
  } catch (error) {
    syncButton.classList.add('sync-error');
    setTimeout(() => syncButton.classList.remove('sync-error'), 3000);

    const syncDebug = document.getElementById('sync-debug');
    syncDebug.innerHTML = '';
    const pre = document.createElement('pre');
    pre.style.cssText = 'margin: 0; font-size: inherit; white-space: pre-wrap;';
    pre.textContent = `Exception: ${error.message}`;

    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-debug-btn';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(pre.textContent);
      copyBtn.textContent = 'Copied!';
      setTimeout(() => {
        copyBtn.textContent = 'Copy';
      }, 2000);
    });

    syncDebug.appendChild(pre);
    syncDebug.appendChild(copyBtn);
    syncDebug.hidden = false;
  }
});

// ----------------------------------------------
// Sync All Button Logic
// ----------------------------------------------

const syncAllButton = document.getElementById('syncAll');

// Disable Sync All if no servers configured (same check as Sync button)
Promise.all([getServerConfigs(), getPrimaryServer(), getBackupServer()]).then(
  ([configs, primary, backup]) => {
    if (configs.length === 0 || (!primary && !backup)) {
      syncAllButton.disabled = true;
      syncAllButton.title = syncButton.title;
    }
  },
);

syncAllButton.addEventListener('click', async () => {
  if (syncAllButton.disabled) return;

  const syncDebug = document.getElementById('sync-debug');
  syncDebug.hidden = true;

  try {
    // Get blacklist
    const blacklistEntries = await getDomainEntries();
    const blacklist = new Set(blacklistEntries.map((e) => e.domain));

    const result = await syncAllCookies({
      includeRetry: false,
      trigger: 'manual',
      blacklist,
    });

    if (result.success) {
      syncAllButton.classList.add('syncall-success');
      setTimeout(() => syncAllButton.classList.remove('syncall-success'), 2000);
    } else {
      syncAllButton.classList.add('syncall-error');
      setTimeout(() => syncAllButton.classList.remove('syncall-error'), 3000);

      syncDebug.innerHTML = '';
      const pre = document.createElement('pre');
      pre.style.cssText =
        'margin: 0; font-size: inherit; white-space: pre-wrap;';

      if (result.serverResults.length === 0) {
        pre.textContent =
          'Sync All failed: No target servers found.\n\n\u{1F4A1} Set at least one server as Primary or Backup in Settings.';
      } else {
        const details = result.serverResults
          .map((r) => {
            const status = r.statusCode
              ? `HTTP ${r.statusCode}`
              : 'No response';
            const error = r.error || 'Unknown error';
            return `[${r.serverId}] ${status} — ${error}`;
          })
          .join('\n');
        pre.textContent = `Sync All failed (${result.cookieCount} cookies from ${result.domainCount} domains)\n\n${details}`;
      }

      const copyBtn = document.createElement('button');
      copyBtn.className = 'copy-debug-btn';
      copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(pre.textContent);
        copyBtn.textContent = 'Copied!';
        setTimeout(() => {
          copyBtn.textContent = 'Copy';
        }, 2000);
      });

      syncDebug.appendChild(pre);
      syncDebug.appendChild(copyBtn);
      syncDebug.hidden = false;
    }
  } catch (error) {
    syncAllButton.classList.add('syncall-error');
    setTimeout(() => syncAllButton.classList.remove('syncall-error'), 3000);
    const syncDebug = document.getElementById('sync-debug');
    syncDebug.innerHTML = `<pre style="margin:0;font-size:inherit;white-space:pre-wrap;">Exception: ${error.message}</pre>`;
    syncDebug.hidden = false;
  }
});

// Settings button - open Options page
document.getElementById('openSettings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});
