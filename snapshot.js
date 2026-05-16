// =============================================================================
// SECTOR FLOWS — net buying-pressure proxy from monthly ETF data
// =============================================================================

const SECTORS = [
    {name: 'Technology', etf: 'XLK', tickers: ['NVDA', 'AAPL', 'MSFT', 'AVGO', 'ORCL', 'CRM', 'CSCO']},
    {name: 'Communication Services', etf: 'XLC', tickers: ['GOOGL', 'META', 'NFLX', 'TMUS', 'DIS', 'T', 'CMCSA']},
    {name: 'Financials', etf: 'XLF', tickers: ['BRK.B', 'JPM', 'V', 'MA', 'BAC', 'WFC', 'GS']},
    {name: 'Health Care', etf: 'XLV', tickers: ['LLY', 'UNH', 'JNJ', 'ABBV', 'MRK', 'ABT', 'TMO']},
    {name: 'Consumer Discretionary', etf: 'XLY', tickers: ['AMZN', 'TSLA', 'HD', 'MCD', 'LOW', 'BKNG', 'TJX']},
    {name: 'Consumer Staples', etf: 'XLP', tickers: ['WMT', 'COST', 'PG', 'KO', 'PEP', 'PM', 'MO']},
    {name: 'Energy', etf: 'XLE', tickers: ['XOM', 'CVX', 'COP', 'EOG', 'MPC', 'PSX', 'SLB']},
    {name: 'Industrials', etf: 'XLI', tickers: ['GE', 'RTX', 'CAT', 'BA', 'HON', 'UBER', 'UNP']},
    {name: 'Materials', etf: 'XLB', tickers: ['LIN', 'SHW', 'ECL', 'FCX', 'APD', 'NEM', 'DD']},
    {name: 'Real Estate', etf: 'XLRE', tickers: ['PLD', 'AMT', 'EQIX', 'WELL', 'SPG', 'PSA', 'CCI']},
    {name: 'Utilities', etf: 'XLU', tickers: ['NEE', 'SO', 'DUK', 'CEG', 'SRE', 'AEP', 'D']}
];

// =============================================================================
// HELPERS
// =============================================================================

function avNum(v) {
    if (v === null || v === undefined || v === 'None' || v === '-' || v === '') {
        return null;
    }
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

const AV_MIN_GAP_MS = 1500;
let _avLastCallAt = 0;
const _avSleep = (ms) => new Promise(res => setTimeout(res, ms));

async function _avCall(fn, symbol, key) {
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

// =============================================================================
// STATE (shared key with stocks.html via the same STORAGE_KEY)
// =============================================================================

const STORAGE_KEY = 'qvs.state.v1';
const CACHE_PREFIX = 'qvs.cache.monthly.';
const CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

const defaultState = () => ({
    theme: 'light',
    avKey: '',
    window: 1
});

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

let state = loadState();
const WINDOWS = [1, 3, 6, 12];
if (!WINDOWS.includes(state.window)) {
    state.window = 1;
}

// URL params can anchor the view to a historical month (set by sectors.html on click).
// These are transient — not persisted to localStorage.
const urlParams = new URLSearchParams(window.location.search);
const urlWindow = parseInt(urlParams.get('window'), 10);
if (WINDOWS.includes(urlWindow)) {
    state.window = urlWindow;
}
const anchorMonth = urlParams.get('month');  // 'YYYY-MM' or null

// =============================================================================
// AV FETCH — monthly bars per ETF, with localStorage cache
// =============================================================================

async function fetchMonthly(etf, key) {
    const cacheKey = CACHE_PREFIX + etf;
    let parsed = null;
    try {
        const raw = localStorage.getItem(cacheKey);
        if (raw) {
            parsed = JSON.parse(raw);
        }
    } catch (e) {
    }
    if (parsed && Date.now() - parsed.fetchedAt < CACHE_TTL_MS) {
        if (parsed.error) {
            // sectors.js caches fetch failures; re-throw so the cell shows the error.
            throw new Error(parsed.error);
        }
        if (parsed.bars) {
            return parsed.bars;
        }
    }
    try {
        const j = await _avCall('TIME_SERIES_MONTHLY', etf, key);
        const series = j['Monthly Time Series'];
        if (!series) {
            throw new Error('No monthly series returned for ' + etf);
        }
        const bars = Object.keys(series).sort().reverse().map(date => ({
            date,
            close: avNum(series[date]['4. close']),
            volume: avNum(series[date]['5. volume'])
        })).filter(b => b.close !== null && b.volume !== null);
        try {
            localStorage.setItem(cacheKey, JSON.stringify({fetchedAt: Date.now(), bars}));
        } catch (e) {
        }
        return bars;
    } catch (e) {
        try {
            localStorage.setItem(cacheKey, JSON.stringify({
                fetchedAt: Date.now(),
                error: e.message || String(e)
            }));
        } catch (storeErr) {
        }
        throw e;
    }
}

async function fetchAllSectors(key, onProgress, force) {
    const out = [];
    for (let i = 0; i < SECTORS.length; i++) {
        const s = SECTORS[i];
        if (onProgress) {
            onProgress(i + 1, SECTORS.length, s.etf);
        }
        try {
            if (force) {
                localStorage.removeItem(CACHE_PREFIX + s.etf);
            }
            const bars = await fetchMonthly(s.etf, key);
            out.push({...s, bars, error: null});
        } catch (e) {
            out.push({...s, bars: null, error: e.message || String(e)});
        }
    }
    return out;
}

// =============================================================================
// COMPUTATION — net buying pressure proxy
// =============================================================================

// Walk `count` months starting at index `fromIdx` (newest-first array).
// signedFlow per month = close × volume × sign(close − prev_close)
// Returns net dollar flow over the window (signed).
function netDollarVol(bars, fromIdx, count) {
    let sum = 0;
    for (let i = fromIdx; i < fromIdx + count; i++) {
        const cur = bars[i];
        const prev = bars[i + 1];
        if (!cur || !prev) {
            continue;
        }
        const sign = cur.close > prev.close ? 1 : (cur.close < prev.close ? -1 : 0);
        sum += cur.close * cur.volume * sign;
    }
    return sum;
}

// If anchorYm is set, slide the "current period" window so it ends with that month.
// Otherwise default to the most recent month (offset 0).
function findAnchorOffset(bars, anchorYm) {
    if (!anchorYm) {
        return 0;
    }
    for (let i = 0; i < bars.length; i++) {
        if (bars[i].date.startsWith(anchorYm)) {
            return i;
        }
    }
    return -1;  // month not in this sector's history
}

function computeCells(sectors, windowN, anchorYm) {
    return sectors.map(s => {
        if (!s.bars) {
            return {
                name: s.name, etf: s.etf, tickers: s.tickers,
                value: 0, delta: 0, error: s.error || 'No data'
            };
        }
        const fromIdx = findAnchorOffset(s.bars, anchorYm);
        if (fromIdx < 0) {
            return {
                name: s.name, etf: s.etf, tickers: s.tickers,
                value: 0, delta: 0, error: `Month ${anchorYm} not available`
            };
        }
        if (s.bars.length < fromIdx + windowN * 2 + 1) {
            return {
                name: s.name, etf: s.etf, tickers: s.tickers,
                value: 0, delta: 0, error: s.error || 'Insufficient history'
            };
        }
        const current = netDollarVol(s.bars, fromIdx, windowN);
        const previous = netDollarVol(s.bars, fromIdx + windowN, windowN);
        return {
            name: s.name, etf: s.etf, tickers: s.tickers,
            value: current, delta: current - previous, error: null
        };
    });
}

// =============================================================================
// TREEMAP — squarified algorithm
// Reference: Bruls, Huijsen, van Wijk (2000)
// =============================================================================

function layoutTreemap(cells, width, height) {
    // Cells sized by abs(value), with a floor so tiny cells stay readable.
    const totalAbs = cells.reduce((s, c) => s + Math.abs(c.value), 0);
    const totalArea = width * height;
    if (totalAbs <= 0) {
        // Everything is zero — fall back to equal sizing, scaled to fill the rect.
        const equalArea = totalArea / cells.length;
        const items = cells.map(c => ({cell: c, area: equalArea}));
        return squarify(items, width, height);
    }
    const floor = 0.01;  // 1% area floor
    const items = cells.map(c => {
        const raw = Math.abs(c.value) / totalAbs;
        return {cell: c, weight: Math.max(raw, floor)};
    });
    // Re-normalise after flooring
    const wSum = items.reduce((s, it) => s + it.weight, 0);
    items.forEach(it => {
        it.area = (it.weight / wSum) * totalArea;
    });
    // Sort descending so the algorithm packs largest first
    items.sort((a, b) => b.area - a.area);
    return squarify(items, width, height);
}

function squarify(items, width, height) {
    const results = [];
    const remaining = items.slice();
    let x = 0, y = 0, w = width, h = height;
    let row = [];
    let rowSum = 0;

    while (remaining.length) {
        const next = remaining[0];
        const sideShort = Math.min(w, h);
        const candidate = row.concat([next]);
        const candidateSum = rowSum + next.area;
        const currentWorst = worstAspect(row, rowSum, sideShort);
        const newWorst = worstAspect(candidate, candidateSum, sideShort);

        if (row.length === 0 || newWorst <= currentWorst) {
            row = candidate;
            rowSum = candidateSum;
            remaining.shift();
        } else {
            // Emit current row, advance the layout rect along the long side
            const placed = placeRow(row, rowSum, x, y, w, h);
            results.push(...placed);
            if (w >= h) {
                const rowW = rowSum / h;
                x += rowW;
                w -= rowW;
            } else {
                const rowH = rowSum / w;
                y += rowH;
                h -= rowH;
            }
            row = [];
            rowSum = 0;
        }
    }
    // Emit final row
    if (row.length) {
        const placed = placeRow(row, rowSum, x, y, w, h);
        results.push(...placed);
    }
    return results;
}

function worstAspect(row, rowSum, sideShort) {
    if (row.length === 0 || rowSum <= 0) {
        return Infinity;
    }
    const sideShortSq = sideShort * sideShort;
    const rowSumSq = rowSum * rowSum;
    let max = 0;
    for (const it of row) {
        const r1 = (sideShortSq * it.area) / rowSumSq;
        const r2 = rowSumSq / (sideShortSq * it.area);
        if (r1 > max) {
            max = r1;
        }
        if (r2 > max) {
            max = r2;
        }
    }
    return max;
}

function placeRow(row, rowSum, x, y, w, h) {
    const out = [];
    if (w >= h) {
        // Lay items in a vertical column on the left of the remaining rect
        const colW = rowSum / h;
        let cy = y;
        for (const it of row) {
            const ih = it.area / colW;
            out.push({cell: it.cell, x, y: cy, w: colW, h: ih});
            cy += ih;
        }
    } else {
        // Horizontal row across the top
        const rowH = rowSum / w;
        let cx = x;
        for (const it of row) {
            const iw = it.area / rowH;
            out.push({cell: it.cell, x: cx, y, w: iw, h: rowH});
            cx += iw;
        }
    }
    return out;
}

// =============================================================================
// FORMATTING
// =============================================================================

function fmtMoney(n) {
    if (n === 0 || n === null || n === undefined || !Number.isFinite(n)) {
        return '$0.0B';
    }
    const sign = n < 0 ? '−' : '';
    return `${sign}$${(Math.abs(n) / 1e9).toFixed(1)}B`;
}

function fmtDelta(d, current, previous) {
    if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) {
        return '—';
    }
    const pct = (d / Math.abs(previous)) * 100;
    const sign = d > 0 ? '+' : (d < 0 ? '−' : '±');
    const absD = Math.abs(d);
    const moneyPart = sign + fmtMoney(absD).replace('−', '');
    const pctPart = (pct >= 0 ? '+' : '−') + Math.abs(pct).toFixed(0) + '%';
    return `${moneyPart} vs prev (${pctPart})`;
}

const MONTH_NAMES_SECTORS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtYm(ym) {
    if (!ym) {
        return '';
    }
    const [y, m] = ym.split('-');
    return `${MONTH_NAMES_SECTORS[Number(m) - 1]} ${y}`;
}

// =============================================================================
// RENDERING
// =============================================================================

const gridEl = document.getElementById('sectorGrid');
const statusEl = document.getElementById('status');

let lastSectors = null;   // array from fetchAllSectors (with bars + error)
let isFetching = false;

function setStatus(text, kind, isHtml) {
    if (!text) {
        statusEl.hidden = true;
        statusEl.textContent = '';
        statusEl.removeAttribute('data-kind');
        return;
    }
    statusEl.hidden = false;
    if (isHtml) {
        statusEl.innerHTML = text;
    } else {
        statusEl.textContent = text;
    }
    statusEl.setAttribute('data-kind', kind || 'info');
}

function getCurrentMonth() {
    if (anchorMonth) {
        return anchorMonth;
    }
    if (!lastSectors) {
        return null;
    }
    for (const s of lastSectors) {
        if (s.bars && s.bars[0]) {
            return s.bars[0].date.slice(0, 7);
        }
    }
    return null;
}

function isAtLatest() {
    if (!anchorMonth || !lastSectors) {
        return true;
    }
    for (const s of lastSectors) {
        if (s.bars && s.bars[0]) {
            return s.bars[0].date.startsWith(anchorMonth);
        }
    }
    return true;
}

function setIdleStatus(fallback) {
    const month = getCurrentMonth();
    if (month) {
        const link = isAtLatest()
                     ? ''
                     : ` · <a href="snapshot.html?window=${state.window}">Reset to now</a>`;
        setStatus(`Viewing ${state.window}M ending ${fmtYm(month)}${link}`, 'info', true);
    } else if (fallback) {
        setStatus(fallback, 'info');
    } else {
        setStatus('', null);
    }
}

function partialFailStatus(failedSectors) {
    const etfs = failedSectors.map(s => s.etf).join(', ');
    return `${failedSectors.length} sector(s) failed: ${etfs} · ` +
           `<a href="#" data-action="reload-failed">Reload failed</a>`;
}

async function reloadFailed() {
    if (isFetching || !lastSectors) {
        return;
    }
    const failedSectors = lastSectors.filter(s => s.error);
    if (!failedSectors.length) {
        return;
    }
    isFetching = true;
    try {
        for (let i = 0; i < failedSectors.length; i++) {
            const s = failedSectors[i];
            setStatus(`Retrying ${i + 1} of ${failedSectors.length} — ${s.etf}…`, 'info');
            const idx = lastSectors.findIndex(x => x.etf === s.etf);
            if (idx < 0) {
                continue;
            }
            try {
                localStorage.removeItem(CACHE_PREFIX + s.etf);
                const bars = await fetchMonthly(s.etf, state.avKey);
                lastSectors[idx] = {...lastSectors[idx], bars, error: null};
            } catch (e) {
                lastSectors[idx] = {...lastSectors[idx], bars: null, error: e.message || String(e)};
            }
        }
        const stillFailed = lastSectors.filter(s => s.error);
        if (stillFailed.length) {
            setStatus(partialFailStatus(stillFailed), 'error', true);
        } else {
            setIdleStatus();
        }
        renderGrid();
        syncUrlParams();
    } finally {
        isFetching = false;
    }
}

function renderEmpty(message) {
    gridEl.innerHTML = `<div class="sector-grid-empty">${message}</div>`;
}

function tickerHref(t) {
    // Yahoo Finance uses '-' instead of '.' (e.g. BRK.B → BRK-B)
    return 'https://finance.yahoo.com/quote/' + encodeURIComponent(t.replace(/\./g, '-'));
}

function renderGrid() {
    if (!lastSectors) {
        renderEmpty('Enter your free Alpha Vantage key above, then press refresh.');
        return;
    }
    // clientWidth/Height = inner content box (excludes the 1px border) so cells
    // tile flush against the inside of the grid's border without overlapping it.
    const W = Math.max(0, gridEl.clientWidth);
    const H = Math.max(0, gridEl.clientHeight);
    if (W === 0 || H === 0) {
        return;
    }
    const cells = computeCells(lastSectors, state.window, anchorMonth);
    const placements = layoutTreemap(cells, W, H);

    gridEl.innerHTML = '';
    for (const p of placements) {
        const {cell, x, y, w, h} = p;
        const el = document.createElement('div');
        el.className = 'sector-cell';
        el.style.left = x + 'px';
        el.style.top = y + 'px';
        el.style.width = w + 'px';
        el.style.height = h + 'px';
        // `--cell-scale` is the cell's area in thousands of square pixels — used
        // by snapshot.css so font sizes scale with area (≈ net in/out magnitude)
        // instead of just cell width.
        el.style.setProperty('--cell-scale', `${(w * h) / 1000}px`);

        let flow = 'na';
        if (cell.error) {
            flow = 'na';
        } else if (cell.value > 0) {
            flow = 'in';
        } else if (cell.value < 0) {
            flow = 'out';
        }
        el.setAttribute('data-flow', flow);

        const flowLabel = cell.error
                          ? '—'
                          : (cell.value > 0 ? '▲ Net In' : (cell.value < 0 ? '▼ Net Out' : '◆ Flat'));
        const valueText = cell.error
                          ? cell.error
                          : `<strong>${flowLabel}</strong> ${fmtMoney(Math.abs(cell.value))}`;
        const previous = cell.value - cell.delta;
        const deltaText = cell.error ? '' : fmtDelta(cell.delta, cell.value, previous);
        const tickerList = cell.tickers.map(t =>
            `<li><a href="${tickerHref(t)}" target="_blank" rel="noopener">${t}</a></li>`
        ).join('');

        el.innerHTML = `
            <div class="sector-head">
              <span class="sector-name serif">${cell.name}</span>
              <span class="sector-etf"><a href="${tickerHref(cell.etf)}" target="_blank" rel="noopener">${cell.etf}</a></span>
            </div>
            <div class="sector-mid">
              <div class="sector-value">${valueText}</div>
              <div class="sector-delta">${deltaText}</div>
            </div>
            <ul class="sector-tickers">${tickerList}</ul>
        `;
        gridEl.appendChild(el);
    }
}

// =============================================================================
// CONTROLLER
// =============================================================================

async function refresh(force) {
    if (isFetching) {
        return;
    }
    if (!state.avKey) {
        renderEmpty(
            'Enter your free Alpha Vantage key above, then press refresh. <br><br><a href="https://www.alphavantage.co/support/#api-key" target="_blank" rel="noopener">Get a free key →</a>');
        setStatus('No API key set.', 'info');
        return;
    }
    isFetching = true;
    setStatus(`Fetching 1 of ${SECTORS.length}…`, 'info');
    try {
        lastSectors = await fetchAllSectors(state.avKey, (i, n, etf) => {
            setStatus(`Fetching ${i} of ${n} — ${etf}…`, 'info');
        }, !!force);
        const failed = lastSectors.filter(s => s.error);
        if (failed.length) {
            setStatus(partialFailStatus(failed), 'error', true);
        } else {
            setIdleStatus();
        }
        renderGrid();
        syncUrlParams();
    } catch (e) {
        setStatus(e.message || String(e), 'error');
    } finally {
        isFetching = false;
    }
}

// ---- Theme ----
function applyTheme() {
    document.documentElement.setAttribute('data-theme', state.theme);
}

applyTheme();

document.getElementById('themeToggle').addEventListener('click', () => {
    state.theme = state.theme === 'light' ? 'dark' : 'light';
    applyTheme();
    saveState();
});

// ---- Window selector ----
const windowButtons = document.querySelectorAll('.segmented-buttons button');

function applyWindowButtons() {
    windowButtons.forEach(b => {
        b.classList.toggle('active', Number(b.dataset.window) === state.window);
    });
}

applyWindowButtons();

function syncUrlParams() {
    const params = new URLSearchParams(window.location.search);
    params.set('window', state.window);
    const month = getCurrentMonth();
    if (month) {
        params.set('month', month);
    }
    const search = params.toString();
    history.replaceState(null, '', window.location.pathname + (search ? '?' + search : '') + window.location.hash);
}

windowButtons.forEach(b => b.addEventListener('click', () => {
    state.window = Number(b.dataset.window);
    saveState();
    applyWindowButtons();
    renderGrid();
    setIdleStatus();
    syncUrlParams();
}));

// ---- AV key input ----
const keyInput = document.getElementById('avKeyInput');
keyInput.value = state.avKey || '';
keyInput.addEventListener('change', () => {
    state.avKey = keyInput.value.trim();
    saveState();
    // Auto-refresh on first key entry if cache is empty
    if (state.avKey && !lastSectors) {
        refresh(false);
    }
});

// ---- Refresh ----
document.getElementById('refreshBtn').addEventListener('click', () => refresh(true));

// Status-bar event delegation: the "Reload failed" link sits inside the status
// message HTML, so it gets re-created on every status update.
statusEl.addEventListener('click', (e) => {
    const link = e.target.closest('[data-action="reload-failed"]');
    if (link) {
        e.preventDefault();
        reloadFailed();
    }
});

// ---- Resize ----
const ro = new ResizeObserver(() => {
    if (lastSectors) {
        renderGrid();
    }
});
ro.observe(gridEl);

// ---- Boot ----
// Try a passive load from cache without triggering fresh fetches.
(async function boot() {
    if (!state.avKey) {
        renderEmpty(
            'Enter your free Alpha Vantage key above, then press refresh. <br><br><a href="https://www.alphavantage.co/support/#api-key" target="_blank" rel="noopener">Get a free key →</a>');
        return;
    }
    // Load whatever cache we have (successes AND failures). A `null` entry
    // means we've never tried this ETF, so we still need to fetch it.
    const cachedAll = SECTORS.map(s => {
        try {
            const raw = localStorage.getItem(CACHE_PREFIX + s.etf);
            if (!raw) {
                return null;
            }
            const parsed = JSON.parse(raw);
            if (Date.now() - parsed.fetchedAt >= CACHE_TTL_MS) {
                return null;
            }
            if (parsed.error) {
                return {...s, bars: null, error: parsed.error};
            }
            return {...s, bars: parsed.bars, error: null};
        } catch (e) {
            return null;
        }
    });
    if (cachedAll.every(x => x)) {
        // Every ETF has cache — either bars or a recorded failure. Don't auto-
        // retry the failures; surface them via the same "Reload failed" link.
        lastSectors = cachedAll;
        renderGrid();
        const failed = lastSectors.filter(s => s.error);
        if (failed.length) {
            setStatus(partialFailStatus(failed), 'error', true);
        } else {
            setIdleStatus('Loaded from cache. Press refresh to fetch fresh data.');
        }
        syncUrlParams();
    } else {
        await refresh(false);
    }
})();
