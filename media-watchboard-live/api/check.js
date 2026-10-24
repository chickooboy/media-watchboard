import {
  cronAuthed, hgetall, hset, redis, KEYS,
  resolveChannelId, latestUploadIds, videoDetails, telegram,
} from '../lib/util.js';

export const config = { maxDuration: 60 };

const SEEN_CAP = 40;

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!cronAuthed(req)) return res.status(401).json({ error: 'Not allowed' });
  const started = Date.now();
  const alerts = [];
  const errors = [];
  try {
    const channels = Object.values(await hgetall(KEYS.channels)).filter(c => c && c.platform === 'youtube' && c.url);
    const autoAll = await hgetall(KEYS.auto);

    // 1. find the newest uploads of every YouTube channel
    const step1 = await pool(channels, 8, async (c) => {
      const prev = autoAll[c.id] || {};
      try {
        let ytId = prev.ytId;
        if (!ytId) {
          ytId = await resolveChannelId(c.url);
          if (!ytId) throw new Error('Could not find this YouTube channel from its link');
        }
        const ids = await latestUploadIds(ytId, 5);
        return { c, prev, ytId, ids };
      } catch (e) {
        errors.push(`${c.name}: ${e.message}`);
        return { c, prev, error: String(e.message || e) };
      }
    });

    // 2. one batched look at those videos (is any live? is any new?)
    const allIds = [...new Set(step1.flatMap(s => s.ids || []))];
    let details = {};
    if (allIds.length) {
      try { details = await videoDetails(allIds); }
      catch (e) { errors.push('videos: ' + e.message); }
    }

    // 3. decide what changed, store it, alert
    const now = Date.now();
    for (const s of step1) {
      const { c, prev } = s;
      if (s.error || !s.ids) {
        await hset(KEYS.auto, c.id, { ...prev, checkedAt: prev.checkedAt || 0, error: s.error, errorAt: now });
        continue;
      }
      const first = !prev.seen;
      const seen = new Set(prev.seen || []);
      const alerted = new Set(prev.alerted || []);
      let live = null, newVideo = prev.newVideo || null, upcoming = null, latest = null;

      for (const id of s.ids) {
        const v = details[id]; if (!v) continue;
        if (!latest) latest = { id: v.id, title: v.title, publishedAt: v.publishedAt };
        if (v.live === 'live') {
          if (!live) live = { id: v.id, title: v.title, startedAt: v.startedAt || v.publishedAt };
          if (!alerted.has(id)) {
            alerted.add(id); seen.add(id);
            newVideo = { id, title: v.title, publishedAt: v.publishedAt, detectedAt: now, kind: 'live' };
            alerts.push(`🔴 LIVE now: ${c.name}\n${v.title}\nhttps://www.youtube.com/watch?v=${id}`);
          }
        } else if (v.live === 'upcoming') {
          if (!upcoming) upcoming = { id: v.id, title: v.title, scheduledAt: v.scheduledAt };
        } else if (!seen.has(id)) {
          seen.add(id);
          if (!first) {
            newVideo = { id, title: v.title, publishedAt: v.publishedAt, detectedAt: now, kind: 'video' };
            alerts.push(`🆕 New upload: ${c.name}\n${v.title}\nhttps://www.youtube.com/watch?v=${id}`);
          }
        }
      }
      await hset(KEYS.auto, c.id, {
        ytId: s.ytId,
        checkedAt: now,
        live, upcoming, latest, newVideo,
        seen: [...seen].slice(-SEEN_CAP),
        alerted: [...alerted].slice(-SEEN_CAP),
        error: null,
      });
    }

    for (const text of alerts) await telegram(text);

    const meta = {
      lastRun: now, ms: Date.now() - started, channels: channels.length,
      alerts: alerts.length, errors: errors.slice(0, 5),
      telegram: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
    };
    await redis('SET', KEYS.meta, JSON.stringify(meta));
    res.status(200).json({ ok: true, ...meta });
  } catch (e) {
    const msg = String(e.message || e);
    try { await redis('SET', KEYS.meta, JSON.stringify({ lastRun: Date.now(), fatal: msg })); } catch {}
    res.status(500).json({ error: msg });
  }
}
