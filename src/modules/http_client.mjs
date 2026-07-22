/**
 * POST cookie data to a remote server.
 * @param {string} url - Server URL
 * @param {string} cookieText - Cookie data in Netscape format
 * @param {string} authKey - Authorization key
 * @param {string} [authHeaderName='Authorization'] - Custom auth header name
 * @returns {Promise<{success: boolean, statusCode: number, error?: string, retriable?: boolean}>}
 */
export async function postCookies(
  url,
  cookieText,
  authKey,
  authHeaderName = 'Authorization',
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        [authHeaderName]: authKey,
      },
      body: cookieText,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const statusCode = response.status;

    if (statusCode >= 200 && statusCode < 300) {
      return { success: true, statusCode, retriable: false };
    }

    if (statusCode >= 400 && statusCode < 500) {
      let body = '';
      try {
        body = await response.text();
      } catch (e) {
        /* ignore */
      }
      const errorMsg = body
        ? `Client error: ${statusCode} - ${body.slice(0, 200)}`
        : `Client error: ${statusCode}`;
      return {
        success: false,
        statusCode,
        error: errorMsg,
        retriable: false,
      };
    }

    if (statusCode >= 500) {
      let body = '';
      try {
        body = await response.text();
      } catch (e) {
        /* ignore */
      }
      const errorMsg = body
        ? `Server error: ${statusCode} - ${body.slice(0, 200)}`
        : `Server error: ${statusCode}`;
      return {
        success: false,
        statusCode,
        error: errorMsg,
        retriable: true,
      };
    }

    return {
      success: false,
      statusCode,
      error: `Unexpected status: ${statusCode}`,
      retriable: false,
    };
  } catch (err) {
    clearTimeout(timeoutId);

    if (err.name === 'AbortError') {
      return {
        success: false,
        statusCode: 0,
        error: 'Request timed out',
        retriable: true,
      };
    }

    return {
      success: false,
      statusCode: 0,
      error: err.message || 'Network error',
      retriable: true,
    };
  }
}
