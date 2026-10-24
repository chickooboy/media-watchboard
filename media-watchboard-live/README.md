# Media Watchboard (live)
Checks Goa YouTube channels every few minutes, flags live streams and new uploads, and sends Telegram alerts.
Folders: `api/` (server functions), `lib/` (shared code), `public/` (dashboard page + starter channel list).
Settings (Vercel > Settings > Environment Variables): DASH_PASSWORD, CRON_SECRET, YOUTUBE_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID. The database variables are added by Vercel automatically.
