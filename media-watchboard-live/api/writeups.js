import { cronAuthed, dashAuthed, readBody, hgetall, hset, hdel, KEYS } from '../lib/util.js';

// Formal write-ups (one short, third-person brief per political story), shown on the "Write-ups" tab.
// GET  -> { now, writeups: [...] }
// POST { action: 'set', writeups: [ {id, date, t, camp, tone, title, points[], sources[], check?} ] }  |  { action: 'delete', id }
// Auth: open dashboard, or Authorization: Bearer <CRON_SECRET>
const clean = (s, n = 600) => String(s ?? '').trim().slice(0, n);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!dashAuthed(req) && !cronAuthed(req)) return res.status(401).json({ error: 'Not allowed' });
  try {
    if (req.method === 'GET') {
      const all = await hgetall(KEYS.writeups);
      return res.status(200).json({ now: Date.now(), writeups: Object.values(all).filter(Boolean) });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST only' });
    const b = await readBody(req);
    if (b.action === 'delete') {
      const id = clean(b.id, 120);
      if (!id) return res.status(400).json({ error: 'id required' });
      await hdel(KEYS.writeups, id);
      return res.status(200).json({ ok: true });
    }
    if (b.action === 'set') {
      const list = (Array.isArray(b.writeups) ? b.writeups : []).slice(0, 200);
      let written = 0;
      for (const w of list) {
        const id = clean(w && w.id, 120);
        if (!id || !w.title) continue;
        const rec = {
          id, date: clean(w.date, 12), t: Number(w.t) || Date.now(),
          camp: ['nda', 'opp', 'oth'].includes(w.camp) ? w.camp : '', tone: ['pos', 'neg', 'twist'].includes(w.tone) ? w.tone : '',
          title: clean(w.title, 240),
          points: (Array.isArray(w.points) ? w.points : []).slice(0, 8).map(p => clean(p, 700)).filter(Boolean),
          sources: (Array.isArray(w.sources) ? w.sources : []).slice(0, 8).map(s => ({ name: clean(s && s.name, 80), url: clean(s && s.url, 500) })),
          check: w.check ? clean(w.check, 300) : undefined,
        };
        await hset(KEYS.writeups, id, rec); written++;
      }
      return res.status(200).json({ ok: true, written });
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
