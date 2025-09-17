const dgram = require('dgram');
const dnsPacket = require('dns-packet');
const sqlite3 = require('sqlite3').verbose();
const server = dgram.createSocket('udp4');

// --- SQLite Setup ---
const db = new sqlite3.Database('./db/blocklist.db', sqlite3.OPEN_READONLY, (err) => {
  if (err) console.error('DB Error:', err);
  //console.log('SQLite DB connected');
});

// --- In-memory cache ---
const cache = new Map();

// --- Helper to check if domain is blocked ---
function isBlocked(domain, callback) {
  db.get('SELECT domain FROM blocklist WHERE domain = ?', [domain], (err, row) => {
    if (err) return callback(false);
    callback(!!row);
  });
}

// --- Resolve upstream DNS ---
const dns = require('dns');
function resolveUpstream(domain, type, callback) {
  const key = `${domain}:${type}`;
  if (cache.has(key)) {
    //console.log('[CACHE HIT]', domain, type);
    return callback(null, cache.get(key));
  }

  const resolver = type === 'AAAA' ? dns.resolve6 : dns.resolve4;
  resolver(domain, (err, addresses) => {
    if (err) return callback(err);
    cache.set(key, addresses);
    callback(null, addresses);
  });
}

// --- Handle incoming queries ---
server.on('message', (msg, rinfo) => {
  let query;
  try {
    query = dnsPacket.decode(msg);
  } catch (e) {
    console.error('Decode Error:', e);
    return;
  }

  if (!query.questions || query.questions.length === 0) return;
  const question = query.questions[0];
  const { name, type } = question;

  //console.log('[QUERY]', name, 'type', type);

  isBlocked(name, (blocked) => {
    let response;

    if (blocked) {
      // Return 0.0.0.0 for blocked domains
      response = {
        id: query.id,
        type: 'response',
        flags: dnsPacket.RECURSION_DESIRED | dnsPacket.RECURSION_AVAILABLE,
        questions: [question],
        answers: [{ name, type: 'A', class: 'IN', ttl: 300, data: '0.0.0.0' }]
      };
      sendResponse(response);
    } else {
      // Forward to system resolver
      const recordType = type === 28 ? 'AAAA' : 'A';
      resolveUpstream(name, recordType, (err, addresses) => {
        if (err || !addresses || addresses.length === 0) {
          response = { id: query.id, type: 'response', flags: dnsPacket.RECURSION_DESIRED, questions: [question], answers: [] };
        } else {
          response = {
            id: query.id,
            type: 'response',
            flags: dnsPacket.RECURSION_DESIRED | dnsPacket.RECURSION_AVAILABLE,
            questions: [question],
            answers: addresses.map(ip => ({ name, type: recordType, class: 'IN', ttl: 300, data: ip }))
          };
        }
        sendResponse(response);
      });
    }
  });

  function sendResponse(response) {
    const buf = dnsPacket.encode(response);
    server.send(buf, rinfo.port, rinfo.address, (err) => {
      if (err) console.error('Send Error:', err);
    });
  }
});

// --- Error handling ---
server.on('error', (err) => {
  console.error('Server Error:', err);
  server.close();
});

// --- Start server ---
const PORT = 53;
server.bind(PORT, '0.0.0.0', () => {
  //console.log(`DNS server running on 0.0.0.0:${PORT}`);
});
