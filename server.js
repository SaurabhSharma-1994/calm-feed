// Calm Feed – YouTube MVP. Run: node server.js  (Node 18+, no installs needed)
const http = require("http"), fs = require("fs"), path = require("path");
const PORT = process.env.PORT || 3000;
const HEAD = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  Cookie: "CONSENT=YES+1; SOCS=CAI",
};
const ID = /^UC[\w-]{22}$/;
const cache = new Map();

async function get(url) {
  const r = await fetch(url, { headers: HEAD });
  if (!r.ok) throw new Error("YouTube returned " + r.status);
  return r.text();
}

// Accepts: @handle, handle, channel link, /channel/UC..., /c/, /user/, or even a video link
async function resolveId(q) {
  q = q.trim();
  if (ID.test(q)) return q;
  let m = q.match(/youtube\.com\/channel\/(UC[\w-]{22})/i);
  if (m) return m[1];
  const isLink = /^https?:\/\//i.test(q) || /^(www\.|m\.)?(youtube\.com|youtu\.be)/i.test(q);
  const url = isLink ? (/^https?:/i.test(q) ? q : "https://" + q)
                     : "https://www.youtube.com/@" + q.replace(/^@/, "");
  const html = await get(url);
  const isVideo = /watch\?v=|youtu\.be\/|\/shorts\//.test(url);
  const pats = isVideo
    ? [/"channelId":"(UC[\w-]{22})"/]
    : [/rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/,
       /"externalId":"(UC[\w-]{22})"/, /"channelId":"(UC[\w-]{22})"/];
  for (const p of pats) { m = html.match(p); if (m) return m[1]; }
  throw new Error("Couldn't find that channel. Check the handle or link.");
}

const dec = s => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
                  .replace(/&quot;/g, '"').replace(/&#39;/g, "'");

async function feed(id) {
  const c = cache.get(id);
  if (c && Date.now() - c.t < 10 * 60 * 1000) return c.v;
  const xml = await get("https://www.youtube.com/feeds/videos.xml?channel_id=" + id);
  const name = dec((xml.match(/<author>\s*<name>([^<]*)/) || [])[1] || "Channel");
  const videos = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(m => {
    const e = m[1];
    return {
      id: (e.match(/<yt:videoId>([^<]+)/) || [])[1],
      title: dec((e.match(/<title>([^<]*)/) || [])[1] || ""),
      published: (e.match(/<published>([^<]+)/) || [])[1],
      channelId: id, channel: name,
    };
  }).filter(v => v.id);
  const v = { id, name, videos };
  cache.set(id, { t: Date.now(), v });
  return v;
}


// ---- Playlists ----
function entries(xml, cid, name) {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(m => {
    const e = m[1];
    return { id: (e.match(/<yt:videoId>([^<]+)/) || [])[1],
      title: dec((e.match(/<title>([^<]*)/) || [])[1] || ""),
      published: (e.match(/<published>([^<]+)/) || [])[1],
      channelId: cid, channel: (e.match(/<author>\s*<name>([^<]*)/) || [])[1] ? dec(e.match(/<author>\s*<name>([^<]*)/)[1]) : name };
  }).filter(v => v.id);
}
function playlistId(q) {
  q = q.trim();
  const m = q.match(/[?&]list=([\w-]+)/) || q.match(/^((?:PL|OL|UU|FL|RD)[\w-]{10,})$/);
  if (!m) throw new Error("That doesn't look like a playlist link.");
  return m[1];
}
async function playlist(id) {
  const k = "pl" + id, c = cache.get(k);
  if (c && Date.now() - c.t < 10 * 60 * 1000) return c.v;
  const xml = await get("https://www.youtube.com/feeds/videos.xml?playlist_id=" + id);
  const title = dec((xml.match(/<title>([^<]*)/) || [])[1] || "Playlist");
  const v = { id, title, videos: entries(xml, "", "") };
  cache.set(k, { t: Date.now(), v });
  return v;
}
// Best effort: reads the channel's Playlists tab. YouTube can change this page at any time.
async function channelPlaylists(id) {
  const html = await get("https://www.youtube.com/channel/" + id + "/playlists");
  const seen = new Map();
  for (const m of html.matchAll(/"(?:playlistId|contentId)":"(PL[\w-]{10,})"/g)) {
    if (seen.has(m[1])) continue;
    const t = html.slice(m.index, m.index + 1500).match(/"(?:content|simpleText|text)":"([^"]{2,120})"/);
    let title = t ? t[1] : "Playlist";
    try { title = JSON.parse('"' + title + '"'); } catch (e) {}
    seen.set(m[1], title);
  }
  const ids = [...seen.keys()].slice(0, 24);
  const res = await Promise.allSettled(ids.map(playlist));
  return ids.map((pid, i) => res[i].status === "fulfilled"
    ? { id: pid, title: res[i].value.title, thumb: (res[i].value.videos[0] || {}).id || "" }
    : { id: pid, title: seen.get(pid), thumb: "" });
}

async function avatar(id) {
  const k = "av" + id, c = cache.get(k);
  if (c) return c.v;
  let v = "";
  try {
    const m = (await get("https://www.youtube.com/channel/" + id)).match(/<meta property="og:image" content="([^"]+)"/);
    if (m) v = dec(m[1]);
  } catch (e) {}
  if (v) cache.set(k, { t: Date.now(), v });
  return v;
}

const json = (res, code, obj) => {
  res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(obj));
};

http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  try {
    if (u.pathname === "/api/add") {
      const id = await resolveId(u.searchParams.get("q") || "");
      const f = await feed(id);
      return json(res, 200, { id, name: f.name, avatar: await avatar(id) });
    }
    if (u.pathname === "/api/feed") {
      const ids = (u.searchParams.get("ids") || "").split(",").filter(i => ID.test(i));
      const out = await Promise.allSettled(ids.map(feed));
      const videos = out.flatMap(o => (o.status === "fulfilled" ? o.value.videos : []))
        .sort((a, b) => new Date(b.published) - new Date(a.published));
      return json(res, 200, { videos });
    }
    if (u.pathname === "/api/channels") {
      const ids = (u.searchParams.get("ids") || "").split(",").filter(i => ID.test(i));
      const channels = await Promise.all(ids.map(async i => {
        try { return { id: i, name: (await feed(i)).name, avatar: await avatar(i) }; } catch (e) { return { id: i, name: "", avatar: "" }; }
      }));
      return json(res, 200, { channels });
    }
    if (u.pathname === "/api/playlist") {
      return json(res, 200, await playlist(playlistId(u.searchParams.get("q") || u.searchParams.get("id") || "")));
    }
    if (u.pathname === "/api/channel-playlists") {
      const cid = u.searchParams.get("id") || "";
      if (!ID.test(cid)) throw new Error("Bad channel id");
      let list = [];
      try { list = await channelPlaylists(cid); } catch (e) {}
      return json(res, 200, { playlists: list });
    }
    if (u.pathname.startsWith("/api/")) return json(res, 404, { error: "Unknown API route. Restart the server with the newest server.js." });
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(fs.readFileSync(path.join(__dirname, "index.html")));
  } catch (e) {
    json(res, 400, { error: e.message });
  }
}).listen(PORT, () => console.log("Calm Feed running at http://localhost:" + PORT));
