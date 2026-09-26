import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const archiveUrl = 'https://www.karsiyaka.bel.tr/meclis-karar-ozetleri';
const root = new URL('..', import.meta.url).pathname;
const cacheDir = join(root, 'work', 'pdf-cache');
const outputFile = join(root, 'dist', 'data', 'decisions.json');
const year = process.argv.find((x) => /^20\d\d$/.test(x)) || String(new Date().getFullYear());

await mkdir(cacheDir, { recursive: true });
await mkdir(join(root, 'dist', 'data'), { recursive: true });

const html = await fetchText(archiveUrl);
const pdfUrls = [...html.matchAll(/href="(https:\/\/demoapi\.karsiyaka\.bel\.tr\/[^"?]*Meclis-Karar-Ozeti[^"?]*\.pdf)"/gi)]
  .map((m) => m[1])
  .filter((url, index, all) => all.indexOf(url) === index)
  .filter((url) => basename(url).includes(year));

const existing = JSON.parse(await readFile(outputFile, 'utf8').catch(() => '[]'));
const curated = new Map(existing.filter((x) => x.reviewed).map((x) => [`${x.source}#${x.decisionNo || ''}`, x]));
const imported = [];

for (const source of pdfUrls) {
  const pdfPath = join(cacheDir, basename(new URL(source).pathname));
  const textPath = `${pdfPath}.txt`;
  await download(source, pdfPath);
  const result = spawnSync('pdftotext', ['-layout', pdfPath, textPath], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`PDF metni çıkarılamadı: ${source}\n${result.stderr}`);
  const text = await readFile(textPath, 'utf8');
  const date = dateFromFilename(source);
  imported.push(...parseDecisions(text, source, date));
}

const merged = imported.map((record) => curated.get(`${record.source}#${record.decisionNo}`) || record);
for (const record of existing.filter((x) => x.reviewed)) {
  if (!merged.some((x) => x.id === record.id)) merged.push(record);
}
merged.sort((a, b) => b.date.localeCompare(a.date) || Number(b.decisionNo || 0) - Number(a.decisionNo || 0));
await writeFile(outputFile, `${JSON.stringify(merged, null, 2)}\n`);

console.log(JSON.stringify({ year, documents: pdfUrls.length, decisions: merged.length, reviewed: merged.filter((x) => x.reviewed).length, pending_review: merged.filter((x) => !x.reviewed).length }));

async function fetchText(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'KarsiyakaMeclisAcik/1.0' } });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
}

async function download(url, destination) {
  const response = await fetch(url, { headers: { 'user-agent': 'KarsiyakaMeclisAcik/1.0' } });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
}

function dateFromFilename(url) {
  const match = basename(new URL(url).pathname).match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : '0000-00-00';
}

function parseDecisions(input, source, date) {
  const text = input.replace(/\s+/g, ' ').replace(/((?:KABUL|RET)\s+EDİLDİ)\s*:\s*(\d+)/gi, '$1 KARAR NO:$2').trim();
  const chunks = text.split(/KARAR\s*NO\s*:\s*(\d+)/i);
  const records = [];
  for (let i = 1; i < chunks.length; i += 2) {
    const decisionNo = chunks[i];
    const before = chunks[i - 1];
    const starts = [...before.matchAll(/(?:^|\s)(\d+)\s*-\s*\(([^)]+)\)/g)];
    if (!starts.length) continue;
    const start = starts.at(-1);
    let body = before.slice(start.index + start[0].indexOf(start[1]) + start[1].length).replace(/^\s*-?\s*\([^)]+\)\s*/, '').trim();
    const resultMatch = body.match(/(OY\s+BİRLİĞİ\s+İLE\s+(?:KABUL|RET)\s+EDİLDİ|OY\s+ÇOKLUĞU\s+İLE\s+(?:KABUL|RET)\s+EDİLDİ|(?:görev[^.]{0,90})?SEÇİLDİ)\.?\s*$/i);
    const result = resultMatch ? titleCase(resultMatch[1]) : 'Karara bağlandı';
    if (resultMatch) body = body.slice(0, resultMatch.index).trim();
    body = body.replace(/^(?:\d+\s*-\s*)?\([^)]+\)\s*/, '').trim();
    const department = start[2].split('-')[0].trim();
    records.push({
      id: `${date}-${decisionNo}`,
      date,
      decisionNo,
      tag: classify(`${department} ${body}`),
      title: makeTitle(body),
      text: body,
      result,
      type: department,
      place: extractPlace(body),
      source,
      reviewed: false
    });
  }
  return records;
}

function makeTitle(text) {
  const clean = text.replace(/\s+(hakkında|hususunda)\s+(önerge|raporu).*$/i, '').trim();
  const sentence = clean.split(/(?<=[.!?])\s/)[0];
  return sentence.length > 145 ? `${sentence.slice(0, 142).trim()}…` : sentence;
}

function classify(text) {
  if (/imar|parsel|plan değişikliği|taşınmaz|intifa/i.test(text)) return 'İmar';
  if (/bütçe|tarife|ücret|borç|mali|ödenek/i.test(text)) return 'Mali';
  if (/kültür|sanat|spor|müze|etkinlik/i.test(text)) return 'Kültür';
  return 'Yönetim';
}

function extractPlace(text) {
  const match = text.match(/(?:İlçemiz\s+)?([A-ZÇĞİÖŞÜ][a-zçğıöşü]+(?:\s+[A-ZÇĞİÖŞÜ][a-zçğıöşü]+)?)\s+Mahallesi/);
  return match ? match[1] : 'Karşıyaka';
}

function titleCase(value) {
  return value.toLocaleLowerCase('tr-TR').replace(/(^|\s)\S/g, (x) => x.toLocaleUpperCase('tr-TR'));
}
