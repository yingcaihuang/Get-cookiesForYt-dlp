# Implementation Plan: Cookie Remote Sync

## Overview

This plan implements remote cookie synchronization for the "Get cookies.txt LOCALLY" extension. Tasks are organized to build foundational modules first (storage, HTTP, retry), then the sync engine, then the UI layers, and finally wiring everything together. All code uses vanilla JS (ES modules) with Chrome Extension Manifest V3 APIs.

## Tasks

- [x] 1. Set up project infrastructure and testing framework
  - [x] 1.1 Install Vitest and fast-check as dev dependencies, create vitest.config.mjs with ESM support
    - Add `vitest` and `fast-check` to devDependencies in package.json
    - Create `vitest.config.mjs` at project root
    - Add `"test": "vitest --run"` script to package.json
    - _Requirements: Testing infrastructure_

  - [x] 1.2 Create Chrome API mocks for testing
    - Create `tests/mocks/chrome.mjs` with mocks for `chrome.storage.local`, `chrome.alarms`, `chrome.cookies`, `chrome.notifications`
    - Mock `chrome.storage.local.get`, `.set`, `.remove` using an in-memory Map
    - Mock `chrome.alarms.create`, `.clear`, `.get`
    - _Requirements: Testing infrastructure_

  - [x] 1.3 Update manifest.json with new permissions and options page
    - Add `"alarms"` and `"storage"` to permissions array
    - Add `"options_page": "options.html"` entry
    - _Requirements: 2.1, 6.2_

- [x] 2. Implement Storage Module
  - [x] 2.1 Create `src/modules/storage.mjs` with domain entry CRUD operations
    - Implement `getDomainEntries()`, `getDomainEntry(domain)`, `saveDomainEntry(entry)`, `removeDomainEntry(domain)`
    - Use key format `domain:{domainName}` for storage
    - Maintain a `meta:domainList` index array for efficient listing
    - _Requirements: 2.6, 3.2, 3.3, 3.4_

  - [x] 2.2 Add server configuration CRUD to `src/modules/storage.mjs`
    - Implement `getServerConfigs()`, `getServerConfig(id)`, `saveServerConfig(config)`, `removeServerConfig(id)`
    - Implement `getPrimaryServer()`, `getBackupServer()` convenience functions
    - Use key format `server:{id}` for storage
    - Enforce single primary and single backup invariant in `saveServerConfig`
    - _Requirements: 4.3, 4.4, 4.5_

  - [x] 2.3 Add sync log operations to `src/modules/storage.mjs`
    - Implement `addSyncLog(logEntry)`, `getSyncLogs(domain, limit)`, `clearSyncLogs(domain)`
    - Use key format `log:{domain}:{timestamp}`
    - Implement log pruning when count exceeds 100 per domain
    - _Requirements: 5.3_

  - [x]* 2.4 Write property tests for Storage Module
    - **Property 2: Domain entry storage round-trip**
    - **Property 6: Server role uniqueness invariant**
    - **Property 7: Server configuration storage round-trip**
    - **Validates: Requirements 2.6, 3.2, 3.3, 3.4, 4.3, 4.4, 4.5**

- [x] 3. Implement HTTP Client and Retry Module
  - [x] 3.1 Create `src/modules/http_client.mjs`
    - Implement `postCookies(url, cookieText, authKey)` function
    - Use `fetch` with 30-second timeout via `AbortController`
    - Set `Content-Type: text/plain`, `Authorization: {authKey}` headers
    - Return `{success, statusCode, error}` — classify 4xx as non-retriable, 5xx as retriable
    - _Requirements: 1.4_

  - [x] 3.2 Create `src/modules/retry.mjs`
    - Implement `withRetry(fn, config)` with configurable intervals
    - Export `DEFAULT_RETRY_CONFIG = { intervals: [60000, 120000, 240000], maxRetries: 3 }`
    - Implement `getBackoffDelay(retryCount)` pure function
    - Skip retries for non-retriable errors (4xx)
    - Return `{success, attempts, lastError}`
    - _Requirements: 5.1, 5.2_

  - [x]* 3.3 Write property tests for Retry Module
    - **Property 8: Exponential backoff timing and max retries**
    - **Validates: Requirements 5.1, 5.2**

- [x] 4. Implement Sync Engine
  - [x] 4.1 Create `src/modules/sync_engine.mjs`
    - Implement `syncDomain(domain, options)` that:
      1. Retrieves cookies for the domain using `getAllCookies`
      2. Formats cookies in Netscape format using `formatMap.netscape.serializer`
      3. Gets primary and backup server configs from storage
      4. Dispatches POST requests to both servers in parallel via `Promise.allSettled`
      5. Wraps each request with `withRetry` when `options.includeRetry` is true
      6. Returns `SyncResult` with per-server results
    - Implement `updateDomainStats(domain, result)` to update lastSyncTime, syncCount, failureCount, consecutiveFailures
    - _Requirements: 1.2, 1.3, 1.4, 2.3, 5.5_

  - [x]* 4.2 Write property tests for Sync Engine
    - **Property 1: Sync dispatch sends to all configured servers with correct auth**
    - **Property 3: Sync timestamp update**
    - **Property 9: Retry counter independence and reset**
    - **Property 10: Failure logging completeness**
    - **Validates: Requirements 1.3, 1.4, 2.3, 5.3, 5.5, 5.6**

- [x] 5. Checkpoint - Core modules
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement Background Service Worker Extensions
  - [x] 6.1 Add alarm management to `src/background.mjs`
    - Implement `registerSyncAlarm(domain)` using `chrome.alarms.create` with `periodInMinutes: 5`
    - Implement `cancelSyncAlarm(domain)` using `chrome.alarms.clear`
    - Implement `restoreAlarms()` that reads all enabled domains from storage and registers alarms
    - Add `chrome.alarms.onAlarm` listener that triggers `syncDomain` for the alarm's domain
    - Check domain's `enabled` flag before syncing (skip if disabled)
    - _Requirements: 2.1, 2.2, 2.4, 2.5, 3.5, 3.6_

  - [x] 6.2 Add failure notification logic to `src/background.mjs`
    - After sync completes, check `consecutiveFailures >= 3` on the domain entry
    - Create Chrome notification with domain name and failure count
    - _Requirements: 5.4_

  - [x]* 6.3 Write property tests for alarm/sync scheduling logic
    - **Property 4: Disabled domains are skipped**
    - **Validates: Requirements 3.6**

- [x] 7. Implement Server Configuration Validation
  - [x] 7.1 Create `src/modules/validation.mjs`
    - Implement `isValidServerUrl(url)` — must start with "https://" and be parseable by URL constructor
    - Implement `isValidAuthKey(key)` — must be non-empty and not purely whitespace
    - Implement `validateServerConfig(config)` — combines both validations with error messages
    - _Requirements: 4.2_

  - [x]* 7.2 Write property tests for validation
    - **Property 5: Server configuration validation**
    - **Validates: Requirements 4.2**

- [x] 8. Implement Popup UI Changes
  - [x] 8.1 Update `src/popup.html` with Sync button and modern styling structure
    - Add "Sync" button to the `.export-btn-container` with id="sync"
    - Add CSS classes for success/error states (`sync-success`, `sync-error`)
    - Add tooltip element for disabled state
    - _Requirements: 1.1, 6.1_

  - [x] 8.2 Update `src/popup.mjs` with sync button logic
    - Import `syncDomain` from sync_engine and `getServerConfigs` from storage
    - On load: check if servers exist, disable button if none configured (set tooltip)
    - On click: call `syncDomain` with current tab's hostname, show success/error indicator
    - Use CSS class transitions for feedback (add class, remove after 2 seconds)
    - _Requirements: 1.1, 1.5, 1.6, 1.7_

  - [x] 8.3 Update `src/popup.css` with modern redesign styles
    - Apply 8px border-radius to buttons and containers
    - Add subtle box-shadows to interactive elements
    - Define modern color palette CSS custom properties
    - Ensure layout works between 350px and 600px width
    - _Requirements: 6.1, 6.4_

  - [x] 8.4 Update `src/popup.dark.css` for dark mode support
    - Override CSS custom properties for dark color scheme
    - Ensure all new sync UI elements respect dark mode
    - _Requirements: 6.3_

- [x] 9. Implement Options Page
  - [x] 9.1 Create `src/options.html` with tabbed layout structure
    - Create full-page HTML with three tabs: Domain Management, Server Configuration, Sync History
    - Include tab navigation bar and content panels
    - Link to `options.css` and `options.mjs`
    - _Requirements: 6.2, 6.5_

  - [x] 9.2 Create `src/options.css` with modern styles
    - Style tabbed navigation, tables, forms, buttons
    - Use same CSS custom properties as popup for consistency
    - Include dark mode overrides via `prefers-color-scheme: dark`
    - Responsive layout
    - _Requirements: 6.1, 6.3, 6.6_

  - [x] 9.3 Create `src/options.mjs` — Tab navigation and Domain Management tab
    - Implement tab switching (show/hide panels, no page reload)
    - Implement domain list rendering from storage
    - Implement add domain form with submission handling
    - Implement remove domain with confirmation
    - Implement enable/disable toggle (sends message to background to manage alarm)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 6.5_

  - [x] 9.4 Add Server Configuration tab to `src/options.mjs`
    - Implement server list rendering from storage
    - Implement add server form with URL and auth key validation
    - Implement edit server (inline or modal)
    - Implement remove server with last-server warning
    - Implement primary/backup role toggle buttons
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.6_

  - [x] 9.5 Add Sync History tab to `src/options.mjs`
    - Implement log list rendering with domain filter
    - Display timestamp, domain, trigger type, success/failure, server results
    - Implement clear logs per domain
    - _Requirements: 5.3_

  - [x]* 9.6 Write property tests for domain list rendering
    - **Property 11: Domain list rendering completeness**
    - **Validates: Requirements 3.1**

- [x] 10. Checkpoint - Full feature integration
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Wire messaging between popup/options and background
  - [x] 11.1 Add message handlers to `src/background.mjs` for options page communication
    - Handle `{ type: 'domain-added', domain }` — register alarm if enabled
    - Handle `{ type: 'domain-removed', domain }` — cancel alarm
    - Handle `{ type: 'domain-toggled', domain, enabled }` — start/cancel alarm
    - Handle `{ type: 'get-sync-status', domain }` — return current status
    - _Requirements: 2.1, 2.4, 3.5_

  - [x] 11.2 Add `chrome.runtime.sendMessage` calls in options.mjs
    - Send messages to background when domains are added/removed/toggled
    - _Requirements: 3.2, 3.3, 3.5_

- [x] 12. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The tech stack is vanilla JS (ES modules) with no runtime dependencies
- Testing uses Vitest + fast-check as dev dependencies only
- Chrome API mocks are needed since tests run in Node, not in the extension context

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["2.1", "3.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "3.2", "7.1"] },
    { "id": 3, "tasks": ["2.4", "3.3", "7.2"] },
    { "id": 4, "tasks": ["4.1"] },
    { "id": 5, "tasks": ["4.2", "6.1"] },
    { "id": 6, "tasks": ["6.2", "6.3"] },
    { "id": 7, "tasks": ["8.1", "8.2", "8.3", "8.4", "9.1", "9.2"] },
    { "id": 8, "tasks": ["9.3", "9.4", "9.5"] },
    { "id": 9, "tasks": ["9.6", "11.1"] },
    { "id": 10, "tasks": ["11.2"] }
  ]
}
```
