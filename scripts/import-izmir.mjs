import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = join(root, 'dist/data/izmir-decisions.json');
const cache = join(root, 'work/izmir-pdf-cache');
const base = 'https://www.izmir.bel.tr';
const year = process.argv.find(arg => /^20\d\d$/.test(arg)) || String(new Date().getFullYear());
const limit = Number(process.env.IZMIR_IMPORT_LIMIT || 50);

async function get(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'IzmirMeclisAcik/1.0' }, signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return response;
}

export function parseListingRow(row) {
  const match = row.KararOzet?.match(/href=["']([^"']+\.pdf)["']/i);
  const no = row.MeclisKarariAciklama?.match(/([\d.]+)\s*sayılı/i)?.[1];
  const timestamp = Number(row.KararTarihi?.match(/Date\((\d+)/)?.[1]);
  if (!match || !no || !timestamp || !Number.isInteger(row.KararId)) return null;
  const source = new URL(match[1].replaceAll('&amp;', '&'), base).href;
  if (new URL(source).hostname !== 'www.izmir.bel.tr') return null;
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(timestamp));
  return { id: `izmir-${row.KararId}`, date, decisionNo: no, source };
}

export function parsePdf(text, row) {
  const clean = text.replace(/\s+/g, ' ').trim();
  const pdfNo = clean.match(/Karar No\s*:\s*([\d.]+)/i)?.[1];
  const pdfDate = clean.match(/Karar Tarihi\s*:\s*(\d{2})\/(\d{2})\/(\d{4})/i);
  if (!pdfNo?.endsWith(row.decisionNo) || !pdfDate || `${pdfDate[3]}-${pdfDate[2]}-${pdfDate[1]}` !== row.date) return null;
  const proposal = clean.match(/Başkanlık Önergesinde;\s*[“"](.+?)[”"]/)?.[1]
    || clean.match(/(?:konusunda|hususunda)\s+(.{40,600}?)(?:görüşülmesi|karar verilmesi)/i)?.[0]
    || clean.split(/(?:Komisyon )?Raporunda;|Önergesinde;/i).at(1)?.split(/Yukarıda metni yazılı/i)[0]?.slice(0, 1200);
  const decision = clean.match(/Yukarıda metni yazılı.{0,1200}?Meclisimizce\s+oy(?:birliği|çokluğu)\s+ile\s+karar verildi/iu)?.[0];
  if (!proposal || !decision) return null;
  const textValue = proposal.trim();
  const result = /oybirliği/i.test(decision) ? 'Oybirliğiyle kabul' : 'Oyçokluğuyla kabul';
  const department = clean.match(/([\p{L}\s]+Dairesi Başkanlığı) ifadeli/iu)?.[1]?.trim() || 'İzmir Büyükşehir Belediyesi';
  const tag = /imar|parsel|plan değişikliği|taşınmaz|intifa/i.test(textValue) ? 'İmar'
    : /bütçe|tarife|ücret|borç|mali|ödenek/i.test(textValue) ? 'Mali'
      : /kültür|sanat|spor|müze|etkinlik/i.test(textValue) ? 'Kültür' : 'Yönetim';
  const title = textValue.length > 145 ? `${textValue.slice(0, 142).replace(/\s+\S*$/, '')}…` : textValue;
  return { ...row, municipalityId: 'izmir', municipality: 'İzmir Büyükşehir', tag, title, text: textValue,
    result, votes: { type: /oybirliği/i.test(decision) ? 'unanimous' : 'majority' }, department,
    place: 'İzmir', reviewed: false };
}

async function main() {
  if (!Number.isInteger(limit) || limit < 1 || limit > 5000) throw new Error('IZMIR_IMPORT_LIMIT 1-5000 olmalı');
  await mkdir(cache, { recursive: true });
  const api = new URL('/tr/IbbMeclisi/TariheGoreKararGetirJS', base);
  for (const [key, value] of Object.entries({ yil: year, ay: '', gun: '', txtSozcuk: '', txtKararNo: '', draw: '1', start: '0', length: String(limit) })) api.searchParams.set(key, value);
  const listing = await (await get(api)).json();
  const rows = listing.data?.map(parseListingRow).filter(Boolean);
  if (!rows?.length) throw new Error('İzmir karar listesi boş; mevcut veri korundu.');
  const existing = JSON.parse(await readFile(output, 'utf8').catch(error => error.code === 'ENOENT' ? '[]' : Promise.reject(error)));
  const byId = new Map(existing.map(record => [record.id, record]));
  let added = 0;
  let skipped = 0;
  for (const row of rows) {
    if (byId.get(row.id)?.source === row.source && byId.get(row.id)?.date === row.date) continue;
    const pdf = join(cache, `${row.id}.pdf`);
    const buffer = await readFile(pdf).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (!buffer) await writeFile(pdf, Buffer.from(await (await get(row.source)).arrayBuffer()));
    const result = spawnSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(`PDF metni çıkarılamadı: ${row.source}`);
    const record = parsePdf(result.stdout, row);
    if (!record) {
      if (byId.get(row.id)?.date !== row.date) byId.delete(row.id);
      skipped += 1;
      continue;
    }
    byId.set(row.id, record);
    added += 1;
  }
  if (!byId.size) throw new Error('Hiçbir karar ayrıştırılamadı; mevcut veri korundu.');
  const sorted = [...byId.values()].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  await writeFile(`${output}.tmp`, `${JSON.stringify(sorted, null, 2)}\n`);
  await rename(`${output}.tmp`, output);
  console.log(JSON.stringify({ year, listed: rows.length, added, skipped, total: sorted.length }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
