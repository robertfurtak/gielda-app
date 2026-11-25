// Pobiera ceny z Frisco i Auchan (sklepy internetowe, Warszawa) dla listy fraz z produkty.txt
// i zapisuje je w pliku JSON czytanym przez aplikację. Uruchamiane raz dziennie przez GitHub Actions.
import fs from 'node:fs';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const H = { 'User-Agent': UA, 'Accept-Language': 'pl-PL,pl;q=0.9' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dec = s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const num = s => s == null ? null : parseFloat(String(s).replace(/\s/g, '').replace(',', '.'));

async function get(url, json) {
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(url, { headers: { ...H, Accept: json ? 'application/json' : 'text/html' }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return json ? await r.json() : await r.text();
    } catch (e) { if (a === 2) throw e; await sleep(1500 * (a + 1)); }
  }
}

async function frisco(q) {
  const j = await get(`https://www.frisco.pl/app/commerce/api/v1/offer/products/query?purpose=Listing&pageIndex=1&search=${encodeURIComponent(q)}&pageSize=24&includeFacets=false`, true);
  return (j.products || []).map(x => x.product).filter(p => p && p.price && p.isAvailable !== false).map(p => {
    const name = [p.brand, p.name?.pl].filter(Boolean).join(' ');
    const g = p.grammage, u = p.unitOfMeasure;
    const unit = u === 'Litre' ? 'l' : u === 'Kilogram' ? 'kg' : u === 'Piece' ? 'szt' : (u || '');
    const size = g ? `${String(+g).replace('.', ',')} ${unit}` : '';
    const price = p.price.price;
    const before = p.price.priceBeforePromotion ?? p.price.priceBeforeDiscount ?? null;
    return {
      s: 'frisco', n: name, p: price, o: before && before > price ? before : null, z: size,
      up: g && (unit === 'l' || unit === 'kg') ? +(price / g).toFixed(2) : null, uu: unit,
      u: `https://www.frisco.pl/pid,${p.productId}/n,produkt/stn,product`
    };
  });
}

async function auchan(q) {
  const h = await get(`https://zakupy.auchan.pl/search?q=${encodeURIComponent(q)}`);
  return h.split('class="product-card-container').slice(1).map(t => {
    const n = t.match(/data-test="fop-title"[^>]*>([^<]+)</);
    const p = t.match(/data-test="fop-price"[^>]*>([^<]+)</);
    const href = t.match(/href="(\/products\/[^"]+)"/);
    const ppu = t.match(/data-test="fop-price-per-unit"[^>]*>\(([\d,\s]+) zł\/(\w+)\)/);
    const old = t.match(/([\d,]+) zł - cena przed obniżką/) || t.match(/data-test="fop-was-price"[^>]*>(?:<[^>]+>)*([\d,]+)/);
    const sz = t.match(/_weight_[^"]*">([^<]+)</);
    if (!n || !p) return null;
    return {
      s: 'auchan', n: dec(n[1]), p: num(p[1]), o: old ? num(old[1]) : null, z: sz ? sz[1] : '',
      up: ppu ? num(ppu[1]) : null, uu: ppu ? ppu[2] : '', u: href ? 'https://zakupy.auchan.pl' + href[1] : ''
    };
  }).filter(Boolean);
}

const STORES = { frisco, auchan };
const terms = fs.readFileSync(new URL('./produkty.txt', import.meta.url), 'utf8')
  .split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#'));
const outFile = process.argv[2] || 'ceny.json';
const result = { t: new Date().toISOString(), q: {}, err: {} };
const stats = {};
for (const q of terms) {
  result.q[q] = [];
  for (const [name, fn] of Object.entries(STORES)) {
    try {
      const t0 = Date.now(); const items = (await fn(q)).slice(0, 16);
      result.q[q].push(...items);
      stats[name] = (stats[name] || 0) + items.length; console.log('  ', name, items.length, (Date.now()-t0)+'ms');
    } catch (e) {
      result.err[name] = (result.err[name] || 0) + 1;
      console.log(`! ${name} "${q}": ${e.message}`);
    }
    await sleep(700);
  }
  console.log(q, result.q[q].length);
}
console.log('STATYSTYKI', JSON.stringify(stats), 'BLEDY', JSON.stringify(result.err));
const total = Object.values(stats).reduce((a, b) => a + b, 0);
if (total < 50) { console.log('Za mało wyników, nie nadpisuję danych'); process.exit(1); }
fs.writeFileSync(outFile, JSON.stringify(result));
