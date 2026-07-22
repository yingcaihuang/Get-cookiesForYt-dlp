/**
 * Chrome Extension API mocks for testing in Node/Vitest.
 * Supports Manifest V3 Promise-based API style.
 */

// --- chrome.storage.local ---

let storageData = new Map();

export function resetStorage() {
  storageData = new Map();
}

const storageLocal = {
  async get(keys) {
    if (keys === null || keys === undefined) {
      return Object.fromEntries(storageData);
    }
    const keyList = typeof keys === 'string' ? [keys] : keys;
    if (Array.isArray(keyList)) {
      const result = {};
      for (const key of keyList) {
        if (storageData.has(key)) {
          result[key] = storageData.get(key);
        }
      }
      return result;
    }
    // keys is an object with defaults
    const result = {};
    for (const [key, defaultValue] of Object.entries(keyList)) {
      result[key] = storageData.has(key) ? storageData.get(key) : defaultValue;
    }
    return result;
  },

  async set(items) {
    for (const [key, value] of Object.entries(items)) {
      storageData.set(key, value);
    }
  },

  async remove(keys) {
    const keyList = typeof keys === 'string' ? [keys] : keys;
    for (const key of keyList) {
      storageData.delete(key);
    }
  },
};

// --- chrome.alarms ---

let alarms = new Map();
let alarmListeners = [];

export function resetAlarms() {
  alarms = new Map();
  alarmListeners = [];
}

/**
 * Manually fire an alarm (useful for testing).
 * @param {string} name - Alarm name to fire
 */
export function fireAlarm(name) {
  const alarm = alarms.get(name);
  if (alarm) {
    for (const listener of alarmListeners) {
      listener(alarm);
    }
  }
}

const alarmsApi = {
  async create(name, alarmInfo) {
    alarms.set(name, {
      name,
      scheduledTime:
        Date.now() +
        (alarmInfo.delayInMinutes || alarmInfo.periodInMinutes || 1) * 60_000,
      periodInMinutes: alarmInfo.periodInMinutes || undefined,
    });
  },

  async clear(name) {
    const existed = alarms.has(name);
    alarms.delete(name);
    return existed;
  },

  async get(name) {
    return alarms.get(name) || null;
  },

  async getAll() {
    return Array.from(alarms.values());
  },

  onAlarm: {
    addListener(fn) {
      alarmListeners.push(fn);
    },
    removeListener(fn) {
      alarmListeners = alarmListeners.filter((l) => l !== fn);
    },
    hasListener(fn) {
      return alarmListeners.includes(fn);
    },
  },
};

// --- chrome.cookies ---

let cookieStore = [];

export function resetCookies() {
  cookieStore = [];
}

/**
 * Set mock cookies that will be returned by chrome.cookies.getAll.
 * @param {Array} cookies - Array of cookie objects
 */
export function setCookies(cookies) {
  cookieStore = cookies;
}

const cookiesApi = {
  async getAll(details) {
    if (!details) return [...cookieStore];
    return cookieStore.filter((cookie) => {
      if (details.domain && !cookie.domain.includes(details.domain)) {
        return false;
      }
      if (details.url) {
        try {
          const url = new URL(details.url);
          if (!cookie.domain.includes(url.hostname)) {
            return false;
          }
        } catch {
          return false;
        }
      }
      return true;
    });
  },
};

// --- chrome.notifications ---

let notifications = [];

export function resetNotifications() {
  notifications = [];
}

export function getNotifications() {
  return [...notifications];
}

const notificationsApi = {
  async create(notificationId, options) {
    const id = notificationId || `notif-${Date.now()}`;
    notifications.push({ id, ...options });
    return id;
  },
};

// --- chrome.runtime ---

let messageListeners = [];

export function resetRuntime() {
  messageListeners = [];
}

const runtimeApi = {
  onMessage: {
    addListener(fn) {
      messageListeners.push(fn);
    },
    removeListener(fn) {
      messageListeners = messageListeners.filter((l) => l !== fn);
    },
  },
  sendMessage(message) {
    for (const listener of messageListeners) {
      listener(message, {}, () => {});
    }
  },
};

// --- Assembled chrome global ---

const chrome = {
  storage: {
    local: storageLocal,
  },
  alarms: alarmsApi,
  cookies: cookiesApi,
  notifications: notificationsApi,
  runtime: runtimeApi,
};

export default chrome;

/**
 * Reset all mocks to initial state.
 */
export function resetAll() {
  resetStorage();
  resetAlarms();
  resetCookies();
  resetNotifications();
  resetRuntime();
}
