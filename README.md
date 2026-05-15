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

1. Open `screener.html` in any modern browser.
2. (Optional) Paste an [Alpha Vantage API key](https://www.alphavantage.co/support/#api-key) in the Setup tab to auto-fetch financials by ticker. Without a key, you can still enter inputs manually.
3. Pick a School and Profile.
4. Walk through the tabs and review the Summary and Portfolio verdicts.

## Data sources

- [Alpha Vantage](https://www.alphavantage.co/) — optional, for automated fundamentals and price history. A free key is sufficient for casual use.

## Development

Single file, no build step. Edit `screener.html` directly and refresh the browser.

## License

[MIT](LICENSE)
