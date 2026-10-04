// Calm Feed server. Node 18+, no installs.
// Environment: YOUTUBE_API_KEY (required for YouTube). Optional: SUPABASE_URL, SUPABASE_ANON_KEY, REQUIRE_AUTH=false (local testing only).
const http = require("http"), fs = require("fs"), path = require("path");
const PORT = process.env.PORT || 3000;
const KEY = process.env.YOUTUBE_API_KEY || "";
const SB_URL = process.env.SUPABASE_URL || "https://atavoxosxqvicazhexus.supabase.co";
const SB_ANON = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0YXZveG9zeHF2aWNhemhleHVzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTExMDI1ODEsImV4cCI6MjEwNjY3ODU4MX0.9nS-2zYEJ_L8h1mHsvNWbpf-qIoJSxVYaHQquBmhMUU";
const REQUIRE_AUTH = process.env.REQUIRE_AUTH !== "false";
const UA = "Mozilla/5.0 (compatible; CalmFeed/1.0)";
const ID = /^UC[\w-]{22}$/;

const cache = new Map();
async function memo(k, ttl, fn) {
  const c = cache.get(k);
  if (c && Date.now() - c.t < ttl) return c.v;
  const v = await fn();
  if (cache.size > 4000) cache.clear();
  cache.set(k, { t: Date.now(), v });
  return v;
}
const bad = (code, msg) => Object.assign(new Error(msg), { code });
const dec = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, "&");
async function get(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "*/*" } });
  if (!r.ok) throw bad(502, "That site returned " + r.status + ". It may block servers like this one.");
  return r.text();
}
async function getJson(url) { return JSON.parse(await get(url)); }

/* ---------------- login check + rate limit (protects your YouTube quota) ---------------- */
const tokens = new Map(), hits = new Map();
async function authUser(req) {
  const m = (req.headers.authorization || "").match(/^Bearer (.+)$/);
  if (!m) throw bad(401, "Please sign in.");
  const c = tokens.get(m[1]);
  if (c && c.exp > Date.now()) return c.uid;
  const r = await fetch(SB_URL + "/auth/v1/user", { headers: { apikey: SB_ANON, Authorization: "Bearer " + m[1] } });
  if (!r.ok) throw bad(401, "Session expired. Please sign in again.");
  const u = await r.json();
  if (tokens.size > 2000) tokens.clear();
  tokens.set(m[1], { uid: u.id, exp: Date.now() + 5 * 60 * 1000 });
  return u.id;
}
function rate(uid) {
  const now = Date.now(), a = (hits.get(uid) || []).filter(x => now - x < 60000);
  if (a.length >= 120) throw bad(429, "Too many requests. Please wait a minute.");
  a.push(now); hits.set(uid, a);
  if (hits.size > 5000) hits.clear();
}

/* ---------------- YouTube (official API) ---------------- */
async function yt(p, q) {
  if (!KEY) throw bad(500, "The server has no YOUTUBE_API_KEY set. Add it in Render → Environment.");
  const u = new URL("https://www.googleapis.com/youtube/v3/" + p);
  for (const k in q) if (q[k]) u.searchParams.set(k, q[k]);
  u.searchParams.set("key", KEY);
  const d = await (await fetch(u)).json();
  if (d.error) throw bad(502, d.error.message || "YouTube API error");
  return d;
}
const isoSecs = s => {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(s || "");
  return m ? (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0) : 0;
};
const chInfo = id => memo("ch" + id, 864e5, async () => {
  const it = ((await yt("channels", { part: "snippet", id })).items || [])[0];
  if (!it) throw bad(404, "Channel not found.");
  const t = it.snippet.thumbnails || {};
  return { id, name: it.snippet.title, avatar: (t.medium || t.default || {}).url || "", platform: "youtube" };
});
async function resolveYT(q) {
  q = q.trim();
  if (ID.test(q)) return q;
  let m = q.match(/youtube\.com\/channel\/(UC[\w-]{22})/i);
  if (m) return m[1];
  m = q.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/live\/)([\w-]{11})/);
  if (m) {
    const it = ((await yt("videos", { part: "snippet", id: m[1] })).items || [])[0];
    if (!it) throw bad(404, "Video not found.");
    return it.snippet.channelId;
  }
  m = q.match(/youtube\.com\/@([^\/?#\s]+)/i);
  const handle = m ? decodeURIComponent(m[1]) : (/^https?:|\./.test(q) ? "" : q.replace(/^@/, ""));
  if (handle) { const d = await yt("channels", { part: "id", forHandle: "@" + handle }); if (d.items && d.items[0]) return d.items[0].id; }
  m = q.match(/youtube\.com\/user\/([^\/?#\s]+)/i);
  if (m) { const d = await yt("channels", { part: "id", forUsername: m[1] }); if (d.items && d.items[0]) return d.items[0].id; }
  m = q.match(/youtube\.com\/c\/([^\/?#\s]+)/i);
  const nm = m ? m[1] : handle;
  if (nm) { const d = await yt("search", { part: "snippet", type: "channel", maxResults: 1, q: nm }); if (d.items && d.items[0]) return d.items[0].snippet.channelId; }
  throw bad(404, "Couldn't find that channel. Check the handle or link.");
}
// lengths + live flags (live: 0 none, 1 was a live stream, 2 live/upcoming now)
const meta = new Map();
async function addMeta(videos) {
  const need = videos.map(v => v.id).filter(i => !meta.has(i));
  for (let i = 0; i < need.length; i += 50) {
    try {
      const d = await yt("videos", { part: "contentDetails,liveStreamingDetails,snippet", id: need.slice(i, i + 50).join(",") });
      for (const it of d.items || []) {
        const lb = (it.snippet || {}).liveBroadcastContent;
        meta.set(it.id, { dur: isoSecs(it.contentDetails.duration), live: it.liveStreamingDetails ? (lb === "live" || lb === "upcoming" ? 2 : 1) : 0 });
      }
    } catch (e) {}
  }
  if (meta.size > 20000) meta.clear();
  videos.forEach(v => { const m = meta.get(v.id); if (m) { v.dur = m.dur; v.live = m.live; } });
  return videos;
}
const okItem = it => it.snippet && it.snippet.resourceId && !/^(Private|Deleted) video$/.test(it.snippet.title);
const latestYT = (id, page) => memo("lt" + id + "|" + (page || ""), 600000, async () => {
  const d = await yt("playlistItems", { part: "snippet,contentDetails", playlistId: "UU" + id.slice(2), maxResults: 50, pageToken: page });
  const videos = (d.items || []).filter(okItem).map(it => ({ id: it.snippet.resourceId.videoId, title: it.snippet.title,
    published: (it.contentDetails && it.contentDetails.videoPublishedAt) || it.snippet.publishedAt, channelId: id, channel: it.snippet.channelTitle }));
  await addMeta(videos);
  return { kind: "videos", videos, next: d.nextPageToken || "" };
});
const playlistYT = id => memo("pl" + id, 600000, async () => {
  const m = ((await yt("playlists", { part: "snippet", id })).items || [])[0];
  if (!m) throw bad(404, "Playlist not found (it may be private).");
  const videos = []; let tok = "";
  do {
    const d = await yt("playlistItems", { part: "snippet,contentDetails", playlistId: id, maxResults: 50, pageToken: tok });
    for (const it of d.items || []) if (okItem(it)) videos.push({ id: it.snippet.resourceId.videoId, title: it.snippet.title,
      published: (it.contentDetails && it.contentDetails.videoPublishedAt) || it.snippet.publishedAt, channelId: it.snippet.videoOwnerChannelId || "", channel: it.snippet.videoOwnerChannelTitle || "" });
    tok = d.nextPageToken || "";
  } while (tok && videos.length < 500);
  await addMeta(videos);
  return { id, title: m.snippet.title, videos, source: "api" };
});
const playlistsOf = id => memo("pls" + id, 600000, async () => {
  const out = []; let tok = "";
  for (let i = 0; i < 4; i++) {
    const d = await yt("playlists", { part: "snippet,contentDetails", channelId: id, maxResults: 50, pageToken: tok });
    for (const p of d.items || []) { const t = p.snippet.thumbnails || {}; out.push({ id: p.id, title: p.snippet.title, thumbUrl: (t.medium || t.high || t.default || {}).url || "", count: p.contentDetails ? p.contentDetails.itemCount : 0 }); }
    tok = d.nextPageToken || ""; if (!tok) break;
  }
  return out;
});
function playlistId(q) {
  q = q.trim();
  const m = q.match(/[?&]list=([\w-]+)/) || q.match(/^((?:PL|OL|UU|FL|RD)[\w-]{10,})$/);
  if (!m) throw bad(400, "That doesn't look like a playlist link.");
  return m[1];
}

/* ---------------- Reddit, Bluesky, blogs/RSS, Instagram/X links ---------------- */
const strip = s => dec((s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "")).trim();
function parseFeed(xml) {
  const blocks = [...xml.matchAll(/<(item|entry)[\s>][\s\S]*?<\/\1>/g)].map(m => m[0]);
  const tag = (b, t) => { const m = b.match(new RegExp("<" + t + "[^>]*>([\\s\\S]*?)</" + t + ">", "i")); return m ? m[1] : ""; };
  const posts = blocks.slice(0, 30).map(b => {
    const link = (b.match(/<link[^>]*\shref="([^"]+)"/) || [])[1] || strip(tag(b, "link")) || strip(tag(b, "guid"));
    const raw = dec(b);
    const img = (b.match(/<media:thumbnail[^>]*url="([^"]+)"/) || b.match(/<media:content[^>]*url="([^"]+)"[^>]*medium="image"/) ||
      b.match(/<enclosure[^>]*url="([^"]+)"[^>]*type="image/) || raw.match(/<img[^>]*src="([^"]+)"/) || [])[1] || "";
    const date = strip(tag(b, "pubDate") || tag(b, "published") || tag(b, "updated") || tag(b, "dc:date"));
    const t = strip(tag(b, "title"));
    return { id: link || t, title: t || "(untitled)", link: dec(link || ""), published: date && !isNaN(new Date(date)) ? new Date(date).toISOString() : "", thumb: img ? dec(img) : "" };
  }).filter(p => p.link);
  const head = xml.split(/<(?:item|entry)[\s>]/)[0];
  return { title: strip((head.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1] || ""), posts };
}
function target(q) {
  q = q.trim(); let m;
  if ((m = q.match(/reddit\.com\/r\/(\w+)/i)) || (m = q.match(/^\/?r\/(\w+)$/i))) return { id: "rd:" + m[1].toLowerCase() };
  if ((m = q.match(/bsky\.app\/profile\/([\w.-]+)/i)) || (m = q.match(/^@?([\w-]+(?:\.[\w-]+)*\.bsky\.social)$/i))) return { id: "bs:" + m[1].toLowerCase() };
  if ((m = q.match(/instagram\.com\/([\w.]+)/i))) return { id: "ig:" + m[1] };
  if ((m = q.match(/(?:^|\/\/)(?:www\.)?(?:x|twitter)\.com\/(\w+)/i))) return { id: "tw:" + m[1] };
  if (/^https?:\/\//i.test(q) && !/youtube\.com|youtu\.be/i.test(q)) return { id: "rss:" + q };
  return null;
}
const social = id => memo("so" + id, 600000, async () => {
  const p = id.split(":")[0], v = id.slice(id.indexOf(":") + 1);
  if (p === "rd") {
    const x = parseFeed(await get("https://www.reddit.com/r/" + v + "/.rss"));
    return { name: "r/" + v, avatar: "", platform: "reddit", posts: x.posts.map(q => ({ ...q, source: "r/" + v })) };
  }
  if (p === "bs") {
    const api = "https://public.api.bsky.app/xrpc/";
    const pr = await getJson(api + "app.bsky.actor.getProfile?actor=" + encodeURIComponent(v));
    const f = await getJson(api + "app.bsky.feed.getAuthorFeed?limit=30&filter=posts_no_replies&actor=" + encodeURIComponent(v));
    const posts = (f.feed || []).map(x => { const po = x.post, imgs = po.embed && po.embed.images;
      return { id: po.uri, title: ((po.record && po.record.text) || "").slice(0, 280) || "(media post)", link: "https://bsky.app/profile/" + v + "/post/" + po.uri.split("/").pop(),
        published: po.record && po.record.createdAt, thumb: imgs && imgs[0] ? imgs[0].thumb : "", source: pr.displayName || v }; });
    return { name: pr.displayName || pr.handle, avatar: pr.avatar || "", platform: "bluesky", posts };
  }
  if (p === "rss") {
    let xml = await get(v), f = parseFeed(xml);
    if (!f.posts.length) {
      const m = xml.match(/<link[^>]+type="application\/(?:rss|atom)\+xml"[^>]*href="([^"]+)"/i) || xml.match(/<link[^>]+href="([^"]+)"[^>]*type="application\/(?:rss|atom)\+xml"/i);
      if (m) { xml = await get(new URL(dec(m[1]), v).href); f = parseFeed(xml); }
    }
    if (!f.posts.length) throw bad(404, "No feed found at that address.");
    const host = new URL(v).hostname;
    return { name: f.title || host, avatar: "https://www.google.com/s2/favicons?domain=" + host + "&sz=64", platform: "rss", posts: f.posts.map(p => ({ ...p, source: f.title || host })) };
  }
  if (p === "ig") return { name: "@" + v, avatar: "", platform: "instagram", posts: [], link: "https://www.instagram.com/" + v };
  if (p === "tw") return { name: "@" + v, avatar: "", platform: "x", posts: [], link: "https://x.com/" + v };
  throw bad(400, "Unknown account type.");
});

/* ---------------- API routes ---------------- */
const list = u => (u.searchParams.get("ids") || "").split(",").filter(Boolean).slice(0, 60);
async function route(u) {
  const q = k => u.searchParams.get(k) || "";
  switch (u.pathname) {
    case "/api/add": {
      const t = target(q("q"));
      if (t) { const s = await social(t.id); return { id: t.id, name: s.name, avatar: s.avatar, platform: s.platform }; }
      return chInfo(await resolveYT(q("q")));
    }
    case "/api/latest": {
      const id = q("id");
      if (ID.test(id)) return latestYT(id, q("page"));
      const s = await social(id);
      return { kind: "posts", posts: s.posts, link: s.link || "", next: "" };
    }
    case "/api/channels": {
      const channels = await Promise.all(list(u).map(async id => {
        try { if (ID.test(id)) return await chInfo(id); const s = await social(id); return { id, name: s.name, avatar: s.avatar, platform: s.platform }; }
        catch (e) { return { id, name: "", avatar: "" }; }
      }));
      return { channels };
    }
    case "/api/new": {   // dates of each account's newest items, used for the "new" dot
      const out = {};
      await Promise.all(list(u).map(async id => {
        try {
          out[id] = ID.test(id) ? (await latestYT(id, "")).videos.slice(0, 15).map(v => v.published)
                                : (/^(ig|tw):/.test(id) ? [] : (await social(id)).posts.slice(0, 15).map(p => p.published));
        } catch (e) { out[id] = []; }
      }));
      return { counts: out };
    }
    case "/api/playlist": return playlistYT(playlistId(q("q") || q("id")));
    case "/api/channel-playlists": { if (!ID.test(q("id"))) throw bad(400, "Bad channel id"); let l = []; try { l = await playlistsOf(q("id")); } catch (e) {} return { playlists: l }; }
    default: throw bad(404, "Unknown API route. Update server.js and restart.");
  }
}

const MANIFEST = JSON.stringify({ name: "Calm Feed", short_name: "Calm Feed", start_url: "/", display: "standalone", background_color: "#15181a", theme_color: "#2f7d6d",
  icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }] });
const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="#2f7d6d"/><path d="M38 28v44l36-22z" fill="#fff"/></svg>';
const send = (res, code, type, body) => { res.writeHead(code, { "Content-Type": type, "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type" }); res.end(body); };

http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  try {
    if (req.method === "OPTIONS") return send(res, 204, "text/plain", "");
    if (u.pathname.startsWith("/api/")) {
      rate(REQUIRE_AUTH ? await authUser(req) : "anon");
      return send(res, 200, "application/json", JSON.stringify(await route(u)));
    }
    if (u.pathname === "/manifest.webmanifest") return send(res, 200, "application/manifest+json", MANIFEST);
    if (u.pathname === "/icon.svg") return send(res, 200, "image/svg+xml", ICON);
    if (u.pathname === "/sw.js") return send(res, 200, "text/javascript", 'self.addEventListener("install",()=>self.skipWaiting());self.addEventListener("fetch",()=>{});');
    send(res, 200, "text/html; charset=utf-8", fs.readFileSync(path.join(__dirname, "index.html")));
  } catch (e) {
    send(res, e.code || 400, "application/json", JSON.stringify({ error: e.message }));
  }
}).listen(PORT, () => console.log("Calm Feed running at http://localhost:" + PORT));

module.exports = { parseFeed, target, isoSecs, rate };
