// Read an approved expense report export (.xlsx or .csv) in the browser — no library.
// .xlsx is a zip of XML files: read the first sheet, then find the header row and columns by name.
// Works in node too (tests) since it only needs DecompressionStream and TextDecoder.

const td = new TextDecoder();

async function inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}

/** Minimal zip reader: { name → () => Promise<Uint8Array> }. */
function unzip(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not an Excel file');
  const count = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  const files = {};
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = td.decode(u8.subarray(p + 46, p + 46 + nameLen));
    files[name] = async () => {
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      const data = u8.subarray(start, start + size);
      return method === 0 ? data : inflateRaw(data);
    };
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const unxml = s => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(n)).replace(/&amp;/g, '&');
const colIndex = ref => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

/** First worksheet of an .xlsx as an array of rows (strings or numbers). */
export async function readXlsx(buf) {
  const z = unzip(buf), text = async n => z[n] ? td.decode(await z[n]()) : '';
  const shared = [...(await text('xl/sharedStrings.xml')).matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map(m => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => unxml(t[1])).join(''));
  // first sheet in workbook order
  const wb = await text('xl/workbook.xml'), rels = await text('xl/_rels/workbook.xml.rels');
  const rid = (wb.match(/<sheet\b[^>]*r:id="([^"]+)"/) || [])[1];
  const target = rid && (rels.match(new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`)) || rels.match(new RegExp(`Target="([^"]+)"[^>]*Id="${rid}"`)) || [])[1];
  const path = target ? 'xl/' + target.replace(/^\/?xl\//, '').replace(/^\//, '') : Object.keys(z).find(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const xml = await text(path);
  const rows = [];
  for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1], body = c[2] || '';
      const ref = (attrs.match(/r="([A-Z]+\d+)"/) || [])[1], type = (attrs.match(/t="(\w+)"/) || [])[1];
      const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      let val = '';
      if (type === 's') val = shared[+v] ?? '';
      else if (type === 'inlineStr') val = unxml((body.match(/<is>([\s\S]*?)<\/is>/) || [, ''])[1]);
      else if (type === 'str' || type === 'e') val = v != null ? unxml(v) : '';
      else if (type === 'b') val = v === '1';
      else val = v != null && v !== '' ? Number(v) : '';
      row[ref ? colIndex(ref) : row.length] = val;
    }
    rows.push(Array.from(row, x => x ?? ''));
  }
  return rows;
}

/** CSV (quoted fields allowed) → rows. */
export function readCsv(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(f); f = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += ch;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim()));
}

// ---------- rows → report ----------

const iso = d => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
export function toDate(v) {
  if (v === '' || v == null) return null;
  if (typeof v === 'number' && v > 20000 && v < 80000) return iso(new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5));   // Excel serial
  const s = String(v).trim(); let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/))) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; }
  const d = new Date(s); return isNaN(d) ? null : iso(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())));
}
export function toAmount(v) {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').trim(); if (!s) return null;
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s);
  const n = parseFloat(s.replace(/[^0-9.]/g, ''));
  return isNaN(n) ? null : neg ? -n : n;
}

// Header names seen in expense tools (Concur, Expensify, Emburse, Coupa, SAP), most specific first.
const COLS = {
  date: [/^(transaction|expense|txn|purchase|trans\.?)\s*date/i, /^date$/i, /date/i],
  merchant: [/merchant|vendor|payee|supplier/i, /^description$/i, /business purpose|description/i],
  amount: [/approved\s*amount/i, /reimburs\w*\s*amount/i, /amount\s*\(?(usd|rpt|report)/i, /^amount$/i, /amount/i, /^total$/i],
  type: [/expense\s*type/i, /^category$/i, /type|category/i],
  report: [/report\s*(id|number|no|#|key)/i, /^report$/i],
  approved: [/approv\w*\s*date|date\s*approv|approved\s*on/i, /paid\s*date|payment\s*date/i],
};
const pick = (header, pats, avoid = /$^/) => { for (const p of pats) { const i = header.findIndex(h => p.test(h) && !avoid.test(h)); if (i >= 0) return i; } return -1; };

/**
 * Rows → { ref, approved, total, lines: [{ d, m, a, type }], columns }.
 * Finds the header row (the first with a date-ish and an amount-ish column), maps columns by
 * name, and reads report-level fields from "Report ID: …" style cells above the table.
 */
export function rowsToReport(rows, fileName = '') {
  const norm = r => r.map(c => String(c ?? '').trim());
  let h = -1;
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const r = norm(rows[i]);
    if (pick(r, COLS.date, /approv/i) >= 0 && pick(r, COLS.amount) >= 0) { h = i; break; }
  }
  if (h < 0) throw new Error('Couldn’t find a header row with a date and an amount column');
  const header = norm(rows[h]);
  const col = {
    date: pick(header, COLS.date, /approv|submit|paid|report/i), merchant: pick(header, COLS.merchant),
    amount: pick(header, COLS.amount), type: pick(header, COLS.type), report: pick(header, COLS.report), approved: pick(header, COLS.approved),
  };
  // report-level values written above the table ("Report ID" | "12345")
  const above = {};
  for (const r of rows.slice(0, h)) for (let i = 0; i < r.length; i++) {
    const k = String(r[i] ?? '').trim(); const v = r.slice(i + 1).find(x => String(x ?? '').trim() !== '');
    if (v == null) continue;
    if (/report\s*(id|number|no|#|key|name)?\s*:?$/i.test(k) && !above.ref) above.ref = String(v).trim();
    if (/approv/i.test(k) && !above.approved) above.approved = toDate(v);
  }
  const lines = [];
  for (const r of rows.slice(h + 1)) {
    const a = toAmount(r[col.amount]);
    const label = String(r[col.merchant] ?? r[0] ?? '');
    if (a == null || a === 0) continue;
    if (/^\s*(grand\s*)?total|subtotal/i.test(label) || /^\s*(grand\s*)?total/i.test(String(r[0] ?? ''))) continue;
    lines.push({ d: col.date >= 0 ? toDate(r[col.date]) : null, m: col.merchant >= 0 ? String(r[col.merchant] ?? '').trim() : '', a: Math.round(a * 100) / 100,
      type: col.type >= 0 ? String(r[col.type] ?? '').trim() : '' });
  }
  if (!lines.length) throw new Error('No expense lines found');
  const firstRow = rows[h + 1] || [];
  const ref = above.ref || (col.report >= 0 && String(firstRow[col.report] ?? '').trim()) || fileName.replace(/\.[^.]+$/, '');
  const approved = above.approved || (col.approved >= 0 ? toDate(firstRow[col.approved]) : null);
  const total = Math.round(lines.reduce((s, l) => s + l.a, 0) * 100) / 100;
  return { ref, approved, total, lines, columns: Object.fromEntries(Object.entries(col).map(([k, i]) => [k, i >= 0 ? header[i] : null])) };
}

/** File → report draft. */
export async function readReportFile(file) {
  const name = file.name || '';
  const rows = /\.csv$/i.test(name) ? readCsv(await file.text()) : await readXlsx(await file.arrayBuffer());
  return { ...rowsToReport(rows, name), file: name };
}
