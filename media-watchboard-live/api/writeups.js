import { cronAuthed, dashAuthed, readBody, hgetall, hset, hdel, KEYS } from '../lib/util.js';

// Formal write-ups (one short, third-person brief per political story), shown on the "Write-ups" tab.
// GET  -> { now, writeups: [...] }
// POST { action: 'set', writeups: [ {id, date, t, camp, tone, title, points[], sources[], check?} ] }  |  { action: 'delete', id }
// Auth: open dashboard, or Authorization: Bearer <CRON_SECRET>
export const config = { maxDuration: 60 };

// Backend generation: when ANTHROPIC_API_KEY is set on the server, a requested write-up is produced immediately.
async function generate(rec) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const prompt = `Write a formal news write-up for a Goa political-news desk from ONLY the facts below.
Style: third person, formal, factual, neutral, no opinion adjectives. Use "Shri" before names of male politicians, "Smt." for women, "Dr." for doctors. Title in sentence case. Then 1 to 6 short numbered points, one fact each (who said or did what, where, when, reaction). Never invent quotes, numbers or detail; if something is unclear, state only what is certain and put a short note in "check".
Headline: ${rec.title}
Source(s): ${rec.sources.map(x => x.name + ' ' + x.url).join('; ')}
Leaning label: camp=${rec.camp} tone=${rec.tone}
Reply with ONLY JSON: {"title":"...","points":["..."],"check":"" }`;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: process.env.WRITEUP_MODEL || 'claude-sonnet-4-5', max_tokens: 800, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!r.ok) throw new Error('generation failed ' + r.status);
  const j = await r.json();
  const txt = (j.content || []).map(c => c.text || '').join('');
  const o = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
  if (!o.title || !Array.isArray(o.points) || !o.points.length) throw new Error('bad generation');
  return { ...rec, status: undefined, title: clean(o.title, 240), points: o.points.slice(0, 8).map(p => clean(p, 700)).filter(Boolean), check: o.check ? clean(o.check, 300) : undefined };
}

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
    if (b.action === 'request') {
      // User clicked "Write-up" on a live-feed item: queue it as pending; the assistant fills it in.
      const id = clean(b.id, 120);
      if (!id || !b.title) return res.status(400).json({ error: 'id and title required' });
      const all = await hgetall(KEYS.writeups);
      const have = all[id];
      if (have && (have.status !== 'pending' || have.points?.length)) return res.status(200).json({ ok: true, existing: true });
      const rec = {
        id, status: 'pending', requestedAt: Date.now(), date: clean(b.date, 12), t: Number(b.t) || Date.now(),
        camp: ['nda', 'opp', 'oth'].includes(b.camp) ? b.camp : '', tone: ['pos', 'neg', 'twist'].includes(b.tone) ? b.tone : '',
        title: clean(b.title, 240), points: [],
        sources: (Array.isArray(b.sources) ? b.sources : []).slice(0, 8).map(s => ({ name: clean(s && s.name, 80), url: clean(s && s.url, 500) })),
      };
      await hset(KEYS.writeups, id, rec);
      try {
        const done = await generate(rec);
        if (done) { delete done.status; await hset(KEYS.writeups, id, done); return res.status(200).json({ ok: true, done: true }); }
      } catch (e) { return res.status(200).json({ ok: true, pending: true, note: String(e.message || e) }); }
      return res.status(200).json({ ok: true, pending: true });
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
