# Stocks Screener

A single-file, browser-based stock screener for quality-at-a-discount investing. Walks a ticker through universe filters, quality and valuation gates, momentum checks, red flags, a scenario-based IRR estimate, and a half-Kelly position size — all in one HTML file.

## Features

- **Investment schools & threshold profiles** — switch between presets (Standard, Conservative, Aggressive, Cyclical, Compounder) to change how strict each gate is.
- **Staged analysis** — Setup → Inputs → Quality → Valuation → Momentum → Red Flags → Scenario → Summary → Portfolio.
- **Live scoring** — pass/fail/warn verdicts update as inputs change.
- **Scenario IRR** — bear/base/bull cases with an expected IRR and margin of safety.
- **Portfolio sizing** — half-Kelly position recommendation.
- **Light & dark themes.**
- **No backend** — everything runs locally in the browser.

## Usage

1. Get a free [Alpha Vantage API key](https://www.alphavantage.co/support/#api-key) — required to fetch fundamentals and price history.
2. Open `screener.html` in any modern browser.
3. Paste your API key in the Setup tab.
4. Pick a School and Profile.
5. Walk through the tabs and review the Summary and Portfolio verdicts.

## Data sources

- [Alpha Vantage](https://www.alphavantage.co/) — required, for fundamentals and price history.
  A [free key](https://www.alphavantage.co/support/#api-key) is sufficient for casual use.

## Development

Single file, no build step. Edit `screener.html` directly and refresh the browser.

## License

[MIT](LICENSE)
