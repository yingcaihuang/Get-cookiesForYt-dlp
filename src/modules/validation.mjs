/**
 * Validate a server URL is a valid HTTPS URL.
 * @param {string} url - The URL to validate
 * @returns {boolean}
 */
export function isValidServerUrl(url) {
  if (typeof url !== 'string') return false;
  if (!url.toLowerCase().startsWith('https://')) return false;
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate an authorization key is non-empty and not purely whitespace.
 * @param {string} key - The auth key to validate
 * @returns {boolean}
 */
export function isValidAuthKey(key) {
  if (typeof key !== 'string') return false;
  return key.trim().length > 0;
}

/**
 * Validate a complete server configuration.
 * @param {{url: string, authKey: string}} config - The config to validate
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateServerConfig(config) {
  const errors = [];

  if (!isValidServerUrl(config.url)) {
    errors.push('URL must be a valid HTTPS URL');
  }

  if (!isValidAuthKey(config.authKey)) {
    errors.push('Authorization key must not be empty');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
