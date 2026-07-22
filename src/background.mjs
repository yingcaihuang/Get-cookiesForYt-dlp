import getAllCookies from './modules/get_all_cookies.mjs';
import saveToFile from './modules/save_to_file.mjs';
import { getDomainEntries, getDomainEntry } from './modules/storage.mjs';
import { syncDomain } from './modules/sync_engine.mjs';

/**
 * Update icon badge counter on active page
 */
const updateBadgeCounter = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    return;
  }
  const { id: tabId, url: urlString } = tab;
  if (!urlString) {
    chrome.action.setBadgeText({ tabId, text: '' });
    return;
  }
  const url = new URL(urlString);
  const cookies = await getAllCookies({
    url: url.href,
    partitionKey: { topLevelSite: url.origin },
  });
  const text = cookies.length.toFixed();
  chrome.action.setBadgeText({ tabId, text });
};

chrome.cookies.onChanged.addListener(updateBadgeCounter);
chrome.tabs.onUpdated.addListener(updateBadgeCounter);
chrome.tabs.onActivated.addListener(updateBadgeCounter);
chrome.windows.onFocusChanged.addListener(updateBadgeCounter);

// Update notification
chrome.runtime.onInstalled.addListener(({ previousVersion, reason }) => {
  if (reason === 'update') {
    const currentVersion = chrome.runtime.getManifest().version;
    chrome.notifications.create('updated', {
      type: 'basic',
      title: 'Get cookies.txt LOCALLY',
      message: `Updated from ${previousVersion} to ${currentVersion}`,
      iconUrl: '/images/icon128.png',
      buttons: [{ title: 'Github Releases' }, { title: 'Uninstall' }],
    });
  }
});

// Update notification's button handler
chrome.notifications.onButtonClicked.addListener(
  (notificationId, buttonIndex) => {
    console.log(notificationId, buttonIndex);
    if (notificationId === 'updated') {
      switch (buttonIndex) {
        case 0:
          chrome.tabs.create({
            url: 'https://github.com/kairi003/Get-cookies.txt-LOCALLY/releases',
          });
          break;
        case 1:
          chrome.management.uninstallSelf({ showConfirmDialog: true });
          break;
      }
    }
  },
);

// Unified message listener for sync management and file saving
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, domain, enabled } = message || {};

  // Handle domain sync management messages
  if (type === 'domain-added') {
    registerSyncAlarm(domain);
    sendResponse({ success: true });
    return true;
  }

  if (type === 'domain-removed') {
    cancelSyncAlarm(domain);
    sendResponse({ success: true });
    return true;
  }

  if (type === 'domain-toggled') {
    if (enabled) {
      registerSyncAlarm(domain);
    } else {
      cancelSyncAlarm(domain);
    }
    sendResponse({ success: true });
    return true;
  }

  if (type === 'get-sync-status') {
    getDomainEntry(domain).then((entry) => {
      sendResponse({ entry });
    });
    return true; // indicates async response
  }

  // Existing save handler for Firefox
  // TODO: use offscreen API to integrate implementation in chrome and firefox
  const { target, data } = message || {};
  if (target === 'background' && type === 'save') {
    const { text, name, format, saveAs } = data || {};
    saveToFile(text, name, format, saveAs).then(() => {
      sendResponse('done');
    });
    return true;
  }

  return true;
});

// --- Alarm Management for Cookie Remote Sync ---

/**
 * Register a periodic alarm for syncing cookies of a given domain.
 * Alarm name format: "sync:{domain}"
 * @param {string} domain - The domain to register an alarm for
 */
export function registerSyncAlarm(domain) {
  chrome.alarms.create(`sync:${domain}`, { periodInMinutes: 5 });
}

/**
 * Cancel the sync alarm for a given domain.
 * @param {string} domain - The domain to cancel the alarm for
 */
export function cancelSyncAlarm(domain) {
  chrome.alarms.clear(`sync:${domain}`);
}

/**
 * Restore alarms for all enabled domains on startup.
 * Reads all domain entries from storage and registers alarms for those with enabled: true.
 */
export async function restoreAlarms() {
  const entries = await getDomainEntries();
  for (const entry of entries) {
    if (entry.enabled) {
      registerSyncAlarm(entry.domain);
    }
  }
}

// Listen for alarm events and trigger sync for the corresponding domain
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith('sync:')) return;

  const domain = alarm.name.slice('sync:'.length);
  const entry = await getDomainEntry(domain);

  // Skip if domain is disabled or entry no longer exists
  if (!entry || !entry.enabled) return;

  await syncDomain(domain, { trigger: 'scheduled' });

  // Check for persistent failures and notify the user
  const updatedEntry = await getDomainEntry(domain);
  if (updatedEntry && updatedEntry.consecutiveFailures >= 3) {
    chrome.notifications.create(`sync-failure:${domain}`, {
      type: 'basic',
      title: 'Cookie Sync Failure',
      message: `Sync for ${domain} has failed ${updatedEntry.consecutiveFailures} consecutive times. Check your server configuration.`,
      iconUrl: '/images/icon128.png',
    });
  }
});

// Restore alarms on extension startup
restoreAlarms();
