# Calm Feed

**One calm place for everything you actually want to follow.**

Pick the channels and accounts you care about and see only those. No recommendations, no endless scrolling, no rabbit holes. When you have seen everything, the feed ends.

## Features

**Following**
- YouTube channels (add by `@handle`, channel link, or even a video link), playlists, and Latest videos with "Load more".
- Reddit subreddits, Bluesky accounts, and any blog or podcast (RSS) link.
- Instagram and X accounts as link tiles (they do not share posts with other apps).
- Folders to group channels, reorder channels, search your channels, a red dot with a number for new items since your last visit.

**Watching**
- Grid or list view, filter videos by title, video length badge, red progress bar, resume where you stopped.
- Big player with an "Up next" list you can close; the next video plays automatically.

**Focus**
- Hide Shorts (60 seconds or less) and live streams.
- Daily time limit (with an optional "add 10 minutes"), quiet hours, and a weekly summary.

**Accounts**
- Email sign-in, password reset, everything saved to your account across devices.
- Optional public profile: share a link (`/?u=username`) so others can see and copy your channel list.
- Light, dark or automatic theme; can be added to a phone or tablet home screen.

**Plans**
- Free plan: up to 15 channels (change `FREE_LIMIT` in `index.html`). Pro (unlimited, no ads) is a placeholder, with no payments yet.
- Optional ad slot at the side of the page: set `ADSENSE_CLIENT` and `ADSENSE_SLOT` in `index.html`.

## Setup

1. **Supabase:** run `supabase-setup.sql` once in SQL Editor. In Authentication → URL Configuration, set Site URL to your website address (needed for password reset links).
2. **Render:** add environment variable `YOUTUBE_API_KEY` (YouTube Data API v3 key). Keep it private.
3. **GitHub:** upload `server.js`, `index.html`, `package.json` and `README.md`. Render redeploys automatically.

Run locally: `YOUTUBE_API_KEY=yourkey REQUIRE_AUTH=false node server.js`, then open `http://localhost:3000`. (`REQUIRE_AUTH=false` is for local testing only.)

## Files

- `server.js`: talks to YouTube's official API, Reddit, Bluesky and RSS; requires a signed-in user and limits each user to 120 requests a minute to protect your YouTube quota.
- `index.html`: the app.
- `package.json`: lets hosting start the app with `npm start`.
- `supabase-setup.sql`: one-time database setup.

## Known limits

- YouTube Shorts are detected by length (60 seconds or less).
- Reddit often blocks requests from hosting servers; if adding a subreddit fails, that is why.
- Daily time and the weekly minutes are counted per device. Watch history and progress sync across devices.
- Payments are not built. Before charging for Pro, the plan setting must be moved somewhere users cannot edit.
