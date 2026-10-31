import { cronAuthed, dashAuthed, readBody, hgetall, hset, redis, KEYS, detectPlatform, parseLabel } from '../lib/util.js';

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
    inclination: clean(c.inclination ?? old.inclination, 60),
    intervalH: Math.min(168, Math.max(0.25, Number(c.intervalH) || 6)),
    note: clean(c.note, 500),
    flag: ['none', 'new', 'live'].includes(c.flag) ? c.flag : 'none',
    lastChecked: num(c.lastChecked),
    lastActivity: num(c.lastActivity),
    history: Array.isArray(c.history) ? c.history.slice(0, 20) : [],
    repeats: Array.isArray(c.repeats) ? c.repeats.slice(0, 30) : (old.repeats || []),
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
    let written = 0, logged = 0;
    // Permanent log of political items (the channel history only keeps the latest few).
    let known = {};
    try { known = await hgetall(KEYS.items); } catch {}
    for (const c of incoming) {
      const id = clean(c.id, 80);
      const next = build(c, all[id] || {});
      await hset(KEYS.channels, id, next);
      written++;
      const entries = [...next.history.map(h => ({ h, rep: false })), ...(next.repeats || []).map(h => ({ h, rep: true }))];
      for (const { h, rep } of entries) {
        if (!h || h.type === 'checked' || !h.t) continue;
        const lab = parseLabel(h);
        if (!lab.camp || !lab.hl) continue;
        const iid = rep ? `${id}|${h.t}|r` : `${id}|${h.t}`;
        const prev = known[iid];
        const url = clean(h.url, 500);
        if (prev && prev.url === url && !!prev.rep === rep) continue;
        const rec = { id: iid, cid: id, name: next.name, platform: next.platform, t: Number(h.t), hl: clean(lab.hl, 240), camp: lab.camp, tone: lab.tone, raw: clean(lab.raw, 40), url, seen: prev?.seen || Date.now(), ...(rep ? { rep: true, dupOf: clean(h.dupOf, 300) } : {}) };
        await hset(KEYS.items, iid, rec);
        known[iid] = rec;
        logged++;
      }
    }
    await redis('SET', 'mw:sync', JSON.stringify({ at: Date.now(), count: written }));
    res.status(200).json({ ok: true, written, logged });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
