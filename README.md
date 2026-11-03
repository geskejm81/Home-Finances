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
src/core/demo.js      invented sample household (no real data in this repo)
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
- **No real financial data in the repo.** The repo and site are public. Real data will come from the database after sign-in.

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
