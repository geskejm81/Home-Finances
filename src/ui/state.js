// View state: what's selected, open, filtered. Never persisted.

import { TODAY, ym } from '../core/format.js';

export const VIEWS = [
  {id:'inbox', name:'Inbox', icon:'inbox', key:'i'},
  {id:'month', name:'Month', icon:'month', key:'m'},
  {id:'year', name:'Year', icon:'year', key:'y'},
  {id:'ledger', name:'Ledger', icon:'ledger', key:'l'},
  {id:'trends', name:'Trends', icon:'trends', key:'t'},
  {id:'knauf', name:'Knauf', icon:'knauf', key:'k'},
  {id:'projects', name:'Projects', icon:'projects', key:'p'},
];
export const UI = {
  view: 'inbox', sel: null, cursor: 0,
  month: ym(TODAY), open: {variable:true}, openCat: null,
  year: +TODAY.slice(0,4), yearGroup: 'summary',
  q: '', limit: 150,
  trendCat: 'Groceries',
  kSel: new Set(), showReimbursed: false,
  projYear: +TODAY.slice(0,4),
  splitDraft: null, more: false,
  mode: 'loading', email: '', sent: null, authError: null, saving: null, importDraft: null,
};
