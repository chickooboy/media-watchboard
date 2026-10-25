import { cronAuthed, dashAuthed, readBody, hgetall, hset, redis, KEYS, detectPlatform } from '../lib/util.js';

// Receives the Claude board's channel documents and mirrors them into the database,
// so the Vercel site shows the same channels, flags and notes. The Claude board is the master copy.
// POST { channels: [ {id, name, url, platform, tag, intervalH, flag, note, lastChecked, lastActivity, history, probe, createdAt}, ... ] }
// Auth: Authorization: Bearer <CRON_SECRET>  (or x-key: <DASH_PASSWORD>)

const clean = (s, n = 300) => String(s ?? '').trim().slice(0, n);
const num = v => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
const PLATFORMS = ['youtube', 'x', 'instagram', 'facebook', 'tiktok', 'linkedin', 'telegram', 'reddit', 'other'];

function build(c, old = {}) {
  const url = clean(c.url, 500);
  return {
    ...old,
    id: clean(c.id, 80),
    name: clean(c.name, 120) || 'Untitled channel',
    platform: PLATFORMS.includes(c.platform) ? c.platform : detectPlatform(url),
    url,
    tag: clean(c.tag, 60),
    intervalH: Math.min(168, Math.max(0.25, Number(c.intervalH) || 6)),
    note: clean(c.note, 500),
    flag: ['none', 'new', 'live'].includes(c.flag) ? c.flag : 'none',
    lastChecked: num(c.lastChecked),
    lastActivity: num(c.lastActivity),
    history: Array.isArray(c.history) ? c.history.slice(0, 20) : [],
    probe: c.probe && typeof c.probe === 'object' ? c.probe : null,
    createdAt: num(c.createdAt) || old.createdAt || Date.now(),
    // keep Vercel-side acknowledgement unless the Claude board raised a newer activity
    ackAt: old.ackAt ?? 0,
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!cronAuthed(req) && !dashAuthed(req)) return res.status(401).json({ error: 'Not allowed' });
  try {
    const b = await readBody(req);
    const incoming = (Array.isArray(b.channels) ? b.channels : []).filter(c => c && clean(c.id, 80)).slice(0, 500);
    const all = await hgetall(KEYS.channels);
    let written = 0;
    for (const c of incoming) {
      const id = clean(c.id, 80);
      await hset(KEYS.channels, id, build(c, all[id] || {}));
      written++;
    }
    await redis('SET', 'mw:sync', JSON.stringify({ at: Date.now(), count: written }));
    res.status(200).json({ ok: true, written });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
