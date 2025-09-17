# Blocklist App – Detailed Description

## Overview

The Blocklist App is a Node.js application designed to fetch domains from multiple online blocklists and store them in a local SQLite3 database. It aims to provide a lightweight, easy-to-deploy ad/malware blocking system that can run on Debian-based systems as a systemd service.

---

## Architecture

1. **Node.js Backend**
   - Written in CommonJS syntax.
   - Uses:
     - `axios` for fetching blocklists over HTTP/HTTPS.
     - `sqlite3` for storing domain entries in a local database.
   - Supports multiple blocklist sources (CDNs).

2. **Database**
   - SQLite3 database (`blocklist.db`) stores all blocked domains.
   - Table structure:
     ```sql
     CREATE TABLE blocklist (
         domain TEXT PRIMARY KEY
     );
     ```
   - Designed to handle large datasets (thousands of domains).
   - Inserts are batched to avoid exceeding SQLite's SQL variable limit.

3. **Blocklist Sources**
   - Supports multiple CDN formats:
     - Plain domain lists (e.g., `multi.txt` from `jsdelivr`).
     - Hosts files (e.g., `StevenBlack/hosts` from GitHub).
   - The app automatically parses each line, ignoring comments and invalid entries.
   - Deduplicates domains before inserting into the database.

4. **Systemd Integration**
   - The app can be installed as a service for automatic execution.
   - `blocklist-app.service` ensures:
     - Startup on boot.
     - Logging via `journalctl`.
     - Easy management (`start`, `stop`, `restart`).

5. **Debian Package**
   - Provides `.deb` for easy installation.
   - Copies Node.js app and database to `/usr/local/bin/`.
   - Installs systemd service automatically.
   - Handles dependencies via `postinst` script.

---

## Workflow

1. On startup, the app reads the list of configured blocklist URLs.
2. Fetches each blocklist asynchronously using HTTP GET.
3. Parses the content:
   - Ignores comments (`#`) and blank lines.
   - Converts hosts-file style entries (e.g., `0.0.0.0 domain.com`) into domain-only format.
4. Deduplicates domains to avoid inserting duplicates into SQLite.
5. Batches inserts into the database (to avoid exceeding SQLite’s variable limit).
6. Logs success/failure messages.
7. If installed as a service, the app repeats the process whenever restarted.

---

## Security & Performance Considerations

- Only stores domain names (no IPs or metadata from hosts files), reducing DB size.
- SQLite3 ensures fast read/write and portability.
- Can be integrated with local DNS servers for ad-blocking.
- Updates can be automated by running a cronjob or using the systemd service restart.

---

## Extensibility

- New blocklists can be added to the array in `index.js`.
- Supports both plain lists and hosts file formats.
- Can be extended to periodically fetch and update lists.

---

## Logging

- Logs are output to `stdout` and captured by systemd.
- Users can inspect logs with:
```bash
sudo journalctl -u blocklist-app -f
