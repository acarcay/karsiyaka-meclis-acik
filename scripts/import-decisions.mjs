import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyDisplayTitle } from './decision-titles.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const archiveUrl = 'https://www.karsiyaka.bel.tr/meclis-karar-ozetleri';
const root = fileURLToPath(new URL('..', import.meta.url));
const cacheDir = join(root, 'work', 'pdf-cache');
const outputFile = join(root, 'dist', 'data', 'decisions.json');
const year = process.argv.find((x) => /^20\d\d$/.test(x)) || String(new Date().getFullYear());

// ─── Yardımcı: HTTP ─────────────────────────────────────────────────────────

async function fetchText(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'KarsiyakaMeclisAcik/1.0' }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
}

async function download(url, destination) {
  const response = await fetch(url, { headers: { 'user-agent': 'KarsiyakaMeclisAcik/1.0' }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
}

// ─── Yardımcı: Tarih ────────────────────────────────────────────────────────

function dateFromFilename(url) {
  const match = basename(new URL(url).pathname).match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!match) throw new Error(`Belge tarihi bulunamadı: ${url}`);
  const date = `${match[3]}-${match[2]}-${match[1]}`;
  if (new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error(`Geçersiz tarih: ${date}`);
  return date;
}

// ─── Kritik 1: `type` / `department` normalizasyonu ─────────────────────────
// Ham PDF'den gelen BÜYÜK HARF müdürlük adlarını okunabilir forma çevirir.
// Eşleşme yoksa MÜDÜRLÜĞÜ ekini kırpar ve titleCase uygular.

const DEPT_MAP = [
  [/YAZI\s+İŞLERİ/i,                          'Yazı İşleri'],
  [/MALİ\s+HİZMETLER/i,                       'Mali Hizmetler'],
  [/DESTEK\s+HİZMETLERİ/i,                    'Destek Hizmetleri'],
  [/RUHSAT\s+VE\s+DENETİM/i,                  'Ruhsat ve Denetim'],
  [/BASIN.*HALKLA\s+İLİŞKİLER/i,              'Basın ve Halkla İlişkiler'],
  [/PARK\s+VE\s+BAHÇELER/i,                   'Park ve Bahçeler'],
  [/VETERİNER\s+İŞLERİ/i,                     'Veteriner İşleri'],
  [/ZABITA/i,                                  'Zabıta'],
  [/KADIN\s+VE\s+AİLE/i,                      'Kadın ve Aile Hizmetleri'],
  [/GELİRLER/i,                               'Gelirler'],
  [/İNSAN\s+KAYNAKLARI/i,                     'İnsan Kaynakları'],
  [/İMAR\s+VE\s+ŞEHİRCİLİK/i,                'İmar ve Şehircilik'],
  [/KÜLTÜR\s+VE\s+SOSYAL/i,                   'Kültür ve Sosyal İşler'],
  [/SAĞLIK\s+İŞLERİ/i,                        'Sağlık İşleri'],
  [/FEN\s+İŞLERİ/i,                           'Fen İşleri'],
  [/ÇEVRE\s+KORUMA/i,                         'Çevre Koruma'],
  [/HUKUK\s+İŞLERİ/i,                         'Hukuk İşleri'],
  [/STRATEJİ\s+GELİŞTİRME/i,                 'Strateji Geliştirme'],
  [/EMLAK\s+VE\s+İSTİMLAK/i,                  'Emlak ve İstimlak'],
  [/YAPI\s+KONTROL/i,                          'Yapı Kontrol'],
  [/BİLGİ\s+İŞLEM/i,                          'Bilgi İşlem'],
  [/TEMİZLİK\s+İŞLERİ/i,                      'Temizlik İşleri'],
  [/ULAŞIM\s+HİZMETLERİ/i,                    'Ulaşım Hizmetleri'],
  [/SOSYAL\s+YARDIM/i,                         'Sosyal Yardım'],
  [/SPOR\s+HİZMETLERİ/i,                       'Spor Hizmetleri'],
];

function normalizeDepartment(raw) {
  for (const [pattern, label] of DEPT_MAP) {
    if (pattern.test(raw)) return label;
  }
  // Fallback: MÜDÜRLÜĞÜ ekini kırp + titleCase
  return titleCase(raw.replace(/\s*MÜDÜRLÜĞÜ\s*$/i, '').trim());
}

// ─── Kritik 3: Oy dağılımı parse ────────────────────────────────────────────
// "Dört meclis üyesi ret oyu verdi" gibi ifadeleri yapısal veriye çevirir.

const WORD_TO_NUM = {
  bir: 1, iki: 2, üç: 3, dört: 4, beş: 5, altı: 6, yedi: 7,
  sekiz: 8, dokuz: 9, on: 10, onbir: 11, oniki: 12, onüç: 13,
  ondört: 14, onbeş: 15, onaltı: 16, onyedi: 17, onsekiz: 18,
  ondokuz: 19, yirmi: 20, yirmibir: 21, yirmiiki: 22,
};

function wordToNum(word) {
  const clean = word.toLocaleLowerCase('tr-TR').replace(/\s+/g, '');
  return /^\d+$/.test(clean) ? Number(clean) : WORD_TO_NUM[clean] ?? NaN;
}

function parseVotes(text, resultText) {
  if (/OY\s+BİRLİĞİ\s+İLE/i.test(resultText || text)) {
    return { type: 'unanimous' };
  }
  // "X üye/meclis üyesi ret oyu" veya "X ret oyuna karşı"
  const againstMatch = text.match(/([\p{L}\d]+)\s+(?:meclis\s+)?üye(?:si)?\s+ret\s+oyu/iu);
  if (againstMatch) {
    const n = wordToNum(againstMatch[1]);
    if (!isNaN(n)) return { type: 'majority', against: n };
  }
  // "X çekimser"
  const abstainMatch = text.match(/([\p{L}\d]+)\s+çekimser/iu);
  if (abstainMatch) {
    const n = wordToNum(abstainMatch[1]);
    if (!isNaN(n)) return { type: 'majority', abstain: n };
  }
  if (/OY\s+ÇOKLUĞU\s+İLE/i.test(resultText || text)) {
    return { type: 'majority' };
  }
  return { type: 'other' };
}

// ─── Kritik 2: `makeTitle()` iyileştirme ────────────────────────────────────
// Ham bürokratik metindeki kalıp ifadeleri temizler ve kısa, anlamlı başlık üretir.

const CLEANUP_PATTERNS = [
  // "…hakkında komisyon raporu okunarak görüşüldü" gibi kalıplar
  [/\s+hakkında\s+(?:ihtisas\s+)?komisyon\s+raporu\s+.*$/i, ''],
  // "…hakkında önerge" / "hususunda önerge"
  [/\s+(?:hakkında|hususunda)\s+(?:verilen\s+)?önerge.*$/i, ''],
  // "…ile ilgili yazı/dilekçe"
  [/\s+(?:ile\s+)?ilgili\s+(?:belediye\s+)?(?:yazı|dilekçe|yazısı).*$/i, ''],
  // "… tarihli ve … sayılı …" referansları
  [/\d{2}\.\d{2}\.\d{4}\s+tarihli\s+ve\s+[\w/]+\s+sayılı\s+meclis\s+kararıyla\s+/gi, ''],
];

function makeTitle(text) {
  let clean = text.trim();
  for (const [pattern, replacement] of CLEANUP_PATTERNS) {
    clean = clean.replace(pattern, replacement).trim();
  }
  // Nokta; madde numaraları ve A.Ş. gibi kısaltmalarda cümle sonu değildir.
  clean = clean || text.trim();
  if (clean.length <= 145) return clean;
  const prefix = clean.slice(0, 142);
  const boundary = prefix.lastIndexOf(' ');
  return `${prefix.slice(0, boundary > 90 ? boundary : 142).trim()}…`;
}

// ─── Ana parse fonksiyonu ────────────────────────────────────────────────────

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
    const resultRaw = resultMatch ? resultMatch[1] : null;
    const result = resultRaw ? titleCase(resultRaw) : 'Sonuç otomatik belirlenemedi; kaynak belgeyi inceleyin';
    if (resultMatch) body = body.slice(0, resultMatch.index).trim();
    body = body.replace(/^(?:\d+\s*-\s*)?\([^)]+\)\s*/, '').trim();
    const rawDepartment = start[2].split('-')[0].trim();
    const department = normalizeDepartment(rawDepartment); // Kritik 1
    records.push({
      id: `${date}-${decisionNo}`,
      date,
      decisionNo,
      tag: classify(`${rawDepartment} ${body}`),
      title: makeTitle(body),                              // Kritik 2
      text: body,
      result,
      votes: parseVotes(body, resultRaw),                 // Kritik 3
      department,                                          // Kritik 1 — normalize edilmiş
      type: department,                                    // geriye dönük uyumluluk için korundu
      place: extractPlace(body),
      source,
      reviewed: false,
    });
  }
  return records;
}

// ─── Diğer yardımcılar ──────────────────────────────────────────────────────

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

export function mergeDecisions(existing, imported) {
  const incoming = new Map();
  for (const record of imported) {
    if (incoming.has(record.id)) throw new Error(`Tekrarlanan karar: ${record.id}`);
    incoming.set(record.id, record);
  }
  const sources = new Set(imported.map(record => record.source));
  for (const record of existing) {
    if (sources.has(record.source) && !incoming.has(record.id)) {
      throw new Error(`Karar kaybı tespit edildi (${record.id}); mevcut veri korundu.`);
    }
  }
  const merged = new Map(existing.map(record => [record.id, record]));
  for (const record of imported) {
    const previous = merged.get(record.id);
    // PDF adresi değişse bile elle kontrol edilmiş özetleri koru.
    merged.set(record.id, previous?.reviewed ? { ...record, ...previous, source: record.source } : record);
  }
  return [...merged.values()].map(applyDisplayTitle).sort((a, b) => b.date.localeCompare(a.date) || Number(b.decisionNo) - Number(a.decisionNo));
}

export { parseDecisions, makeTitle, normalizeDepartment, parseVotes, dateFromFilename };

async function main() {
  await mkdir(cacheDir, { recursive: true });
  await mkdir(join(root, 'dist', 'data'), { recursive: true });

  const html = await fetchText(archiveUrl);
  const pdfUrls = [...html.matchAll(/href="(https:\/\/demoapi\.karsiyaka\.bel\.tr\/[^"?]*Meclis-Karar-Ozeti[^"?]*\.pdf)"/gi)]
    .map((m) => m[1])
    .filter((url, index, all) => all.indexOf(url) === index)
    .filter((url) => basename(url).includes(year));

  if (!pdfUrls.length) throw new Error(`${year} için PDF bulunamadı; mevcut veri korundu.`);
  const existing = JSON.parse(await readFile(outputFile, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '[]';
    throw error;
  }));
  const imported = [];

  for (const source of pdfUrls) {
    const pdfPath = join(cacheDir, basename(new URL(source).pathname));
    const textPath = `${pdfPath}.txt`;
    await download(source, pdfPath);
    const result = spawnSync('pdftotext', ['-layout', pdfPath, textPath], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`PDF metni çıkarılamadı: ${source}\n${result.stderr}`);
    const text = await readFile(textPath, 'utf8');
    const date = dateFromFilename(source);
    const records = parseDecisions(text, source, date);
    if (!records.length) throw new Error(`Belge ayrıştırılamadı; mevcut veri korundu: ${source}`);
    imported.push(...records);
  }

  const merged = mergeDecisions(existing, imported);
  await writeFile(`${outputFile}.tmp`, `${JSON.stringify(merged, null, 2)}\n`);
  await rename(`${outputFile}.tmp`, outputFile);
  await writeFile(join(root, 'dist', 'data', 'status.json'), `${JSON.stringify({ checkedAt: new Date().toISOString(), year, documents: pdfUrls.length }, null, 2)}\n`);

  console.log(JSON.stringify({
    year,
    documents: pdfUrls.length,
    decisions: merged.length,
    reviewed: merged.filter((x) => x.reviewed).length,
    pending_review: merged.filter((x) => !x.reviewed).length,
  }));

}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
