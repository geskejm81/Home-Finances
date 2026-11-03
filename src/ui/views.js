// Every screen is a function of state that returns HTML.

import { GROUPS, MON, MONL, TODAY, addYm, dObj, dayLabel, esc, fmt, money, shortDate, ym } from '../core/format.js';
import { S, catGroup, label, txById } from '../core/store.js';
import { agg, catLabel, counts, inbox, knaufSummary, month, netOf, parts, pivot, projectTotal, returnsOf, searchTx, suggest, typical } from '../core/model.js';
import { UI } from './state.js';
import { barChart, lineChart } from './charts.js';
import { go } from './app.js';
import { ic } from './icons.js';

/* ---------- shared row renderers ---------- */
export function amtCell(t){
  const G = catGroup();
  if (t.inbox) return `<span class="amt ${t.a<0?'in':''}">${t.a<0?'+':''}${fmt(Math.abs(t.a))}</span>`;
  if (returnsOf(t.id).length) return `<span class="amt"><s>${fmt(t.a)}</s>${fmt(netOf(t))}</span>`;
  if (t.k==='deposit') return `<span class="amt muted">+${fmt(Math.abs(t.a))}</span>`;
  if (t.x) return `<span class="amt muted">${fmt(Math.abs(t.a))}</span>`;
  if (G[t.c]==='income') return `<span class="amt in">+${fmt(t.a)}</span>`;
  if (t.a<0) return `<span class="amt in">+${fmt(-t.a)}</span>`;
  return `<span class="amt">${fmt(t.a)}</span>`;
}
export function txRow(t, extra=''){
  const ret = t.ret ? `<span class="pill">${ic('ret')}${shortDate(txById(t.ret)?.d||t.d)}</span>` : '';
  const who = t.p ? `<span class="pill hide-m">${esc(t.p)}</span>` : '';
  return `<div class="row click ${UI.sel===t.id?'sel':''} ${t.s?'muted':''}" data-tx="${t.id}">
    ${t.s ? `<span class="dot hollow" title="Scheduled"></span>` : ''}
    <span class="name">${esc(label(t))}</span>${ret}${who}
    <span class="sub">${esc(t.m && t.n ? t.n : (catLabel(t)!==label(t) ? catLabel(t) : ''))}</span>
    ${amtCell(t)}${extra}</div>`;
}
export function byDay(list, rowFn=txRow, totals=false){
  let out='', cur=null, buf=[], sum=0;
  const flush = () => { if (cur) out += `<div class="day">${dayLabel(cur)}<span class="sp"></span>${totals?`<span class="t">${fmt(sum)}</span>`:''}</div>` + buf.join(''); };
  for (const t of list){ if (t.d!==cur){ flush(); cur=t.d; buf=[]; sum=0; } buf.push(rowFn(t)); if (!t.x && !t.k) sum += t.a; }
  flush(); return out;
}

/* ---------- Inbox ---------- */
export function vInbox(){
  const list = inbox();
  if (!list.length) return `<div class="page"><div class="top"><h1>Inbox</h1></div><div class="empty">${ic('check')}<div>All caught up</div></div></div>`;
  const ready = list.filter(t => suggest(t).type!=='none').length;
  return `<div class="page"><div class="top"><h1>Inbox</h1><span class="sp"></span>
    ${ready ? `<button class="btn pri" data-act="acceptAll">${ic('check')}Accept ${ready}</button>` : ''}</div>
    ${byDay(list, t => {
      const s = suggest(t), i = list.indexOf(t);
      const pill = s.type==='none' ? `<button class="pill" data-act="pickCat" data-id="${t.id}">${s.label}</button>`
        : `<button class="pill ${s.type==='knauf'||s.type==='reimb'?'k':'sug'}" data-act="accept" data-id="${t.id}">${s.type==='return'?ic('ret'):''}${esc(s.label)}</button>`;
      return `<div class="row click ${UI.sel===t.id||(!UI.sel&&UI.cursor===i)?'sel':''}" data-tx="${t.id}">
        <span class="name">${esc(t.m)}</span>${pill}${amtCell(t)}</div>`;
    })}</div>`;
}

/* ---------- Month ---------- */
export function vMonth(){
  const k = UI.month, m = month(k), G = catGroup();
  const [y, mo] = k.split('-').map(Number);
  const isCur = k===ym(TODAY);
  const pace = isCur ? (+TODAY.slice(8)) / new Date(y, mo, 0).getDate() : null;
  const ks = knaufSummary();
  const groupRow = g => {
    const v = m[g.id], typ = typical(k, g.id, true), open = UI.open[g.id];
    const cats = Object.entries(m.cats).filter(([c]) => G[c]===g.id).sort((a,b)=>b[1]-a[1]);
    const bar = (val, t) => t>0 ? `<span class="bar hide-m"><b class="${g.id!=='income'&&g.id!=='savings'&&val>t*1.1?'over':''}" style="width:${Math.min(100, val/t*100)}%"></b>${pace&&g.id==='variable'?`<i style="left:${pace*100}%"></i>`:''}</span>` : `<span class="bar hide-m" style="visibility:hidden"></span>`;
    return `<div class="row lg click ${open?'open':''}" data-act="toggleGroup" data-g="${g.id}">${ic('chev','chev')}<span class="name">${g.name}</span>${bar(v,typ)}<span class="amt ${g.id==='income'?'in':''}">${g.id==='income'?'+':''}${fmt(v)}</span></div>`
      + (open ? cats.map(([c, val]) => {
        const tc = typical(k, c), o = UI.openCat===c;
        const txs = o ? S.txns.filter(t => counts(t) && ym(t.d)===k && parts(t).some(p=>p.c===c)).sort((a,b)=>b.d.localeCompare(a.d)) : [];
        return `<div class="row nest click ${o?'open':''}" data-act="toggleCat" data-c="${esc(c)}">${ic('chev','chev')}<span class="name">${esc(c)}</span>${bar(val,tc)}<span class="amt">${fmt(val)}</span></div>`
          + txs.map(t => `<div class="nest2">${txRow(t)}</div>`).join('');
      }).join('') : '');
  };
  return `<div class="page"><div class="top">
      <button class="icon" data-act="month" data-d="-1">${ic('left')}</button>
      <h1>${MONL[mo-1]} ${y}</h1>
      <button class="icon" data-act="month" data-d="1">${ic('chev')}</button><span class="sp"></span>
      ${!isCur?`<button class="btn ghost" data-act="month" data-d="0">Today</button>`:''}
    </div>
    <div class="hero"><div class="big ${m.left<0?'neg':''}">${money(m.left,false)}</div><div class="cap">left</div></div>
    ${GROUPS.map(groupRow).join('')}
    ${ks.outstanding>0 ? `<div class="sec"><div class="row click" data-go="knauf"><span class="name">Knauf</span><span class="sub">${ks.open.length+ks.submitted.length} items</span><span class="amt">${fmt(ks.outstanding)}</span></div></div>`:''}
  </div>`;
}

/* ---------- Year (pivot) ---------- */
export function vYear(){
  const y = UI.year, g = UI.yearGroup;
  const years = [...new Set(S.txns.map(t=>+t.d.slice(0,4)))].filter(v=>v<=+TODAY.slice(0,4)).sort();
  const mk = i => `${y}-${String(i+1).padStart(2,'0')}`;
  const cell = (v, extra='') => `<td class="${Math.abs(v)<0.005?'z':''} ${v<0?'neg':''} ${extra}">${Math.abs(v)<0.005?'–':fmt(v,false)}</td>`;
  let body;
  if (g==='summary'){
    const proj = S.projects.filter(p=>p.year===y).reduce((s,p)=>s+projectTotal(p),0);
    const line = (name, f, cls='') => { const v = MON.map((_,i)=>f(month(mk(i)))); return `<tr class="${cls}"><td>${name}</td>${v.map(x=>cell(x)).join('')}${cell(v.reduce((a,b)=>a+b,0))}</tr>`; };
    const left = MON.reduce((s,_,i)=>s+month(mk(i)).left,0);
    body = line('Income', m=>m.income) + line('Savings', m=>m.savings) + line('Fixed', m=>m.fixed) + line('Variable', m=>m.variable)
      + line('Left', m=>m.left, 'tot')
      + `<tr><td>Projects</td>${MON.map(()=>'<td class="z"></td>').join('')}${cell(proj)}</tr>`
      + `<tr class="tot"><td>Left after projects</td>${MON.map(()=>'<td></td>').join('')}${cell(left-proj)}</tr>`;
  } else {
    const rows = pivot(y, g); const tot = Array(12).fill(0);
    body = rows.map(([c, v]) => { v.forEach((x,i)=>tot[i]+=x); return `<tr><td title="${esc(c)}">${esc(c)}</td>${v.map((x,i)=>cell(x,'c" data-act="cell" data-c="'+esc(c)+'" data-m="'+mk(i))).join('')}${cell(v.reduce((a,b)=>a+b,0))}</tr>`; }).join('')
      + `<tr class="tot"><td>Total</td>${tot.map(x=>cell(x)).join('')}${cell(tot.reduce((a,b)=>a+b,0))}</tr>`;
  }
  return `<div class="page wide"><div class="top"><h1>Year</h1>
      <select class="sel" data-act="year">${years.map(v=>`<option ${v===y?'selected':''}>${v}</option>`).join('')}</select><span class="sp"></span>
      <div class="seg">${[['summary','Summary'],...GROUPS.map(g=>[g.id,g.name])].map(([id,n])=>`<button class="${g===id?'on':''}" data-act="yearGroup" data-g="${id}">${n}</button>`).join('')}</div></div>
    <div class="tbl"><table><thead><tr><th></th>${MON.map(m=>`<th>${m}</th>`).join('')}<th>Total</th></tr></thead><tbody>${body}</tbody></table></div></div>`;
}

/* ---------- Ledger ---------- */
export function ledgerTotal(){
  if (!UI.q.trim()) return '';
  const l = searchTx(UI.q).filter(t=>!t.x && t.k!=='deposit');
  return `${l.length} · ${money(l.reduce((s,t)=>s+(catGroup()[t.c]==='income'?-t.a:t.a),0))}`;
}
export function ledgerBody(){
  const list = searchTx(UI.q);
  if (!list.length) return `<div class="empty">No matches</div>`;
  const shown = list.slice(0, UI.limit);
  return byDay(shown) + (list.length>shown.length ? `<div style="text-align:center;padding:16px"><button class="btn ghost" data-act="more-rows">${list.length-shown.length} more</button></div>` : '');
}
export function vLedger(){
  return `<div class="page"><div class="top"><h1>Ledger</h1><span class="sp"></span><button class="btn" data-act="new">${ic('plus')}New</button></div>
    <label class="search">${ic('search')}<input id="q" placeholder="Search" value="${esc(UI.q)}" autocomplete="off"><span class="tot" id="qtot">${ledgerTotal()}</span></label>
    <div id="ledgerBody">${ledgerBody()}</div></div>`;
}

/* ---------- Trends ---------- */
export let CH = {};
export function vTrends(){
  const y = +TODAY.slice(0,4), py = y-1, lastM = +TODAY.slice(5,7);
  const spend = yr => MON.map((_,i)=>{ const k = `${yr}-${String(i+1).padStart(2,'0')}`; if (!agg()[k]) return null; const m = month(k); return m.fixed + m.variable; });
  const cur = spend(y).map((v,i)=> i<lastM-1 ? v : null), prev = spend(py);
  const ytd = (yr, key) => { let s=0; for (let i=1;i<lastM;i++) s += month(`${yr}-${String(i).padStart(2,'0')}`)[key]; return s; };
  const W3 = [lastM-3, lastM-2, lastM-1]; // last three complete months
  const win = (yr, key) => W3.reduce((s,i)=>{ const m = month(`${yr}-${String(i).padStart(2,'0')}`); return s + (key==='spend' ? m.fixed+m.variable : m[key]); }, 0);
  const wl = `${MON[W3[0]-1]}–${MON[W3[2]-1]}`;
  const inc = ytd(y,'income'), sav = ytd(y,'savings'), sp = win(y,'spend'), spP = win(py,'spend');
  // biggest movers YTD (complete months)
  const G = catGroup(), cy = {}, pyv = {};
  for (const i of W3){ for (const [c,v] of Object.entries(month(`${y}-${String(i).padStart(2,'0')}`).cats)) cy[c]=(cy[c]||0)+v; for (const [c,v] of Object.entries(month(`${py}-${String(i).padStart(2,'0')}`).cats)) pyv[c]=(pyv[c]||0)+v; }
  const movers = [...new Set([...Object.keys(cy),...Object.keys(pyv)])].filter(c=>G[c]==='variable'||G[c]==='fixed')
    .map(c=>[c, pyv[c]||0, cy[c]||0]).sort((a,b)=>Math.abs(b[2]-b[1])-Math.abs(a[2]-a[1])).slice(0,8);
  // recurring price changes (fixed categories)
  const changes = [];
  for (const c of S.cats.filter(c=>c.group==='fixed')){
    const tx = S.txns.filter(t=>t.c===c.name && counts(t)).sort((a,b)=>a.d.localeCompare(b.d));
    const yr = tx.filter(t => dObj(t.d) > dObj(TODAY)-365*864e5);
    let flips = 0; for (let i=1;i<yr.length;i++) if (Math.abs(yr[i].a-yr[i-1].a)>0.009) flips++;
    if (flips===0 || flips>2) continue; // metered bills move every month; subscriptions step
    for (let i=yr.length-1;i>0;i--){ const a = yr[i-1].a, b = yr[i].a; if (Math.abs(a-b)>0.009){ changes.push([c.name, a, b, yr[i].d]); break; } }
  }
  changes.sort((a,b)=>b[3].localeCompare(a[3]));
  // people
  const ppl = S.people.map(p => [p, S.txns.filter(t=>t.p===p && counts(t) && t.d.startsWith(String(y))).reduce((s,t)=>s+t.a,0)]).filter(x=>x[1]>0);
  const catsV = S.cats.filter(c=>c.group==='variable'||c.group==='fixed').map(c=>c.name).sort();
  const series = []; for (let i=23;i>=0;i--){ const k = addYm(ym(TODAY), -i); if (agg()[k] || series.length) series.push([k, month(k).cats[UI.trendCat]||0]); }
  CH = {cur, prev, y, py, series};
  return `<div class="page wide"><div class="top"><h1>Trends</h1></div>
    <div class="grid2" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
      <div class="stat"><div class="l">Spent ${wl} ${y}</div><div class="n">${money(sp,false)}</div></div>
      <div class="stat"><div class="l">${wl} ${py}</div><div class="n">${money(spP,false)}</div></div>
      <div class="stat"><div class="l">Saved ${y}</div><div class="n">${inc?Math.round(sav/inc*100):0}%</div></div>
      <div class="stat"><div class="l">Knauf outstanding</div><div class="n">${money(knaufSummary().outstanding,false)}</div></div>
    </div>
    <div class="card"><h3>Spending by month<span class="sp"></span><span class="legend"><span><i style="background:var(--accent)"></i>${y}</span><span><i style="background:var(--prev)"></i>${py}</span></span></h3>
      <svg class="chart" id="c1" height="230"></svg><div class="tip" id="t1"></div></div>
    <div class="card"><h3><select class="sel" data-act="trendCat">${catsV.map(c=>`<option ${c===UI.trendCat?'selected':''}>${esc(c)}</option>`).join('')}</select><span class="sp"></span>
      <span class="legend">${money(series.slice(-12).reduce((s,x)=>s+x[1],0)/12,false)} / mo</span></h3>
      <svg class="chart" id="c2" height="190"></svg><div class="tip" id="t2"></div></div>
    <div class="grid2" style="margin-top:12px">
      <div class="card" style="margin:0"><h3>Biggest changes<span class="sp"></span><span class="legend">${wl} vs ${py}</span></h3>
        ${movers.map(([c,a,b])=>`<div class="row click" data-act="trendPick" data-c="${esc(c)}" style="padding:0 4px"><span class="name">${esc(c)}</span><span class="sub">${fmt(a,false)} → ${fmt(b,false)}</span><span class="amt ${b>a?'':'in'}" style="min-width:70px">${b>a?'+':'−'}${fmt(Math.abs(b-a),false)}</span></div>`).join('')}</div>
      <div class="card" style="margin:0"><h3>Price changes</h3>
        ${changes.map(([c,a,b,d])=>`<div class="row click" data-act="trendPick" data-c="${esc(c)}" style="padding:0 4px"><span class="name">${esc(c)}</span><span class="sub">${shortDate(d)}</span><span class="amt" style="min-width:120px">${fmt(a)} → ${fmt(b)}</span></div>`).join('')}
        ${ppl.length?`<h3 style="margin-top:16px">People</h3>${ppl.sort((a,b)=>b[1]-a[1]).map(([p,v])=>`<div class="row click" data-act="searchFor" data-q="${p}" style="padding:0 4px"><span class="name">${p}</span><span class="amt">${fmt(v,false)}</span></div>`).join('')}`:''}
      </div>
    </div></div>`;
}
export function wireCharts(){
  const c1 = document.getElementById('c1'); if (!c1) return;
  lineChart(c1, document.getElementById('t1'), [
    {name:String(CH.y), color:'var(--accent)', v:CH.cur}, {name:String(CH.py), color:'var(--prev)', v:CH.prev}], MON);
  barChart(document.getElementById('c2'), document.getElementById('t2'), CH.series, k => { UI.q = `"${UI.trendCat}" ${k}`; go('ledger'); });
}
/* ---------- Knauf ---------- */
export function vKnauf(){
  const ks = knaufSummary();
  const sorted = a => [...a].sort((x,y)=>y.d.localeCompare(x.d));
  const selTotal = [...UI.kSel].reduce((s,id)=>s+(txById(id)?.a||0),0);
  const krow = t => `<div class="row click ${UI.sel===t.id?'sel':''}" data-tx="${t.id}">
      <button class="chk ${UI.kSel.has(t.id)?'on':''}" data-act="kSel" data-id="${t.id}"></button>
      <span class="name">${esc(label(t))}</span><span class="sub">${shortDate(t.d)}</span>${amtCell(t)}</div>`;
  const reimb = sorted(ks.reimbursed); const ry = {};
  reimb.forEach(t => { const yy = t.d.slice(0,4); ry[yy]=(ry[yy]||0)+t.a; });
  const selKind = [...UI.kSel].map(id=>txById(id)?.k);
  const action = !UI.kSel.size ? '' : selKind.every(k=>k==='open')
    ? `<button class="btn pri" data-act="kSubmit">Submit ${money(selTotal)}</button>`
    : selKind.every(k=>k==='submitted') ? `<button class="btn pri" data-act="kReimburse">Reimbursed ${money(selTotal)}</button>`
    : `<button class="btn" data-act="kReopen">Reopen</button>`;
  return `<div class="page"><div class="top"><h1>Knauf</h1><span class="sp"></span>${action}
      <button class="btn" data-act="new" data-k="1">${ic('plus')}New</button></div>
    <div class="hero"><div class="big">${money(ks.outstanding)}</div><div class="cap">owed</div></div>
    <div class="sec"><h2><span>Open</span><span class="t">${money(ks.openTotal)}</span><span class="sp"></span>${ks.open.length?`<button class="btn ghost" data-act="kAll" data-k="open">Select all</button><button class="btn ghost" data-act="kCopy">${ic('copy')}Copy</button>`:''}</h2>${sorted(ks.open).map(krow).join('') || '<div class="row muted"><span class="name">None</span></div>'}</div>
    <div class="sec"><h2><span>Submitted</span><span class="t">${money(ks.submittedTotal)}</span><span class="sp"></span>${ks.submitted.length?`<button class="btn ghost" data-act="kAll" data-k="submitted">Select all</button>`:''}</h2>${sorted(ks.submitted).map(krow).join('') || '<div class="row muted"><span class="name">None</span></div>'}</div>
    <div class="sec"><h2 class="click" data-act="kShowR" style="cursor:pointer"><span>Reimbursed</span><span class="t">${Object.entries(ry).sort().reverse().map(([yy,v])=>`${yy} ${money(v,false)}`).join(' · ')}</span><span class="sp"></span>${ic('chev','chev')}</h2>
      ${UI.showReimbursed ? reimb.map(krow).join('') : ''}</div></div>`;
}

/* ---------- Projects ---------- */
export function vProjects(){
  const y = UI.projYear;
  const years = [...new Set([...S.projects.map(p=>p.year), +TODAY.slice(0,4)])].sort();
  const list = S.projects.filter(p=>p.year===y);
  const total = list.reduce((s,p)=>s+projectTotal(p),0);
  return `<div class="page"><div class="top"><h1>Projects</h1>
      <div class="seg">${years.map(v=>`<button class="${v===y?'on':''}" data-act="projYear" data-y="${v}">${v}</button>`).join('')}</div><span class="sp"></span></div>
    <div class="hero"><div class="big">${money(total,false)}</div><div class="cap">${y}</div></div>
    ${list.map(p => `<div class="row click ${UI.sel==='P'+p.id?'sel':''}" data-proj="${p.id}"><span class="name">${esc(p.name)}</span><span class="sub">${esc(p.when||'')}</span><span class="amt">${fmt(projectTotal(p))}</span></div>`).join('')}
    <form class="inl" data-form="proj"><input name="name" placeholder="New project" autocomplete="off"><input class="n" name="a" placeholder="0.00" inputmode="decimal"></form></div>`;
}

/* ---------- Settings ---------- */
export function vSettings(){
  return `<div class="page"><div class="top"><h1>Settings</h1></div>
    ${GROUPS.map(g => `<div class="sec"><h2>${g.name}</h2>${S.cats.filter(c=>c.group===g.id).map(c=>`<div class="row"><input class="name" value="${esc(c.name)}" data-act="catRename" data-from="${esc(c.name)}"><select class="sel" data-act="catMove" data-c="${esc(c.name)}">${GROUPS.map(x=>`<option value="${x.id}" ${x.id===g.id?'selected':''}>${x.name}</option>`).join('')}</select></div>`).join('')}
      <form class="inl" data-form="cat" data-g="${g.id}"><input name="name" placeholder="New category" autocomplete="off"></form></div>`).join('')}
    <div class="sec"><h2>Rules</h2>${S.rules.map(r=>`<div class="row"><span class="name">${esc(r.m)}</span><span class="sub">${r.x?'Excluded':r.k?'Knauf':esc(r.c)}</span><button class="icon" data-act="ruleDel" data-m="${esc(r.m)}">${ic('close')}</button></div>`).join('')}</div>
    <div class="sec"><h2>Accounts</h2>${S.accounts.map(a=>`<div class="row"><input class="name" value="${esc(a.name)}" data-act="acctRename" data-id="${a.id}"></div>`).join('')}</div>
    <div class="sec"><h2>Data</h2><div class="row"><span class="name">Reset to spreadsheet</span><button class="btn" data-act="reset">Reset</button></div></div>
  </div>`;
}
