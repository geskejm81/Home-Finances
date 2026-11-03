// The single state object. Replaced in place so every module keeps the same reference.

import { TODAY } from './format.js';
import { demoState } from './demo.js';

export const KEY = 'household.v1';
export const S = {};
export function setState(next){ for (const k of Object.keys(S)) delete S[k]; Object.assign(S, next); }
export function seed(){ return demoState(TODAY); }
export function load(){
  try { const s = JSON.parse(globalThis.localStorage?.getItem(KEY)); if (s && s.v===1) return s; } catch(e){}
  return null;
}
// Only sample data is kept in the browser; real data lives in the database.
export function save(){ if (!S.demo) return; try { globalThis.localStorage?.setItem(KEY, JSON.stringify(S)); } catch(e){} }

// lookups
export const catGroup = () => Object.fromEntries(S.cats.map(c => [c.name, c.group]));
export const txById = id => S.txns.find(t => t.id === id);
export const acctName = id => (S.accounts.find(a=>a.id===id)||{}).name || '';
export const label = t => t.m || t.n || t.c || 'Untitled';
