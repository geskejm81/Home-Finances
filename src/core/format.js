// Pure helpers: dates, money, names. No state, no DOM.

export const GROUPS = [
  {id:'income', name:'Income'},
  {id:'savings', name:'Savings'},
  {id:'fixed', name:'Fixed'},
  {id:'variable', name:'Variable'},
];
export const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export const MONL = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export const fmt = (n, cents=true) => {
  const v = Math.abs(n) < 0.005 ? 0 : n;
  const s = Math.abs(v).toLocaleString('en-US',{minimumFractionDigits:cents?2:0, maximumFractionDigits:cents?2:0});
  return v<0 ? '−'+s : s;
};
export const money = (n, cents=true) => (n<0?'−':'') + '$' + fmt(Math.abs(n), cents);
export const num = s => parseFloat(String(s).replace(/[^0-9.\-]/g,''));
export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
export const ym = d => d.slice(0,7);
export const dObj = d => new Date(d+'T12:00:00');
export const dayLabel = d => {
  const diff = Math.round((dObj(TODAY)-dObj(d))/864e5);
  if (diff===0) return 'Today';
  if (diff===1) return 'Yesterday';
  const o = dObj(d);
  return o.toLocaleDateString('en-US',{weekday: Math.abs(diff)<7?'long':undefined, month:'short', day:'numeric', year: o.getFullYear()!==dObj(TODAY).getFullYear()?'numeric':undefined});
};
export const shortDate = d => dObj(d).toLocaleDateString('en-US',{month:'short',day:'numeric'});
export const norm = m => String(m||'').toLowerCase().replace(/[#*0-9]+/g,' ').replace(/[^a-z& ]/g,' ').replace(/\b(inc|llc|com|www|the|pos|purchase|debit|sq|[a-z])\b/g,' ').replace(/\s+/g,' ').trim();
export const GENERIC = new Set(['payment','online','transfer','check','ach','ppd','autopay','zelle','venmo']);
export const mkey = m => { const w = norm(m).split(' '); return GENERIC.has(w[0]) ? w.slice(0,5).join(' ') : w[0]; };
export const addYm = (k, n) => { let [y,m] = k.split('-').map(Number); m += n; while(m<1){m+=12;y--} while(m>12){m-=12;y++} return `${y}-${String(m).padStart(2,'0')}`; };

/** Bank descriptors → names people use. "Costco Whse #0376" → "Costco". */
export function cleanName(raw){
  let s = String(raw).split('*')[0].replace(/#\s*\d+/g,'').replace(/\b\d{3,}\b/g,'').replace(/\.com\b/i,'')
    .replace(/\b(whse|trip|pos|purchase|debit card|exp reimb)\b/ig,'').replace(/\s+/g,' ').trim();
  if (s === s.toUpperCase()) s = s.toLowerCase().replace(/(^|[\s/&-])([a-z])/g, (m, p, c) => p + c.toUpperCase());
  if (/^payment thank you /i.test(s)) s = s.replace(/^payment thank you /i,'') + ' payment';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate()+n); return x; };
export const TODAY = iso(new Date());
