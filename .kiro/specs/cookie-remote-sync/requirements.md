# Requirements Document

## Introduction

This document specifies the requirements for adding remote cookie synchronization capabilities to the "Get cookies.txt LOCALLY" browser extension. The feature enables users to sync cookies from specific domains to user-configured remote servers, with support for scheduled auto-sync, retry logic, and a management interface. The implementation uses vanilla JavaScript (ES modules) with Chrome Extension Manifest V3 APIs.

## Glossary

- **Extension**: The "Get cookies.txt LOCALLY" Chrome/Firefox browser extension
- **Popup**: The extension's popup UI shown when the user clicks the extension icon
- **Background_Service_Worker**: The extension's persistent background script running as a Manifest V3 service worker
- **Sync_Engine**: The module responsible for sending cookie data to remote servers via HTTP POST requests
- **Domain_Sync_Entry**: A stored record representing a domain marked for continuous synchronization, including its configuration and status metadata
- **Server_Configuration**: A stored record representing a remote server endpoint, including its URL, authorization key, and label
- **Options_Page**: A full-page management interface accessible from the extension for configuring servers, managing synced domains, and viewing logs
- **Netscape_Format**: The standard cookie file format (Netscape HTTP Cookie File) used for serializing cookies
- **Exponential_Backoff**: A retry strategy where wait time doubles between each retry attempt (1min, 2min, 4min)
- **Primary_Server**: The server designated as the main sync target
- **Backup_Server**: The server designated as the secondary sync target that receives data simultaneously with the Primary_Server

## Requirements

### Requirement 1: One-Click Cookie Sync

**User Story:** As a user, I want to sync the current tab's cookies to my remote server with one click, so that I can quickly push cookie data without manual export and upload.

#### Acceptance Criteria

1. WHEN the user opens the Extension Popup, THE Popup SHALL display a "Sync" button alongside the existing export buttons
2. WHEN the user clicks the "Sync" button, THE Sync_Engine SHALL retrieve all cookies for the current tab's domain in Netscape_Format
3. WHEN the user clicks the "Sync" button, THE Sync_Engine SHALL send an HTTP POST request to each configured server (Primary_Server and Backup_Server) simultaneously
4. WHEN sending a sync request, THE Sync_Engine SHALL include the authorization key from the Server_Configuration as an HTTP header named "Authorization"
5. WHEN a sync request completes successfully, THE Popup SHALL display a brief success indicator to the user
6. IF no Server_Configuration exists, THEN THE Popup SHALL disable the "Sync" button and display a tooltip indicating that server configuration is required
7. WHEN a sync request fails, THE Popup SHALL display a brief error indicator to the user

### Requirement 2: Persistent Auto-Sync

**User Story:** As a user, I want specific domains to automatically sync their cookies at regular intervals, so that my remote server always has up-to-date cookie data without manual intervention.

#### Acceptance Criteria

1. WHEN the user marks a domain for continuous sync, THE Background_Service_Worker SHALL register a Chrome alarm with a 5-minute interval for that domain
2. WHILE a domain is marked for continuous sync, THE Background_Service_Worker SHALL retrieve and sync cookies for that domain every 5 minutes using the Sync_Engine
3. WHEN a scheduled sync completes, THE Background_Service_Worker SHALL update the Domain_Sync_Entry with the current timestamp as last sync time
4. WHEN the user removes a domain from continuous sync, THE Background_Service_Worker SHALL cancel the associated Chrome alarm
5. WHEN the Extension is installed or the browser starts, THE Background_Service_Worker SHALL re-register alarms for all domains marked for continuous sync
6. THE Background_Service_Worker SHALL store each Domain_Sync_Entry in chrome.storage.local with the domain name as key prefix

### Requirement 3: Domain Sync Management

**User Story:** As a user, I want to manage which domains are synced and view their sync history, so that I can control my sync configuration and troubleshoot issues.

#### Acceptance Criteria

1. THE Options_Page SHALL display a list of all Domain_Sync_Entry records with columns for domain name, sync status, last sync time, sync count, and success/failure counts
2. WHEN the user adds a new domain, THE Options_Page SHALL create a new Domain_Sync_Entry in chrome.storage.local
3. WHEN the user removes a domain, THE Options_Page SHALL delete the Domain_Sync_Entry from chrome.storage.local and cancel any associated alarm
4. WHEN the user edits a Domain_Sync_Entry, THE Options_Page SHALL update the stored record in chrome.storage.local
5. WHEN the user toggles the enabled state of a Domain_Sync_Entry, THE Background_Service_Worker SHALL start or cancel the associated alarm accordingly
6. WHILE a Domain_Sync_Entry has enabled set to false, THE Background_Service_Worker SHALL skip scheduled syncs for that domain

### Requirement 4: Server Configuration Management

**User Story:** As a user, I want to configure multiple remote servers with their connection details, so that I can control where my cookies are sent.

#### Acceptance Criteria

1. THE Options_Page SHALL provide a server management section for adding, editing, and removing Server_Configuration records
2. WHEN the user adds a Server_Configuration, THE Options_Page SHALL validate that the URL is a valid HTTPS URL and the authorization key is non-empty
3. WHEN the user designates a server as Primary_Server, THE Options_Page SHALL ensure only one server holds the primary designation at a time
4. WHEN the user designates a server as Backup_Server, THE Options_Page SHALL ensure only one server holds the backup designation at a time
5. THE Options_Page SHALL store all Server_Configuration records in chrome.storage.local
6. WHEN the user removes the last Server_Configuration, THE Options_Page SHALL disable all sync operations and display a warning

### Requirement 5: Retry and Failure Strategy

**User Story:** As a user, I want sync failures to be handled with retries and logged, so that transient network issues are handled gracefully and I can diagnose persistent failures.

#### Acceptance Criteria

1. WHEN a sync request to a server fails, THE Sync_Engine SHALL retry the request using Exponential_Backoff with intervals of 1 minute, 2 minutes, and 4 minutes
2. WHEN a sync request has failed 3 consecutive retries, THE Sync_Engine SHALL mark the sync attempt as failed and stop retrying until the next scheduled interval
3. WHEN a sync attempt fails permanently (after all retries), THE Sync_Engine SHALL log the failure reason, timestamp, and affected domain to chrome.storage.local
4. WHEN a domain has 3 or more consecutive permanently failed sync attempts, THE Background_Service_Worker SHALL create a Chrome notification alerting the user
5. THE Sync_Engine SHALL maintain independent retry counters for Primary_Server and Backup_Server
6. WHEN a retry succeeds, THE Sync_Engine SHALL reset the retry counter for that server and record the sync as successful

### Requirement 6: Modern UI Redesign

**User Story:** As a user, I want the extension to have a modern, clean interface with organized management pages, so that I can efficiently manage sync settings and view information.

#### Acceptance Criteria

1. THE Popup SHALL use a modern visual style with rounded corners (8px border-radius), subtle box shadows, and a cohesive color palette
2. THE Extension SHALL provide an Options_Page accessible via the extension's options link with tabbed navigation for Domain Management, Server Configuration, and Sync History sections
3. WHILE the browser has dark mode enabled (prefers-color-scheme: dark), THE Popup and Options_Page SHALL render with a dark color scheme
4. THE Popup SHALL render correctly at widths between 350px and 600px without horizontal scrolling
5. WHEN the user navigates between tabs on the Options_Page, THE Options_Page SHALL display the selected section without full page reloads
6. THE Options_Page SHALL use consistent typography, spacing, and interactive element styles across all tabs

