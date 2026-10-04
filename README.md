# Calm Feed

**One calm place for everything you actually want to follow.**

Calm Feed is a distraction-free way to follow your favorite creators. You pick the channels and accounts you care about, and you see only their content. No recommendations, no endless scrolling, no rabbit holes.

## Why this exists

Most of us open YouTube or Instagram to watch one thing and end up scrolling for an hour. The apps are built to keep us there. Calm Feed does the opposite: it gives you what you chose, then lets you leave.

The idea in one line: **your favorites, in one place, without the distraction.**

## The vision

1. **Create your own profile.** Anyone can sign up and set up a personal space.
2. **Add your favorite sources.** YouTube channels, Instagram accounts, X accounts, and other social media or blogs, all in one place.
3. **See only what you chose.** A clean, chronological feed of the accounts you added. When you have seen everything, the feed ends and says so.
4. **Share your favorites (later).** Public profiles let people see which creators you recommend.

### Principles

- **No algorithmic recommendations.** You decide what appears.
- **No infinite scroll.** The feed has an end.
- **Calm design.** Minimal, quiet, easy on the eyes.
- **Your list, your control.** Add or remove accounts any time.

## What works today (MVP: YouTube only)

- Add a channel by **handle** (for example `@mkbhd`) or by pasting a **channel link** (or even a video link).
- **Home page** shows only your channels: profile picture and name.
- Tap a channel to open it, with two tabs:
  - **Latest videos:** the newest uploads as thumbnails, playable in the page.
  - **Playlists:** playlist thumbnails to choose from, plus a box to paste a playlist link.
- Your channel list is saved in your browser.

### Known limits

- Without an API key, playlists show the first ~100 videos (read from the playlist page). With a free YouTube API key set as `YOUTUBE_API_KEY` on the host, playlists show up to 500 videos reliably. Channel "Latest videos" shows the 15 newest.
- The automatic playlist list reads YouTube's page layout, which can change. Pasting a playlist link always works as a fallback.
- Your list is saved per browser. It does not sync between devices yet.
- YouTube may block some hosting servers. If that happens, switching to YouTube's official API (with a free key) is the planned fix.

## Roadmap

1. **Now:** YouTube channels and playlists (this MVP).
2. **Next:** Official YouTube API for full playlists and stable results; accounts and sync across devices.
3. **Then:** More platforms that offer public feeds (Reddit, Bluesky, Mastodon, blogs, podcasts).
4. **Later:** Instagram and X through a browser extension that works inside the user's own session, with official embeds for display.
5. **Focus tools:** Daily limits, scheduled check-in times, weekly summaries of what you watched.
6. **Public profiles:** Share the creators you recommend.

## Ideas for making money (kept in line with the calm promise)

- **Free plan** with a limited number of accounts and light, static ads on the side of the page (no ads before or inside videos).
- **Paid plan** with unlimited accounts, more platforms, focus tools and no ads.
- **Optional extras:** custom profile pages, and team or school plans.

## How to run it

You need Node.js 18 or newer.

```
node server.js
```

Then open `http://localhost:3000`.

Files:
- `server.js`: the small server that finds channels and fetches their videos
- `index.html`: the app screen
- `package.json`: lets hosting services start the app with `npm start`

## Status

Early prototype. Built to test one question: *do people want a calmer way to follow their favorites?*
