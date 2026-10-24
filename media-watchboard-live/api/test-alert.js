import { dashAuthed, telegram } from '../lib/util.js';

export default async function handler(req, res) {
  if (!dashAuthed(req)) return res.status(401).json({ error: 'Wrong or missing password' });
  const ok = await telegram('✅ Media Watchboard test: alerts are working.');
  res.status(200).json({ ok, hint: ok ? 'Check your Telegram group.' : 'Telegram not configured or the bot is not in the group.' });
}
