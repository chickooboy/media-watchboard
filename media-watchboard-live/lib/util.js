// Shared helpers: database (Upstash Redis REST), login check, YouTube API, Telegram.

const DB_URL = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const DB_TOKEN = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

let _tcp;
async function tcpClient() {
  if (!_tcp) {
    const { createClient } = await import('redis');
    const c = createClient({ url: process.env.REDIS_URL });
    c.on('error', () => {});
    _tcp = c.connect().then(() => c);
  }
  return _tcp;
}

export async function redis(...cmd) {
  if (!DB_URL() || !DB_TOKEN()) {
    if (!process.env.REDIS_URL) throw new Error('Database not connected (missing KV_REST_API_URL / KV_REST_API_TOKEN / REDIS_URL)');
    try {
      const c = await tcpClient();
      return await c.sendCommand(cmd.map(String));
    } catch (e) { _tcp = undefined; throw new Error('Database error: ' + e.message); }
  }
  const r = await fetch(DB_URL(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${DB_TOKEN()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error('Database error: ' + (j.error || r.status));
  return j.result;
}

export async function hgetall(key) {
  const res = await redis('HGETALL', key);
  const out = {};
  if (Array.isArray(res)) {
    for (let i = 0; i < res.length; i += 2) out[res[i]] = safeParse(res[i + 1]);
  } else if (res && typeof res === 'object') {
    for (const k of Object.keys(res)) out[k] = safeParse(res[k]);
  }
  return out;
}
export const hset = (key, field, value) => redis('HSET', key, field, JSON.stringify(value));
export const hdel = (key, field) => redis('HDEL', key, field);

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

// ---- access checks -------------------------------------------------------
export function dashAuthed(req) {
  // The dashboard is open (no password) unless REQUIRE_PASSWORD=1 is set on the project.
  // To bring the password back: set REQUIRE_PASSWORD=1 and DASH_PASSWORD in Vercel and redeploy.
  if (process.env.REQUIRE_PASSWORD !== '1') return true;
  const pw = process.env.DASH_PASSWORD;
  return !!pw && (req.headers['x-key'] || '') === pw;
}
export function cronAuthed(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  const q = (req.query && req.query.key) || '';
  return bearer === secret || q === secret;
}

export async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return safeParse(req.body) || {};
  return {};
}

// ---- YouTube ---------------------------------------------------------------
async function yt(path, params) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error('YOUTUBE_API_KEY is not set');
  const u = new URL('https://www.googleapis.com/youtube/v3/' + path);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set('key', key);
  const r = await fetch(u);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('YouTube: ' + (j.error?.message || r.status));
  return j;
}

// Turn a channel link into the channel's UC... id.
export async function resolveChannelId(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!/(^|\.)youtube\.com$/i.test(u.hostname)) return null;
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts[0] === 'channel' && /^UC[\w-]{20,}$/.test(parts[1] || '')) return parts[1];
  if (parts[0] && parts[0].startsWith('@')) {
    const j = await yt('channels', { part: 'id', forHandle: parts[0] });
    return j.items?.[0]?.id || null;
  }
  if (parts[0] === 'user' && parts[1]) {
    const j = await yt('channels', { part: 'id', forUsername: parts[1] });
    return j.items?.[0]?.id || null;
  }
  if (parts[0] === 'c' && parts[1]) {
    const j = await yt('search', { part: 'snippet', type: 'channel', q: parts[1], maxResults: '1' });
    return j.items?.[0]?.snippet?.channelId || j.items?.[0]?.id?.channelId || null;
  }
  return null;
}

export async function latestUploadIds(channelId, n = 5) {
  const j = await yt('playlistItems', { part: 'contentDetails', playlistId: 'UU' + channelId.slice(2), maxResults: String(n) });
  return (j.items || []).map(i => i.contentDetails.videoId);
}

export async function videoDetails(ids) {
  const out = {};
  for (let i = 0; i < ids.length; i += 50) {
    const j = await yt('videos', { part: 'snippet,liveStreamingDetails', id: ids.slice(i, i + 50).join(',') });
    for (const v of j.items || []) {
      out[v.id] = {
        id: v.id,
        title: v.snippet?.title || '',
        publishedAt: Date.parse(v.snippet?.publishedAt) || null,
        live: v.snippet?.liveBroadcastContent || 'none', // live | upcoming | none
        startedAt: Date.parse(v.liveStreamingDetails?.actualStartTime) || null,
        scheduledAt: Date.parse(v.liveStreamingDetails?.scheduledStartTime) || null,
      };
    }
  }
  return out;
}

// ---- Telegram --------------------------------------------------------------
export async function telegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text }),
    });
    return r.ok;
  } catch { return false; }
}

export const KEYS = { channels: 'mw:channels', auto: 'mw:auto', meta: 'mw:meta', items: 'mw:items', itemmeta: 'mw:itemmeta' };

// Parse a board label like "NDA Positive" or a note like "[Opposition Negative] headline".
export function parseLabel(h) {
  const note = String(h?.note || '').trim();
  const m = note.match(/^\[([^\]]+)\]\s*(.*)$/);
  const raw = String(h?.incl || (m && m[1]) || '').trim();
  const l = raw.toLowerCase();
  const camp = /^nda/.test(l) ? 'nda' : /^opp/.test(l) ? 'opp' : /^oth/.test(l) ? 'oth' : '';
  const tone = /positive/.test(l) ? 'pos' : /negative/.test(l) ? 'neg' : /twist/.test(l) ? 'twist' : '';
  return { camp, tone, raw, hl: (m ? m[2] : note) || note };
}

export function detectPlatform(url) {
  let h = '';
  try { h = new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return 'other'; }
  if (/(^|\.)youtube\.com$|^youtu\.be$/.test(h)) return 'youtube';
  if (/(^|\.)instagram\.com$/.test(h)) return 'instagram';
  if (/(^|\.)(x|twitter)\.com$/.test(h)) return 'x';
  if (/(^|\.)facebook\.com$/.test(h)) return 'facebook';
  return 'other';
}
