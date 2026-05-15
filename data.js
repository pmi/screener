// =============================================================================
// DATA MODEL
// =============================================================================

const PROFILE_NAMES = ['Standard', 'Conservative', 'Aggressive', 'Cyclical', 'Compounder'];

// Each criterion has: key, label, comp ('min'/'max'/'info'), unit, fmt, values per profile, note
const CRITERIA = [
    {
        section: 'Stage 1 — Universe', items: [
            {
                key: 'mktcap_min', label: 'Market cap minimum ($M)', comp: 'min', fmt: 'n0',
                values: [500, 1000, 250, 500, 500], note: 'Liquidity floor'
            },
            {
                key: 'adv_min', label: 'ADV minimum ($M, 20-day)', comp: 'min', fmt: 'n1',
                values: [5, 10, 2, 5, 5], note: 'Trade without moving the market'
            }
        ]
    },
    {
        section: 'Stage 2A — Profitability', items: [
            {
                key: 'roic5y_min', label: 'ROIC 5y median minimum', comp: 'min', fmt: 'pct',
                values: [12, 15, 8, 10, 18], note: 'Excess returns on capital'
            },
            {
                key: 'roic_yrs_min', label: 'Years ROIC > WACC+3% (of 10)', comp: 'min', fmt: 'n0',
                values: [7, 8, 5, 5, 8], note: 'Consistency of excess returns'
            },
            {
                key: 'gm_cv_max', label: 'Gross margin CV max (σ/μ, 10y)', comp: 'max', fmt: 'n2',
                values: [0.15, 0.10, 0.25, 0.30, 0.10], note: 'Stability of unit economics'
            },
            {
                key: 'fcf_margin_min', label: 'FCF margin 5y minimum', comp: 'min', fmt: 'pct',
                values: [8, 12, 5, 6, 12], note: 'Cash generation per dollar of revenue'
            },
            {
                key: 'cashconv_min', label: 'Cash conversion (FCF/NI) min', comp: 'min', fmt: 'n2',
                values: [0.80, 0.90, 0.70, 0.70, 0.85], note: 'Earnings quality'
            }
        ]
    },
    {
        section: 'Stage 2B — Balance Sheet', items: [
            {
                key: 'ndebt_max', label: 'Net Debt / EBITDA max', comp: 'max', fmt: 'n1',
                values: [2.5, 1.5, 3.5, 1.5, 2.0], note: 'Leverage tolerance'
            },
            {
                key: 'intcov_min', label: 'Interest coverage min (EBIT/Int)', comp: 'min', fmt: 'n1',
                values: [6, 10, 4, 6, 8], note: ''
            },
            {
                key: 'currratio_min', label: 'Current ratio min', comp: 'min', fmt: 'n2',
                values: [1.2, 1.5, 1.0, 1.2, 1.2], note: ''
            },
            {
                key: 'altman_min', label: 'Altman Z-score min', comp: 'min', fmt: 'n2',
                values: [2.99, 3.5, 1.81, 2.5, 2.99], note: 'Bankruptcy risk'
            },
            {
                key: 'beneish_max', label: 'Beneish M-score max', comp: 'max', fmt: 'n2',
                values: [-1.78, -2.22, -1.0, -1.78, -1.78], note: 'Earnings manipulation'
            }
        ]
    },
    {
        section: 'Stage 2C — Capital Allocation', items: [
            {
                key: 'incroic_min', label: 'Incremental ROIC 5y minimum', comp: 'min', fmt: 'pct',
                values: [10, 12, 8, 8, 15], note: 'Returns on reinvested capital'
            },
            {
                key: 'sharecagr_max', label: 'Share count CAGR max (ex-comp)', comp: 'max', fmt: 'pct',
                values: [1, 0, 2, 1, 1], note: 'Dilution discipline'
            },
            {
                key: 'acq_fcf_max', label: "Acquisition / 5y FCF max", comp: 'max', fmt: 'pct',
                values: [30, 20, 50, 25, 30], note: 'M&A discipline'
            }
        ]
    },
    {
        section: 'Stage 2D — Durability', items: [
            {
                key: 'rev_cagr_min', label: 'Revenue CAGR 5y minimum', comp: 'min', fmt: 'pct',
                values: [4, 5, 2, 0, 8], note: 'Real growth'
            },
            {
                key: 'topcust_max', label: 'Top customer % rev max', comp: 'max', fmt: 'pct',
                values: [15, 10, 25, 15, 15], note: 'Customer concentration'
            }
        ]
    },
    {
        section: 'Stage 3 — Valuation', items: [
            {
                key: 'evebit_max', label: 'EV/EBIT max', comp: 'max', fmt: 'n1',
                values: [12, 10, 16, 8, 18], note: 'Absolute valuation'
            },
            {
                key: 'evebit_pct_max', label: 'EV/EBIT 10y percentile max', comp: 'max', fmt: 'pct',
                values: [25, 25, 40, 25, 30], note: 'Relative to own history'
            },
            {
                key: 'fcfy_min', label: 'FCF yield min (FCF / EV)', comp: 'min', fmt: 'pct',
                values: [6, 7, 5, 8, 4], note: 'Cash yield'
            },
            {
                key: 'peg_max', label: 'PEG max', comp: 'max', fmt: 'n2',
                values: [1.2, 1.0, 1.5, 1.5, 1.4], note: 'Growth-adjusted PE'
            },
            {
                key: 'rdcf_max', label: 'Reverse DCF implied / consensus max', comp: 'max', fmt: 'pct',
                values: [50, 40, 70, 60, 60], note: 'Market underpricing growth'
            },
            {
                key: 'acqmul_pct_max', label: "Acquirer's multiple percentile max", comp: 'max', fmt: 'pct',
                values: [25, 25, 40, 25, 35], note: 'Greenblatt rank'
            },
            {
                key: 'val_passes_min', label: 'Min valuation criteria passes (of 6)', comp: 'min', fmt: 'n0',
                values: [3, 4, 2, 3, 3], note: 'How many of 6 must clear'
            },
            {
                key: 'mos_min', label: 'Minimum Margin of Safety', comp: 'min', fmt: 'pct',
                values: [30, 40, 20, 30, 25], note: '(IV − Price) / IV'
            }
        ]
    },
    {
        section: 'Stage 4 — Red Flags', items: [
            {
                key: 'accruals_max', label: 'Accruals ratio max', comp: 'max', fmt: 'pct',
                values: [5, 3, 8, 5, 5], note: 'Sloan ratio'
            },
            {
                key: 'dso_max', label: 'DSO YoY change max', comp: 'max', fmt: 'pct',
                values: [25, 15, 35, 25, 25], note: 'Receivables stretch'
            },
            {
                key: 'ocfni_min', label: 'OCF / NI min', comp: 'min', fmt: 'n2',
                values: [0.70, 0.80, 0.50, 0.70, 0.70], note: 'Cash-backed earnings'
            },
            {
                key: 'goodwill_max', label: 'Goodwill / Assets max', comp: 'max', fmt: 'pct',
                values: [40, 30, 50, 40, 40], note: 'Acquisition risk'
            },
            {
                key: 'insider_max', label: 'Insider net selling 12m max', comp: 'max', fmt: 'pct',
                values: [5, 3, 10, 5, 5], note: '% of insider holdings sold'
            },
            {
                key: 'short_max', label: 'Short interest max', comp: 'max', fmt: 'pct',
                values: [15, 10, 25, 15, 15], note: '% of float'
            }
        ]
    },
    {
        section: 'Stage 3M — Momentum (Q+M and V+M schools)', items: [
            {
                key: 'mom12_1_min', label: '12–1 month price momentum min', comp: 'min', fmt: 'pct',
                values: [10, 15, 5, 8, 12], note: '12-mo return excluding most recent month (academic standard)'
            },
            {
                key: 'mom6m_min', label: '6-month price momentum min', comp: 'min', fmt: 'pct',
                values: [5, 8, 0, 3, 8], note: 'Recent trend strength'
            },
            {
                key: 'dist_52wh_min', label: 'Distance from 52-week high min', comp: 'min', fmt: 'pct',
                values: [-15, -10, -25, -20, -10], note: 'Negative — how far below recent high. Closer to 0 = stronger'
            },
            {
                key: 'above_200dma_min', label: 'Above 200-day MA (1 = yes)', comp: 'min', fmt: 'n0',
                values: [1, 1, 0, 1, 1], note: 'Primary trend confirmation'
            },
            {
                key: 'rs_index_min', label: 'Relative strength vs index 6m min', comp: 'min', fmt: 'pct',
                values: [0, 5, -5, 0, 3], note: 'Outperformance vs benchmark'
            },
            {
                key: 'eps_rev_min', label: 'EPS revisions 90d min', comp: 'min', fmt: 'pct',
                values: [0, 2, -3, 0, 0], note: 'FY1 analyst estimate trend'
            },
            {
                key: 'mom_passes_min', label: 'Min momentum criteria passes (of 6)', comp: 'min', fmt: 'n0',
                values: [4, 5, 3, 4, 4], note: 'How many of 6 must clear'
            }
        ]
    },
    {
        section: 'Stage 5 — Expected Return', items: [
            {
                key: 'eirr_min', label: 'Min probability-weighted IRR', comp: 'min', fmt: 'pct',
                values: [15, 18, 12, 15, 15], note: '3–5 year horizon'
            }
        ]
    },
    {
        section: 'Stage 6 — Portfolio', items: [
            {
                key: 'maxpos', label: 'Max position size', comp: 'info', fmt: 'pct',
                values: [8, 6, 10, 8, 8], note: 'Per name cap'
            },
            {
                key: 'maxsector', label: 'Max sector weight', comp: 'info', fmt: 'pct',
                values: [25, 20, 30, 25, 25], note: 'GICS sector cap'
            },
            {
                key: 'target_holdings', label: 'Target portfolio holdings', comp: 'info', fmt: 'n0',
                values: [20, 25, 15, 20, 18], note: 'Number of names'
            },
            {
                key: 'kelly_mult', label: 'Kelly fraction multiplier', comp: 'info', fmt: 'n2',
                values: [0.5, 0.25, 0.75, 0.5, 0.5], note: 'Half-Kelly default'
            },
            {
                key: 'liq_max', label: 'Max position / 20d ADV', comp: 'info', fmt: 'pct',
                values: [10, 5, 15, 10, 10], note: 'Liquidity rule'
            }
        ]
    }
];

// Build PROFILES lookup: { Standard: { key: value, ... }, ... }
const PROFILES = {};
PROFILE_NAMES.forEach((p, idx) => {
    PROFILES[p] = {};
    CRITERIA.forEach(sec => sec.items.forEach(it => {
        PROFILES[p][it.key] = it.values[idx];
    }));
});

// Flat criterion lookup
const CRIT_BY_KEY = {};
CRITERIA.forEach(sec => sec.items.forEach(it => {
    CRIT_BY_KEY[it.key] = it;
}));

// Investment schools — each defines its own 5-stage funnel.
// Common stages: universe, redflags, scenario. Variable: quality / valuation / momentum.
const SCHOOLS = {
    'Quality + Value': {stages: ['universe', 'quality', 'valuation', 'redflags', 'scenario']},
    'Quality + Momentum': {stages: ['universe', 'quality', 'momentum', 'redflags', 'scenario']},
    'Value + Momentum': {stages: ['universe', 'valuation', 'momentum', 'redflags', 'scenario']}
};
const SCHOOL_NAMES = Object.keys(SCHOOLS);

function schoolStages() {
    return SCHOOLS[state.school].stages;
}

function schoolUses(stage) {
    return schoolStages().includes(stage);
}

// Plain-English definitions, keyed by input/metric key. Used in cell + header tooltips.
const METRIC_DEFINITIONS = {
    ticker: 'Stock ticker symbol (e.g. AAPL, MSFT).',
    name: 'Company name.',
    sector: 'GICS sector classification.',
    mktcap: 'Market Capitalization in $ millions — the total stock-market value of the company (price × shares). Larger caps are easier to trade in size.',
    adv: 'Average Daily dollar Volume in $ millions — typical $ value traded per day. A $1M position can move the stock if it is too large a share of ADV.',

    roic5y: 'Return On Invested Capital, 5-year median. The % return the business earns on every dollar of capital (equity + debt) at work in operations. Above 12% means the company creates real value year after year. The single most important quality signal.',
    roic_yrs: 'Count of years (out of last 10) where ROIC exceeded WACC + 3% — a proxy for whether the company has consistently created shareholder value, not just in one good year. Free Alpha Vantage tier only provides 5 years.',
    gm_cv: 'Gross Margin coefficient of variation = standard deviation ÷ mean over 10 years. Low values = stable, predictable unit economics. High values = cyclical, commodity-like, or product-mix dependent.',
    fcf_margin: 'Free Cash Flow margin = FCF ÷ Revenue, 5-year average. The % of every dollar of sales that becomes actual cash after paying for capital expenditures. Above 8% means a real cash machine.',
    cashconv: 'Cash conversion = sum of 5y Free Cash Flow ÷ sum of 5y Net Income. Above 0.80 means most reported earnings convert to real cash. Low conversion = earnings backed by accounting estimates, not cash.',

    ndebt: 'Net Debt ÷ EBITDA — how many years of cash earnings it would take to repay all debt minus cash on hand. Below 2.5× = comfortable. Above 3× = stretched.',
    intcov: 'Interest Coverage = EBIT ÷ Interest Expense — how many times the company can cover its interest bill from operating profit. Above 6× = safe.',
    currratio: 'Current Ratio = current assets ÷ current liabilities — short-term liquidity. Above 1.2 means the company can meet near-term obligations without raising capital.',
    altman: 'Altman Z-score — a bankruptcy-risk score combining 5 balance-sheet ratios. Above 2.99 = healthy. Below 1.81 = distress zone.',
    beneish: 'Beneish M-score — a statistical flag for earnings manipulation built from 8 ratios. Companies scoring above −1.78 have historically been more likely to be manipulating earnings. Lower (more negative) = cleaner accounting.',

    incroic: 'Incremental ROIC over 5y = change in NOPAT ÷ change in Invested Capital. The return the company earns on capital it reinvests. Above 10% means management is allocating capital productively.',
    sharecagr: 'Share-count CAGR over 5 years, excluding stock-based comp. Below 1% growth (or negative = buybacks) means shareholders are not being meaningfully diluted.',
    acq_fcf: 'Acquisition spending over the last 5 years as % of cumulative free cash flow. Above 50% means the company has been an aggressive acquirer — historically a value destroyer unless there is a strong integration track record.',

    rev_cagr: 'Revenue CAGR over 5 years — top-line growth rate. Above 4% real-terms growth means the business is expanding, not melting.',
    topcust: 'Top customer as % of revenue — customer concentration risk. If one customer is above 15% of revenue, losing them would hurt badly.',

    evebit: 'EV ÷ EBIT = (Market Cap + Debt − Cash) ÷ Operating Earnings. How many years of operating profit you are paying to buy the whole business. Below 12× is reasonable.',
    evebit_pct: 'Where current EV/EBIT ranks within the company\'s own 10-year history (percentile). Below 25th percentile = trading cheap vs. its own past.',
    fcfy: 'Free Cash Flow Yield = FCF ÷ Enterprise Value. Like an interest rate on the business. Above 6% is a healthy yield, comparable to a high-yield bond but with growth.',
    peg: 'PEG = P/E divided by expected growth rate. Below 1.2 means you are paying less than 1× the growth rate for earnings. The classic Peter Lynch screen.',
    rdcf_ratio: 'Reverse-DCF implied growth ÷ consensus expected growth. Reverse DCF backs out the growth rate the current stock price assumes. Below 50% means the market is pricing much less growth than analysts expect — potential upside.',
    acqmul_pct: 'Acquirer\'s Multiple percentile rank (lower = cheaper). Greenblatt\'s measure: EV ÷ Operating Earnings within sector. Below 25th percentile = cheaper than 75% of peers.',
    iv: 'Intrinsic Value per share — your fair-value estimate (DCF, multiple-based, etc.). Auto-fill uses sector-typical PE × TTM EPS; refine with your own model.',
    price: 'Current stock price.',

    accruals: 'Accruals ratio (Sloan ratio) = (Net Income − Operating Cash Flow) ÷ Total Assets. High accruals = earnings growing faster than cash. Historically a predictor of earnings disappointments.',
    dso: 'Days Sales Outstanding year-over-year change. If receivables grow faster than revenue, the company may be stuffing the channel or extending generous credit — a warning sign.',
    ocfni: 'Operating Cash Flow ÷ Net Income. Above 0.70 means earnings are mostly cash-backed. Below 0.70 = profits driven by accounting estimates.',
    goodwill: 'Goodwill as % of total assets. High goodwill = the company has paid premium prices for acquisitions. Risk of future write-downs.',
    insider: 'Insider net selling over the last 12 months as % of insider holdings. Above 5% = management voting with their feet.',
    short: 'Short interest as % of float — bets against the stock. Above 15% means a meaningful contingent of investors expects bad news. Investigate why before buying.',
    auditor_chg: 'Auditor change in the last 2 years (Y/N). Unexplained auditor changes sometimes precede accounting disputes.',
    restate: 'Financial restatement in the last 3 years (Y/N). Restatements signal prior-year earnings were not reliable.',

    mom12_1: '12–1 month price momentum — the 12-month total return excluding the most recent month. The academic momentum factor. Skipping the last month avoids 1-month reversal noise. Enter manually (AV historical-price endpoint is premium-only).',
    mom6m: '6-month price return — recent trend strength. Used to confirm intermediate-term momentum. Enter manually (AV historical-price endpoint is premium-only).',
    dist_52wh: 'Distance from 52-week high (negative %). How far below the recent peak the stock is trading. Closer to 0 = stronger; below −20% = downtrend.',
    above_200dma: 'Above 200-day moving average (1 = yes, 0 = no). The primary long-term trend filter — institutions watch this religiously.',
    rs_index: 'Relative strength vs benchmark (6-month outperformance %). Stock return minus benchmark return. Positive = beating the market.',
    eps_rev: 'EPS revisions over the last 90 days (% change in FY1 consensus estimate). Rising revisions = analysts upgrading; falling = downgrading.',

    bull_irr: 'Bull-case annualized return — what you make per year if the optimistic scenario plays out.',
    bull_p: 'Probability you assign to the bull case (0–100%).',
    base_irr: 'Base-case annualized return.',
    base_p: 'Probability of the base case.',
    bear_irr: 'Bear-case annualized return (usually negative).',
    bear_p: 'Probability of the bear case. All three probabilities must sum to 100%.',

    moat: 'Competitive moat (Wide / Narrow / None). Sustainable advantages: scale, network effects, switching costs, IP, brand. Wide = at least 10 years of protected returns expected.',
    mgmt_own: 'Management ownership as % of shares outstanding. Skin in the game — high insider ownership aligns management with shareholders.',
    turnover: 'Count of CEO/CFO turnovers in the last 5 years. Above 2 = instability red flag.'
};

// Non-metric criterion descriptions (used for Setup tooltips)
const CRITERION_EXTRA_DEFS = {
    val_passes_min: 'Number of valuation criteria (out of 6) that must clear for the stock to pass Stage 3. Lower = more lenient.',
    mom_passes_min: 'Number of momentum criteria (out of 6) that must clear for the stock to pass the Momentum stage. Lower = more lenient.',
    mos_min: 'Margin of Safety = (Intrinsic Value − Price) ÷ IV. The discount to fair value you require before buying. 30% means buy only when the stock trades at least 30% below your IV estimate.',
    eirr_min: 'Minimum probability-weighted expected IRR. Below this, the position is not worth the opportunity cost of capital.',
    maxpos: 'Maximum size of any single position as % of portfolio. Caps single-stock risk.',
    maxsector: 'Maximum exposure to any one GICS sector. Caps sector concentration.',
    target_holdings: 'Target number of concurrent positions in the portfolio.',
    kelly_mult: 'Fraction of full-Kelly to use for sizing (1.0 = full, 0.5 = half-Kelly). Lower = more conservative.',
    liq_max: 'Maximum position size as % of 20-day average dollar volume. Higher = harder to exit without market impact.'
};

// Resolve a plain-English description for a criterion key (Setup) or metric key (Inputs/Scoring)
function defFor(key) {
    if (CRITERION_EXTRA_DEFS[key]) {
        return CRITERION_EXTRA_DEFS[key];
    }
    if (METRIC_DEFINITIONS[key]) {
        return METRIC_DEFINITIONS[key];
    }
    if (key === 'rdcf_max') {
        return METRIC_DEFINITIONS.rdcf_ratio;
    }
    // strip _min / _max suffix
    const m = String(key).replace(/_(min|max)$/, '');
    return METRIC_DEFINITIONS[m] || '';
}

// Input fields for tickers (Inputs panel)
const INPUT_GROUPS = [
    {
        group: 'Identity', items: [
            {key: 'ticker', label: 'Ticker', type: 'text'},
            {key: 'name', label: 'Name', type: 'text'},
            {key: 'sector', label: 'Sector', type: 'text'},
            {key: 'mktcap', label: 'Mkt Cap ($M)', type: 'num', fmt: 'n0'},
            {key: 'adv', label: 'ADV ($M, 20d)', type: 'num', fmt: 'n1'}
        ]
    },
    {
        group: 'Profitability', items: [
            {key: 'roic5y', label: 'ROIC 5y median', type: 'pct'},
            {key: 'roic_yrs', label: 'Yrs ROIC>WACC+3% (of 10)', type: 'num', fmt: 'n0'},
            {key: 'gm_cv', label: 'GM CV (σ/μ)', type: 'num', fmt: 'n2'},
            {key: 'fcf_margin', label: 'FCF margin 5y', type: 'pct'},
            {key: 'cashconv', label: 'Cash conv. (FCF/NI)', type: 'num', fmt: 'n2'}
        ]
    },
    {
        group: 'Balance Sheet', items: [
            {key: 'ndebt', label: 'Net Debt/EBITDA', type: 'num', fmt: 'n1'},
            {key: 'intcov', label: 'Int. coverage', type: 'num', fmt: 'n1'},
            {key: 'currratio', label: 'Current ratio', type: 'num', fmt: 'n2'},
            {key: 'altman', label: 'Altman Z', type: 'num', fmt: 'n2'},
            {key: 'beneish', label: 'Beneish M', type: 'num', fmt: 'n2'}
        ]
    },
    {
        group: 'Capital Allocation', items: [
            {key: 'incroic', label: 'Incremental ROIC 5y', type: 'pct'},
            {key: 'sharecagr', label: 'Share count CAGR', type: 'pct'},
            {key: 'acq_fcf', label: 'Acq / 5y FCF', type: 'pct'}
        ]
    },
    {
        group: 'Durability', items: [
            {key: 'rev_cagr', label: 'Revenue CAGR 5y', type: 'pct'},
            {key: 'topcust', label: 'Top customer %', type: 'pct'}
        ]
    },
    {
        group: 'Valuation', items: [
            {key: 'evebit', label: 'EV/EBIT', type: 'num', fmt: 'n1'},
            {key: 'evebit_pct', label: 'EV/EBIT 10y %ile', type: 'pct'},
            {key: 'fcfy', label: 'FCF yield', type: 'pct'},
            {key: 'peg', label: 'PEG', type: 'num', fmt: 'n2'},
            {key: 'rdcf_ratio', label: 'RevDCF / consensus', type: 'pct'},
            {key: 'acqmul_pct', label: "Acq mult %ile", type: 'pct'},
            {key: 'iv', label: 'Intrinsic value/share', type: 'num', fmt: 'n2'},
            {key: 'price', label: 'Price', type: 'num', fmt: 'n2'}
        ]
    },
    {
        group: 'Momentum', items: [
            {key: 'mom12_1', label: '12-1m return', type: 'pct'},
            {key: 'mom6m', label: '6m return', type: 'pct'},
            {key: 'dist_52wh', label: 'Dist 52w-H', type: 'pct'},
            {key: 'above_200dma', label: '> 200d MA (1=Y)', type: 'num', fmt: 'n0'},
            {key: 'rs_index', label: 'RS vs SPX 6m', type: 'pct'},
            {key: 'eps_rev', label: 'EPS rev 90d', type: 'pct'}
        ]
    },
    {
        group: 'Red Flags', items: [
            {key: 'accruals', label: 'Accruals ratio', type: 'pct'},
            {key: 'dso', label: 'DSO YoY Δ', type: 'pct'},
            {key: 'ocfni', label: 'OCF / NI', type: 'num', fmt: 'n2'},
            {key: 'goodwill', label: 'Goodwill / Assets', type: 'pct'},
            {key: 'insider', label: 'Insider sell 12m', type: 'pct'},
            {key: 'short', label: 'Short int.', type: 'pct'},
            {key: 'auditor_chg', label: 'Auditor chg 2y', type: 'yn'},
            {key: 'restate', label: 'Restated 3y', type: 'yn'}
        ]
    },
    {
        group: 'Scenarios (3–5y IRR)', items: [
            {key: 'bull_irr', label: 'Bull IRR', type: 'pct'},
            {key: 'bull_p', label: 'Bull P', type: 'pct'},
            {key: 'base_irr', label: 'Base IRR', type: 'pct'},
            {key: 'base_p', label: 'Base P', type: 'pct'},
            {key: 'bear_irr', label: 'Bear IRR', type: 'pct'},
            {key: 'bear_p', label: 'Bear P', type: 'pct'}
        ]
    },
    {
        group: 'Qualitative', items: [
            {key: 'moat', label: 'Moat', type: 'moat'},
            {key: 'mgmt_own', label: 'Mgmt ownership %', type: 'pct'},
            {key: 'turnover', label: 'CEO/CFO turnover (5y)', type: 'num', fmt: 'n0'}
        ]
    }
];

const INPUT_KEYS = [];
INPUT_GROUPS.forEach(g => g.items.forEach(f => INPUT_KEYS.push(f.key)));

// Gate definitions per scoring panel
const UNIVERSE_GATES = [
    {label: 'Mkt Cap ≥', metric: 'mktcap', thr: 'mktcap_min'},
    {label: 'ADV ≥', metric: 'adv', thr: 'adv_min'}
];
const QUALITY_GATES = [
    {label: 'ROIC 5y ≥', metric: 'roic5y', thr: 'roic5y_min'},
    {label: 'Yrs ROIC>WACC ≥', metric: 'roic_yrs', thr: 'roic_yrs_min'},
    {label: 'GM CV ≤', metric: 'gm_cv', thr: 'gm_cv_max'},
    {label: 'FCF margin ≥', metric: 'fcf_margin', thr: 'fcf_margin_min'},
    {label: 'Cash conv ≥', metric: 'cashconv', thr: 'cashconv_min'},
    {label: 'ND/EBITDA ≤', metric: 'ndebt', thr: 'ndebt_max'},
    {label: 'Int cov ≥', metric: 'intcov', thr: 'intcov_min'},
    {label: 'Curr ratio ≥', metric: 'currratio', thr: 'currratio_min'},
    {label: 'Altman Z ≥', metric: 'altman', thr: 'altman_min'},
    {label: 'Beneish M ≤', metric: 'beneish', thr: 'beneish_max'},
    {label: 'Inc. ROIC ≥', metric: 'incroic', thr: 'incroic_min'},
    {label: 'Share CAGR ≤', metric: 'sharecagr', thr: 'sharecagr_max'},
    {label: 'Acq/FCF ≤', metric: 'acq_fcf', thr: 'acq_fcf_max'},
    {label: 'Rev CAGR ≥', metric: 'rev_cagr', thr: 'rev_cagr_min'},
    {label: 'Top cust ≤', metric: 'topcust', thr: 'topcust_max'}
];
const VALUATION_GATES = [
    {label: 'EV/EBIT ≤', metric: 'evebit', thr: 'evebit_max'},
    {label: 'EV/EBIT %ile ≤', metric: 'evebit_pct', thr: 'evebit_pct_max'},
    {label: 'FCF yield ≥', metric: 'fcfy', thr: 'fcfy_min'},
    {label: 'PEG ≤', metric: 'peg', thr: 'peg_max'},
    {label: 'RDCF/Cons ≤', metric: 'rdcf_ratio', thr: 'rdcf_max'},
    {label: 'Acq mult %ile ≤', metric: 'acqmul_pct', thr: 'acqmul_pct_max'}
];
const MOMENTUM_GATES = [
    {label: '12–1m ≥', metric: 'mom12_1', thr: 'mom12_1_min'},
    {label: '6-mo ≥', metric: 'mom6m', thr: 'mom6m_min'},
    {label: 'Dist 52w-H ≥', metric: 'dist_52wh', thr: 'dist_52wh_min'},
    {label: '> 200d MA', metric: 'above_200dma', thr: 'above_200dma_min'},
    {label: 'RS vs SPX ≥', metric: 'rs_index', thr: 'rs_index_min'},
    {label: 'EPS rev ≥', metric: 'eps_rev', thr: 'eps_rev_min'}
];
const REDFLAG_GATES = [
    {label: 'Accruals ≤', metric: 'accruals', thr: 'accruals_max'},
    {label: 'DSO Δ ≤', metric: 'dso', thr: 'dso_max'},
    {label: 'OCF/NI ≥', metric: 'ocfni', thr: 'ocfni_min'},
    {label: 'Goodwill ≤', metric: 'goodwill', thr: 'goodwill_max'},
    {label: 'Insider sell ≤', metric: 'insider', thr: 'insider_max'},
    {label: 'Short int ≤', metric: 'short', thr: 'short_max'}
];
const REDFLAG_YN_GATES = [
    {label: 'No auditor chg', metric: 'auditor_chg'},
    {label: 'No restatement', metric: 'restate'}
];

// Sample tickers — illustrative data only
const SAMPLE_TICKERS = [
    {
        ticker: 'COST', name: 'Costco', sector: 'Cons. Staples',
        mktcap: 380000, adv: 1200,
        roic5y: 21, roic_yrs: 10, gm_cv: 0.04, fcf_margin: 3.2, cashconv: 0.95,
        ndebt: -0.2, intcov: 42, currratio: 1.07, altman: 5.6, beneish: -2.4,
        incroic: 24, sharecagr: 0.0, acq_fcf: 0,
        rev_cagr: 10, topcust: 1,
        evebit: 32, evebit_pct: 85, fcfy: 2.6, peg: 2.8, rdcf_ratio: 75, acqmul_pct: 90,
        iv: 520, price: 840,
        accruals: 1.2, dso: 5, ocfni: 1.0, goodwill: 1, insider: 0.5, short: 1.4,
        auditor_chg: 'N', restate: 'N',
        bull_irr: 12, bull_p: 25, base_irr: 6, base_p: 55, bear_irr: -8, bear_p: 20,
        moat: 'Wide', mgmt_own: 0.5, turnover: 0
    },
    {
        ticker: 'ULVR', name: 'Unilever', sector: 'Cons. Staples',
        mktcap: 120000, adv: 300,
        roic5y: 16, roic_yrs: 9, gm_cv: 0.08, fcf_margin: 13, cashconv: 0.92,
        ndebt: 2.1, intcov: 11, currratio: 0.78, altman: 3.1, beneish: -2.1,
        incroic: 14, sharecagr: 0.2, acq_fcf: 18,
        rev_cagr: 3, topcust: 2,
        evebit: 13.5, evebit_pct: 20, fcfy: 6.5, peg: 1.6, rdcf_ratio: 40, acqmul_pct: 22,
        iv: 55, price: 48,
        accruals: 2.0, dso: 3, ocfni: 1.05, goodwill: 36, insider: 0.4, short: 0.7,
        auditor_chg: 'N', restate: 'N',
        bull_irr: 16, bull_p: 30, base_irr: 10, base_p: 50, bear_irr: -2, bear_p: 20,
        moat: 'Wide', mgmt_own: 0.1, turnover: 1
    },
    {
        ticker: 'GOOGL', name: 'Alphabet', sector: 'Comm. Services',
        mktcap: 2100000, adv: 8000,
        roic5y: 28, roic_yrs: 10, gm_cv: 0.05, fcf_margin: 22, cashconv: 0.88,
        ndebt: -1.4, intcov: 200, currratio: 2.1, altman: 8.2, beneish: -2.7,
        incroic: 32, sharecagr: -0.8, acq_fcf: 8,
        rev_cagr: 17, topcust: 1,
        evebit: 18, evebit_pct: 35, fcfy: 4.2, peg: 1.3, rdcf_ratio: 55, acqmul_pct: 30,
        iv: 210, price: 175,
        accruals: 1.8, dso: 6, ocfni: 0.93, goodwill: 8, insider: 0.3, short: 0.6,
        auditor_chg: 'N', restate: 'N',
        bull_irr: 20, bull_p: 35, base_irr: 12, base_p: 50, bear_irr: -5, bear_p: 15,
        moat: 'Wide', mgmt_own: 5, turnover: 0
    },
    {
        ticker: 'PARA', name: 'Paramount Global', sector: 'Comm. Services',
        mktcap: 8500, adv: 90,
        roic5y: 3, roic_yrs: 2, gm_cv: 0.12, fcf_margin: 2, cashconv: 0.4,
        ndebt: 4.8, intcov: 1.6, currratio: 1.1, altman: 0.9, beneish: -1.2,
        incroic: -2, sharecagr: 0.6, acq_fcf: 65,
        rev_cagr: -2, topcust: 8,
        evebit: 14, evebit_pct: 55, fcfy: 3, peg: 5, rdcf_ratio: 95, acqmul_pct: 55,
        iv: 12, price: 11,
        accruals: 6, dso: 35, ocfni: 0.35, goodwill: 48, insider: 2, short: 18,
        auditor_chg: 'N', restate: 'N',
        bull_irr: 25, bull_p: 20, base_irr: 0, base_p: 50, bear_irr: -30, bear_p: 30,
        moat: 'Narrow', mgmt_own: 0.1, turnover: 2
    }
];

// =============================================================================
// ALPHA VANTAGE FETCH
// =============================================================================

// Sector medians for judgment-based fields. Sector strings match Alpha Vantage's `Sector` field.
const SECTOR_DEFAULTS = {
    'TECHNOLOGY': {moat: 'Wide', bull_irr: 22, bull_p: 30, base_irr: 12, base_p: 50, bear_irr: -8, bear_p: 20, target_pe: 24},
    'COMMUNICATION SERVICES': {
        moat: 'Narrow',
        bull_irr: 20,
        bull_p: 25,
        base_irr: 10,
        base_p: 55,
        bear_irr: -10,
        bear_p: 20,
        target_pe: 20
    },
    'CONSUMER CYCLICAL': {moat: 'Narrow', bull_irr: 18, bull_p: 25, base_irr: 8, base_p: 55, bear_irr: -15, bear_p: 20, target_pe: 18},
    'CONSUMER DISCRETIONARY': {moat: 'Narrow', bull_irr: 18, bull_p: 25, base_irr: 8, base_p: 55, bear_irr: -15, bear_p: 20, target_pe: 18},
    'CONSUMER DEFENSIVE': {moat: 'Wide', bull_irr: 12, bull_p: 25, base_irr: 7, base_p: 60, bear_irr: -5, bear_p: 15, target_pe: 20},
    'CONSUMER STAPLES': {moat: 'Wide', bull_irr: 12, bull_p: 25, base_irr: 7, base_p: 60, bear_irr: -5, bear_p: 15, target_pe: 20},
    'ENERGY': {moat: 'None', bull_irr: 25, bull_p: 25, base_irr: 5, base_p: 50, bear_irr: -20, bear_p: 25, target_pe: 10},
    'FINANCIAL SERVICES': {moat: 'Narrow', bull_irr: 15, bull_p: 25, base_irr: 8, base_p: 55, bear_irr: -12, bear_p: 20, target_pe: 12},
    'FINANCIALS': {moat: 'Narrow', bull_irr: 15, bull_p: 25, base_irr: 8, base_p: 55, bear_irr: -12, bear_p: 20, target_pe: 12},
    'HEALTHCARE': {moat: 'Wide', bull_irr: 18, bull_p: 25, base_irr: 10, base_p: 55, bear_irr: -8, bear_p: 20, target_pe: 18},
    'HEALTH CARE': {moat: 'Wide', bull_irr: 18, bull_p: 25, base_irr: 10, base_p: 55, bear_irr: -8, bear_p: 20, target_pe: 18},
    'INDUSTRIALS': {moat: 'Narrow', bull_irr: 16, bull_p: 25, base_irr: 8, base_p: 55, bear_irr: -10, bear_p: 20, target_pe: 16},
    'MATERIALS': {moat: 'None', bull_irr: 20, bull_p: 25, base_irr: 6, base_p: 50, bear_irr: -18, bear_p: 25, target_pe: 12},
    'BASIC MATERIALS': {moat: 'None', bull_irr: 20, bull_p: 25, base_irr: 6, base_p: 50, bear_irr: -18, bear_p: 25, target_pe: 12},
    'REAL ESTATE': {moat: 'Narrow', bull_irr: 12, bull_p: 25, base_irr: 7, base_p: 55, bear_irr: -10, bear_p: 20, target_pe: 18},
    'UTILITIES': {moat: 'Narrow', bull_irr: 10, bull_p: 25, base_irr: 6, base_p: 60, bear_irr: -5, bear_p: 15, target_pe: 17},
    '_DEFAULT': {moat: 'Narrow', bull_irr: 16, bull_p: 25, base_irr: 8, base_p: 55, bear_irr: -10, bear_p: 20, target_pe: 16}
};

// Generic defaults for fields with no good sector proxy. Set to values that don't unfairly disqualify a name.
const GENERIC_DEFAULTS = {
    evebit_pct: 50, rdcf_ratio: 50, acqmul_pct: 50,
    beneish: -2.0, accruals: 2.0, dso: 5,
    topcust: 5, insider: 0, short: 5, mgmt_own: 1, turnover: 0,
    acq_fcf: 10, auditor_chg: 'N', restate: 'N',
    // Momentum defaults set to neutral. mom12_1 and mom6m need historical daily prices (premium-only on AV);
    // rs_index and eps_rev aren't on AV at all. Enter manually if your school uses Momentum.
    mom12_1: 0, mom6m: 0, rs_index: 0, eps_rev: 0
};
