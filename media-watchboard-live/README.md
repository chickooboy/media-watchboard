# Media Watchboard (live)
Checks Goa YouTube channels every few minutes, flags live streams and new uploads, and sends Telegram alerts.
Folders: `api/` (server functions), `lib/` (shared code), `public/` (dashboard page + starter channel list).
Settings (Vercel > Settings > Environment Variables): DASH_PASSWORD, CRON_SECRET, YOUTUBE_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID. The database variables are added by Vercel automatically.

## Sync with the Claude board
`api/sync.js` mirrors the Claude board's channels (flags, notes, last activity, history) into this site's database. The Claude board is the master copy.
Push with `SYNC_URL=https://<your-app>.vercel.app/api/sync SYNC_SECRET=<CRON_SECRET> node scripts/sync-to-vercel.mjs channels.json`.
Pull direction: `api/export.js` lists the site's channels; `scripts/pull-from-vercel.mjs` turns site edits (Mark checked, renames, notes) into updates for the Claude board.
