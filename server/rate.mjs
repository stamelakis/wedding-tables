// Rate-limit bookkeeping, as pure functions so the API tests can check them without starting a server.
// Keys are `<client>:<bucket>` and the client is an IP address — which, for IPv6, contains colons of its own. Every
// split in here therefore works from the END of the key: the bucket suffix never contains a colon, an address may.
// Getting this wrong does not weaken the limiting itself (the keys stay distinct) but it does make «Πίεση στα όρια»
// report a fragment of someone's address as a bucket name, with no ceiling and so no at-80% warning — exactly in the
// case the panel exists for: 300 guests on a venue's wifi, most of them on IPv6 mobile, hitting POST /find.

// How long each bucket counts for. The housekeeping must never drop a row that is still counting
// (`:findfail` also carries the per-token rows, whose keys end in `!<hash>`).
export const RL_WINDOW = k => k.endsWith(':mail') || k.includes(':findfail') ? 3600000 : k.endsWith(':find') ? 600000 : 60000;
// What each bucket's ceiling is — kept next to the limits themselves so «Διαγνωστικά» can never show a stale number.
export const RL_LIMIT = { find: 400, findfail: 10, findtoken: 1, mail: 20, pdf: 10, amelie: 12, create: 20, write: 120, authfail: 60 };

// The per-token rows are `<ip>:findfail!<sha>`; everything else is `<ip>:<bucket>`.
export const rateKind = k => k.includes('!') ? 'findtoken' : (k.slice(k.lastIndexOf(':') + 1) || 'other');
export const rateClient = k => { const i = k.lastIndexOf(':'); return i > 0 ? k.slice(0, i) : k; };

// How full each bucket is right now. Counts only — never a key, never an address: the admin console has no business
// learning who is hitting a limit, only that something is.
export function ratePressure(RL, now = Date.now()) {
  const buckets = new Map(), clients = new Set();
  for (const [k, arr] of RL) {
    const live = arr.filter(t => now - t < RL_WINDOW(k)).length;
    if (!live) continue;
    const kind = rateKind(k);
    const b = buckets.get(kind) || { kind, limit: RL_LIMIT[kind] || 0, keys: 0, hits: 0, worst: 0, atLimit: 0 };
    b.keys++; b.hits += live; if (live > b.worst) b.worst = live;
    if (b.limit && live >= b.limit) b.atLimit++;
    buckets.set(kind, b);
    clients.add(rateClient(k));
  }
  const out = [...buckets.values()].sort((a, b) => (b.worst / (b.limit || 1)) - (a.worst / (a.limit || 1)));
  return { rows: RL.size, live: out.reduce((n, b) => n + b.keys, 0), clients: clients.size, buckets: out };
}
