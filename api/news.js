/*
 * GET /api/news: today's Kolkata headlines for The Calcutta Chronicle.
 *
 * Reads the Google News RSS search for Kolkata (English, and Bengali for the
 * কলকাতা column) and hands back headlines only: title, source, time and link.
 * Google's feed sends no CORS header, so the browser can't read it itself;
 * this runs on Vercel next to the game. Responses are cached at the edge for
 * half an hour, so the feed is hit a couple of times an hour at most.
 */

const FEEDS = {
  en: 'https://news.google.com/rss/search?q=Kolkata+when:1d&hl=en-IN&gl=IN&ceid=IN:en',
  bn: 'https://news.google.com/rss/search?q=%E0%A6%95%E0%A6%B2%E0%A6%95%E0%A6%BE%E0%A6%A4%E0%A6%BE+when:1d&hl=bn&gl=IN&ceid=IN:bn',
};
const LIMIT = { en: 12, bn: 8 };
const MAX_AGE = 2 * 24 * 3600 * 1000;
// posts, not reporting
const SKIP_SOURCES = /facebook|youtube|instagram|twitter|^x$|threads|linkedin|reddit|sharechat/i;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1));
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1]) : '';
}

// The same story from five papers: compare the words that carry it. Every headline
// says Kolkata, and Bengali words take endings (পাত্র, পাত্রর), so compare stems.
const COMMON = new Set(['kolkata', 'bengal', 'west', 'news', 'কলকাত', 'বাংল', 'খবর']);
const stem = (w) => (/[a-z]/.test(w) ? w.replace(/(s|es|ed|ing)$/, '') : w.slice(0, 5));
const words = (t) =>
  new Set(
    t
      .toLowerCase()
      .split(/[^\p{L}\p{M}\p{N}]+/u)
      .filter((w) => w.length > 3)
      .map(stem)
      .filter((w) => !COMMON.has(w)),
  );
function sameStory(a, b) {
  let both = 0;
  for (const w of a) if (b.has(w)) both++;
  return both >= 2 && both / Math.min(a.size, b.size) >= 0.34;
}

/** RSS items to { title, source, time, link }, newest first, one per story. */
export function parseFeed(xml, limit) {
  const items = [];
  for (const [, item] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const source = tag(item, 'source');
    let title = tag(item, 'title');
    // Google appends " - Source" to every title
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    const link = tag(item, 'link');
    const time = Date.parse(tag(item, 'pubDate')) || 0;
    if (!title || !/^https?:\/\//.test(link) || SKIP_SOURCES.test(source)) continue;
    // "when:1d" is loose: old pages that were just re-indexed slip in
    if (time && Date.now() - time > MAX_AGE) continue;
    items.push({ title, source, time, link });
  }
  // the feed lists the best coverage first: keep that one of each story, then show newest first
  const out = [];
  const kept = [];
  for (const n of items) {
    const w = words(n.title);
    if (kept.some((k) => sameStory(w, k))) continue;
    kept.push(w);
    out.push(n);
    if (out.length === limit) break;
  }
  return out.sort((a, b) => b.time - a.time);
}

async function feed(lang) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch(FEEDS[lang], { signal: ctl.signal, headers: { 'user-agent': 'Mozilla/5.0 (VibeCity Kolkata newspaper)' } });
    if (!r.ok) return [];
    return parseFeed(await r.text(), LIMIT[lang]);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  const [en, bn] = await Promise.all([feed('en'), feed('bn')]);
  const ok = en.length + bn.length > 0;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // a good answer is kept for 30 min (and served stale for an hour while it refreshes); a failure only briefly
  res.setHeader('Cache-Control', ok ? 'public, s-maxage=1800, stale-while-revalidate=3600' : 'public, s-maxage=60');
  res.statusCode = ok ? 200 : 502;
  res.end(JSON.stringify({ updated: Date.now(), en, bn }));
}
