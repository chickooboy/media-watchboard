// Usage: node scripts/sync-to-vercel.mjs channels.json
// channels.json = the Claude board's "channels" documents (array of docs, or an array of {id, data}).
// Env: SYNC_URL (e.g. https://your-app.vercel.app/api/sync) and SYNC_SECRET (same value as CRON_SECRET).
import { readFileSync } from 'node:fs';
const { SYNC_URL, SYNC_SECRET } = process.env;
if (!SYNC_URL || !SYNC_SECRET) { console.error('Set SYNC_URL and SYNC_SECRET'); process.exit(1); }
const raw = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const channels = (Array.isArray(raw) ? raw : raw.documents || []).map(d => (d.data ? { id: d.id, ...d.data } : d));
const r = await fetch(SYNC_URL, {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + SYNC_SECRET, 'Content-Type': 'application/json' },
  body: JSON.stringify({ channels }),
});
console.log(r.status, await r.text());
process.exit(r.ok ? 0 : 1);
