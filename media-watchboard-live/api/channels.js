import { dashAuthed, readBody, hgetall, hset, hdel, KEYS, detectPlatform } from '../lib/util.js';

const clean = (s, n = 300) => String(s ?? '').trim().slice(0, n);
const PLATFORMS = ['youtube', 'x', 'instagram', 'facebook', 'tiktok', 'linkedin', 'telegram', 'reddit', 'other'];

function sanitize(c, old = {}) {
  const url = clean(c.url ?? old.url, 500);
  const platform = PLATFORMS.includes(c.platform) ? c.platform : (old.platform || detectPlatform(url));
  return {
    id: old.id || clean(c.id, 80),
    name: clean(c.name ?? old.name, 120) || 'Untitled channel',
    platform, url,
    tag: clean(c.tag ?? old.tag ?? '', 60),
    intervalH: Math.min(168, Math.max(0.25, Number(c.intervalH ?? old.intervalH ?? 6) || 6)),
    note: clean(c.note ?? old.note ?? '', 500),
    flag: ['none', 'new', 'live'].includes(c.flag) ? c.flag : (old.flag || 'none'),
    lastChecked: old.lastChecked ?? null,
    ackAt: old.ackAt ?? 0,
    createdAt: old.createdAt || Date.now(),
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!dashAuthed(req)) return res.status(401).json({ error: 'Wrong or missing password' });
  try {
    const b = await readBody(req);
    const all = await hgetall(KEYS.channels);

    if (b.action === 'import') {
      let added = 0;
      for (const c of (b.channels || []).slice(0, 500)) {
        const id = clean(c.id, 80) || ('c-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
        if (all[id]) continue;
        await hset(KEYS.channels, id, sanitize({ ...c, id }, {}));
        added++;
      }
      return res.status(200).json({ ok: true, added });
    }
    if (b.action === 'upsert') {
      const c = b.channel || {};
      const id = clean(c.id, 80) || ('c-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
      const old = all[id] || {};
      const next = sanitize({ ...c, id }, { ...old, id });
      next.id = id;
      await hset(KEYS.channels, id, next);
      return res.status(200).json({ ok: true, channel: next });
    }
    if (b.action === 'delete') {
      const id = clean(b.id, 80);
      await hdel(KEYS.channels, id);
      await hdel(KEYS.auto, id);
      return res.status(200).json({ ok: true });
    }
    if (b.action === 'ack') {
      const ids = (Array.isArray(b.ids) ? b.ids : [b.id]).map(x => clean(x, 80));
      const now = Date.now();
      for (const id of ids) {
        const c = all[id]; if (!c) continue;
        await hset(KEYS.channels, id, { ...c, lastChecked: now, ackAt: now, flag: 'none' });
      }
      return res.status(200).json({ ok: true, at: now });
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
