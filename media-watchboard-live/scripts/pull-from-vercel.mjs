// Usage: node scripts/pull-from-vercel.mjs board.json > updates.json
// board.json = the Claude board's "channels" documents (array of {id, version, data}).
// Env: SYNC_URL (the site's /api/sync URL; /api/export is derived from it) and SYNC_SECRET.
// Prints the updates to apply to the board: [{id, version, data:{...}}]. Rules:
//  - "Mark checked" on the site (ackAt newer than the board's lastActivity) clears a "new" flag on the board.
//  - Name, tag, note, url, interval edited on the site are copied back when they differ.
//  - Channels added on the site that the board lacks are returned with "create": true.
import { readFileSync } from 'node:fs';
const { SYNC_URL, SYNC_SECRET } = process.env;
if (!SYNC_URL || !SYNC_SECRET) { console.error('Set SYNC_URL and SYNC_SECRET'); process.exit(1); }
const board = new Map(JSON.parse(readFileSync(process.argv[2], 'utf8')).map(d => [d.id, d]));
const r = await fetch(SYNC_URL.replace(/\/api\/sync\/?$/, '/api/export'), { headers: { Authorization: 'Bearer ' + SYNC_SECRET } });
if (!r.ok) { console.error('export failed', r.status, await r.text()); process.exit(1); }
const { channels } = await r.json();
const out = [];
for (const v of channels) {
  const b = board.get(v.id);
  if (!b) { const { ackAt, ...data } = v; out.push({ id: v.id, create: true, data }); continue; }
  const d = {}, bd = b.data || {};
  if (bd.flag === 'new' && (v.ackAt || 0) > (bd.lastActivity || 0)) d.flag = 'none';
  for (const k of ['name', 'tag', 'note', 'url', 'intervalH']) if (v[k] !== undefined && v[k] !== bd[k] && !(d.flag && k === 'note')) d[k] = v[k];
  if (Object.keys(d).length) out.push({ id: v.id, version: b.version, data: d });
}
console.log(JSON.stringify(out, null, 2));
