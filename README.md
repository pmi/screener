# Stocks Screener

A serverless, single-page-app suite for quality-at-a-discount investing. Three linked pages:

- **`stocks.html`** — per-ticker stock screener. Walks each ticker through universe filters, quality and valuation gates, momentum checks,
  red flags, a scenario-based IRR estimate, and a half-Kelly position size.
- **`sectors.html`** — 12-month flow timeline. Sankey-style ribbons per sector across the last 12 months, with sticky monthly-totals header
  and month-labels footer. Click any month → drills into `snapshot.html` anchored at that month with the 1M window pre-selected.
- **`snapshot.html`** — treemap snapshot of all 11 GICS sectors (SPDR ETFs) sized by net buying-pressure proxy over a 1M / 3M / 6M / 12M
  window. Cells show net flow, period-over-period delta, and the three top tickers in each sector.

All three pages share design tokens, typography, and components through `common.css`. The header on every page includes a cross-link to the
other views.

## Features

### Stock screener

- **Investment schools & threshold profiles** — switch between Standard, Conservative, Aggressive, Cyclical, Compounder to change how strict
  each gate is.
- **Staged analysis** — Setup → Inputs → Quality → Valuation → Momentum → Red Flags → Scenario → Summary → Portfolio.
- **Live scoring** — pass/fail/warn verdicts update as inputs change.
- **Scenario IRR** — bear/base/bull cases with an expected IRR and margin of safety.
- **Portfolio sizing** — half-Kelly position recommendation.

### Sector timeline (`sectors.html`)

- **Per-sector ribbons** across 12 months, green above center for up-months, red below for down-months, with smooth Bezier curves between
  months.
- **Sticky header + footer** — monthly totals (green/red per sign) at the top, month labels at the bottom; both stay pinned while the body
  scrolls.
- **Hover crosshair** — dashed vertical guide + per-sector colored value at the hovered month; the active month's total and label go bold.
- **Click to drill** — click any month to open `snapshot.html` anchored at that month.

### Sector snapshot (`snapshot.html`)

- **Squarified treemap** — every pixel of the grid is used; cell size proportional to absolute net flow.
- **Window selector** — 1M / 3M / 6M / 12M, with the previous same-length period as the baseline for the delta.
- **Net-flow color** — green for net inflow, red for net outflow.
- **Anchor month** — visit `snapshot.html?month=YYYY-MM&window=1` (or click through from the timeline) to view a historical month. Status
  strip shows `Viewing 1M ending …` with a "Reset to now" link.

### Across the suite

- **Light & dark themes** — same toggle on every page; state shared via `localStorage`.
- **Cached fetches** — 90-day localStorage cache per ticker/ETF; the Alpha Vantage key is shared across pages.
- **No backend** — opens directly from the filesystem (`file://`). Nothing leaves the browser except the AV requests.

## Usage

1. Get a free [Alpha Vantage API key](https://www.alphavantage.co/support/#api-key) — required to fetch fundamentals, ETF history, and price
   data.
2. Open any of `stocks.html`, `sectors.html`, or `snapshot.html` in a modern browser.
3. Paste your API key once (Setup tab on the screener, or the "AV key" pill on the sector pages) — it persists across pages.
4. Navigate between views via the header links.

## Data sources

- [Alpha Vantage](https://www.alphavantage.co/) — fundamentals (`OVERVIEW`, `INCOME_STATEMENT`, `BALANCE_SHEET`, `CASH_FLOW`,
  `GLOBAL_QUOTE`) for the per-ticker screener and `TIME_SERIES_MONTHLY` for the 11 sector ETFs (XLK, XLC, XLF, XLV, XLY, XLP, XLE, XLI, XLB,
  XLRE, XLU). A [free key](https://www.alphavantage.co/support/#api-key) suffices for casual use (25 calls/day, 5/minute).

## File layout

- `common.css` — design tokens (light + dark), typography utilities, header/footer, pills, buttons, card/table, status badges. Used by all
  three pages.
- `stocks.html` / `stocks.css` / `stocks.js` + `data.js` — per-ticker stock screener.
- `sectors.html` / `sectors.css` / `sectors.js` — 12-month sector timeline.
- `snapshot.html` / `snapshot.css` / `snapshot.js` — sector treemap snapshot.

## Development

No build step. Edit any file directly and refresh the browser. The data layer (Alpha Vantage cache + page-specific state) lives in
`localStorage` under the `qvs.*` namespace; clear it from devtools to reset.

## License

[MIT](LICENSE)
