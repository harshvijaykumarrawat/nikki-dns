const sqlite3 = require('sqlite3').verbose();
const https = require('https');

const db = new sqlite3.Database('./db/blocklist.db');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS blocklist (
    domain TEXT PRIMARY KEY
  );`);
});

const cdnUrls = [
  'https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/adblock/multi.txt',
  'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts'
];

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function extractDomains(url, data) {
  const lines = data.split(/\r?\n/);
  const domains = [];

  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;

    if (url.includes('multi.txt')) {
      line = line.replace(/^\|\|/, '').replace(/\^.*$/, '');
      if (line) domains.push(line);
    } else if (url.includes('hosts')) {
      const parts = line.split(/\s+/);
      if (parts.length >= 2 && (parts[0] === '0.0.0.0' || parts[0] === '127.0.0.1')) {
        domains.push(parts[1]);
      }
    }
  }

  return domains;
}

// Batch insert domains to avoid SQLITE_ERROR
async function insertDomainsInBatches(domains, batchSize = 900) {
  for (let i = 0; i < domains.length; i += batchSize) {
    const batch = domains.slice(i, i + batchSize);
    const placeholders = batch.map(() => '(?)').join(',');
    await new Promise((resolve, reject) => {
      const stmt = db.prepare(`INSERT OR IGNORE INTO blocklist (domain) VALUES ${placeholders}`);
      stmt.run(batch, function(err) {
        if (err) reject(err);
        else {
          console.log(`Inserted ${this.changes} domains`);
          resolve();
        }
      });
      stmt.finalize();
    });
  }
}

(async () => {
  for (const url of cdnUrls) {
    try {
      const data = await fetchUrl(url);
      const domains = extractDomains(url, data);
      console.log(`Processing ${domains.length} domains from ${url}`);
      await insertDomainsInBatches(domains);
    } catch (err) {
      console.error(`Failed to fetch ${url}:`, err);
    }
  }

  db.close(() => console.log('Database closed.'));
})();
