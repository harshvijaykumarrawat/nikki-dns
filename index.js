const dgram = require('dgram');
const dnsPacket = require('dns-packet');
const sqlite3 = require('sqlite3').verbose();
const { LRUCache } = require("lru-cache");
const server = dgram.createSocket('udp4');

// --- Logging Utility ---
const isDev = process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test';
function log(...args) {
    if (isDev) {
        console.log(...args);
    }
}

// --- SQLite Setup ---
const db = new sqlite3.Database('./db/blocklist.db', sqlite3.OPEN_READONLY, (err) => {
    if (err) console.error('DB Error:', err);
    log('SQLite DB connected');
});

// --- LRU Cache Setup ---
const MAX_SIZE = 20; // Max number of entries in cache
const BLOCKED_CACHE_SIZE = 0.8 * MAX_SIZE; // 80% of memory
const ALLOWED_CACHE_SIZE = 0.2 * MAX_SIZE; // 20% of memory
const CACHE_TTL = 1000 * 60 * 60 * 5; // 20 minutes in milliseconds

const blockedCache = new LRUCache({
    max: BLOCKED_CACHE_SIZE,
    ttl: CACHE_TTL,
    updateAgeOnGet: true,
    updateAgeOnHas: true,
});

const allowedCache = new LRUCache({
    max: ALLOWED_CACHE_SIZE,
    ttl: CACHE_TTL,
    updateAgeOnGet: true,
    updateAgeOnHas: true,
});

// --- Helper to check if domain is blocked ---
function isBlocked(domain, callback) {
    if (blockedCache.has(domain)) {
        log(`[CACHE HIT] Blocked: ${domain}`);
        return callback(true);
    }
    if (allowedCache.has(domain)) {
        log(`[CACHE HIT] Allowed: ${domain}`);
        return callback(false);
    }

    db.get('SELECT domain FROM blocklist WHERE domain = ?', [domain], (err, row) => {
        if (err) return callback(false);

        if (row) {
            blockedCache.set(domain, true);
            log(`[CACHE SET] Blocked: ${domain}`);
            callback(true);
        } else {
            allowedCache.set(domain, true);
            log(`[CACHE SET] Allowed: ${domain}`);
            callback(false);
        }
    });
}

// --- Resolve upstream DNS ---
const dns = require('dns');
function resolveUpstream(domain, type, callback) {
    const key = `${domain}:${type}`;
    if (allowedCache.has(key)) {
        log('[CACHE HIT] Allowed:', domain, type);
        return callback(null, allowedCache.get(key));
    }

    const resolver = type === 'AAAA' ? dns.resolve6 : dns.resolve4;
    resolver(domain, (err, addresses) => {
        if (err) return callback(err);
        allowedCache.set(key, addresses);
        log('[CACHE SET] Allowed:', domain, type, addresses);
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

    log('[QUERY]', name, 'type', type);

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
    log(`DNS server running on 0.0.0.0:${PORT}`);
});
