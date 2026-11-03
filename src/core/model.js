// Reads (selectors), suggestions, and the one write path: run(command, args).
// No DOM here — this file runs in the browser and in `node --test`.

import { GROUPS, MON, MONL, TODAY, addYm, dObj, mkey, norm, shortDate, ym } from './format.js';
import { S, acctName, catGroup, save, seed, setState, txById } from './store.js';

/* ============================================================
   SELECTORS — pure reads used by views and agents alike
   ============================================================ */
/** Does a transaction count toward household totals? */
export const counts = t => !t.inbox && !t.x && !t.k && !t.proj && !!(t.c || t.split);
/** Category parts of a transaction (expands splits). */
export const parts = t => t.split ? t.split.map(s => ({c:s.c, a:s.a})) : [{c:t.c, a:t.a}];

export let _agg = null;
export function agg(){
  if (_agg) return _agg;
  const G = catGroup(), byM = {};
  for (const t of S.txns){
    if (!counts(t)) continue;
    const k = ym(t.d);
    const m = byM[k] || (byM[k] = {income:0,savings:0,fixed:0,variable:0,cats:{}});
    for (const p of parts(t)){
      const g = G[p.c]; if (!g) continue;
      m[g] += p.a; m.cats[p.c] = (m.cats[p.c]||0) + p.a;
    }
  }
  for (const k in byM){ const m=byM[k]; m.left = m.income - m.savings - m.fixed - m.variable; }
  return (_agg = byM);
}
export const month = k => agg()[k] || {income:0,savings:0,fixed:0,variable:0,cats:{},left:0};
/** Trailing 6-month average for a category or group, excluding month k. */
export function typical(k, key, isGroup){
  let s=0, n=0;
  for (let i=1;i<=6;i++){ const m = agg()[addYm(k,-i)]; if (!m) continue; s += isGroup ? m[key] : (m.cats[key]||0); n++; }
  return n ? s/n : 0;
}
export function knaufSummary(){
  const out = {open:[], submitted:[], reimbursed:[], deposits:[]};
  for (const t of S.txns){ if (!t.k) continue; (out[t.k==='deposit'?'deposits':t.k] || []).push(t); }
  const sum = a => a.reduce((s,t)=>s+t.a,0);
  out.outstanding = sum(out.open) + sum(out.submitted);
  out.openTotal = sum(out.open); out.submittedTotal = sum(out.submitted);
  return out;
}
export const returnsOf = id => S.txns.filter(t => t.ret === id);
export const netOf = t => t.a + returnsOf(t.id).reduce((s,r)=>s+r.a,0);
export const projectTotal = p => p.a + S.txns.filter(t=>t.proj===p.id).reduce((s,t)=>s+t.a,0);
export const inbox = () => S.txns.filter(t => t.inbox).sort((a,b)=> b.d.localeCompare(a.d) || a.id-b.id);

/* ---------- the smart part: suggestions ---------- */
export function knaufMerchants(){
  const set = new Set();
  for (const t of S.txns) if (t.k && t.k!=='deposit' && t.m) set.add(norm(t.m).split(' ')[0]);
  ['apple','amazon','cash','tipjar'].forEach(x=>set.delete(x)); // too ambiguous to auto-flag
  return set;
}
export function subsetMatch(items, target){
  // exact-cents subset sum, preferring fewer items; items <= ~40
  const T = Math.round(target*100); const reach = new Map([[0,[]]]);
  for (const it of items){
    const c = Math.round(it.a*100);
    for (const [s,ids] of [...reach]){ const n = s + c; if (n<=T && !reach.has(n)) reach.set(n, [...ids, it.id]); }
    if (reach.has(T)) return reach.get(T);
  }
  return reach.get(T) || null;
}
export function suggest(t){
  const n = norm(t.raw || t.m);
  const G = catGroup();
  // 1. Knauf reimbursement deposit
  if (/knauf/.test(n) && t.a < 0){
    const ks = knaufSummary();
    const ids = subsetMatch(ks.submitted, -t.a) || subsetMatch([...ks.submitted, ...ks.open], -t.a);
    return {type:'reimb', ids: ids || [], label: ids ? `Reimburses ${ids.length}` : 'Knauf deposit'};
  }
  // 2. Return to the same merchant
  if (t.a < 0 && t.m){
    const first = n.split(' ')[0];
    const cands = S.txns.filter(o => o.id!==t.id && o.a>0 && o.m && norm(o.m).split(' ')[0]===first && o.d<=t.d
      && (dObj(t.d)-dObj(o.d))/864e5 <= 120 && netOf(o) >= -t.a - 0.005)
      .sort((a,b)=> Math.abs(a.a + t.a) - Math.abs(b.a + t.a) || b.d.localeCompare(a.d));
    if (cands[0]) return {type:'return', of:cands[0].id, c:cands[0].c, label:`Return · ${shortDate(cands[0].d)}`};
  }
  // 3. Learned rules
  const rule = S.rules.filter(r => n.startsWith(r.m) || n.includes(r.m)).sort((a,b)=>b.m.length-a.m.length)[0];
  if (rule){
    if (rule.x) return {type:'transfer', label:'Transfer'};
    if (rule.k) return {type:'knauf', label:'Knauf'};
    if (rule.c && G[rule.c]) return {type:'cat', c:rule.c, label:rule.c};
  }
  if (/payment|thank you|autopay|transfer/.test(n)) return {type:'transfer', label:'Transfer'};
  // 4. Knauf by merchant history (hotels, airlines, rideshare from the Knauf sheet)
  if (t.a > 0 && knaufMerchants().has(n.split(' ')[0])) return {type:'knauf', label:'Knauf'};
  // 5. Merchant history
  const hist = {};
  for (const o of S.txns) if (o.c && o.m && norm(o.m).split(' ')[0]===n.split(' ')[0] && !o.inbox) hist[o.c]=(hist[o.c]||0)+1;
  const top = Object.entries(hist).sort((a,b)=>b[1]-a[1]);
  if (top[0]) return {type:'cat', c:top[0][0], label:top[0][0]};
  return {type:'none', label:'Categorize'};
}

/* ============================================================
   COMMANDS — the single write path (UI, keyboard, palette, agents)
   ============================================================ */
export const undoStack = [];
export const COMMANDS = {
  'tx.accept':     {title:'Accept suggestion', key:'Enter', run:({id}) => accept(id)},
  'tx.acceptAll':  {title:'Accept all suggestions', run:() => { let n=0; for (const t of inbox()) { const s=suggest(t); if (s.type!=='none'){ accept(t.id); n++; } } return n; }},
  'tx.setCategory':{title:'Set category', key:'C', run:({id, c, learn=true}) => {
      const t = txById(id); const G = catGroup();
      if (t.inbox) settleSign(t, c);
      t.c = c; delete t.split; delete t.k; delete t.x; delete t.inbox;
      if (learn && t.m && t.src==='bank') learnRule(t.raw||t.m, {c});
  }},
  'tx.setKnauf':   {title:'Toggle Knauf', key:'K', run:({id, on}) => {
      const t = txById(id); on = on ?? !(t.k && t.k!=='deposit');
      if (on){ t.k='open'; delete t.inbox; delete t.c; delete t.split; if (t.m && t.src==='bank') learnRule(t.raw||t.m,{k:1}); }
      else { delete t.k; }
  }},
  'tx.setExcluded':{title:'Toggle excluded from totals', key:'X', run:({id, on}) => {
      const t = txById(id); on = on ?? !t.x; t.x = on ? 1 : 0; if (!on) delete t.x; else delete t.inbox;
      if (on && t.m && t.src==='bank') learnRule(t.raw||t.m,{x:1});
  }},
  'tx.linkReturn': {title:'Link return to purchase', key:'R', run:({id, of}) => {
      const t = txById(id), o = txById(of); t.ret = of; t.c = o.c; t.a = -Math.abs(t.a); delete t.inbox; delete t.k;
      if (o.k) t.k = o.k;
  }},
  'tx.unlinkReturn':{title:'Unlink return', run:({id}) => { delete txById(id).ret; }},
  'tx.split':      {title:'Split transaction', key:'S', run:({id, parts}) => {
      const t = txById(id); if (!parts || parts.length<2){ delete t.split; return; }
      t.split = parts.map(p=>({c:p.c, a:+(+p.a).toFixed(2)})); delete t.c; delete t.inbox; delete t.k;
  }},
  'tx.update':     {title:'Edit transaction', run:({id, ...f}) => { const t = txById(id); for (const k in f){ if (f[k]===''||f[k]==null) delete t[k]; else t[k]=f[k]; } }},
  'tx.setProject': {title:'Move to project', key:'P', run:({id, proj}) => { const t = txById(id); if (proj) { t.proj=proj; delete t.inbox; } else delete t.proj; }},
  'tx.create':     {title:'New transaction', key:'N', run:(f) => { const t = {id:S.nextId++, d:TODAY, a:0, src:'manual', ...f}; S.txns.push(t); return t.id; }},
  'tx.delete':     {title:'Delete transaction', run:({id}) => { S.txns = S.txns.filter(t=>t.id!==id); S.txns.forEach(t=>{ if (t.ret===id) delete t.ret; }); }},
  'knauf.submit':  {title:'Mark Knauf items submitted', run:({ids}) => { for (const id of ids){ const t=txById(id); t.k='submitted'; t.ks=TODAY; } }},
  'knauf.reimburse':{title:'Mark Knauf items reimbursed', run:({ids, deposit}) => {
      for (const id of ids){ const t=txById(id); t.k='reimbursed'; t.kr = deposit || TODAY; }
      if (deposit){ const d = txById(deposit); d.k='deposit'; d.kids = ids; delete d.inbox; }
  }},
  'knauf.reopen':  {title:'Move Knauf item back to open', run:({ids}) => { for (const id of ids){ const t=txById(id); t.k='open'; delete t.ks; delete t.kr; } }},
  'project.create':{title:'New project', run:({name, year, a=0, when=''}) => { const p={id:'p'+Date.now().toString(36), name, year, a:+a, when}; S.projects.push(p); return p.id; }},
  'project.update':{title:'Edit project', run:({id, ...f}) => Object.assign(S.projects.find(p=>p.id===id), f)},
  'project.delete':{title:'Delete project', run:({id}) => { S.projects = S.projects.filter(p=>p.id!==id); S.txns.forEach(t=>{ if (t.proj===id) delete t.proj; }); }},
  'cat.create':    {title:'New category', run:({name, group}) => { S.cats.push({name, group}); }},
  'cat.rename':    {title:'Rename category', run:({from, to}) => {
      const c = S.cats.find(c=>c.name===from); c.name = to;
      for (const t of S.txns){ if (t.c===from) t.c=to; if (t.split) t.split.forEach(s=>{ if (s.c===from) s.c=to; }); }
      S.rules.forEach(r=>{ if (r.c===from) r.c=to; });
  }},
  'cat.move':      {title:'Move category to group', run:({name, group}) => { S.cats.find(c=>c.name===name).group = group; }},
  'rule.delete':   {title:'Delete rule', run:({m}) => { S.rules = S.rules.filter(r=>r.m!==m); }},
  'account.rename':{title:'Rename account', run:({id, name}) => { S.accounts.find(a=>a.id===id).name = name; }},
  'data.reset':    {title:'Reset to sample data', run:() => { setState(seed()); }},
};
export function settleSign(t, c){
  // Bank feed: + is money out. Income categories store inflows as positive.
  const g = catGroup()[c];
  if (g==='income') t.a = Math.abs(t.a);
}
export function learnRule(m, r){
  const key = mkey(m);
  if (!key) return;
  S.rules = S.rules.filter(x => x.m !== key);
  S.rules.unshift({m:key, ...r});
}
export function accept(id){
  const t = txById(id), s = suggest(t);
  if (s.type==='cat') run('tx.setCategory', {id, c:s.c, learn:false}, true);
  else if (s.type==='knauf') run('tx.setKnauf', {id, on:true}, true);
  else if (s.type==='transfer') run('tx.setExcluded', {id, on:true}, true);
  else if (s.type==='return') run('tx.linkReturn', {id, of:s.of}, true);
  else if (s.type==='reimb'){ if (s.ids.length) run('knauf.reimburse', {ids:s.ids, deposit:id}, true); else { t.k='deposit'; delete t.inbox; } }
  else return false;
  return true;
}
/** The one write path. nested=true skips undo/render (used inside other commands). */
export function run(name, args={}, nested=false){
  const cmd = COMMANDS[name]; if (!cmd) throw new Error('Unknown command '+name);
  if (!nested) undoStack.push(JSON.stringify(S)), undoStack.length > 40 && undoStack.shift();
  const out = cmd.run(args);
  _agg = null;
  if (!nested){ save(); emit(); }
  return out;
}
export function undo(){ const s = undoStack.pop(); if (!s) return false; setState(JSON.parse(s)); _agg=null; save(); emit(); return true; }
export const listeners = [];
export function onChange(fn){ listeners.push(fn); }
export function emit(){ for (const f of listeners) f(); }

/* ---------- queries shared by views and agents ---------- */
export function catLabel(t){
  if (t.k==='deposit') return 'Knauf reimbursement';
  if (t.k) return 'Knauf';
  if (t.x) return 'Excluded';
  if (t.proj){ const p = S.projects.find(p=>p.id===t.proj); return p ? p.name : ''; }
  if (t.split) return t.split.map(s=>s.c).join(' + ');
  return t.c || '';
}
export function pivot(year, gid){
  const G = catGroup(), rows = {};
  for (let i=1;i<=12;i++){
    const m = month(`${year}-${String(i).padStart(2,'0')}`);
    for (const [c,v] of Object.entries(m.cats)) if (G[c]===gid){ (rows[c] ||= Array(12).fill(0))[i-1] = v; }
  }
  return Object.entries(rows).sort((a,b)=>a[0].localeCompare(b[0]));
}
export function searchTx(q){
  const G = catGroup();
  let list = S.txns.filter(t => !t.inbox);
  const toks = q.toLowerCase().match(/"[^"]+"|\S+/g) || [];
  for (let tok of toks){
    tok = tok.replace(/"/g,'');
    let m;
    if (tok==='knauf') list = list.filter(t=>t.k);
    else if (tok==='returns') list = list.filter(t=>!t.k && (t.ret || returnsOf(t.id).length || (t.a<0 && t.c && G[t.c]!=='income')));
    else if (tok==='excluded') list = list.filter(t=>t.x);
    else if (tok==='split') list = list.filter(t=>t.split);
    else if (tok==='scheduled') list = list.filter(t=>t.s);
    else if ((m = tok.match(/^([<>])(\d+(?:\.\d+)?)$/))) list = list.filter(t => m[1]==='>' ? Math.abs(t.a)>+m[2] : Math.abs(t.a)<+m[2]);
    else if (/^\d{4}$/.test(tok)) list = list.filter(t=>t.d.startsWith(tok));
    else if (/^\d{4}-\d{2}$/.test(tok)) list = list.filter(t=>t.d.startsWith(tok));
    else if (MON.some(x=>x.toLowerCase()===tok.slice(0,3)) && tok.length>=3 && MONL.some(x=>x.toLowerCase().startsWith(tok))) { const i = MON.findIndex(x=>x.toLowerCase()===tok.slice(0,3)); list = list.filter(t=>+t.d.slice(5,7)===i+1); }
    else if (GROUPS.some(g=>g.id===tok)) list = list.filter(t => parts(t).some(p=>G[p.c]===tok) && !t.k);
    else list = list.filter(t => [t.m,t.n,t.c,t.p,catLabel(t),acctName(t.acct)].some(f => f && String(f).toLowerCase().includes(tok)));
  }
  return list.sort((a,b)=>b.d.localeCompare(a.d) || b.id-a.id);
}
