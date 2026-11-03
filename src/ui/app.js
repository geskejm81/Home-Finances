// Routing, rendering, the detail panel, popovers, and input handling.

import { GROUPS, TODAY, addYm, dObj, esc, fmt, money, norm, shortDate, ym } from '../core/format.js';
import { S, acctName, catGroup, label, load, seed, setState, txById } from '../core/store.js';
import { COMMANDS, inbox, knaufSummary, month, netOf, onChange, pivot, projectTotal, returnsOf, run, searchTx, suggest, typical, undo } from '../core/model.js';
import { UI, VIEWS } from './state.js';
import { auth, api } from '../data/supabase.js';
import { createSync } from '../data/sync.js';
import { workingLines } from '../core/budget.js';
import { connectBank, syncBanks } from '../data/bank.js';
import { listMembers, inviteMember, removeMember } from '../data/members.js';
import { ledgerBody, ledgerTotal, txRow, vGate, vInbox, vKnauf, vLedger, vMonth, vProjects, vSettings, vTrends, vYear, vBudget, wireCharts } from './views.js';
import { ic } from './icons.js';

export function go(view, opts={}){
  UI.view = view; Object.assign(UI, opts); UI.more=false; UI.cursor=0; UI.kSel.clear();
  try { if (location.hash !== '#'+view) history.replaceState(null,'','#'+view); } catch(e){}
  closePanel(false); render(); document.getElementById('main').scrollTop = 0;
}
window.addEventListener('hashchange', () => { if (/access_token=|error=/.test(location.hash)) { boot(); return; } const v = location.hash.slice(1); if (VIEWS.some(x=>x.id===v) || v==='settings') go(v); });

/* ============================================================
   RENDER
   ============================================================ */
/** Navigating from the sidebar, tabs, palette, or keys starts the Ledger with a clean search. */
export const nav = (id) => go(id, id==='ledger' ? {q:'', limit:150} : {});

export function render(){
  const gated = !['live','sample'].includes(UI.mode);
  document.body.classList.toggle('gated', gated);
  if (gated){ document.getElementById('main').innerHTML = vGate(); return; }
  if (UI.view==='settings' && UI.mode==='live' && UI.members==null && !UI.membersLoading) loadMembers();
  renderSide(); renderTabs();
  const main = document.getElementById('main');
  const keepSearch = UI.view==='ledger' && document.activeElement && document.activeElement.id==='q';
  const fn = {inbox:vInbox, month:vMonth, year:vYear, ledger:vLedger, trends:vTrends, budget:vBudget, knauf:vKnauf, projects:vProjects, settings:vSettings}[UI.view];
  if (keepSearch){ document.getElementById('ledgerBody').innerHTML = ledgerBody(); document.getElementById('qtot').innerHTML = ledgerTotal(); }
  else main.innerHTML = fn();
  if (UI.view==='trends') wireCharts();
  if (UI.sel) renderPanel();
}
export function renderSide(){
  const n = inbox().length, ks = knaufSummary();
  document.getElementById('side').innerHTML = `
    <div class="brand"><i></i>Household</div>
    <button class="cmdk" data-act="palette">${ic('search')}Search<kbd>⌘K</kbd></button>
    ${VIEWS.map(v => `<button class="nav ${UI.view===v.id?'on':''}" data-go="${v.id}">${ic(v.icon)}${v.name}${
      v.id==='inbox' && n ? `<span class="ct hot">${n}</span>` :
      v.id==='knauf' && ks.outstanding>0 ? `<span class="ct">${money(ks.outstanding,false)}</span>` : ''}</button>`).join('')}
    <div class="grow"></div>
    <button class="nav ${UI.view==='settings'?'on':''}" data-go="settings">${ic('settings')}Settings</button>`;
}
export function renderTabs(){
  const n = inbox().length;
  const tab = (id, icon, name, badge) => `<button class="${UI.view===id?'on':''}" data-go="${id}">${ic(icon)}${name}${badge?`<span class="badge">${badge}</span>`:''}</button>`;
  const inMore = ['year','trends','budget','projects','settings'].includes(UI.view);
  document.getElementById('tabs').innerHTML = tab('inbox','inbox','Inbox',n) + tab('month','month','Month') + tab('ledger','ledger','Ledger') + tab('knauf','knauf','Knauf') +
    `<button class="${inMore||UI.more?'on':''}" data-act="more">${ic('more')}More</button>`;
  document.getElementById('more').className = 'more' + (UI.more?' on':'');
  document.getElementById('more').innerHTML = ['year','trends','budget','projects'].map(id => { const v=VIEWS.find(x=>x.id===id); return `<button class="nav" data-go="${id}">${ic(v.icon)}${v.name}</button>`; }).join('') +
    `<button class="nav" data-go="settings">${ic('settings')}Settings</button>`;
}

/* ============================================================
   DETAIL PANEL
   ============================================================ */
export function showPanel(on){ document.getElementById('panel').classList.toggle('on', on); document.body.classList.toggle('panel-open', on); }
export function openTx(id){ UI.sel = id; UI.splitDraft = null; render(); showPanel(true); }
export function closePanel(rr=true){ UI.sel=null; UI.splitDraft=null; showPanel(false); if (rr) render(); }
export function renderPanel(){
  const p = document.getElementById('panel');
  if (typeof UI.sel==='string' && UI.sel.startsWith('P')) return renderProjectPanel(p, UI.sel.slice(1));
  const t = txById(UI.sel); if (!t){ closePanel(); return; }
  const G = catGroup(), s = t.inbox ? suggest(t) : null;
  const isIn = G[t.c]==='income' || t.a<0;
  const rets = returnsOf(t.id), orig = t.ret ? txById(t.ret) : null;
  const proj = t.proj ? S.projects.find(p=>p.id===t.proj) : null;
  const hasM = 'm' in t || t.src!=='sheet';
  const v = (act, inner, ro) => `<div class="v ${ro?'ro':''}" ${act?`data-act="${act}"`:''}>${inner}</div>`;
  let callout = '';
  if (s && s.type==='return') callout = `<div class="callout">${ic('ret')}<span class="sp">${esc(label(txById(s.of)))} · ${shortDate(txById(s.of).d)} · ${fmt(txById(s.of).a)}</span><button class="btn pri" data-act="accept" data-id="${t.id}">Link</button></div>`;
  else if (s && s.type==='reimb' && s.ids.length) callout = `<div class="callout">${ic('knauf')}<span class="sp">${s.ids.length} Knauf items · ${money(s.ids.reduce((a,id)=>a+txById(id).a,0))}</span><button class="btn pri" data-act="accept" data-id="${t.id}">Match</button></div>`;
  else if (s && s.type!=='none') callout = `<div class="callout">${ic('spark')}<span class="sp">${esc(s.label)}</span><button class="btn pri" data-act="accept" data-id="${t.id}">Accept</button></div>`;
  const sd = UI.splitDraft;
  const splitUI = sd ? `<div class="split">${sd.map((r,i)=>`<div class="sr"><div class="v" data-act="pickSplitCat" data-i="${i}">${r.c?esc(r.c):'<span class="ph2">Category</span>'}</div><input value="${r.a}" data-act="splitAmt" data-i="${i}" inputmode="decimal"></div>`).join('')}
      <div class="sr"><button class="btn ghost" data-act="splitAdd">${ic('plus')}Add</button><span class="sp" style="flex:1"></span><span style="color:${Math.abs(sd.reduce((a,r)=>a+(+r.a||0),0)-t.a)<0.005?'var(--text2)':'var(--neg)'}">${fmt(sd.reduce((a,r)=>a+(+r.a||0),0))} / ${fmt(t.a)}</span></div>
      <div class="acts"><button class="btn pri" data-act="splitSave">Save split</button><button class="btn ghost" data-act="splitCancel">Cancel</button></div></div>` : '';
  p.innerHTML = `<div class="ph"><span class="sp"></span>
      <button class="icon" data-act="del" title="Delete">${ic('trash')}</button><button class="icon" data-act="close">${ic('close')}</button></div>
    <div class="pb">
      <input class="m" value="${esc(hasM ? t.m : t.n||'')}" placeholder="${esc(label(t))}" data-act="edit" data-f="${hasM?'m':'n'}">
      <div class="a ${isIn?'in':''}" style="display:flex">${isIn?'<span>+</span>':''}<input value="${Math.abs(t.a).toFixed(2)}" data-act="editAmt" inputmode="decimal" style="width:100%;font-size:inherit;font-weight:inherit;letter-spacing:inherit;color:inherit"></div>
      <div class="props">
        <label>Date</label>${v('', `<input type="date" value="${t.d}" data-act="editDate">`)}
        ${t.acct?`<label>Account</label>${v('', esc(acctName(t.acct)), true)}`:''}
        ${t.raw && t.raw!==t.m?`<label>Bank text</label>${v('', `<span style="color:var(--text2)">${esc(t.raw)}</span>`, true)}`:''}
        <label>Category</label>${v('pickCat', t.k? (t.k==='deposit'?'Knauf reimbursement':'Knauf · '+t.k) : t.x ? 'Excluded' : t.split ? t.split.map(x=>esc(x.c)).join(' + ') : t.c ? esc(t.c) : '<span class="ph2">None</span>')}
        <label>Person</label>${v('pickPerson', t.p ? esc(t.p) : '<span class="ph2">—</span>')}
        <label>Project</label>${v('pickProject', proj ? esc(proj.name) : '<span class="ph2">—</span>')}
        ${hasM ? `<label>Note</label>${v('', `<input value="${esc(t.n||'')}" data-act="edit" data-f="n">`)}` : ''}
      </div>
      ${callout}${splitUI}
      ${!sd ? `<div class="acts">
        <button class="btn" data-act="knauf">${ic('knauf')}${t.k && t.k!=='deposit' ? 'Not Knauf' : 'Knauf'}<kbd>K</kbd></button>
        <button class="btn" data-act="exclude">${t.x?'Include':'Exclude'}<kbd>X</kbd></button>
        ${t.a>0 && !t.k ? `<button class="btn" data-act="split">${ic('split')}Split<kbd>S</kbd></button>`:''}
        ${t.a<0 && !t.ret && G[t.c]!=='income' && !t.k ? `<button class="btn" data-act="pickReturn">${ic('ret')}Return of…<kbd>R</kbd></button>`:''}
        ${t.ret ? `<button class="btn" data-act="unlink">Unlink return</button>`:''}
      </div>` : ''}
      ${orig ? `<div class="linked"><div class="day">Return of</div>${txRow(orig)}</div>` : ''}
      ${rets.length ? `<div class="linked"><div class="day">Returns<span class="sp"></span><span class="t">net ${fmt(netOf(t))}</span></div>${rets.map(r=>txRow(r)).join('')}</div>` : ''}
      ${t.k==='deposit' && t.kids ? `<div class="linked"><div class="day">Reimbursed</div>${t.kids.map(id=>txById(id)).filter(Boolean).map(r=>txRow(r)).join('')}</div>` : ''}
    </div>`;
}
export function renderProjectPanel(p, id){
  const pr = S.projects.find(x=>x.id===id); if (!pr){ closePanel(); return; }
  const tx = S.txns.filter(t=>t.proj===id).sort((a,b)=>b.d.localeCompare(a.d));
  p.innerHTML = `<div class="ph"><span class="sp"></span><button class="icon" data-act="projDel">${ic('trash')}</button><button class="icon" data-act="close">${ic('close')}</button></div>
    <div class="pb"><input class="m" value="${esc(pr.name)}" data-act="projEdit" data-f="name">
      <div class="a">${money(projectTotal(pr))}</div>
      <div class="props">
        <label>When</label><div class="v"><input value="${esc(pr.when||'')}" data-act="projEdit" data-f="when"></div>
        <label>Year</label><div class="v"><input value="${pr.year}" data-act="projEdit" data-f="year" inputmode="numeric"></div>
        <label>Logged</label><div class="v"><input value="${pr.a}" data-act="projEdit" data-f="a" inputmode="decimal"></div>
        ${pr.detail?`<label>Note</label><div class="v ro" style="padding:6px 8px;line-height:1.4">${esc(pr.detail)}</div>`:''}
      </div>
      ${tx.length?`<div class="linked"><div class="day">Transactions</div>${tx.map(t=>txRow(t)).join('')}</div>`:''}
    </div>`;
}

/* ============================================================
   POPOVERS: picker + command palette
   ============================================================ */
export let POP = null;
export function picker(anchor, items, onPick, {groups=true, placeholder='', palette=false}={}){
  const wrap = document.getElementById('popwrap'), scrim = document.getElementById('scrim');
  scrim.className = 'scrim on' + (palette?' dim':'');
  const el = document.createElement('div'); el.className = 'pop' + (palette?' pal':'');
  el.innerHTML = `<input placeholder="${placeholder}" autocomplete="off"><div class="ls"></div>`;
  wrap.innerHTML=''; wrap.appendChild(el);
  if (!palette && anchor){ const r = anchor.getBoundingClientRect(); el.style.left = Math.min(r.left, innerWidth-310)+'px'; el.style.top = (r.bottom+300>innerHeight ? Math.max(8,r.top-384) : r.bottom+4)+'px'; }
  const input = el.querySelector('input'), ls = el.querySelector('.ls');
  let idx = 0, cur = [];
  const draw = () => {
    const q = input.value.toLowerCase().trim();
    cur = items.filter(it => !q || (it.label+' '+(it.hint||'')+' '+(it.group||'')).toLowerCase().includes(q)).slice(0, 80);
    idx = Math.min(idx, Math.max(0,cur.length-1));
    let lastG = null;
    ls.innerHTML = cur.map((it,i)=>{ const gh = groups && it.group!==lastG ? `<div class="gh">${esc(it.group||'')}</div>` : ''; lastG = it.group; return gh + `<div class="it ${i===idx?'on':''}" data-i="${i}">${it.icon?ic(it.icon):''}<span>${esc(it.label)}</span><span class="sp"></span><span class="g">${esc(it.hint||'')}</span></div>`; }).join('');
    ls.querySelector('.it.on')?.scrollIntoView({block:'nearest'});
  };
  input.addEventListener('input', () => { idx=0; draw(); });
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key==='ArrowDown'){ idx=Math.min(cur.length-1, idx+1); draw(); e.preventDefault(); }
    else if (e.key==='ArrowUp'){ idx=Math.max(0, idx-1); draw(); e.preventDefault(); }
    else if (e.key==='Enter'){ e.preventDefault(); if (cur[idx]){ const it=cur[idx]; closePop(); onPick(it); } }
    else if (e.key==='Escape'){ closePop(); e.stopPropagation(); }
  });
  ls.addEventListener('mousedown', e => { const it = e.target.closest('.it'); if (!it) return; e.preventDefault(); const x = cur[+it.dataset.i]; closePop(); onPick(x); });
  draw(); setTimeout(()=>input.focus(), 0);
  POP = el;
}
export function closePop(){ document.getElementById('popwrap').innerHTML=''; document.getElementById('scrim').className='scrim'; POP=null; }
export function catItems(t){
  const G = catGroup(); const out = [];
  if (t){ const s = suggest(t); if (s.type==='cat') out.push({label:s.c, group:'Suggested', value:s.c}); }
  // recent for this merchant
  for (const g of GROUPS) for (const c of S.cats.filter(c=>c.group===g.id)) out.push({label:c.name, group:g.name, value:c.name});
  out.push({label:'Knauf', group:'Other', value:'__knauf'}, {label:'Excluded', group:'Other', value:'__x'});
  return out;
}
export function pickCategory(anchor, id){
  const t = txById(id);
  picker(anchor, catItems(t), it => {
    if (it.value==='__knauf') run('tx.setKnauf', {id, on:true});
    else if (it.value==='__x') run('tx.setExcluded', {id, on:true});
    else { run('tx.setCategory', {id, c:it.value}); if (t.src==='bank') toast(`${label(t)} → ${it.value} from now on`); }
    afterInboxAction(id);
  });
}
export function afterInboxAction(id){
  if (UI.view!=='inbox') return;
  const list = inbox(); if (!list.length){ closePanel(); return; }
  if (UI.sel===id) { const n = list[Math.min(UI.cursor, list.length-1)]; openTx(n.id); }
}
export function palette(){
  const items = [
    ...VIEWS.map(v=>({label:v.name, group:'Go to', icon:v.icon, hint:'G '+v.key.toUpperCase(), run:()=>nav(v.id)})),
    {label:'Settings', group:'Go to', icon:'settings', run:()=>go('settings')},
    {label:'New transaction', group:'Actions', icon:'plus', hint:'N', run:()=>newTx()},
    ...(UI.mode==='live' ? [{label:'Check banks', group:'Actions', icon:'inbox', run:()=>checkBanks(true)}] : []),
    {label:'Accept all suggestions', group:'Actions', icon:'check', run:()=>{ const n=run('tx.acceptAll'); toast(`${n} accepted`); }},
    {label:'Undo', group:'Actions', hint:'⌘Z', run:doUndo},
    ...S.cats.map(c=>({label:c.name, group:'Categories', hint:GROUPS.find(g=>g.id===c.group).name, run:()=>{ UI.q=`"${c.name}"`; go('ledger'); }})),
    ...S.people.map(p=>({label:p, group:'People', run:()=>{ UI.q=p; go('ledger'); }})),
    ...S.projects.slice().reverse().map(p=>({label:p.name, group:'Projects', hint:String(p.year), run:()=>{ go('projects',{projYear:p.year}); UI.sel='P'+p.id; render(); showPanel(true); }})),
  ];
  picker(null, items, it => it.run(), {palette:true, placeholder:'Type a command or search'});
}
export function newTx(knauf){
  const id = run('tx.create', knauf ? {k:'open', m:'New expense'} : {m:'New transaction'});
  if (UI.view!=='ledger' && UI.view!=='knauf') go('ledger');
  openTx(id); setTimeout(()=>document.querySelector('#panel .m')?.focus(), 220);
}

/* ============================================================
   EVENTS (delegated)
   ============================================================ */
export let toastT;
export function doUndo(){ if (undo()) toast('Undone'); }
export function toast(msg, undoable=false){
  const el = document.getElementById('toast'); el.innerHTML = `<span>${esc(msg)}</span>${undoable?'<button data-act="undo">Undo</button>':''}`;
  el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(()=>el.classList.remove('on'), 3200);
}
document.addEventListener('click', e => {
  const goEl = e.target.closest('[data-go]');
  if (goEl){ nav(goEl.dataset.go); return; }
  const a = e.target.closest('[data-act]');
  const act = a?.dataset.act;
  if (act && ACT[act]){ if (a.tagName!=='INPUT' && a.tagName!=='SELECT') { e.stopPropagation(); ACT[act](a, e); return; } }
  if (e.target.closest('#scrim')){ closePop(); UI.more=false; renderTabs(); return; }
  const tx = e.target.closest('[data-tx]');
  if (tx && !e.target.closest('input')){ const id=+tx.dataset.tx; if (UI.view==='inbox') UI.cursor = inbox().findIndex(t=>t.id===id); openTx(id); return; }
  const pr = e.target.closest('[data-proj]');
  if (pr){ UI.sel='P'+pr.dataset.proj; render(); showPanel(true); return; }
  if (UI.more && !e.target.closest('#more')){ UI.more=false; renderTabs(); }
});
export const ACT = {
  palette: () => palette(),
  more: () => { UI.more=!UI.more; renderTabs(); },
  undo: () => doUndo(),
  close: () => closePanel(),
  accept: a => { const id=+a.dataset.id; const t=txById(id), s=suggest(t); run('tx.accept', {id}); toast(s.type==='reimb'?`${s.ids.length} Knauf items reimbursed`:`${label(t)} · ${s.label}`, true); afterInboxAction(id); },
  acceptAll: () => { const n = run('tx.acceptAll'); toast(`${n} accepted`, true); closePanel(false); render(); },
  pickCat: a => pickCategory(a, +(a.dataset.id || UI.sel)),
  pickPerson: a => picker(a, [{label:'—', value:''}, ...S.people.map(p=>({label:p, value:p}))], it => run('tx.update', {id:UI.sel, p:it.value}), {groups:false}),
  pickProject: a => picker(a, [{label:'—', value:'', group:''}, ...S.projects.slice().sort((x,y)=>y.year-x.year).map(p=>({label:p.name, hint:String(p.year), value:p.id, group:String(p.year)}))], it => { run('tx.setProject', {id:UI.sel, proj:it.value}); afterInboxAction(UI.sel); }),
  pickReturn: a => {
    const t = txById(UI.sel); const n = norm(t.m||t.n).split(' ')[0];
    const cands = S.txns.filter(o => o.a>0 && o.id!==t.id && o.d<=t.d && (dObj(t.d)-dObj(o.d))/864e5<=180).sort((x,y)=> (norm(y.m||y.n).split(' ')[0]===n) - (norm(x.m||x.n).split(' ')[0]===n) || y.d.localeCompare(x.d)).slice(0,200);
    picker(a, cands.map(o=>({label:label(o), hint:`${shortDate(o.d)} · ${fmt(o.a)}`, value:o.id, group: norm(o.m||o.n).split(' ')[0]===n ? 'Same merchant' : 'Recent'})), it => run('tx.linkReturn', {id:t.id, of:it.value}));
  },
  unlink: () => run('tx.unlinkReturn', {id:UI.sel}),
  knauf: () => { const id=UI.sel; run('tx.setKnauf', {id}); afterInboxAction(id); },
  exclude: () => { const id=UI.sel; run('tx.setExcluded', {id}); afterInboxAction(id); },
  del: () => { const t = txById(UI.sel); run('tx.delete', {id:UI.sel}); closePanel(); toast(`Deleted ${label(t)}`, true); },
  split: () => { const t = txById(UI.sel); UI.splitDraft = [{c:t.c||suggest(t).c||'', a:(t.a/2).toFixed(2)}, {c:'', a:(t.a - +(t.a/2).toFixed(2)).toFixed(2)}]; renderPanel(); },
  splitAdd: () => { UI.splitDraft.push({c:'', a:'0'}); renderPanel(); },
  splitCancel: () => { UI.splitDraft=null; renderPanel(); },
  pickSplitCat: a => picker(a, catItems().filter(x=>!x.value.startsWith('__')), it => { UI.splitDraft[+a.dataset.i].c = it.value; renderPanel(); }),
  splitSave: () => {
    const t = txById(UI.sel), d = UI.splitDraft.filter(r=>r.c && +r.a);
    const sum = d.reduce((s,r)=>s + +r.a, 0);
    if (Math.abs(sum - t.a) > 0.005 || d.length<2){ toast(`Parts must add to ${fmt(t.a)}`); return; }
    const id = t.id; UI.splitDraft=null; run('tx.split', {id, parts:d}); afterInboxAction(id);
  },
  month: a => { const d=+a.dataset.d; UI.month = d===0 ? ym(TODAY) : addYm(UI.month, d); UI.openCat=null; render(); },
  toggleGroup: a => { UI.open[a.dataset.g] = !UI.open[a.dataset.g]; render(); },
  toggleCat: a => { UI.openCat = UI.openCat===a.dataset.c ? null : a.dataset.c; render(); },
  yearGroup: a => { UI.yearGroup = a.dataset.g; render(); },
  cell: a => { UI.q = `"${a.dataset.c}" ${a.dataset.m}`; go('ledger'); },
  'more-rows': () => { UI.limit += 300; render(); },
  new: a => newTx(!!a.dataset.k),
  trendPick: a => { UI.trendCat = a.dataset.c; render(); document.getElementById('c2')?.scrollIntoView({behavior:'smooth', block:'center'}); },
  searchFor: a => { UI.q = a.dataset.q; go('ledger'); },
  kSel: a => { const id=+a.dataset.id; UI.kSel.has(id)?UI.kSel.delete(id):UI.kSel.add(id); render(); },
  kAll: a => { const ks = knaufSummary(); const ids = ks[a.dataset.k].map(t=>t.id); const all = ids.every(id=>UI.kSel.has(id)); UI.kSel.clear(); if (!all) ids.forEach(id=>UI.kSel.add(id)); render(); },
  kSubmit: () => { const ids=[...UI.kSel]; UI.kSel.clear(); run('knauf.submit', {ids}); toast(`${ids.length} submitted`, true); },
  kReimburse: () => { const ids=[...UI.kSel]; UI.kSel.clear(); run('knauf.reimburse', {ids}); toast(`${ids.length} reimbursed`, true); },
  kReopen: () => { const ids=[...UI.kSel]; UI.kSel.clear(); run('knauf.reopen', {ids}); },
  kShowR: () => { UI.showReimbursed = !UI.showReimbursed; render(); },
  kCopy: () => {
    const rows = knaufSummary().open.sort((a,b)=>a.d.localeCompare(b.d));
    const txt = 'Date\tMerchant\tAmount\n' + rows.map(t=>`${t.d}\t${label(t)}\t${t.a.toFixed(2)}`).join('\n') + `\n\tTotal\t${rows.reduce((s,t)=>s+t.a,0).toFixed(2)}`;
    (navigator.clipboard?.writeText(txt) || Promise.reject()).then(()=>toast(`${rows.length} items copied`), ()=>toast('Copy blocked here'));
  },
  projYear: a => { UI.projYear = +a.dataset.y; render(); },
  projDel: () => { const id = UI.sel.slice(1); run('project.delete', {id}); closePanel(); toast('Project deleted', true); },
  ruleDel: a => run('rule.delete', {m:a.dataset.m}),
  reset: () => { run('data.reset'); toast('Reset', true); },
  sample: () => { try { localStorage.setItem(SAMPLE_KEY, '1'); } catch(e){} setState(load() || seed()); UI.mode='sample'; go('inbox'); },
  leaveSample: () => { try { localStorage.removeItem(SAMPLE_KEY); } catch(e){} UI.mode='signin'; UI.sent=null; render(); },
  resend: () => { UI.sent=null; render(); },
  signOut: async () => { await auth.signOut(); try { localStorage.removeItem(SAMPLE_KEY); } catch(e){} location.hash=''; location.reload(); },
  connectBank: async () => {
    UI.bankBusy = true; render();
    try { const r = await connectBank(); if (r){ await reloadLive(); toast(bankSummary(r) || 'Connected'); } }
    catch(e){ toast(e.message); }
    finally { UI.bankBusy = false; render(); }
  },
  relinkBank: async a => { try { const r = await connectBank(a.dataset.id); if (r){ await reloadLive(); toast(bankSummary(r) || 'Reconnected'); } } catch(e){ toast(e.message); } },
  budgetYear: a => { UI.budgetYear = +a.dataset.y; UI.budgetReason=''; render(); },
  budgetLock: () => { const y = UI.budgetYear; run('budget.lock', {year:y, lines:workingLines(y), by:UI.email}); toast(`${y} budget locked`, true); },
  budgetRevise: () => { UI.budgetReason=''; run('budget.revise', {year:UI.budgetYear}); },
  budgetDiscard: () => { UI.budgetReason=''; run('budget.discard', {year:UI.budgetYear}); },
  budgetSaveRev: () => {
    const y = UI.budgetYear, reason = UI.budgetReason.trim(); if (!reason) return;
    try { run('budget.lock', {year:y, lines:workingLines(y), reason, by:UI.email}); UI.budgetReason=''; render(); toast(`Revision saved`, true); }
    catch(e){ toast(e.message); }
  },
  clearSearch: () => { UI.q=''; UI.limit=150; render(); document.getElementById('q')?.focus(); },
  memberRemove: async a => {
    const email = a.dataset.email;
    if (UI.confirmRemove !== email){ UI.confirmRemove = email; render(); return; }
    UI.confirmRemove = null;
    try { await removeMember(email); toast(`Removed ${email}`); } catch(e){ toast(e.message); }
    await loadMembers();
  },
  importCancel: () => { UI.importDraft=null; render(); },
  importApply: () => { const d = UI.importDraft; UI.importDraft=null; run('data.import', d); toast(`Imported ${d.txns.length.toLocaleString()} transactions`, true); },
  // the following fire from change events
};
document.addEventListener('change', e => {
  const a = e.target.closest('[data-act]'); if (!a) return;
  const v = e.target.value, act = a.dataset.act;
  if (act==='edit'){ run('tx.update', {id:UI.sel, [a.dataset.f]:v.trim()}); }
  else if (act==='editAmt'){ const t = txById(UI.sel); const n = Math.abs(parseFloat(v.replace(/[^0-9.\-]/g,''))); if (!isNaN(n)) run('tx.update', {id:UI.sel, a: t.a<0 ? -n : n}); }
  else if (act==='editDate'){ if (v) run('tx.update', {id:UI.sel, d:v}); }
  else if (act==='year'){ UI.year = +v; render(); }
  else if (act==='trendCat'){ UI.trendCat = v; render(); }
  else if (act==='catRename'){ if (v.trim() && v.trim()!==a.dataset.from) run('cat.rename', {from:a.dataset.from, to:v.trim()}); }
  else if (act==='catMove'){ run('cat.move', {name:a.dataset.c, group:v}); }
  else if (act==='acctRename'){ if (v.trim()) run('account.rename', {id:a.dataset.id, name:v.trim()}); }
  else if (act==='projEdit'){ const f=a.dataset.f; run('project.update', {id:UI.sel.slice(1), [f]: f==='a'||f==='year' ? +v || 0 : v}); }
  else if (act==='budgetSet'){ const n = parseFloat(v.replace(/[^0-9.]/g,'')); try { run('budget.set', {year:UI.budgetYear, c:a.dataset.c, a: isNaN(n) ? 0 : n}); } catch(err){ toast(err.message); render(); } }
  else if (act==='importFile'){
    const file = e.target.files?.[0]; if (!file) return;
    file.text().then(txt => {
      let d; try { d = JSON.parse(txt); } catch(err){ toast('Not a valid import file'); return; }
      if (d.kind!=='household-import' || !Array.isArray(d.txns) || !Array.isArray(d.cats)){ toast('Not a valid import file'); return; }
      UI.importDraft = d; render();
    });
  }
  else if (act==='splitAmt'){ UI.splitDraft[+a.dataset.i].a = v; renderPanel(); }
});
document.addEventListener('input', e => {
  if (e.target.id==='q'){ UI.q = e.target.value; UI.limit = 150; render(); document.getElementById('qclear')?.toggleAttribute('hidden', !UI.q); }
  if (e.target.dataset?.act==='budgetReason'){ UI.budgetReason = e.target.value; const b = document.querySelector('[data-act="budgetSaveRev"]'); if (b) b.disabled = !UI.budgetReason.trim(); }
});
document.addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target, kind = f.dataset.form;
  if (kind==='invite'){
    const email = f.email.value.trim(); if (!email) return;
    try { await inviteMember(email); f.email.value=''; toast(`Invited ${email}`); } catch(err){ toast(err.message); }
    await loadMembers(); return;
  }
  if (kind==='signin'){
    const email = f.email.value.trim(); if (!email) return;
    const b = f.querySelector('button'); b.disabled = true;
    try { await auth.sendLink(email, location.origin + location.pathname); UI.sent = email; UI.authError = null; }
    catch(err){ UI.authError = err.message; }
    render(); return;
  }
  if (kind==='proj'){ const name=f.name.value.trim(); if (!name) return; run('project.create', {name, year:UI.projYear, a: parseFloat(f.a.value)||0}); }
  if (kind==='cat'){ const name=f.name.value.trim(); if (!name) return; run('cat.create', {name, group:f.dataset.g}); }
});

/* keyboard */
export let gPending = false;
document.addEventListener('keydown', e => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
  if ((e.metaKey||e.ctrlKey) && e.key.toLowerCase()==='k'){ e.preventDefault(); POP?closePop():palette(); return; }
  if ((e.metaKey||e.ctrlKey) && e.key.toLowerCase()==='z' && !typing){ e.preventDefault(); doUndo(); return; }
  if (POP) return;
  if (e.key==='Escape'){ if (typing) document.activeElement.blur(); else if (UI.sel) closePanel(); return; }
  if (typing) { if (e.key==='Enter' && document.activeElement.closest('#panel')) document.activeElement.blur(); return; }
  if (e.metaKey||e.ctrlKey||e.altKey) return;
  const k = e.key.toLowerCase();
  if (gPending){ gPending=false; const v = VIEWS.find(v=>v.key===k); if (v){ nav(v.id); return; } }
  if (k==='g'){ gPending=true; setTimeout(()=>gPending=false, 800); return; }
  if (k==='/'){ e.preventDefault(); if (UI.view!=='ledger') go('ledger'); setTimeout(()=>document.getElementById('q')?.focus(),0); return; }
  if (k==='n'){ e.preventDefault(); newTx(UI.view==='knauf'); return; }
  // list navigation (Inbox)
  if (UI.view==='inbox'){
    const list = inbox(); if (!list.length) return;
    if (k==='j'||e.key==='ArrowDown'){ UI.cursor=Math.min(list.length-1, UI.cursor+1); if (UI.sel) openTx(list[UI.cursor].id); else render(); e.preventDefault(); return; }
    if (e.key==='ArrowUp'){ UI.cursor=Math.max(0, UI.cursor-1); if (UI.sel) openTx(list[UI.cursor].id); else render(); e.preventDefault(); return; }
    const t = UI.sel ? txById(UI.sel) : list[UI.cursor];
    if (!t) return;
    if (e.key==='Enter'){ e.preventDefault(); const s=suggest(t); if (s.type==='none') pickCategory(document.querySelector(`[data-tx="${t.id}"] .pill`), t.id); else { UI.sel=t.id; ACT.accept({dataset:{id:t.id}}); } return; }
    if (e.key===' '){ e.preventDefault(); openTx(t.id); return; }
  }
  if (UI.view==='inbox' && !UI.sel && 'ckxsrp'.includes(k)){ const t = inbox()[UI.cursor]; if (t) openTx(t.id); }
  const id = UI.sel; if (!id || typeof id!=='number') return;
  if (k==='c'){ e.preventDefault(); pickCategory(document.querySelector('#panel [data-act="pickCat"]'), id); }
  else if (k==='k'){ ACT.knauf(); }
  else if (k==='x'){ ACT.exclude(); }
  else if (k==='s' && txById(id).a>0){ ACT.split(); }
  else if (k==='r' && txById(id).a<0){ ACT.pickReturn(document.querySelector('#panel [data-act="pickReturn"]')); }
  else if (k==='p'){ ACT.pickProject(document.querySelector('#panel [data-act="pickProject"]')); }
});

/* boot */
const SAMPLE_KEY = 'household.sample';
const sync = createSync(api, { onStatus: (s, err) => {
  UI.saving = s;
  if (s==='error'){ toast("Couldn't save. Retrying…"); setTimeout(() => sync.push(() => S, 0), 15000); console.error(err); }
}});
window.addEventListener('beforeunload', e => { if (UI.saving==='saving') e.preventDefault(); });
onChange(() => { render(); if (UI.mode==='live') sync.push(() => S); });

async function loadMembers(){
  UI.membersLoading = true;
  try { UI.members = await listMembers(); } catch(e){ UI.members = []; console.error(e); }
  UI.membersLoading = false; if (UI.view==='settings') render();
}
const bankSummary = r => [r.added && `${r.added} new in Inbox`, r.matched && `${r.matched} matched`].filter(Boolean).join(' · ');
/** Reload from the database, keeping the current screen. Skipped while edits are still saving. */
async function reloadLive(){
  if (UI.saving==='saving') return;
  const state = await sync.load(); if (state){ setState(state); render(); }
}
/** Pull new bank transactions (server matches them to the spreadsheet first). */
async function checkBanks(announce=false){
  if (UI.mode!=='live' || !(S.banks||[]).length) { if (announce) toast('No banks connected'); return; }
  try {
    const r = await syncBanks();
    const relink = (r.banks||[]).filter(b => b.status!=='ok');
    if (r.added || r.matched || r.removed) await reloadLive();
    const msg = relink.length ? `Reconnect ${relink.map(b=>b.institution).join(', ')} in Settings` : bankSummary(r);
    if (msg || announce) toast(msg || 'Up to date');
  } catch(e){ if (announce) toast(e.message); console.error(e); }
}

async function boot(){
  const link = auth.fromUrl(location.hash);
  if (link && link!=='signed-in') UI.authError = link;
  if (link) history.replaceState(null, '', location.pathname + '#inbox');
  const v = location.hash.slice(1); if (VIEWS.some(x=>x.id===v) || v==='settings') UI.view = v;
  let sample = false; try { sample = localStorage.getItem(SAMPLE_KEY)==='1'; } catch(e){}
  if (auth.session){
    UI.mode = 'loading'; UI.email = auth.email; render();
    try {
      const state = await sync.load();
      if (state){ setState(state); UI.mode = 'live'; setTimeout(checkBanks, 0); } else UI.mode = 'nohousehold';
    } catch(e){ UI.mode = 'signin'; UI.authError = e.message; }
  } else if (sample){ setState(load() || seed()); UI.mode = 'sample'; }
  else UI.mode = 'signin';
  render();
}
boot();
window.addEventListener('resize', () => { if (UI.view==='trends') wireCharts(); });

/* Agent / console surface: same commands, same selectors. */
window.household = {
  get state(){ return S; },
  commands: Object.fromEntries(Object.entries(COMMANDS).map(([k,v])=>[k,v.title])),
  run, undo: doUndo, sync,
  query: { month, typical, knaufSummary, suggest, inbox, netOf, projectTotal, pivot, search: searchTx },
};
