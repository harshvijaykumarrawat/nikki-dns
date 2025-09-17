# nikki-dns

A Node.js application that fetches ad/malware domains from multiple blocklist CDNs and inserts them into a local SQLite3 database. Can run as a systemd service on Debian/Ubuntu.

---

## Features

- Fetches blocklists from multiple CDNs:
  - `https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/adblock/multi.txt`
  - `https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts`
- Supports large SQLite3 databases.
- Runs as a systemd service.
- Automatically updates and inserts new domains.
- Logs output to syslog.

---

## Installation (Debian/Ubuntu)

1. **Download the `.deb` package**:

```bash
wget https://github.com/<username>/blocklist-app/releases/download/v1.0.0/blocklist-app.deb
