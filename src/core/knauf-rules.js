// Which bank descriptions are Knauf money. Shared by the app and the Plaid function
// (supabase/functions/plaid/knauf-rules.js is a copy; a test keeps them identical).

// Expense reimbursements. Plaid has tagged these as both contractor and salary income,
// so match the description, not Plaid's category.
export const KNAUF_DEPOSIT = /knauf\s+insulation\s+direct[\s-]*pay/i;
// Payroll is ordinary income and must never be treated as a reimbursement.
export const KNAUF_PAYROLL = /knauf\s+insulation\s+payroll/i;

export const isKnaufDeposit = text => KNAUF_DEPOSIT.test(String(text || '')) && !KNAUF_PAYROLL.test(String(text || ''));
