# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Working with the app

There is **no build, lint, or test infrastructure**. The three HTML pages are opened directly from the filesystem (`file://`) — there is no
server, bundler, or transpiler. Edit any `.html` / `.css` / `.js` file and refresh the browser. The Alpha Vantage API key (and per-page
state) is stored in `localStorage` under the `qvs.*` namespace; clear those keys from devtools to reset the app.

When Playwright-style smoke tests are needed (e.g. to verify a multi-page change), a venv has been used at `/tmp/pw_venv` with
`playwright` + chromium installed; ad-hoc scripts have lived in `/tmp/test_*.py`. They are not part of the repo.

## Three-page suite

- **`stocks.html`** + `stocks.css` + `stocks.js` + `data.js` — per-ticker quality-at-a-discount screener with multiple tabs (Setup /
  Inputs / Quality / Valuation / Momentum / Red Flags / Scenario / Summary / Portfolio).
- **`sectors.html`** + `sectors.css` + `sectors.js` — 12-month flow timeline. SVG body with sticky HTML thead (monthly totals) and tfoot (
  month labels) inside one scroll region.
- **`snapshot.html`** + `snapshot.css` + `snapshot.js` — squarified treemap of the 11 GICS sectors for a 1M / 3M / 6M / 12M window. Cells
  encode net flow direction (green / red), size = abs(net flow).

All three load `common.css` first, then their page-specific stylesheet. The header on every page carries cross-links to the other two views.

## Shared CSS framework (`common.css`)

`common.css` owns the design language: tokens (light + dark CSS variables), reset, body typography, `.mono`/`.serif`/`.serif-italic`,
`.profile-pill` family, `.icon-btn`, buttons, `.card`/`.table-wrap`/base `table`/`th`/`td`, `.status-strip`, `.dot`, `.pill` variants,
scrollbar styling, and the app-shell layout. Page-specific CSS files are kept narrow — they hold only rules used by exactly one page.

Two cross-file conventions worth knowing:

- **`body.full-height-page`** is the app-shell marker in `common.css` — sets
  `height: 100vh; overflow: hidden; display: flex; flex-direction: column`. Applied to `sectors.html` and `snapshot.html`; `stocks.html`
  does *not* use it (its `<main>` scrolls naturally).
- **`main.sectors-main`** sets `max-width: none; width: 100%; margin: 0` specifically to override the global
  `main { max-width: 1680px; margin: 0 auto }` rule (which lives in `stocks.css`). Without this override, the flex column collapses to
  content width via auto cross-axis margins.

Some SVG-text classes in `sectors.js` share typography with HTML table cells via combined selectors in `common.css` (e.g.
`th, .month-label { … }`, `td.ticker, .lane-etf { … }`). When adding new SVG text, prefer extending these shared rules over defining one-off
styles.

## Renames left some old class names behind

The repo went through a `screener.* → stocks.*`, `sankey.* → sectors.*`, `sectors.* → snapshot.*` rename. Internal CSS classes and IDs in *
*`sectors.html`** (the timeline, previously `sankey.html`) were intentionally left as-is — you'll see `sankey-page`, `sankey-scroller`,
`sankey-thead`, `sankey-tfoot`, `sankey-body`, plus IDs like `sankeyScroller` / `sankeyThead` / `sankeyTfoot`. They're consistent across the
HTML/CSS/JS triplet for that page and don't affect behavior, but treat them as the timeline's internal naming, not as a separate concept.

## Alpha Vantage integration

Every page that talks to AV reimplements the same helper, **not** a shared module:

- `_avCall(fn, symbol, key)` — single-call helper with built-in throttling (`AV_MIN_GAP_MS = 1500` between any two calls) and explicit error
  mapping for AV's `Note` / `Information` / `Error Message` response shapes. Lives in `stocks.js`, `sectors.js`, and `snapshot.js`.
- `avNum(v)` — numeric coercion that treats `'None'`, `'-'`, `''`, `null` as `null`.
- The `SECTORS` array (11 GICS sectors → SPDR ETF tickers, with top-3 cap tickers per sector for `snapshot.js`) is duplicated in both
  `sectors.js` and `snapshot.js`.

This duplication is intentional — each page is self-contained so it can be opened standalone.

**AV free tier**: 25 calls/day, 5/minute. The 1.5s throttle keeps requests under the per-minute cap.

## `localStorage` key conventions (`qvs.*` namespace)

- **`qvs.state.v1`** — shared state object (theme, AV key, window selection, etc.). All three pages read/write it via
  `Object.assign(defaultState(), JSON.parse(raw))`, so each page can add its own keys without clobbering the others' state.
- **`qvs.cache.{TICKER}`** — `stocks.js` per-ticker fundamentals cache (90 days). Shape: `{ fetchedAt, data: { ov, is, bs, cf, q } }`.
- **`qvs.cache.monthly.{ETF}`** — monthly bars cache shared between `sectors.js` and `snapshot.js` (90 days). Stores **two shapes** under
  the same TTL: `{ fetchedAt, bars: [...] }` on success, `{ fetchedAt, error: "..." }` on failure.

Both `fetchMonthly()` implementations re-throw cached errors instead of re-fetching — so a failed sector stays failed across reloads until
the user explicitly clicks **Reload failed** in the status strip. This means: never silently replay a network call if you find a cached
failure; the user has explicit retry control.

## Status strip pattern

`sectors.html` and `snapshot.html` use a `.status-strip` element above the content area for transient messages.

- `setStatus(text, kind, isHtml)` — set or clear the strip. `kind` is `'info'` (default) or `'error'`. `isHtml: true` uses `innerHTML` so
  links can be embedded.
- `partialFailStatus(failedSectors)` — shared format `N sector(s) failed: ETF1, ETF2 · <a data-action="reload-failed">Reload failed</a>`.
- A delegated `click` listener on the status element watches for `[data-action="reload-failed"]` and runs `reloadFailed()`, which clears
  each failed ETF's cache entry and retries `fetchMonthly` for just those ETFs (not the whole sector list).

When adding a new in-status link, follow the same `data-action="…"` + delegation pattern; the status HTML is recreated on every update.

## Cross-page navigation

- `stocks.html` ↔ `sectors.html` — both have a `.header-link` pointing at the other.
- `sectors.html` body click on a month → `snapshot.html?month=YYYY-MM&window=1` (drills into the snapshot anchored at that month).
- `snapshot.html` reads `?month=` and `?window=` URL params on boot. `?month` anchors the period (transient — never persisted to
  `localStorage`); `?window` sets and persists the selected window length. After data loads, `snapshot.js` writes both back via
  `history.replaceState` so the URL always reflects the visible state.
- The "Reset to now" link in `snapshot.html`'s status clears the anchor while preserving the window.

## Theming

`data-theme="light"|"dark"` on `<html>`. Toggled by `themeToggle` button on every page; state lives in `state.theme` and is persisted via
`qvs.state.v1`. All colours flow through CSS variables in `common.css` — there should be no hard-coded colours in any page-specific CSS.

## Other gotchas

- **Money formatting is fixed at billions** (`$X.YB`) everywhere via `fmtMoney(n)` / `fmtMoneyAbs(n)` — no mixing of M/B/T scales. If you
  add new monetary output, mirror this.
- The `qvs.cache.monthly.*` cache TTL is 90 days. Failures live just as long — there's no separate short TTL for errors.
- `sectors.js` and `snapshot.js` share the cache key prefix; changes to the failure-cache shape must be applied to **both** files.
