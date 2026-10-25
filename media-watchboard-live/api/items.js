import { dashAuthed, readBody, hgetall, hset, hdel, KEYS } from '../lib/util.js';

// Permanent log of political items (filled by api/sync.js) plus per-item stars/notes.
// GET  -> { now, items: [...], meta: { <itemId>: { star, note } } }
// POST { action: 'meta', id, star?, note? }  |  { action: 'delete', id }
const clean = (s, n = 300) => String(s ?? '').trim().slice(0, n);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!dashAuthed(req)) return res.status(401).json({ error: 'Wrong or missing password' });
  try {
    if (req.method === 'GET') {
      const [items, meta] = await Promise.all([hgetall(KEYS.items), hgetall(KEYS.itemmeta)]);
      return res.status(200).json({ now: Date.now(), items: Object.values(items).filter(Boolean), meta });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST only' });
    const b = await readBody(req);
    const id = clean(b.id, 120);
    if (!id) return res.status(400).json({ error: 'id required' });
    if (b.action === 'meta') {
      const all = await hgetall(KEYS.itemmeta);
      const next = { ...(all[id] || {}) };
      if (b.star !== undefined) next.star = !!b.star;
      if (b.note !== undefined) next.note = clean(b.note, 500);
      if (!next.star && !next.note) await hdel(KEYS.itemmeta, id); else await hset(KEYS.itemmeta, id, next);
      return res.status(200).json({ ok: true, meta: next });
    }
    if (b.action === 'delete') {
      await hdel(KEYS.items, id); await hdel(KEYS.itemmeta, id);
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
