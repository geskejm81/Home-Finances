// Which bank descriptions are Knauf money. Shared by the app and the Plaid function
// (supabase/functions/plaid/knauf-rules.js is a copy; a test keeps them identical).

// Expense reimbursements. Plaid has tagged these as both contractor and salary income,
// so match the description, not Plaid's category.
export const KNAUF_DEPOSIT = /knauf\s+insulation\s+direct[\s-]*pay/i;
// Payroll is ordinary income and must never be treated as a reimbursement.
export const KNAUF_PAYROLL = /knauf\s+insulation\s+payroll/i;

export const isKnaufDeposit = text => KNAUF_DEPOSIT.test(String(text || '')) && !KNAUF_PAYROLL.test(String(text || ''));

// Work-travel merchants: United and Marriott's brands. These only ever *suggest* Knauf —
// the family books on the same cards (several identical fares on one day), so you confirm each.
export const KNAUF_MERCHANTS = new RegExp([
  'united\\s+airlines', '^united\\s+\\d', 'united\\.com', '\\bua\\s+infl', '\\bua\\s+inflight',
  'marriott', 'residence\\s+inn', 'towneplace', 'courtyard', 'fairfield\\s+(inn|by)', 'springhill', '\\bac\\s+hotel',
  '\\baloft\\b', 'sheraton', 'westin', '\\bmoxy\\b', 'element\\s+(by|hotel)', 'four\\s+points', 'le\\s+meridien',
  'renaissance\\s+(hotel|by)', 'ritz[\\s-]*carlton', 'st\\.?\\s+regis', 'delta\\s+hotels', 'gaylord', 'autograph\\s+collection',
  'tribute\\s+portfolio', '\\bw\\s+hotels?\\b',
].join('|'), 'i');
export const isKnaufMerchant = (...texts) => texts.some(t => KNAUF_MERCHANTS.test(String(t || '')));

// Money moving between your own accounts, and credit-card payments: never spending.
export const OWN_TRANSFER = new Set(['LOAN_PAYMENTS_CREDIT_CARD_PAYMENT', 'TRANSFER_IN_ACCOUNT_TRANSFER', 'TRANSFER_OUT_ACCOUNT_TRANSFER']);
