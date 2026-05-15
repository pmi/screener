function avNum(v) {
    if (v === null || v === undefined || v === 'None' || v === '-' || v === '') {
        return null;
    }
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function mean(a) {
    const f = a.filter(x => x !== null && Number.isFinite(x));
    return f.length ? f.reduce((s, x) => s + x, 0) / f.length : null;
}

function median(a) {
    const f = a.filter(x => x !== null && Number.isFinite(x)).sort((x, y) => x - y);
    if (!f.length) {
        return null;
    }
    const m = Math.floor(f.length / 2);
    return f.length % 2 ? f[m] : (f[m - 1] + f[m]) / 2;
}

function stdevPop(a) {
    const f = a.filter(x => x !== null && Number.isFinite(x));
    if (f.length < 2) {
        return null;
    }
    const m = f.reduce((s, x) => s + x, 0) / f.length;
    return Math.sqrt(f.reduce((s, x) => s + (x - m) * (x - m), 0) / f.length);
}

const AV_MIN_GAP_MS = 1500;  // serial calls, ≤1 request/sec
let _avLastCallAt = 0;

function _avSleep(ms) {
    return new Promise(res => setTimeout(res, ms));
}

async function _avCall(fn, symbol, key) {
    // Enforce minimum gap between any two AV requests
    const since = Date.now() - _avLastCallAt;
    if (since < AV_MIN_GAP_MS) {
        await _avSleep(AV_MIN_GAP_MS - since);
    }
    _avLastCallAt = Date.now();
    const url = `https://www.alphavantage.co/query?function=${fn}&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(key)}`;
    const r = await fetch(url);
    if (!r.ok) {
        throw new Error(`HTTP ${r.status} on ${fn}`);
    }
    const j = await r.json();
    if (j.Note) {
        throw new Error('AV rate limit hit on ' + fn + '. Free tier is 25 calls/day, 5/minute. Try again later.');
    }
    if (j.Information) {
        throw new Error('AV: ' + String(j.Information).slice(0, 240));
    }
    if (j['Error Message']) {
        throw new Error('AV: ' + String(j['Error Message']).slice(0, 240));
    }
    return j;
}

async function fetchAlphaVantage(symbol, key, onProgress) {
    const fns = ['OVERVIEW', 'INCOME_STATEMENT', 'BALANCE_SHEET', 'CASH_FLOW', 'GLOBAL_QUOTE'];
    const out = [];
    for (let i = 0; i < fns.length; i++) {
        if (onProgress) {
            onProgress(fns[i], i + 1, fns.length);
        }
        out.push(await _avCall(fns[i], symbol, key));
    }
    return {ov: out[0], is: out[1], bs: out[2], cf: out[3], q: out[4]};
}

// Derive partial momentum from OVERVIEW fields (free tier).
// 12-1m and 6m returns need a daily series — those endpoints are no longer free, so leave them for manual entry.
function deriveMomentum(ov, price) {
    const high52w = avNum(ov['52WeekHigh']);
    const ma200 = avNum(ov['200DayMovingAverage']);
    const dist_52wh = (price !== null && high52w && high52w > 0) ? ((price / high52w) - 1) * 100 : null;
    const above_200dma = (price !== null && ma200 && ma200 > 0) ? (price > ma200 ? 1 : 0) : null;
    return {dist_52wh, above_200dma};
}

function parseAV(symbol, data) {
    const {ov, is, bs, cf, q} = data;
    if (!ov || !ov.Symbol) {
        throw new Error('No fundamentals returned for ' + symbol);
    }

    const isRpt = (is.annualReports || []).slice(0, 5);  // most recent first
    const bsRpt = (bs.annualReports || []).slice(0, 5);
    const cfRpt = (cf.annualReports || []).slice(0, 5);
    const quote = q['Global Quote'] || {};

    const sector = (ov.Sector || '').trim();
    const sectorKey = sector.toUpperCase();
    const mktcapRaw = avNum(ov.MarketCapitalization);    // absolute dollars
    const ebitda = avNum(ov.EBITDA);
    const epsTTM = avNum(ov.DilutedEPSTTM) ?? avNum(ov.EPS);
    const peg = avNum(ov.PEGRatio);

    // Income statement series (index 0 = latest)
    const rev = isRpt.map(r => avNum(r.totalRevenue));
    const gp = isRpt.map(r => avNum(r.grossProfit));
    const opInc = isRpt.map(r => avNum(r.operatingIncome) ?? avNum(r.ebit));
    const ni = isRpt.map(r => avNum(r.netIncome));
    const intExp = isRpt.map(r => avNum(r.interestExpense));
    const incTax = isRpt.map(r => avNum(r.incomeTaxExpense));
    const incPre = isRpt.map(r => avNum(r.incomeBeforeTax));

    // Balance sheet series
    const ta = bsRpt.map(r => avNum(r.totalAssets));
    const ca = bsRpt.map(r => avNum(r.totalCurrentAssets));
    const cl = bsRpt.map(r => avNum(r.totalCurrentLiabilities));
    const cash = bsRpt.map(r => avNum(r.cashAndShortTermInvestments) ?? avNum(r.cashAndCashEquivalentsAtCarryingValue) ?? 0);
    const stDebt = bsRpt.map(r => avNum(r.currentDebt) ?? avNum(r.shortTermDebt) ?? 0);
    const ltDebt = bsRpt.map(r => avNum(r.longTermDebt) ?? avNum(r.longTermDebtNoncurrent) ?? 0);
    const totalDebt = bsRpt.map((_, i) => (stDebt[i] || 0) + (ltDebt[i] || 0));
    const tl = bsRpt.map(r => avNum(r.totalLiabilities));
    const eq = bsRpt.map(r => avNum(r.totalShareholderEquity));
    const re = bsRpt.map(r => avNum(r.retainedEarnings));
    const gw = bsRpt.map(r => avNum(r.goodwill) ?? 0);
    const sh = bsRpt.map(r => avNum(r.commonStockSharesOutstanding));

    // Cash flow series
    const ocf = cfRpt.map(r => avNum(r.operatingCashflow));
    const capex = cfRpt.map(r => {
        const v = avNum(r.capitalExpenditures);
        return v === null ? null : Math.abs(v);
    });
    const fcf = ocf.map((o, i) => (o !== null && capex[i] !== null) ? o - capex[i] : null);

    // Quote
    const price = avNum(quote['05. price']);
    const volume = avNum(quote['06. volume']);
    const adv = (price !== null && volume !== null) ? (price * volume) / 1e6 : null;  // $M, single-day proxy

    // ROIC per year: NOPAT / Invested Capital
    const taxRates = incPre.map((p, i) => {
        if (p === null || incTax[i] === null || p === 0) {
            return 0.25;
        }
        return Math.min(0.4, Math.max(0, incTax[i] / p));
    });
    const nopat = opInc.map((o, i) => o !== null ? o * (1 - taxRates[i]) : null);
    const ic = bsRpt.map((_, i) => (eq[i] !== null) ? eq[i] + (totalDebt[i] || 0) - (cash[i] || 0) : null);
    const roicSeries = nopat.map((n, i) => (n !== null && ic[i] !== null && ic[i] > 0) ? (n / ic[i]) * 100 : null);
    const roicVals = roicSeries.filter(v => v !== null);
    const roic5y = median(roicVals);
    const roic_yrs = roicVals.filter(r => r > 10).length;  // 10% as WACC + 3% proxy

    // Gross margin CV (decimal)
    const gms = gp.map((g, i) => (g !== null && rev[i]) ? g / rev[i] : null);
    const gmsFiltered = gms.filter(v => v !== null);
    const gmMean = mean(gmsFiltered);
    const gm_cv = (gmsFiltered.length >= 2 && gmMean) ? stdevPop(gmsFiltered) / Math.abs(gmMean) : null;

    // FCF margin (avg %)
    const fcfMargins = fcf.map((f, i) => (f !== null && rev[i]) ? (f / rev[i]) * 100 : null);
    const fcf_margin = mean(fcfMargins.filter(v => v !== null));

    // Cash conversion: sum(FCF) / sum(NI) over available years
    const fcfSum = fcf.filter(v => v !== null).reduce((s, v) => s + v, 0);
    const niSum = ni.filter(v => v !== null).reduce((s, v) => s + v, 0);
    const cashconv = niSum ? fcfSum / niSum : null;

    // OCF/NI latest
    const ocfni = (ocf[0] !== null && ni[0]) ? ocf[0] / ni[0] : null;

    // Balance sheet ratios (latest)
    const ndebt = (ebitda && totalDebt[0]) ? (totalDebt[0] - (cash[0] || 0)) / ebitda : null;
    const intcov = (opInc[0] !== null && intExp[0]) ? opInc[0] / intExp[0] : null;
    const currratio = (ca[0] !== null && cl[0]) ? ca[0] / cl[0] : null;
    const goodwill_pct = (gw[0] !== null && ta[0]) ? (gw[0] / ta[0]) * 100 : null;

    // Altman Z (manufacturing/non-finance version)
    let altman = null;
    if (ta[0] && tl[0] && mktcapRaw && ca[0] !== null && cl[0] !== null && re[0] !== null && opInc[0] !== null && rev[0] !== null) {
        altman = 1.2 * ((ca[0] - cl[0]) / ta[0])
                 + 1.4 * (re[0] / ta[0])
                 + 3.3 * (opInc[0] / ta[0])
                 + 0.6 * (mktcapRaw / tl[0])
                 + 1.0 * (rev[0] / ta[0]);
    }

    // Revenue CAGR (oldest to newest)
    const revPos = rev.filter(v => v !== null && v > 0);
    const rev_cagr = revPos.length >= 2
                     ? (Math.pow(revPos[0] / revPos[revPos.length - 1], 1 / (revPos.length - 1)) - 1) * 100
                     : null;

    // Share count CAGR
    const shPos = sh.filter(v => v !== null && v > 0);
    const sharecagr = shPos.length >= 2
                      ? (Math.pow(shPos[0] / shPos[shPos.length - 1], 1 / (shPos.length - 1)) - 1) * 100
                      : null;

    // EV/EBIT
    const ev = mktcapRaw !== null ? mktcapRaw + (totalDebt[0] || 0) - (cash[0] || 0) : null;
    const evebit = (ev && opInc[0]) ? ev / opInc[0] : null;
    const fcfy = (ev && fcf[0] !== null) ? (fcf[0] / ev) * 100 : null;

    // Incremental ROIC: ΔNOPAT / ΔIC across 5y
    let incroic = null;
    if (nopat[0] !== null && nopat[nopat.length - 1] !== null && ic[0] !== null && ic[ic.length - 1] !== null) {
        const dN = nopat[0] - nopat[nopat.length - 1];
        const dI = ic[0] - ic[ic.length - 1];
        if (Math.abs(dI) > 1) {
            incroic = (dN / dI) * 100;
        }
    }

    const sd = SECTOR_DEFAULTS[sectorKey] || SECTOR_DEFAULTS._DEFAULT;

    // IV via sector-typical PE × TTM EPS (simple anchor; user can refine)
    const iv = (epsTTM !== null && epsTTM > 0) ? epsTTM * sd.target_pe : null;

    const mom = deriveMomentum(ov, price);

    return {
        ticker: symbol.toUpperCase(),
        name: ov.Name || symbol,
        sector,
        mktcap: mktcapRaw !== null ? mktcapRaw / 1e6 : null,  // store as $M
        adv,
        mom12_1: GENERIC_DEFAULTS.mom12_1,
        mom6m: GENERIC_DEFAULTS.mom6m,
        dist_52wh: mom.dist_52wh,
        above_200dma: mom.above_200dma,
        rs_index: GENERIC_DEFAULTS.rs_index,
        eps_rev: GENERIC_DEFAULTS.eps_rev,
        roic5y, roic_yrs,
        gm_cv,
        fcf_margin, cashconv,
        ndebt, intcov, currratio, altman,
        beneish: GENERIC_DEFAULTS.beneish,
        incroic, sharecagr,
        acq_fcf: GENERIC_DEFAULTS.acq_fcf,
        rev_cagr,
        topcust: GENERIC_DEFAULTS.topcust,
        evebit,
        evebit_pct: GENERIC_DEFAULTS.evebit_pct,
        fcfy, peg,
        rdcf_ratio: GENERIC_DEFAULTS.rdcf_ratio,
        acqmul_pct: GENERIC_DEFAULTS.acqmul_pct,
        iv, price,
        accruals: GENERIC_DEFAULTS.accruals,
        dso: GENERIC_DEFAULTS.dso,
        ocfni,
        goodwill: goodwill_pct,
        insider: GENERIC_DEFAULTS.insider,
        short: GENERIC_DEFAULTS.short,
        auditor_chg: GENERIC_DEFAULTS.auditor_chg,
        restate: GENERIC_DEFAULTS.restate,
        bull_irr: sd.bull_irr, bull_p: sd.bull_p,
        base_irr: sd.base_irr, base_p: sd.base_p,
        bear_irr: sd.bear_irr, bear_p: sd.bear_p,
        moat: sd.moat,
        mgmt_own: GENERIC_DEFAULTS.mgmt_own,
        turnover: GENERIC_DEFAULTS.turnover,
        _fetched: Date.now()
    };
}

const CACHE_PREFIX = 'qvs.cache.';
const CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000;  // 90 days

async function handleFetch(symbol, key, onProgress) {
    const sym = symbol.trim().toUpperCase();
    if (!sym) {
        throw new Error('Enter a ticker.');
    }
    if (!key) {
        throw new Error('Set your Alpha Vantage API key first.');
    }
    const cacheKey = CACHE_PREFIX + sym;
    let raw;
    try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
            const parsed = JSON.parse(cached);
            if (Date.now() - parsed.fetchedAt < CACHE_TTL_MS) {
                raw = parsed.data;
            }
        }
    } catch (e) {
    }
    let fromCache = !!raw;
    if (!raw) {
        raw = await fetchAlphaVantage(sym, key, onProgress);
        try {
            localStorage.setItem(cacheKey, JSON.stringify({fetchedAt: Date.now(), data: raw}));
        } catch (e) {
        }
    }
    const ticker = parseAV(sym, raw);
    return {ticker, fromCache};
}

// =============================================================================
// STATE
// =============================================================================

const STORAGE_KEY = 'qvs.state.v1';

const defaultState = () => ({
    theme: 'light',
    school: 'Quality + Value',
    profile: 'Standard',
    overrides: {},      // criterion key -> override value
    tickers: SAMPLE_TICKERS.map(t => ({...t})),
    activeTab: 'setup',
    avKey: ''          // Alpha Vantage API key
});

let state = loadState();

function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            return Object.assign(defaultState(), JSON.parse(raw));
        }
    } catch (e) {
    }
    return defaultState();
}

function saveState() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
    }
}

// =============================================================================
// LOOKUPS / FORMATTING
// =============================================================================

function activeThreshold(key) {
    const o = state.overrides[key];
    if (o !== undefined && o !== '' && o !== null && !Number.isNaN(Number(o))) {
        return Number(o);
    }
    return PROFILES[state.profile][key];
}

function fmt(value, type) {
    if (value === null || value === undefined || value === '' || Number.isNaN(value)) {
        return '—';
    }
    const n = Number(value);
    if (type === 'pct') {
        return n.toFixed(1).replace(/\.0$/, '.0') + '%';
    }
    if (type === 'pct0') {
        return Math.round(n) + '%';
    }
    if (type === 'n0') {
        return n.toLocaleString(undefined, {maximumFractionDigits: 0});
    }
    if (type === 'n1') {
        return n.toFixed(1);
    }
    if (type === 'n2') {
        return n.toFixed(2);
    }
    if (type === 'mone') {
        if (Math.abs(n) >= 1000) {
            return n.toLocaleString(undefined, {maximumFractionDigits: 0});
        }
        return n.toFixed(2);
    }
    return String(value);
}

function fmtByKey(key, val) {
    const it = CRIT_BY_KEY[key];
    return fmt(val, it ? it.fmt : 'n2');
}

function parseNumber(v) {
    if (v === null || v === undefined || v === '') {
        return null;
    }
    if (typeof v === 'number') {
        return v;
    }
    const cleaned = String(v).replace(/,/g, '').replace(/%/g, '').trim();
    if (cleaned === '' || cleaned === '-') {
        return null;
    }
    const n = Number(cleaned);
    return Number.isNaN(n) ? null : n;
}

// =============================================================================
// COMPUTATIONS
// =============================================================================

// Returns true / false / null (null if insufficient input)
function gatePass(value, threshold, comp) {
    const v = parseNumber(value);
    const t = parseNumber(threshold);
    if (v === null || t === null) {
        return null;
    }
    return comp === 'min' ? v >= t : v <= t;
}

function ynPass(val) {
    if (!val) {
        return null;
    }
    const v = String(val).trim().toUpperCase();
    if (v === 'N') {
        return true;
    }
    if (v === 'Y') {
        return false;
    }
    return null;
}

function evalUniverse(t) {
    return UNIVERSE_GATES.map(g => ({
        ...g,
        pass: gatePass(t[g.metric], activeThreshold(g.thr), CRIT_BY_KEY[g.thr].comp),
        value: parseNumber(t[g.metric]),
        threshold: activeThreshold(g.thr)
    }));
}

function evalQuality(t) {
    return QUALITY_GATES.map(g => ({
        ...g,
        pass: gatePass(t[g.metric], activeThreshold(g.thr), CRIT_BY_KEY[g.thr].comp),
        value: parseNumber(t[g.metric]),
        threshold: activeThreshold(g.thr)
    }));
}

function evalValuation(t) {
    return VALUATION_GATES.map(g => ({
        ...g,
        pass: gatePass(t[g.metric], activeThreshold(g.thr), CRIT_BY_KEY[g.thr].comp),
        value: parseNumber(t[g.metric]),
        threshold: activeThreshold(g.thr)
    }));
}

function evalRedFlags(t) {
    const num = REDFLAG_GATES.map(g => ({
        ...g,
        pass: gatePass(t[g.metric], activeThreshold(g.thr), CRIT_BY_KEY[g.thr].comp),
        value: parseNumber(t[g.metric]),
        threshold: activeThreshold(g.thr)
    }));
    const yn = REDFLAG_YN_GATES.map(g => ({
        ...g,
        pass: ynPass(t[g.metric]),
        value: t[g.metric],
        threshold: 'N'
    }));
    return [...num, ...yn];
}

function MoS(t) {
    const iv = parseNumber(t.iv), px = parseNumber(t.price);
    if (iv === null || px === null || iv === 0) {
        return null;
    }
    return ((iv - px) / iv) * 100;  // percent
}

function expectedIRR(t) {
    const bi = parseNumber(t.bull_irr), bp = parseNumber(t.bull_p);
    const xi = parseNumber(t.base_irr), xp = parseNumber(t.base_p);
    const ri = parseNumber(t.bear_irr), rp = parseNumber(t.bear_p);
    if ([bi, bp, xi, xp, ri, rp].some(v => v === null)) {
        return null;
    }
    const sumP = bp + xp + rp;
    if (Math.abs(sumP - 100) > 1) {
        return 'P≠100%';
    }
    return (bi * bp + xi * xp + ri * rp) / 100;
}

function winStats(t) {
    // p (win probability) = sum of probs where IRR > 0
    // b (win/loss ratio) = expected positive return / |expected negative return|
    const rows = [
        [parseNumber(t.bull_irr), parseNumber(t.bull_p)],
        [parseNumber(t.base_irr), parseNumber(t.base_p)],
        [parseNumber(t.bear_irr), parseNumber(t.bear_p)]
    ];
    if (rows.some(r => r[0] === null || r[1] === null)) {
        return null;
    }
    let p = 0, gain = 0, loss = 0;
    rows.forEach(([irr, prob]) => {
        const w = prob / 100;
        if (irr > 0) {
            p += w;
            gain += irr * w;
        } else if (irr < 0) {
            loss += -irr * w;
        }
    });
    const b = loss === 0 ? 3 : gain / loss;  // fallback when no loss scenario
    return {p, b};
}

function kellyFraction(t) {
    const ws = winStats(t);
    if (!ws) {
        return null;
    }
    const {p, b} = ws;
    if (b <= 0) {
        return 0;
    }
    return Math.max(0, (p * b - (1 - p)) / b);
}

function passCount(arr) {
    return arr.filter(g => g.pass === true).length;
}

function totalEvaluable(arr) {
    return arr.filter(g => g.pass !== null).length;
}

function stageResult(arr) {
    const ev = totalEvaluable(arr);
    if (ev === 0) {
        return null;
    }
    const passes = passCount(arr);
    // Pass iff every gate we could evaluate cleared. Null gates are skipped (insufficient data).
    return passes === ev ? 'PASS' : 'FAIL';
}

function valuationResult(t) {
    const arr = evalValuation(t);
    const ev = totalEvaluable(arr);
    if (ev === 0) {
        return {result: null, passes: 0, mos: MoS(t), mosOk: null};
    }
    const passes = passCount(arr);
    const minPass = activeThreshold('val_passes_min');
    const mos = MoS(t);
    const mosMin = activeThreshold('mos_min');
    const mosOk = mos === null ? null : mos >= mosMin;
    const result = (passes >= minPass && mosOk === true) ? 'PASS' : 'FAIL';
    return {result, passes, mos, mosOk};
}

function evalMomentum(t) {
    return MOMENTUM_GATES.map(g => ({
        ...g,
        pass: gatePass(t[g.metric], activeThreshold(g.thr), CRIT_BY_KEY[g.thr].comp),
        value: parseNumber(t[g.metric]),
        threshold: activeThreshold(g.thr)
    }));
}

function momentumResult(t) {
    const arr = evalMomentum(t);
    const ev = totalEvaluable(arr);
    if (ev === 0) {
        return {result: null, passes: 0};
    }
    const passes = passCount(arr);
    const minPass = activeThreshold('mom_passes_min');
    const result = passes >= minPass ? 'PASS' : 'FAIL';
    return {result, passes};
}

function summarize(t) {
    const uni = evalUniverse(t);
    const qua = evalQuality(t);
    const val = valuationResult(t);
    const mom = momentumResult(t);
    const rf = evalRedFlags(t);
    const eirr = expectedIRR(t);
    const uniRes = stageResult(uni);
    const quaRes = stageResult(qua);
    const valRes = val.result;
    const momRes = mom.result;
    const rfRes = stageResult(rf);
    let irrRes = null;
    if (eirr !== null && eirr !== 'P≠100%') {
        irrRes = eirr >= activeThreshold('eirr_min') ? 'PASS' : 'FAIL';
    } else if (eirr === 'P≠100%') {
        irrRes = 'FAIL';
    }
    const stageMap = {universe: uniRes, quality: quaRes, valuation: valRes, momentum: momRes, redflags: rfRes, scenario: irrRes};
    const active = schoolStages();
    const activeResults = active.map(s => stageMap[s]);
    const stagesPassed = activeResults.filter(s => s === 'PASS').length;
    const stagesEval = activeResults.filter(s => s !== null).length;
    let overall = null;
    if (stagesEval === active.length) {
        overall = stagesPassed === active.length ? 'BUY' : stagesPassed >= active.length - 1 ? 'WATCH' : 'REJECT';
    }
    return {
        uni,
        qua,
        val,
        mom,
        rf,
        eirr,
        irrRes,
        uniRes,
        quaRes,
        valRes,
        momRes,
        rfRes,
        stagesPassed,
        stagesEval,
        overall,
        activeStages: active,
        stageResults: stageMap
    };
}

// =============================================================================
// RENDERING — utilities
// =============================================================================

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];

// Reusable ticker cell with an inline refresh button (visible on row hover).
// The button hooks into the global click delegate below.
function tickerCell(t) {
    const sym = safeText((t && t.ticker) || '');
    if (!sym) {
        return `<td class="ticker"></td>`;
    }
    return `<td class="ticker"><span class="ticker-with-refresh">${sym}<button class="refresh-btn" data-refetch="${sym}" title="Refetch ${sym} from Alpha Vantage" aria-label="Refetch ${sym}">
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><polyline points="13.5 2 13.5 5.5 10 5.5"/>
    </svg>
  </button></span></td>`;
}

// Toast helper — used when refetch is triggered from a non-Inputs tab
let _toastEl = null;
let _toastTimer = null;

function showToast(text, kind /* 'loading'|'success'|'error' */) {
    if (!_toastEl) {
        _toastEl = document.createElement('div');
        _toastEl.className = 'fetch-toast';
        document.body.appendChild(_toastEl);
    }
    _toastEl.className = 'fetch-toast show' + (kind ? ' ' + kind : '');
    const icon = kind === 'loading' ? '<span class="spinner"></span>' : kind === 'success' ? '✓' : kind === 'error' ? '✕' : '';
    _toastEl.innerHTML = `${icon}<span>${safeText(text)}</span>`;
    if (_toastTimer) {
        clearTimeout(_toastTimer);
    }
    if (kind !== 'loading') {
        _toastTimer = setTimeout(() => {
            if (_toastEl) {
                _toastEl.classList.remove('show');
            }
        }, 3500);
    }
}

// Refetch a ticker from anywhere in the app
async function refetchTickerSymbol(symbol, btn) {
    const sym = String(symbol || '').trim().toUpperCase();
    if (!sym) {
        return;
    }
    if (!state.avKey) {
        if (btn) {
            btn.classList.add('error');
            btn.title = 'Set your Alpha Vantage key on the Inputs tab.';
            setTimeout(() => btn.classList.remove('error'), 4000);
        }
        showToast('Add your Alpha Vantage key on the Inputs tab.', 'error');
        return;
    }
    if (btn) {
        btn.classList.remove('error');
        btn.classList.add('spinning');
    }
    showToast(`Refetching ${sym}…`, 'loading');
    // Clear cache so we go to network
    try {
        localStorage.removeItem(CACHE_PREFIX + sym);
    } catch (_) {
    }
    try {
        const onProgress = (fn, n, total) => showToast(`Refetching ${sym} · ${fn} (${n}/${total})…`, 'loading');
        const {ticker} = await handleFetch(sym, state.avKey, onProgress);
        const idx = state.tickers.findIndex(t => (t.ticker || '').toUpperCase() === sym);
        if (idx >= 0) {
            state.tickers[idx] = ticker;
        } else {
            state.tickers.unshift(ticker);
        }
        saveState();
        const s = summarize(ticker);
        showToast(`✓ ${sym} · ${ticker.sector || 'Unknown'} · ${s.overall || '—'}`, 'success');
        renderActive();
    } catch (err) {
        if (btn) {
            btn.classList.remove('spinning');
            btn.classList.add('error');
            btn.title = err.message;
            setTimeout(() => btn.classList.remove('error'), 5000);
        }
        showToast('✕ ' + (err.message || 'Fetch failed'), 'error');
    }
}

// Global click delegate for [data-refetch] elements (works on every panel)
document.addEventListener('click', e => {
    const btn = e.target.closest('[data-refetch]');
    if (!btn) {
        return;
    }
    e.preventDefault();
    refetchTickerSymbol(btn.dataset.refetch, btn);
});

// Reverse lookup: metric key -> threshold criterion key (so input cells can show their target)
const METRIC_TO_THR = (() => {
    const m = {};
    CRITERIA.forEach(sec => sec.items.forEach(it => {
        const base = it.key.replace(/_(min|max)$/, '');
        if (METRIC_DEFINITIONS[base] && !m[base]) {
            m[base] = it.key;
        }
    }));
    m.rdcf_ratio = 'rdcf_max';
    return m;
})();

function inputCellTooltip(metricKey) {
    const def = METRIC_DEFINITIONS[metricKey] || '';
    const thrKey = METRIC_TO_THR[metricKey];
    if (!thrKey) {
        return def;
    }
    const crit = CRIT_BY_KEY[thrKey];
    if (!crit) {
        return def;
    }
    const op = crit.comp === 'min' ? '≥' : '≤';
    const val = activeThreshold(thrKey);
    return `${def}\n\nThreshold (${state.profile}): ${op} ${fmt(val, crit.fmt)}`.trim();
}

function gateTooltip(gateEval) {
    const def = METRIC_DEFINITIONS[gateEval.metric] || '';
    const isYN = gateEval.thr === undefined;
    let actual, required;
    if (isYN) {
        actual = gateEval.value ? String(gateEval.value).toUpperCase() : 'n/a';
        required = 'N (no flag)';
    } else {
        const crit = CRIT_BY_KEY[gateEval.thr];
        const cfmt = crit ? crit.fmt : 'n2';
        actual = (gateEval.value === null || gateEval.value === undefined) ? 'n/a' : fmt(gateEval.value, cfmt);
        const op = crit && crit.comp === 'min' ? '≥' : '≤';
        required = `${op} ${fmt(gateEval.threshold, cfmt)}`;
    }
    return `${def}\n\nActual: ${actual}\nRequired: ${required}`.trim();
}

function gateCell(gateEval) {
    // Back-compat: if a bare bool/null was passed, render without tooltip
    if (gateEval === null || gateEval === undefined || typeof gateEval === 'boolean') {
        const pass = gateEval;
        if (pass === null || pass === undefined) {
            return `<td class="gate empty">·</td>`;
        }
        return pass ? `<td class="gate pass">✓</td>` : `<td class="gate fail">✕</td>`;
    }
    const tip = safeText(gateTooltip(gateEval));
    if (gateEval.pass === null || gateEval.pass === undefined) {
        return `<td class="gate empty" title="${tip}">·</td>`;
    }
    return gateEval.pass
           ? `<td class="gate pass" title="${tip}">✓</td>`
           : `<td class="gate fail" title="${tip}">✕</td>`;
}

function pillFor(status) {
    if (status === 'PASS') {
        return `<span class="pill pass">Pass</span>`;
    }
    if (status === 'FAIL') {
        return `<span class="pill fail">Fail</span>`;
    }
    if (status === 'BUY') {
        return `<span class="pill buy">Buy</span>`;
    }
    if (status === 'WATCH') {
        return `<span class="pill watch">Watch</span>`;
    }
    if (status === 'REJECT') {
        return `<span class="pill reject">Reject</span>`;
    }
    return `<span class="pill empty">—</span>`;
}

function safeText(s) {
    if (s === null || s === undefined) {
        return '';
    }
    return String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
}

// =============================================================================
// RENDERING — Setup
// =============================================================================

function renderSetup() {
    const root = $('#panel-setup');
    const profIdx = PROFILE_NAMES.indexOf(state.profile);

    const headerCols = `
    <div class="label">Criterion</div>
    <div>Active</div>
    <div>Override</div>
    <div>Default</div>
    ${PROFILE_NAMES.map(p => `<div class="profile-col">${p}</div>`).join('')}
    <div class="note-h">Notes</div>`;

    const rows = CRITERIA.map(sec => {
        let html = `<div class="setup-section">${sec.section} <em>${sec.items.length} criterion${sec.items.length === 1
                                                                                                 ? ''
                                                                                                 : 'a'}</em></div>`;
        html += sec.items.map(it => {
            const def = PROFILES[state.profile][it.key];
            const ov = state.overrides[it.key];
            const active = (ov !== undefined && ov !== '' && ov !== null && !Number.isNaN(Number(ov))) ? Number(ov) : def;
            const profCells = PROFILE_NAMES.map((p, i) => {
                const cls = (i === profIdx) ? 'num profcol active' : 'num profcol';
                return `<div class="${cls} profile-col">${fmt(it.values[i], it.fmt)}</div>`;
            }).join('');
            const ovStr = (ov === undefined || ov === null || ov === '') ? '' : ov;
            const rowTip = safeText(defFor(it.key));
            return `
        <div class="setup-row" data-key="${it.key}" title="${rowTip}">
          <div class="label" title="${rowTip}">${safeText(it.label)}</div>
          <div class="num active">${fmt(active, it.fmt)}</div>
          <div class="override-cell">
            <input type="text" class="cell override-input" data-override="${it.key}"
                   value="${safeText(ovStr)}" placeholder="—"/>
          </div>
          <div class="num default">${fmt(def, it.fmt)}</div>
          ${profCells}
          <div class="note">${safeText(it.note || '')}</div>
        </div>`;
        }).join('');
        return html;
    }).join('');

    root.innerHTML = `
    <div class="panel-header">
      <div>
        <div class="stage">Control Panel</div>
        <h2><em>Active</em> profile & thresholds</h2>
        <p>Switch profiles via the header pill. Override any threshold in the highlighted column to customize without editing the profile defaults.</p>
      </div>
      <div class="panel-actions">
        <button class="btn subtle" id="clearOverrides">Clear overrides</button>
        <button class="btn" id="resetAll">Reset all</button>
      </div>
    </div>
    <div class="card">
      <div class="setup-header-row">${headerCols}</div>
      ${rows}
    </div>`;

    // Wire override inputs
    root.querySelectorAll('input[data-override]').forEach(inp => {
        inp.addEventListener('input', e => {
            const k = e.target.dataset.override;
            const v = e.target.value.trim();
            if (v === '') {
                delete state.overrides[k];
            } else if (!Number.isNaN(Number(v.replace(/,/g, '').replace(/%/g, '')))) {
                state.overrides[k] = Number(v.replace(/,/g, '').replace(/%/g, ''));
            } else {
                state.overrides[k] = v;
            }
            saveState();
            // Update only the Active cell on the same row (don't rerender entire panel — keeps focus)
            const row = e.target.closest('.setup-row');
            const it = CRIT_BY_KEY[k];
            const def = PROFILES[state.profile][k];
            const ov = state.overrides[k];
            const active = (ov !== undefined && ov !== '' && ov !== null && !Number.isNaN(Number(ov))) ? Number(ov) : def;
            row.querySelector('.num.active').textContent = fmt(active, it.fmt);
        });
    });
    $('#clearOverrides').addEventListener('click', () => {
        state.overrides = {};
        saveState();
        renderSetup();
    });
    $('#resetAll').addEventListener('click', () => {
        if (!confirm('Reset profile, overrides, and all ticker data?')) {
            return;
        }
        state = defaultState();
        saveState();
        initProfileSelect();
        render();
    });
}

// =============================================================================
// RENDERING — Inputs
// =============================================================================

function renderInputs() {
    const root = $('#panel-inputs');
    const groupHead = INPUT_GROUPS.map(g =>
        `<th class="group" colspan="${g.items.length}">${g.group}</th>`).join('');
    const colHead = INPUT_GROUPS.map(g =>
        g.items.map(f => {
            const def = METRIC_DEFINITIONS[f.key] || '';
            return `<th class="${f.type === 'text' ? 'left' : 'numeric'}" title="${safeText(def)}">${safeText(f.label)}</th>`;
        }).join('')).join('');

    const rows = state.tickers.map((t, idx) => {
        const cells = INPUT_GROUPS.map(g => g.items.map(f => {
            const v = t[f.key];
            const vStr = (v === null || v === undefined) ? '' : v;
            const tip = safeText(inputCellTooltip(f.key));
            if (f.type === 'text') {
                return `<td title="${tip}"><input type="text" class="cell text" data-row="${idx}" data-key="${f.key}" value="${safeText(
                    vStr)}" title="${tip}"/></td>`;
            }
            if (f.type === 'yn') {
                return `<td title="${tip}"><select class="cell" data-row="${idx}" data-key="${f.key}" title="${tip}">
          <option value=""${vStr === '' ? ' selected' : ''}>—</option>
          <option value="N"${vStr === 'N' ? ' selected' : ''}>N</option>
          <option value="Y"${vStr === 'Y' ? ' selected' : ''}>Y</option>
        </select></td>`;
            }
            if (f.type === 'moat') {
                return `<td title="${tip}"><select class="cell" data-row="${idx}" data-key="${f.key}" title="${tip}">
          <option value=""${!vStr ? ' selected' : ''}>—</option>
          <option value="Wide"${vStr === 'Wide' ? ' selected' : ''}>Wide</option>
          <option value="Narrow"${vStr === 'Narrow' ? ' selected' : ''}>Narrow</option>
          <option value="None"${vStr === 'None' ? ' selected' : ''}>None</option>
        </select></td>`;
            }
            // Display numeric values with one decimal where appropriate, otherwise raw
            let display = vStr;
            if (typeof v === 'number') {
                display = Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2).replace(/\.?0+$/, '');
            }
            return `<td title="${tip}"><input type="text" class="cell" data-row="${idx}" data-key="${f.key}" value="${safeText(
                display)}" title="${tip}"/></td>`;
        }).join('')).join('');
        const s = summarize(t);
        const fetchedTag = t._fetched
                           ? `<td class="row-meta fetched" title="Fetched from Alpha Vantage">AV</td>`
                           : `<td class="row-meta">—</td>`;
        return `<tr data-row="${idx}">
      <td class="idx">${idx + 1}</td>
      ${fetchedTag}
      ${cells}
      <td class="verdict-cell" data-verdict="${idx}">${pillFor(s.overall)}</td>
      <td class="row-actions">
        ${t.ticker ? `<button class="refresh-btn" data-refetch="${safeText(t.ticker)}" title="Refetch ${safeText(t.ticker)} from Alpha Vantage" aria-label="Refetch ticker" style="margin-right:4px;display:inline-grid">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><polyline points="13.5 2 13.5 5.5 10 5.5"/>
          </svg>
        </button>` : ''}
        <button class="row-remove" data-action="remove" data-row="${idx}" title="Remove ${safeText(t.ticker || 'this row')}" aria-label="Remove ticker">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
            <path d="M3 4h10M6.5 4V2.5h3V4M5 4l.5 9.5h5L11 4M6.5 6.5v5M9.5 6.5v5"/>
          </svg>
        </button>
      </td>
    </tr>`;
    }).join('');

    // Live counters
    const verdicts = state.tickers.map(t => summarize(t).overall);
    const buys = verdicts.filter(v => v === 'BUY').length;
    const watches = verdicts.filter(v => v === 'WATCH').length;
    const rejects = verdicts.filter(v => v === 'REJECT').length;

    root.innerHTML = `
    <div class="panel-header">
      <div>
        <div class="stage">Fundamentals</div>
        <h2><em>Live</em> scoring</h2>
        <p>Type a ticker and press Enter — fundamentals fetch from Alpha Vantage, judgment fields auto-fill from sector medians, and every gate scores in real time. Edit any cell to refine.</p>
      </div>
    </div>

    <div class="stat-strip">
      <div class="stat"><div class="k">Tickers</div><div class="v mono" id="statTickers">${state.tickers.length}</div></div>
      <div class="stat"><div class="k">Buy</div><div class="v mono pass" id="statBuy">${buys}</div></div>
      <div class="stat"><div class="k">Watch</div><div class="v mono" style="color:var(--warn)" id="statWatch">${watches}</div></div>
      <div class="stat"><div class="k">Reject</div><div class="v mono fail" id="statReject">${rejects}</div></div>
      <div class="stat"><div class="k">Profile</div><div class="v"><em>${state.profile}</em></div></div>
    </div>

    <div class="card">
      <div class="fetch-bar">
        <div class="group">
          <label>Ticker</label>
          <input type="text" class="field ticker" id="tickerInput" placeholder="AAPL" autocomplete="off" spellcheck="false"/>
          <button class="btn primary" id="fetchBtn">Fetch & score →</button>
        </div>
        <div class="fetch-status" id="fetchStatus"></div>
        <div class="spacer"></div>
        <div class="group">
          <label><a href="https://www.alphavantage.co/support/#api-key" target="_blank" rel="noopener" title="Get a free Alpha Vantage API key">AV Key</a></label>
          <input type="password" class="field apikey" id="avKey" placeholder="paste once, saved locally" autocomplete="off" value="${safeText(
        state.avKey || '')}"/>
        </div>
      </div>
      <div class="fetch-bar" style="border-top:0; padding-top:8px; padding-bottom:8px;">
        <div class="meta"><strong>Cache:</strong> 30 days per ticker · <strong>Free tier:</strong> 25 calls/day, 5/min · <strong>5 calls</strong> per fetch · use the ↻ button on any row to force a fresh fetch</div>
        <div class="spacer"></div>
        <div class="group">
          <button class="btn subtle" id="loadSample">Sample data</button>
          <button class="btn subtle" id="addTicker">+ Blank row</button>
          <button class="btn subtle" id="exportCsv">Export</button>
          <button class="btn subtle" id="importCsv">Import</button>
          <button class="btn subtle" id="removeRejects" title="Remove all tickers with REJECT verdict">Remove rejects</button>
          <button class="btn danger" id="clearAll">Clear all</button>
          <input id="csvFile" type="file" accept=".csv" style="display:none"/>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th></th><th></th>${groupHead}<th></th><th></th></tr>
            <tr><th class="idx">#</th><th class="row-meta">Src</th>${colHead}<th>Verdict</th><th></th></tr>
          </thead>
          <tbody>${rows ||
                   `<tr><td colspan="60" class="empty-state"><div class="title">No tickers yet</div>Type a ticker above and press Enter.</td></tr>`}</tbody>
        </table>
      </div>
    </div>`;

    wireInputsEvents(root);
}

function wireInputsEvents(root) {
    // Cell edits
    root.querySelectorAll('input.cell, select.cell').forEach(inp => {
        inp.addEventListener('input', e => {
            const row = Number(e.target.dataset.row);
            const key = e.target.dataset.key;
            const val = e.target.value;
            const f = INPUT_GROUPS.flatMap(g => g.items).find(it => it.key === key);
            if (f && f.type !== 'text' && f.type !== 'yn' && f.type !== 'moat') {
                state.tickers[row][key] = parseNumber(val);
            } else {
                state.tickers[row][key] = val === '' ? null : val;
            }
            saveState();
            refreshVerdict(row);
            refreshInputsStats();
        });
    });

    // Remove row (and its AV cache so a re-fetch is fresh)
    root.querySelectorAll('button[data-action="remove"]').forEach(b => {
        b.addEventListener('click', e => {
            const idx = Number(e.currentTarget.dataset.row);
            const removed = state.tickers[idx];
            const sym = (removed?.ticker || '').toUpperCase();
            state.tickers.splice(idx, 1);
            if (sym) {
                try {
                    localStorage.removeItem(CACHE_PREFIX + sym);
                } catch (_) {
                }
            }
            saveState();
            renderInputs();
        });
    });

    // API key
    $('#avKey').addEventListener('input', e => {
        state.avKey = e.target.value.trim();
        saveState();
    });

    // Ticker fetch
    const doFetch = async () => {
        const tickerInput = $('#tickerInput');
        const symbol = (tickerInput.value || '').trim().toUpperCase();
        const status = $('#fetchStatus');
        if (!symbol) {
            status.className = 'fetch-status error';
            status.textContent = 'Enter a ticker symbol.';
            return;
        }
        if (!state.avKey) {
            status.className = 'fetch-status error';
            status.textContent = 'Add your Alpha Vantage key on the right →';
            return;
        }
        status.className = 'fetch-status loading';
        status.textContent = `Fetching ${symbol}…`;
        try {
            const onProgress = (fn, n, total) => {
                status.textContent = `Fetching ${symbol} · ${fn} (${n}/${total})…`;
            };
            const {ticker, fromCache} = await handleFetch(symbol, state.avKey, onProgress);
            const existing = state.tickers.findIndex(t => (t.ticker || '').toUpperCase() === symbol);
            if (existing >= 0) {
                state.tickers[existing] = ticker;
            } else {
                state.tickers.unshift(ticker);
            }
            saveState();
            const s = summarize(ticker);
            status.className = 'fetch-status success';
            const verdict = s.overall || 'NO VERDICT';
            const tag = fromCache ? ' (cached)' : '';
            status.textContent = `✓ ${symbol} · ${ticker.sector || 'Unknown sector'} · ${verdict}${tag}`;
            tickerInput.value = '';
            renderInputs();
        } catch (err) {
            status.className = 'fetch-status error';
            status.textContent = '✕ ' + (err.message || 'Fetch failed');
        }
    };
    $('#fetchBtn').addEventListener('click', doFetch);
    $('#tickerInput').addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            doFetch();
        }
    });
    // Auto-focus ticker input for quick entry
    setTimeout(() => $('#tickerInput')?.focus(), 50);

    // Other buttons
    $('#addTicker').addEventListener('click', () => {
        const blank = {};
        INPUT_KEYS.forEach(k => blank[k] = null);
        blank.ticker = '';
        blank.name = '';
        blank.sector = '';
        state.tickers.push(blank);
        saveState();
        renderInputs();
    });
    $('#loadSample').addEventListener('click', () => {
        if (state.tickers.length && !confirm('Replace existing tickers with sample data?')) {
            return;
        }
        state.tickers = SAMPLE_TICKERS.map(t => ({...t}));
        saveState();
        renderInputs();
    });
    $('#removeRejects').addEventListener('click', () => {
        const keep = [];
        const dropped = [];
        state.tickers.forEach(t => {
            if (summarize(t).overall === 'REJECT') {
                dropped.push(t);
            } else {
                keep.push(t);
            }
        });
        if (!dropped.length) {
            const status = $('#fetchStatus');
            status.className = 'fetch-status';
            status.textContent = 'No rejected tickers to remove.';
            return;
        }
        if (!confirm(`Remove ${dropped.length} rejected ticker(s)?`)) {
            return;
        }
        dropped.forEach(t => {
            const sym = (t.ticker || '').toUpperCase();
            if (sym) {
                try {
                    localStorage.removeItem(CACHE_PREFIX + sym);
                } catch (_) {
                }
            }
        });
        state.tickers = keep;
        saveState();
        renderInputs();
    });
    $('#clearAll').addEventListener('click', () => {
        if (!confirm('Clear all ticker rows?')) {
            return;
        }
        // Also purge AV caches so subsequent fetches are fresh
        state.tickers.forEach(t => {
            const sym = (t.ticker || '').toUpperCase();
            if (sym) {
                try {
                    localStorage.removeItem(CACHE_PREFIX + sym);
                } catch (_) {
                }
            }
        });
        state.tickers = [];
        saveState();
        renderInputs();
    });
    $('#exportCsv').addEventListener('click', exportCsv);
    $('#importCsv').addEventListener('click', () => $('#csvFile').click());
    $('#csvFile').addEventListener('change', importCsv);
}

function refreshVerdict(rowIdx) {
    const cell = document.querySelector(`#panel-inputs td[data-verdict="${rowIdx}"]`);
    if (!cell) {
        return;
    }
    const s = summarize(state.tickers[rowIdx]);
    cell.innerHTML = pillFor(s.overall);
}

function refreshInputsStats() {
    const verdicts = state.tickers.map(t => summarize(t).overall);
    const buys = verdicts.filter(v => v === 'BUY').length;
    const watches = verdicts.filter(v => v === 'WATCH').length;
    const rejects = verdicts.filter(v => v === 'REJECT').length;
    const setText = (id, val) => {
        const el = document.getElementById(id);
        if (el) {
            el.textContent = val;
        }
    };
    setText('statTickers', state.tickers.length);
    setText('statBuy', buys);
    setText('statWatch', watches);
    setText('statReject', rejects);
}

function exportCsv() {
    const fields = INPUT_KEYS;
    const lines = [fields.join(',')];
    state.tickers.forEach(t => {
        lines.push(fields.map(k => {
            const v = t[k];
            if (v === null || v === undefined) {
                return '';
            }
            const s = String(v);
            return /[,"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
        }).join(','));
    });
    const blob = new Blob([lines.join('\n')], {type: 'text/csv'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tickers.csv';
    a.click();
    URL.revokeObjectURL(url);
}

function importCsv(e) {
    const file = e.target.files[0];
    if (!file) {
        return;
    }
    const reader = new FileReader();
    reader.onload = () => {
        const text = reader.result;
        const rows = parseCsv(text);
        if (rows.length < 2) {
            alert('CSV must have header + at least one row.');
            return;
        }
        const header = rows[0];
        const newTickers = rows.slice(1).map(cols => {
            const t = {};
            INPUT_KEYS.forEach(k => t[k] = null);
            header.forEach((h, i) => {
                if (INPUT_KEYS.includes(h)) {
                    const v = cols[i];
                    const f = INPUT_GROUPS.flatMap(g => g.items).find(it => it.key === h);
                    if (f && f.type !== 'text' && f.type !== 'yn' && f.type !== 'moat') {
                        t[h] = parseNumber(v);
                    } else {
                        t[h] = v || null;
                    }
                }
            });
            return t;
        });
        if (!confirm(`Replace ${state.tickers.length} ticker(s) with ${newTickers.length} imported?`)) {
            return;
        }
        state.tickers = newTickers;
        saveState();
        renderInputs();
    };
    reader.readAsText(file);
    e.target.value = '';
}

function parseCsv(text) {
    const rows = [];
    let row = [], cell = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQ) {
            if (c === '"' && text[i + 1] === '"') {
                cell += '"';
                i++;
            } else if (c === '"') {
                inQ = false;
            } else {
                cell += c;
            }
        } else {
            if (c === '"') {
                inQ = true;
            } else if (c === ',') {
                row.push(cell);
                cell = '';
            } else if (c === '\n') {
                row.push(cell);
                rows.push(row);
                row = [];
                cell = '';
            } else if (c === '\r') {
            } else {
                cell += c;
            }
        }
    }
    if (cell !== '' || row.length) {
        row.push(cell);
        rows.push(row);
    }
    return rows;
}

// =============================================================================
// RENDERING — Scoring sheets (Quality / Valuation / Red Flags / Scenario)
// =============================================================================

function renderScoring(tab) {
    const root = $(`#panel-${tab}`);
    let title, sub, stage, gates, ynGates = [], extraCol = null;
    if (tab === 'quality') {
        title = `<em>Quality</em> screen`;
        stage = 'Stage 1 + 2';
        sub =
            'Universe filters plus profitability, balance-sheet, capital-allocation and durability gates. A ticker passes only when every gate clears.';
        gates = [...UNIVERSE_GATES.map(g => ({...g, group: 'Universe'})), ...QUALITY_GATES.map(g => ({...g, group: 'Quality'}))];
    } else if (tab === 'valuation') {
        title = `<em>Valuation</em> screen`;
        stage = 'Stage 3';
        sub = 'Six lenses on price. Requires N passes (per profile) plus minimum Margin of Safety vs. your intrinsic value.';
        gates = VALUATION_GATES.map(g => ({...g, group: 'Valuation'}));
    } else if (tab === 'redflags') {
        title = `Red <em>Flags</em>`;
        stage = 'Stage 4';
        sub = 'Forensic checks. ANY tripped flag rejects the ticker.';
        gates = REDFLAG_GATES.map(g => ({...g, group: 'Forensic'}));
        ynGates = REDFLAG_YN_GATES;
    } else if (tab === 'momentum') {
        title = `<em>Momentum</em> screen`;
        stage = 'Stage 3M';
        sub =
            'Price-based confirmation. Six trend signals — requires N passes (per profile). Auto-fetched from daily price history; analyst-driven fields default to neutral.';
        gates = MOMENTUM_GATES.map(g => ({...g, group: 'Momentum'}));
    } else if (tab === 'scenario') {
        return renderScenario();
    }

    const allGates = [...gates, ...ynGates];

    const head = `
    <tr>
      <th class="idx"></th>
      <th class="left">Ticker</th>
      <th class="left">Name</th>
      ${allGates.map(g => {
        const def = defFor(g.metric) || g.label;
        return `<th title="${safeText(def)}">${safeText(g.label)}</th>`;
    }).join('')}
      <th title="Number of gates that passed out of those with usable data.">Passes</th>
      ${tab === 'valuation' ? `<th title="${safeText(
        defFor('mos_min'))}">MoS</th><th title="Does Margin of Safety meet the profile threshold?">MoS OK</th>` : ''}
      <th title="PASS if every evaluable gate cleared; FAIL otherwise.">Verdict</th>
    </tr>`;

    const body = state.tickers.length ? state.tickers.map((t, idx) => {
        let evaluated;
        if (tab === 'quality') {
            evaluated = [...evalUniverse(t), ...evalQuality(t)];
        } else if (tab === 'valuation') {
            evaluated = evalValuation(t);
        } else if (tab === 'momentum') {
            evaluated = evalMomentum(t);
        } else if (tab === 'redflags') {
            evaluated = evalRedFlags(t);
        }

        const cells = evaluated.map(g => gateCell(g)).join('');
        const total = evaluated.length;
        const passes = passCount(evaluated);
        const ev = totalEvaluable(evaluated);
        let verdict;
        let passText = ev === 0 ? '<span class="dim">—</span>' : `${passes}/${total}`;
        let mosCells = '';
        if (tab === 'valuation') {
            const v = valuationResult(t);
            verdict = v.result;
            const mos = v.mos;
            const mosOk = v.mosOk;
            mosCells = `
        <td class="numeric ${mos === null ? 'dim' : ''}">${mos === null ? '—' : fmt(mos, 'pct')}</td>
        <td>${mosOk === null ? pillFor(null) : mosOk ? pillFor('PASS') : pillFor('FAIL')}</td>`;
        } else if (tab === 'momentum') {
            verdict = momentumResult(t).result;
        } else {
            verdict = ev === 0 ? null : (passes === ev ? 'PASS' : 'FAIL');
        }
        return `<tr>
      <td class="idx">${idx + 1}</td>
      ${tickerCell(t)}
      <td class="left dim">${safeText(t.name || '')}</td>
      ${cells}
      <td class="numeric">${passText}</td>
      ${mosCells}
      <td>${pillFor(verdict)}</td>
    </tr>`;
    }).join('') : `<tr><td colspan="${5 + allGates.length + (tab === 'valuation'
                                                             ? 2
                                                             : 0)}" class="empty-state"><div class="title">No tickers</div>Add rows on the Inputs tab.</td></tr>`;

    // Summary stat strip
    const sums = state.tickers.map(t => {
        if (tab === 'quality') {
            const arr = [...evalUniverse(t), ...evalQuality(t)];
            return {ev: totalEvaluable(arr), res: stageResult(arr)};
        }
        if (tab === 'valuation') {
            const v = valuationResult(t);
            return {ev: totalEvaluable(evalValuation(t)), res: v.result};
        }
        if (tab === 'momentum') {
            const m = momentumResult(t);
            return {ev: totalEvaluable(evalMomentum(t)), res: m.result};
        }
        if (tab === 'redflags') {
            const arr = evalRedFlags(t);
            return {ev: totalEvaluable(arr), res: stageResult(arr)};
        }
    });
    const evaluatedCount = sums.filter(s => s && s.ev > 0).length;
    const passCt = sums.filter(s => s && s.res === 'PASS').length;
    const failCt = sums.filter(s => s && s.res === 'FAIL').length;

    root.innerHTML = `
    <div class="panel-header">
      <div>
        <div class="stage">${stage}</div>
        <h2>${title}</h2>
        <p>${sub}</p>
      </div>
    </div>
    <div class="stat-strip">
      <div class="stat"><div class="k">Tickers</div><div class="v mono">${state.tickers.length}</div></div>
      <div class="stat"><div class="k">Evaluable</div><div class="v mono">${evaluatedCount}</div></div>
      <div class="stat"><div class="k">Passing</div><div class="v mono pass">${passCt}</div></div>
      <div class="stat"><div class="k">Failing</div><div class="v mono fail">${failCt}</div></div>
      <div class="stat"><div class="k">Profile</div><div class="v"><em>${state.profile}</em></div></div>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead>${head}</thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </div>`;
}

// =============================================================================
// RENDERING — Scenario
// =============================================================================

function renderScenario() {
    const root = $('#panel-scenario');
    const eirrThrDef = defFor('eirr_min');
    const head = `
    <tr>
      <th class="idx"></th>
      <th class="left">Ticker</th>
      <th class="left">Name</th>
      <th title="${safeText(METRIC_DEFINITIONS.bull_irr)}">Bull IRR</th><th title="${safeText(METRIC_DEFINITIONS.bull_p)}">Bull P</th>
      <th title="${safeText(METRIC_DEFINITIONS.base_irr)}">Base IRR</th><th title="${safeText(METRIC_DEFINITIONS.base_p)}">Base P</th>
      <th title="${safeText(METRIC_DEFINITIONS.bear_irr)}">Bear IRR</th><th title="${safeText(METRIC_DEFINITIONS.bear_p)}">Bear P</th>
      <th title="Sum of bull/base/bear probabilities. Must equal 100%.">Σ P</th>
      <th title="Probability-weighted Expected IRR = Σ (IRR × P).">E[IRR]</th>
      <th title="${safeText(eirrThrDef)}">vs. threshold</th>
      <th title="PASS if E[IRR] meets the minimum threshold for the active profile.">Verdict</th>
    </tr>`;

    const body = state.tickers.length ? state.tickers.map((t, idx) => {
        const eirr = expectedIRR(t);
        const thr = activeThreshold('eirr_min');
        const verdict = eirr === null ? null : (eirr === 'P≠100%' ? 'FAIL' : (eirr >= thr ? 'PASS' : 'FAIL'));
        const ps = [parseNumber(t.bull_p), parseNumber(t.base_p), parseNumber(t.bear_p)];
        const sumP = ps.every(p => p !== null) ? ps.reduce((a, b) => a + b, 0) : null;
        const sumPOk = sumP !== null && Math.abs(sumP - 100) <= 1;
        const eirrText = eirr === null ? '—' : (eirr === 'P≠100%' ? '<span class="pill fail">Σ P ≠ 100%</span>' : fmt(eirr, 'pct'));
        const cellTip = (label, v, fmtType) => {
            const def = METRIC_DEFINITIONS[label] || '';
            const actual = (v === null || v === undefined) ? 'n/a' : fmt(v, fmtType);
            return safeText(`${def}\n\nActual: ${actual}`);
        };
        const sumPTip = safeText(`Sum of bull/base/bear probabilities. Must equal 100%.\n\nActual: ${sumP === null ? 'n/a' : fmt(sumP,
            'pct0')}\nRequired: 100%`);
        const eirrTip = safeText(`Probability-weighted Expected IRR.\n\nActual: ${eirr === null || eirr === 'P≠100%' ? 'n/a' : fmt(eirr,
            'pct')}\nRequired: ≥ ${fmt(thr, 'pct')}`);
        return `<tr>
      <td class="idx">${idx + 1}</td>
      ${tickerCell(t)}
      <td class="left dim">${safeText(t.name || '')}</td>
      <td class="numeric" title="${cellTip('bull_irr', t.bull_irr, 'pct')}">${t.bull_irr === null || t.bull_irr === undefined ? '—' : fmt(
            t.bull_irr, 'pct')}</td>
      <td class="numeric dim" title="${cellTip('bull_p', t.bull_p, 'pct0')}">${t.bull_p === null || t.bull_p === undefined ? '—' : fmt(
            t.bull_p, 'pct0')}</td>
      <td class="numeric" title="${cellTip('base_irr', t.base_irr, 'pct')}">${t.base_irr === null || t.base_irr === undefined ? '—' : fmt(
            t.base_irr, 'pct')}</td>
      <td class="numeric dim" title="${cellTip('base_p', t.base_p, 'pct0')}">${t.base_p === null || t.base_p === undefined ? '—' : fmt(
            t.base_p, 'pct0')}</td>
      <td class="numeric" title="${cellTip('bear_irr', t.bear_irr, 'pct')}">${t.bear_irr === null || t.bear_irr === undefined ? '—' : fmt(
            t.bear_irr, 'pct')}</td>
      <td class="numeric dim" title="${cellTip('bear_p', t.bear_p, 'pct0')}">${t.bear_p === null || t.bear_p === undefined ? '—' : fmt(
            t.bear_p, 'pct0')}</td>
      <td class="numeric ${sumP === null ? 'dim' : (sumPOk ? '' : '')}" ${sumP !== null && !sumPOk
                                                                          ? 'style="color:var(--fail)"'
                                                                          : ''} title="${sumPTip}">${sumP === null ? '—' : fmt(sumP,
            'pct0')}</td>
      <td class="numeric" style="font-weight:500" title="${eirrTip}">${eirrText}</td>
      <td class="numeric dim">${'≥ ' + fmt(thr, 'pct')}</td>
      <td>${pillFor(verdict)}</td>
    </tr>`;
    }).join('') : `<tr><td colspan="13" class="empty-state"><div class="title">No tickers</div>Add rows on the Inputs tab.</td></tr>`;

    const evaluated = state.tickers.filter(t => expectedIRR(t) !== null && expectedIRR(t) !== 'P≠100%');
    const passing = evaluated.filter(t => expectedIRR(t) >= activeThreshold('eirr_min'));
    const avgEirr = evaluated.length ? evaluated.reduce((s, t) => s + expectedIRR(t), 0) / evaluated.length : null;

    root.innerHTML = `
    <div class="panel-header">
      <div>
        <div class="stage">Stage 5</div>
        <h2><em>Scenario</em> & expected IRR</h2>
        <p>Probability-weighted expected IRR over a 3–5 year horizon. Probabilities must sum to 100%. Verdict gates on the minimum E[IRR] threshold from the active profile.</p>
      </div>
    </div>
    <div class="stat-strip">
      <div class="stat"><div class="k">Tickers</div><div class="v mono">${state.tickers.length}</div></div>
      <div class="stat"><div class="k">Evaluable</div><div class="v mono">${evaluated.length}</div></div>
      <div class="stat"><div class="k">Passing</div><div class="v mono pass">${passing.length}</div></div>
      <div class="stat"><div class="k">Avg E[IRR]</div><div class="v mono">${avgEirr === null ? '—' : fmt(avgEirr, 'pct')}</div></div>
      <div class="stat"><div class="k">Threshold</div><div class="v mono">${fmt(activeThreshold('eirr_min'), 'pct')}</div></div>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table><thead>${head}</thead><tbody>${body}</tbody></table>
      </div>
    </div>`;
}

// =============================================================================
// RENDERING — Summary
// =============================================================================

function renderSummary() {
    const root = $('#panel-summary');
    const activeStages = schoolStages();
    const STAGE_LABEL = {
        universe: 'Univ',
        quality: 'Quality',
        valuation: 'Valuation',
        momentum: 'Momentum',
        redflags: 'Red Flags',
        scenario: 'Scenario'
    };
    const STAGE_TIP = {
        universe: 'Universe filters (market cap, liquidity). PASS = tradeable at your size.',
        quality: 'Quality gates (profitability, balance sheet, capital allocation, durability). PASS = every evaluable gate cleared.',
        valuation: 'Valuation gates plus Margin of Safety. PASS = ≥N criteria cleared AND MoS meets profile threshold.',
        momentum: 'Momentum gates (12-1m, 6m, 52w distance, 200d MA, RS, EPS revisions). PASS = ≥N of 6 cleared.',
        redflags: 'Forensic red flags (accruals, accounting quality, insider activity). PASS = nothing tripped.',
        scenario: 'Probability-weighted Expected IRR clears the minimum return threshold.'
    };

    const stageHeaders = activeStages.map(s =>
        `<th title="${safeText(STAGE_TIP[s] || '')}">${STAGE_LABEL[s]}</th>`).join('');

    const head = `
    <tr>
      <th class="idx"></th>
      <th class="left">Ticker</th>
      <th class="left">Name</th>
      <th class="left">Sector</th>
      ${stageHeaders}
      <th title="Count of stages passed out of those with enough data to evaluate.">Stages</th>
      <th title="Overall verdict. BUY = all stages passed. WATCH = all but one. REJECT = fewer.">Verdict</th>
      <th title="Probability-weighted Expected IRR (3–5 year horizon).">E[IRR]</th>
      <th title="${safeText(CRITERION_EXTRA_DEFS.mos_min)}">MoS</th>
      <th class="left" title="${safeText(METRIC_DEFINITIONS.moat)}">Moat</th>
    </tr>`;

    const rows = state.tickers.map((t, idx) => {
        const s = summarize(t);
        return {t, idx, s};
    });
    // Sort: BUY first, then WATCH, then REJECT, then null. Within each, by E[IRR] desc.
    rows.sort((a, b) => {
        const rank = v => v === 'BUY' ? 0 : v === 'WATCH' ? 1 : v === 'REJECT' ? 2 : 3;
        const r = rank(a.s.overall) - rank(b.s.overall);
        if (r !== 0) {
            return r;
        }
        const ea = a.s.eirr, eb = b.s.eirr;
        const na = (ea === null || ea === 'P≠100%') ? -Infinity : ea;
        const nb = (eb === null || eb === 'P≠100%') ? -Infinity : eb;
        return nb - na;
    });

    const body = rows.length ? rows.map(({t, idx, s}) => {
        const cellFor = res => res === null ? `<td>${pillFor(null)}</td>` : `<td>${pillFor(res)}</td>`;
        const stageCells = activeStages.map(name => cellFor(s.stageResults[name])).join('');
        return `<tr>
      <td class="idx">${idx + 1}</td>
      ${tickerCell(t)}
      <td class="left dim">${safeText(t.name || '')}</td>
      <td class="left dim">${safeText(t.sector || '')}</td>
      ${stageCells}
      <td class="numeric">${s.stagesEval === 0 ? '<span class="dim">—</span>' : `${s.stagesPassed}/${s.stagesEval}`}</td>
      <td>${pillFor(s.overall)}</td>
      <td class="numeric">${s.eirr === null || s.eirr === 'P≠100%' ? '—' : fmt(s.eirr, 'pct')}</td>
      <td class="numeric">${s.val.mos === null ? '—' : fmt(s.val.mos, 'pct')}</td>
      <td class="left dim">${safeText(t.moat || '')}</td>
    </tr>`;
    }).join('') : `<tr><td colspan="${9 +
                                      activeStages.length}" class="empty-state"><div class="title">No tickers</div>Add rows on the Inputs tab.</td></tr>`;

    const buys = rows.filter(r => r.s.overall === 'BUY').length;
    const watches = rows.filter(r => r.s.overall === 'WATCH').length;
    const rejects = rows.filter(r => r.s.overall === 'REJECT').length;

    root.innerHTML = `
    <div class="panel-header">
      <div>
        <div class="stage">${activeStages.length} stages · ${state.school}</div>
        <h2><em>Summary</em> & verdicts</h2>
        <p>Final stage pass/fail and overall verdict. BUY = passes all stages, WATCH = all but one, REJECT = fewer.</p>
      </div>
    </div>
    <div class="stat-strip">
      <div class="stat"><div class="k">Tickers</div><div class="v mono">${state.tickers.length}</div></div>
      <div class="stat"><div class="k">Buy</div><div class="v mono pass">${buys}</div></div>
      <div class="stat"><div class="k">Watch</div><div class="v mono" style="color:var(--warn)">${watches}</div></div>
      <div class="stat"><div class="k">Reject</div><div class="v mono fail">${rejects}</div></div>
      <div class="stat"><div class="k">School</div><div class="v"><em>${state.school}</em></div></div>
      <div class="stat"><div class="k">Profile</div><div class="v"><em>${state.profile}</em></div></div>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table><thead>${head}</thead><tbody>${body}</tbody></table>
      </div>
    </div>`;
}

// =============================================================================
// RENDERING — Portfolio
// =============================================================================

function renderPortfolio() {
    const root = $('#panel-portfolio');
    const maxPos = activeThreshold('maxpos');
    const kellyMult = activeThreshold('kelly_mult');
    const target = activeThreshold('target_holdings');

    const head = `
    <tr>
      <th class="idx"></th>
      <th class="left">Ticker</th>
      <th title="Overall verdict from the Summary panel.">Verdict</th>
      <th title="Probability-weighted Expected IRR (3–5y horizon).">E[IRR]</th>
      <th title="Win probability = sum of probabilities assigned to scenarios with positive IRR.">Win P</th>
      <th title="Win/Loss ratio = expected positive IRR divided by absolute expected negative IRR. Higher = better asymmetric payoff.">Win/Loss</th>
      <th title="Full Kelly fraction = (p·b − (1−p)) / b, where p = win probability and b = win/loss ratio. The mathematically optimal bet size — usually too aggressive in practice.">Kelly f*</th>
      <th title="Adjusted Kelly = full Kelly × Kelly multiplier from active profile (typically 0.5 for half-Kelly). The dampened, practical sizing.">Adj. Kelly</th>
      <th title="${safeText(CRITERION_EXTRA_DEFS.maxpos)}">Cap</th>
      <th title="Suggested position size = min(Adjusted Kelly, position cap). Zero if not rated BUY.">Suggested</th>
      <th class="left">Sector</th>
    </tr>`;

    const rows = state.tickers.map((t, idx) => {
        const s = summarize(t);
        const ws = winStats(t);
        const kf = kellyFraction(t);
        const adj = kf === null ? null : kf * kellyMult * 100; // kelly is fraction (0..1), adj is also fraction but we want pct display; convert to percent
        const cap = maxPos;
        const suggested = (s.overall === 'BUY' && adj !== null) ? Math.min(adj, cap) : 0;
        return {t, idx, s, ws, kf, adj, cap, suggested};
    });

    // Sort BUY first, then by suggested desc
    rows.sort((a, b) => {
        const rank = v => v === 'BUY' ? 0 : v === 'WATCH' ? 1 : v === 'REJECT' ? 2 : 3;
        const r = rank(a.s.overall) - rank(b.s.overall);
        if (r !== 0) {
            return r;
        }
        return b.suggested - a.suggested;
    });

    const totalSuggested = rows.reduce((s, r) => s + r.suggested, 0);
    const sectorMix = {};
    rows.forEach(r => {
        if (r.suggested > 0) {
            const sec = r.t.sector || 'Unclassified';
            sectorMix[sec] = (sectorMix[sec] || 0) + r.suggested;
        }
    });
    const sectorList = Object.entries(sectorMix).sort((a, b) => b[1] - a[1]);

    const body = rows.length ? rows.map(({t, idx, s, ws, kf, adj, cap, suggested}) => `
    <tr ${suggested > 0 ? 'style="background:var(--pass-soft)"' : ''}>
      <td class="idx">${idx + 1}</td>
      ${tickerCell(t)}
      <td>${pillFor(s.overall)}</td>
      <td class="numeric">${s.eirr === null || s.eirr === 'P≠100%' ? '—' : fmt(s.eirr, 'pct')}</td>
      <td class="numeric">${ws === null ? '—' : fmt(ws.p * 100, 'pct0')}</td>
      <td class="numeric">${ws === null ? '—' : fmt(ws.b, 'n2')}</td>
      <td class="numeric">${kf === null ? '—' : fmt(kf * 100, 'pct')}</td>
      <td class="numeric">${adj === null ? '—' : fmt(adj, 'pct')}</td>
      <td class="numeric dim">${fmt(cap, 'pct')}</td>
      <td class="numeric" style="font-weight:600">${suggested > 0 ? fmt(suggested, 'pct') : '<span class="dim">—</span>'}</td>
      <td class="left dim">${safeText(t.sector || '')}</td>
    </tr>`).join('') : `<tr><td colspan="11" class="empty-state"><div class="title">No tickers</div>Add rows on the Inputs tab.</td></tr>`;

    const namesWithWeight = rows.filter(r => r.suggested > 0).length;

    root.innerHTML = `
    <div class="panel-header">
      <div>
        <div class="stage">Stage 6</div>
        <h2><em>Portfolio</em> construction</h2>
        <p>Half-Kelly position sizing for BUY-rated names, capped by profile maximum and ADV liquidity. Sum of suggested weights tells you how much dry powder remains.</p>
      </div>
    </div>
    <div class="stat-strip">
      <div class="stat"><div class="k">Buy names</div><div class="v mono pass">${namesWithWeight}</div></div>
      <div class="stat"><div class="k">Target holdings</div><div class="v mono">${target}</div></div>
      <div class="stat"><div class="k">Suggested total</div><div class="v mono">${fmt(totalSuggested, 'pct')}</div></div>
      <div class="stat"><div class="k">Cash buffer</div><div class="v mono">${fmt(Math.max(0, 100 - totalSuggested), 'pct')}</div></div>
      <div class="stat"><div class="k">Kelly × ${fmt(kellyMult, 'n2')}</div><div class="v"><em>${state.profile}</em></div></div>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table><thead>${head}</thead><tbody>${body}</tbody></table>
      </div>
    </div>
    ${sectorList.length ? `
    <div class="card">
      <div class="card-title-row">
        <div>
          <div class="kicker">Sector allocation</div>
          <div class="title"><em>Concentration</em> by GICS sector</div>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th class="left">Sector</th><th>Weight</th><th>vs. cap (${fmt(activeThreshold('maxsector'), 'pct')})</th></tr></thead>
          <tbody>
            ${sectorList.map(([sec, w]) => {
        const cap = activeThreshold('maxsector');
        const over = w > cap;
        return `<tr><td class="left">${safeText(sec)}</td><td class="numeric">${fmt(w, 'pct')}</td><td>${over ? pillFor('FAIL') : pillFor(
            'PASS')}</td></tr>`;
    }).join('')}
          </tbody>
        </table>
      </div>
    </div>` : ''}`;
}

// =============================================================================
// RENDER ROUTING & EVENT WIRING
// =============================================================================

function renderActive() {
    const tab = state.activeTab;
    if (tab === 'setup') {
        renderSetup();
    } else if (tab === 'inputs') {
        renderInputs();
    } else if (tab === 'quality' || tab === 'valuation' || tab === 'momentum' || tab === 'redflags') {
        renderScoring(tab);
    } else if (tab === 'scenario') {
        renderScenario();
    } else if (tab === 'summary') {
        renderSummary();
    } else if (tab === 'portfolio') {
        renderPortfolio();
    }
}

function applyTabVisibility() {
    const active = schoolStages();
    $$('#tabs button[data-stage]').forEach(b => {
        b.style.display = active.includes(b.dataset.stage) ? '' : 'none';
    });
    // If current tab is now hidden, redirect to setup
    const cur = document.querySelector(`#tabs button[data-tab="${state.activeTab}"]`);
    if (cur && cur.style.display === 'none') {
        setTab('setup');
    }
}

function setTab(tab) {
    // Don't navigate into a tab the active school disables
    const btn = document.querySelector(`#tabs button[data-tab="${tab}"]`);
    if (btn && btn.dataset.stage && !schoolStages().includes(btn.dataset.stage)) {
        tab = 'setup';
    }
    state.activeTab = tab;
    saveState();
    $$('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $$('section.panel').forEach(p => p.classList.toggle('active', p.id === `panel-${tab}`));
    renderActive();
}

function setTheme(theme) {
    state.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    saveState();
    // Update icon
    const icon = $('#themeIcon');
    if (theme === 'dark') {
        icon.innerHTML = '<path d="M20 14.3A8.5 8.5 0 1 1 9.7 4a7 7 0 0 0 10.3 10.3Z"/>';
    } else {
        icon.innerHTML =
            '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>';
    }
}

function initProfileSelect() {
    const sel = $('#profileSelect');
    sel.innerHTML = PROFILE_NAMES.map(p => `<option value="${p}"${p === state.profile ? ' selected' : ''}>${p}</option>`).join('');
}

function initSchoolSelect() {
    const sel = $('#schoolSelect');
    sel.innerHTML = SCHOOL_NAMES.map(s => `<option value="${s}"${s === state.school ? ' selected' : ''}>${s}</option>`).join('');
}

function render() {
    renderActive();
}

// =============================================================================
// INIT
// =============================================================================

// Migrate old saved state that has no school
if (!state.school || !SCHOOLS[state.school]) {
    state.school = 'Quality + Value';
}

document.documentElement.setAttribute('data-theme', state.theme);
setTheme(state.theme);
initSchoolSelect();
initProfileSelect();
applyTabVisibility();

$$('#tabs button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
$('#schoolSelect').addEventListener('change', e => {
    state.school = e.target.value;
    saveState();
    applyTabVisibility();
    renderActive();
});
$('#profileSelect').addEventListener('change', e => {
    state.profile = e.target.value;
    saveState();
    renderActive();
});
$('#themeToggle').addEventListener('click', () => {
    setTheme(state.theme === 'light' ? 'dark' : 'light');
});

// Activate the saved tab
setTab(state.activeTab);

// Keyboard: cmd/ctrl+number to switch tabs (visible tabs only)
document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key >= '1' && e.key <= '9') {
        const visible = $$('#tabs button').filter(b => b.style.display !== 'none');
        const idx = Number(e.key) - 1;
        if (visible[idx]) {
            setTab(visible[idx].dataset.tab);
            e.preventDefault();
        }
    }
});
