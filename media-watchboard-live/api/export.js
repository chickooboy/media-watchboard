import { cronAuthed, dashAuthed, hgetall, KEYS } from '../lib/util.js';

// Read endpoint for the Claude board: returns every channel as stored here (including ackAt,
// set when someone presses "Mark checked" on this site) so the board can pull those edits back.
// GET  Authorization: Bearer <CRON_SECRET>  (or x-key: <DASH_PASSWORD>)
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!cronAuthed(req) && !dashAuthed(req)) return res.status(401).json({ error: 'Not allowed' });
  try {
    const channels = Object.values(await hgetall(KEYS.channels)).filter(Boolean);
    res.status(200).json({ now: Date.now(), channels });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
