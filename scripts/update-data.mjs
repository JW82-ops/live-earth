// 매시간 GitHub Actions에서 실행: 나라별 최신 기사(Google 뉴스 RSS)와 위성 구름 지도를 data/ 폴더에 저장한다.
// 의존성 없음 (Node 20 이상의 내장 fetch 사용).
import { readFile, writeFile, mkdir } from "node:fs/promises";

const ROOT = new URL("..", import.meta.url);
const DATA = new URL("data/", ROOT);
const PER_COUNTRY = 6;
const CONCURRENCY = 6;
const UA = "Mozilla/5.0 (compatible; live-earth-bot/1.0; +https://github.com)";

const src = await readFile(new URL("countries.js", ROOT), "utf8");
const COUNTRIES = JSON.parse(src.slice(src.indexOf("{"), src.lastIndexOf("}") + 1));
const list = [...new Map(Object.values(COUNTRIES).map((c) => [c.a2, c])).values()];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, asBuffer = false) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
      if (res.status === 429 || res.status >= 500) throw new Error("HTTP " + res.status);
      if (!res.ok) return null;
      return asBuffer ? Buffer.from(await res.arrayBuffer()) : await res.text();
    } catch (e) {
      await sleep(1500 * (attempt + 1));
    }
  }
  return null;
}

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decode(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) =>
      e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e] ?? m)
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decode(m[1]) : "";
};

export function parseRss(xml) {
  const out = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const it = m[1];
    const source = tag(it, "source");
    let title = tag(it, "title");
    if (source && title.endsWith(" - " + source)) title = title.slice(0, -(source.length + 3));
    const u = tag(it, "link");
    const d = new Date(tag(it, "pubDate"));
    if (!title || !/^https?:\/\//.test(u) || isNaN(d)) continue;
    out.push({ t: title, u, s: source, d: d.toISOString() });
  }
  return out;
}

function pick(items) {
  const seen = new Set();
  const weekAgo = Date.now() - 7 * 864e5;
  return items
    .filter((n) => {
      const k = n.t.replace(/[\s\p{P}\p{S}]/gu, "").toLowerCase().slice(0, 40);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => (new Date(b.d) > weekAgo) - (new Date(a.d) > weekAgo) || b.d.localeCompare(a.d))
    .slice(0, PER_COUNTRY);
}

const rss = (q, lang) =>
  lang === "ko"
    ? `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=ko&gl=KR&ceid=KR:ko`
    : `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;

async function newsFor(c) {
  // 한국어 기사 우선, 부족하면 영어 기사로 채운다.
  const q = c.a2 === "KR" ? "한국 뉴스" : c.ko;
  let items = parseRss((await get(rss(q, "ko"))) || "");
  if (items.length < 3) items = items.concat(parseRss((await get(rss(c.en, "en"))) || ""));
  return pick(items);
}

async function updateNews() {
  const items = {};
  let i = 0, ok = 0;
  async function worker() {
    while (i < list.length) {
      const c = list[i++];
      const n = await newsFor(c);
      if (n.length) { items[c.a2] = n; ok++; }
      await sleep(250);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`news: ${ok}/${list.length} countries`);
  return { items, ok };
}

// 위성 구름 지도(3시간마다 갱신되는 공개 지도). 받을 수 없으면 기존 파일을 그대로 둔다.
const CLOUD_SOURCES = [
  ["https://clouds.matteason.co.uk/images/2048x1024/clouds-alpha.png", "clouds.png"],
  ["https://clouds.matteason.co.uk/images/4096x2048/clouds-alpha.png", "clouds.png"],
  ["https://clouds.matteason.co.uk/images/2048x1024/clouds.jpg", "clouds.jpg"],
];
async function updateClouds() {
  for (const [url, file] of CLOUD_SOURCES) {
    const buf = await get(url, true);
    const isImg = buf && buf.length > 50000 && (buf[0] === 0x89 || (buf[0] === 0xff && buf[1] === 0xd8));
    if (isImg) {
      await writeFile(new URL(file, DATA), buf);
      console.log(`clouds: ${url} (${buf.length} bytes)`);
      return { file, at: new Date().toISOString() };
    }
  }
  console.log("clouds: unavailable, keeping previous");
  return null;
}

await mkdir(DATA, { recursive: true });
// 이전 데이터는 저장소가 아니라 배포된 사이트에서 가져온다 (수집 실패 시 유지용).
let prev = {};
if (process.env.SITE_URL) {
  try { prev = JSON.parse((await get(process.env.SITE_URL + "data/news.json")) || "{}"); } catch {}
}
if (!prev.items) {
  try { prev = JSON.parse(await readFile(new URL("news.json", DATA), "utf8")); } catch {}
}

let [{ items, ok }, clouds] = await Promise.all([updateNews(), updateClouds()]);
if (!clouds && prev.clouds && process.env.SITE_URL) {
  const buf = await get(process.env.SITE_URL + "data/" + prev.clouds.file, true);
  if (buf && buf.length > 50000) { await writeFile(new URL(prev.clouds.file, DATA), buf); clouds = prev.clouds; }
}

// 뉴스 서버가 막혀 대부분 실패한 경우 이전 기사를 유지한다.
const keepOld = ok < list.length * 0.3 && prev.items;
const out = {
  updatedAt: keepOld ? prev.updatedAt : new Date().toISOString(),
  items: keepOld ? prev.items : items,
  clouds: clouds || null,
};
await writeFile(new URL("news.json", DATA), JSON.stringify(out));
console.log(keepOld ? "news: kept previous data" : "news: written");
