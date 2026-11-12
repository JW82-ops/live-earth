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

// 최근 지진(USGS)과 국제우주정거장 궤도 요소(TLE). 페이지는 실시간 서버를 먼저 쓰고, 이 파일은 예비용이다.
async function updateQuakes() {
  const txt = await get("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson");
  try {
    const j = JSON.parse(txt);
    const items = j.features.map((f) => ({
      lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], depth: f.geometry.coordinates[2],
      mag: f.properties.mag, time: f.properties.time, place: f.properties.place, url: f.properties.url, id: f.id,
    }));
    console.log(`quakes: ${items.length}`);
    return { at: new Date().toISOString(), items };
  } catch { console.log("quakes: unavailable"); return null; }
}
const TLE_SOURCES = [
  "https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE",
  "https://live.ariss.org/iss.txt",
];
async function updateIss() {
  for (const url of TLE_SOURCES) {
    const txt = await get(url);
    const lines = (txt || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const i = lines.findIndex((l) => l.startsWith("1 25544"));
    if (i >= 0 && lines[i + 1]?.startsWith("2 25544")) {
      console.log(`iss: ${url}`);
      return { at: new Date().toISOString(), l1: lines[i], l2: lines[i + 1] };
    }
  }
  console.log("iss: unavailable");
  return null;
}
// 활동 중인 열대저기압(태풍·허리케인·사이클론): GDACS
async function updateStorms() {
  const txt = await get("https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC&alertlevel=green;orange;red");
  let list;
  try { list = JSON.parse(txt).features; } catch { console.log("storms: unavailable"); return null; }
  if (!Array.isArray(list)) { console.log("storms: unavailable"); return null; }
  const cutoff = Date.now() - 36 * 3600e3;
  const cur = list.filter((f) => String(f.properties.iscurrent) === "true" && new Date(f.properties.todate + "Z") >= cutoff);
  const items = [];
  for (const f of cur) {
    const p = f.properties;
    let geo = null;
    try { geo = JSON.parse((await get(p.url?.geometry || `https://www.gdacs.org/gdacsapi/api/polygons/getgeometry?eventtype=TC&eventid=${p.eventid}&episodeid=${p.episodeid}`)) || "null"); } catch {}
    const segs = (geo?.features || [])
      .filter((g) => g.geometry?.type === "LineString" && String(g.properties.Class || "").startsWith("Line_"))
      .map((g) => ({ fc: String(g.properties.forecast) === "true", d: g.properties.polygondate || "", c: g.geometry.coordinates }))
      .sort((a, b) => a.d.localeCompare(b.d));
    const chain = (arr) => {
      const out = [];
      for (const s of arr) for (const c of s.c) {
        const last = out[out.length - 1];
        if (!last || Math.abs(last[0] - c[0]) > 1e-6 || Math.abs(last[1] - c[1]) > 1e-6) out.push([+c[0].toFixed(2), +c[1].toFixed(2)]);
      }
      return out;
    };
    const past = chain(segs.filter((s) => !s.fc));
    const fc = chain(segs.filter((s) => s.fc));
    const centroid = (geo?.features || []).find((g) => g.properties?.Class === "Point_Centroid")?.geometry?.coordinates || f.geometry.coordinates;
    const pos = past.length ? past[past.length - 1] : centroid;
    if (fc.length && pos && (fc[0][0] !== pos[0] || fc[0][1] !== pos[1])) fc.unshift(pos);
    items.push({
      id: p.eventid, name: String(p.eventname || p.name).replace(/-\d+$/, ""), wind: Math.round(p.severitydata?.severity || 0),
      text: p.severitydata?.severitytext || "", alert: p.alertlevel, source: p.source, from: p.fromdate, to: p.todate,
      pos, past, fc, countries: (p.affectedcountries || []).map((c) => c.iso2).filter(Boolean),
      url: p.url?.report || "https://www.gdacs.org/",
    });
  }
  console.log(`storms: ${items.length} active (${items.map((i) => i.name + ":" + i.past.length + "/" + i.fc.length).join(", ")})`);
  return { at: new Date().toISOString(), items };
}

// 오로라 예보(NOAA OVATION) + 지자기 지수 Kp. 360×181 격자를 한 글자당 1바이트로 압축해 저장한다.
async function updateAurora() {
  let j;
  try { j = JSON.parse(await get("https://services.swpc.noaa.gov/json/ovation_aurora_latest.json")); } catch { console.log("aurora: unavailable"); return null; }
  if (!j?.coordinates) { console.log("aurora: unavailable"); return null; }
  const grid = new Uint8Array(360 * 181);
  for (const [lon, lat, v] of j.coordinates) {
    const x = ((Math.round(lon) % 360) + 360) % 360, y = Math.round(lat) + 90;
    if (y >= 0 && y <= 180) grid[y * 360 + x] = Math.max(0, Math.min(100, Math.round(v)));
  }
  let kp = null, kpAt = null;
  try {
    const k = JSON.parse(await get("https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json"));
    const last = Array.isArray(k[0]) ? k[k.length - 1] : k[k.length - 1];
    kp = Array.isArray(last) ? +last[1] : +last.Kp;
    kpAt = Array.isArray(last) ? last[0] : last.time_tag;
  } catch {}
  console.log(`aurora: ${j["Forecast Time"]} kp=${kp}`);
  return { at: new Date().toISOString(), obs: j["Observation Time"], fc: j["Forecast Time"], kp, kpAt, w: 360, h: 181, b64: Buffer.from(grid).toString("base64") };
}

// 원화 기준 최근 30일 환율 (유럽중앙은행 기준환율, 주요 통화 약 30개)
async function updateFxHist() {
  const start = new Date(Date.now() - 31 * 864e5).toISOString().slice(0, 10);
  let j;
  try { j = JSON.parse(await get(`https://api.frankfurter.dev/v1/${start}..?from=KRW`)); } catch { console.log("fxhist: unavailable"); return null; }
  const dates = Object.keys(j?.rates || {}).sort();
  if (!dates.length) return null;
  const codes = Object.keys(j.rates[dates[dates.length - 1]]);
  const rates = {};
  for (const c of codes) rates[c] = dates.map((d) => (j.rates[d][c] ? +(1 / j.rates[d][c]).toPrecision(6) : null));
  console.log(`fxhist: ${dates.length} days, ${codes.length} currencies`);
  return { at: new Date().toISOString(), dates, rates };
}

// 미세먼지: 각 나라 수도 + 한국 주요 도시 (Open-Meteo 대기질)
const KR_CITIES = [["부산", 35.18, 129.08], ["인천", 37.46, 126.71], ["대구", 35.87, 128.6], ["대전", 36.35, 127.38], ["광주", 35.16, 126.85], ["울산", 35.54, 129.31], ["수원", 37.26, 127.03], ["제주", 33.5, 126.53], ["강릉", 37.75, 128.9], ["전주", 35.82, 127.15]];
async function updateAir() {
  const pts = list.filter((c) => c.lat != null).map((c) => ({ a2: c.a2, name: c.cap || c.ko, lat: c.lat, lon: c.lng }));
  for (const [n, la, lo] of KR_CITIES) pts.push({ a2: "KR", name: n, lat: la, lon: lo, city: 1 });
  const items = [];
  for (let i = 0; i < pts.length; i += 80) {
    const b = pts.slice(i, i + 80);
    const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${b.map((p) => p.lat.toFixed(2)).join(",")}&longitude=${b.map((p) => p.lon.toFixed(2)).join(",")}&current=pm2_5,pm10,us_aqi`;
    let j; try { j = JSON.parse(await get(url)); } catch { continue; }
    const arr = Array.isArray(j) ? j : [j];
    arr.forEach((r, k) => { const c = r?.current; if (c && c.pm2_5 != null) items.push({ ...b[k], pm25: c.pm2_5, pm10: c.pm10, aqi: c.us_aqi, t: c.time }); });
    await sleep(400);
  }
  console.log(`air: ${items.length}/${pts.length}`);
  return items.length ? { at: new Date().toISOString(), items } : null;
}

// 최근 화산 분화 (GDACS, 최근 120일)
async function updateVolcanoes() {
  let list_;
  try { list_ = JSON.parse(await get("https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=VO")).features; } catch { console.log("volcano: unavailable"); return null; }
  if (!Array.isArray(list_)) return null;
  const cutoff = Date.now() - 120 * 864e5, byName = new Map();
  for (const f of list_) {
    const p = f.properties, to = new Date((p.todate || p.fromdate) + "Z");
    if (isNaN(to) || to < cutoff) continue;
    const name = String(p.eventname || p.name).replace(/^Eruption\s+/i, "").trim();
    const prev = byName.get(name);
    if (!prev || prev.to < p.todate) byName.set(name, { name, country: p.country || "", alert: p.alertlevel, from: p.fromdate, to: p.todate, current: String(p.iscurrent) === "true", pos: f.geometry.coordinates, url: p.url?.report || "https://www.gdacs.org/" });
  }
  const items = [...byName.values()];
  console.log(`volcano: ${items.length} recent (${items.map((v) => v.name).join(", ")})`);
  return { at: new Date().toISOString(), items };
}

// 나라별 대표 매거진: 주소 확인 + 최신 기사 제목 (6시간에 한 번만 다시 확인)
async function status(url) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15" }, redirect: "follow", signal: AbortSignal.timeout(15000) });
    return r.status;
  } catch { return 0; }
}
async function feedFor(base) {
  const root = base.replace(/\/$/, "");
  for (const path of ["/feed/rss", "/rss/all.xml/", "/feed/", "/rss.xml", "/rss", "/feed.xml"]) {
    const xml = await get(root + path);
    if (!xml || !/<(rss|feed)[\s>]/i.test(xml)) continue;
    let items = parseRss(xml);
    if (!items.length) { // Atom
      items = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)].map((m) => {
        const t = tag(m[1], "title"), l = (m[1].match(/<link[^>]*href="([^"]+)"/i) || [])[1], d = new Date(tag(m[1], "updated") || tag(m[1], "published"));
        return t && l && !isNaN(d) ? { t, u: l, s: "", d: d.toISOString() } : null;
      }).filter(Boolean);
    }
    if (items.length >= 2) return items.sort((a, b) => b.d.localeCompare(a.d)).slice(0, 3).map((n) => ({ t: n.t.slice(0, 140), u: n.u, d: n.d }));
  }
  return [];
}
async function updateMagazines(prev) {
  if (prev?.at && Date.now() - new Date(prev.at) < 6 * 3600e3 && prev.items) { console.log("magazines: reuse (fresh)"); return prev; }
  const src = JSON.parse(await readFile(new URL("scripts/magazines-src.json", ROOT), "utf8"));
  const jobs = [];
  for (const [a2, arr] of Object.entries(src)) if (a2[0] !== "_") for (const [n, k, u] of arr) jobs.push({ a2, n, k, u });
  const seen = new Map();
  let i = 0;
  async function worker() {
    while (i < jobs.length) {
      const j = jobs[i++];
      if (!seen.has(j.u)) {
        const st = await status(j.u);
        const ok = (st >= 200 && st < 400) || [401, 402, 403, 405, 429].includes(st);
        seen.set(j.u, { ok, st, h: ok && st < 400 ? await feedFor(j.u) : [] });
      }
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  const items = {}, dead = [];
  for (const j of jobs) {
    const r = seen.get(j.u);
    if (!r.ok) { dead.push(`${j.n}(${r.st})`); continue; }
    (items[j.a2] ||= []).push({ n: j.n, k: j.k, u: j.u, h: r.h });
  }
  const withH = [...seen.values()].filter((r) => r.h.length).length;
  console.log(`magazines: ${jobs.length - dead.length}/${jobs.length} links ok, ${withH} with headlines; dead: ${dead.join(", ") || "none"}`);
  return { at: new Date().toISOString(), items };
}

async function keepOrPrev(name, fresh) {
  if (fresh) return fresh;
  if (process.env.SITE_URL) {
    try { const j = JSON.parse((await get(process.env.SITE_URL + "data/" + name)) || "null"); if (j) return j; } catch {}
  }
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

let prevMag = null;
if (process.env.SITE_URL) { try { prevMag = JSON.parse((await get(process.env.SITE_URL + "data/magazines.json")) || "null"); } catch {} }
let [{ items, ok }, clouds, quakes, iss, storms, aurora, fxhist, air, volcanoes, magazines] = await Promise.all([
  updateNews(), updateClouds(), updateQuakes(), updateIss(), updateStorms(), updateAurora(), updateFxHist(),
  updateAir(), updateVolcanoes(), updateMagazines(prevMag),
]);
air = await keepOrPrev("air.json", air);
volcanoes = await keepOrPrev("volcanoes.json", volcanoes);
for (const [n, v] of [["air.json", air], ["volcanoes.json", volcanoes], ["magazines.json", magazines]]) if (v) await writeFile(new URL(n, DATA), JSON.stringify(v));
quakes = await keepOrPrev("quakes.json", quakes);
iss = await keepOrPrev("iss.json", iss);
storms = await keepOrPrev("storms.json", storms);
aurora = await keepOrPrev("aurora.json", aurora);
fxhist = await keepOrPrev("fxhist.json", fxhist);
for (const [n, v] of [["storms.json", storms], ["aurora.json", aurora], ["fxhist.json", fxhist]]) if (v) await writeFile(new URL(n, DATA), JSON.stringify(v));
if (quakes) await writeFile(new URL("quakes.json", DATA), JSON.stringify(quakes));
if (iss) await writeFile(new URL("iss.json", DATA), JSON.stringify(iss));
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
