import { dashAuthed, hgetall, redis, KEYS } from '../lib/util.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!dashAuthed(req)) return res.status(401).json({ error: 'Wrong or missing password' });
  try {
    const [channels, auto, meta] = await Promise.all([
      hgetall(KEYS.channels), hgetall(KEYS.auto), redis('GET', KEYS.meta),
    ]);
    let m = null; try { m = meta ? JSON.parse(meta) : null; } catch {}
    res.status(200).json({
      now: Date.now(),
      channels: Object.values(channels).filter(Boolean),
      auto, meta: m,
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
