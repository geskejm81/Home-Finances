# Household

Family budget app. Plain HTML, CSS, and JavaScript modules — no framework, no build step, no runtime dependencies.

Live: https://geskejm81.github.io/Home-Finances/

## Run it

```sh
npm start        # serves http://localhost:8080
npm test         # node --test
```

Pushing to `main` runs the tests, then publishes to GitHub Pages. A failing test blocks the deploy.

## Layout

```
index.html            shell: panels, tab bar, script tag
styles.css            all styles; light and dark from the same tokens
src/core/format.js    pure helpers: money, dates, merchant clean-up
src/core/store.js     the state object S, load/save
src/core/model.js     selectors, suggestions, commands, run(), undo()
src/core/budget.js    run rates, trends, suggested budgets, budget status colors
src/core/demo.js      invented sample household (no real data in this repo)
src/data/supabase.js  magic-link sign-in and REST calls (plain fetch)
src/data/sync.js      load on sign-in; save only changed rows
src/data/bank.js      Plaid Link (loaded on demand) and bank checks
supabase/functions/plaid/   server side: Plaid keys, bank tokens, sync, November matching
src/ui/state.js       view state (selection, filters)
src/ui/views.js       one function per screen, state → HTML
src/ui/app.js         routing, render, detail panel, palette, keyboard
src/ui/charts.js      SVG line and bar charts
tests/                node --test, core only
```

## Rules

- **One write path.** Every change is `run('command', args)`. The UI, keyboard, command palette, and agents all call the same commands. The list is `COMMANDS` in `model.js`.
- **Totals are computed, never stored.** Views read selectors such as `month()`, `pivot()`, and `knaufSummary()`.
- **`core/` never touches the DOM**, so it runs under `node --test`.
- **No real financial data in the repo.** The repo and site are public. Real data lives in Supabase and loads after sign-in.

## Database

Supabase project `Household` (`ctzndfvfehdgwppofiru`). Tables: `households`, `members`, `categories`, `accounts`, `rules`, `projects`, `transactions`.

- Row-level security on every table: a signed-in user sees only rows of households they belong to (`private.my_households()`).
- Joining: `rpc/join_household` adds the signed-in user to a household whose `invites` lists their email. To add someone, append their email to `households.invites`.
- The key in `src/data/supabase.js` is the publishable key. It is meant to be public; security comes from the policies above.
- Sync: `sync.load()` reads everything once; after each command, `sync.push()` diffs against what the database last confirmed and upserts or deletes only those rows.
- Import: Settings → Import takes a `household-import` JSON file and replaces all data.

## Budgets

- Budget tab: one budget per year, monthly amounts per category. Suggested amounts come from history (`suggestBudget` in `budget.js`); any cell can be overwritten.
- Lock makes revision 1. Changes after that go through Revise and need a reason; each save adds a new revision. The `budgets` table only allows inserts, so locked revisions can't be edited or deleted.
- Every screen uses the latest locked revision for that year. Without one, Month compares to typical spend (trailing 6 months) and labels the column "Typical".
- Colors: spending under 80% of budget is green, 80–100% yellow, over 100% red. Income, savings, and Left are the reverse (at or above budget green, 80–100% yellow, below 80% red).

## Banks

The `plaid` function (Supabase Edge Function, `supabase/functions/plaid`) holds the Plaid keys (secrets `PLAID_CLIENT_ID`, `PLAID_SECRET`) and the bank tokens (`plaid_tokens`, unreadable by app users).

- Settings → Accounts → Connect bank opens Plaid Link; the function exchanges the token, saves the accounts, and syncs.
- The app checks banks each time it opens (and from ⌘K → Check banks).
- Only posted transactions dated on or after `households.bank_start` (2026-11-01) are taken.
- Each one is first matched to an unconfirmed spreadsheet row: same amount to the cent, same direction, within 4 days (`match.js`, covered by tests). A match fills in the merchant and account; anything else goes to the Inbox.

Signed out, the app shows sign-in. "Look around" opens the sample household, which is stored only in the browser.

## Agents

In the browser console, `window.household` exposes `state`, `commands`, `run(name, args)`, `undo()`, and `query.*` (`month`, `pivot`, `search`, `suggest`, `knaufSummary`, …).

```js
household.run('tx.setCategory', { id: 412, c: 'Groceries' })
household.query.search('knauf >100')
```

## Data model

A transaction: `{ id, d, m, raw, a, c, n, p, acct, src, inbox, k, x, ret, split, proj, s }`

| field | meaning |
|---|---|
| `a` | amount; positive in the category's direction; a refund in a spending category is negative |
| `c` | category (its group lives on the category) |
| `k` | Knauf status: `open`, `submitted`, `reimbursed`, or `deposit` |
| `x` | excluded from totals (transfers, card payments) |
| `ret` | id of the purchase this refunds |
| `split` | `[{ c, a }]` parts that sum to `a` |
| `proj` | project id; kept out of monthly totals |
| `s` | scheduled (future-dated) |
| `inbox` | waiting for review |
