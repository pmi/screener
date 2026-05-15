// =============================================================================
// SECTOR FLOW TIMELINE — per-sector ribbons across 12 months (Sankey-style)
// Shares cache & state keys with snapshot.html so data is reused.
// =============================================================================

const SECTORS = [
    {name: 'Technology', etf: 'XLK'},
    {name: 'Communication Services', etf: 'XLC'},
    {name: 'Financials', etf: 'XLF'},
    {name: 'Health Care', etf: 'XLV'},
    {name: 'Consumer Discretionary', etf: 'XLY'},
    {name: 'Consumer Staples', etf: 'XLP'},
    {name: 'Energy', etf: 'XLE'},
    {name: 'Industrials', etf: 'XLI'},
    {name: 'Materials', etf: 'XLB'},
    {name: 'Real Estate', etf: 'XLRE'},
    {name: 'Utilities', etf: 'XLU'}
];

const MONTHS_WINDOW = 12;

// =============================================================================
// HELPERS (copied from snapshot.js for self-containment)
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

const STORAGE_KEY = 'qvs.state.v1';
const CACHE_PREFIX = 'qvs.cache.monthly.';
const CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

const defaultState = () => ({theme: 'light', avKey: ''});

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
        // Failures are cached too so opening the page later doesn't silently
        // retry — the user must explicitly click "Reload failed".
        if (parsed.error) {
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

function tickerHref(t) {
    return 'https://finance.yahoo.com/quote/' + encodeURIComponent(t.replace(/\./g, '-'));
}

function fmtMoneyAbs(n) {
    if (!Number.isFinite(n) || n === 0) {
        return '$0.0B';
    }
    return '$' + (Math.abs(n) / 1e9).toFixed(1) + 'B';
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtMonth(date) {
    // date like '2026-04-30' or '2026-04'
    const [y, m] = date.split('-');
    return MONTH_NAMES[Number(m) - 1] + " '" + y.slice(2);
}

// =============================================================================
// COMPUTE — per-sector monthly signed flows for the last 12 months
// =============================================================================

// Returns array of 12 flow objects [oldest…newest], or null if insufficient history.
// Each entry: {date, signed, close, prevClose}
function monthlyFlows(bars) {
    if (!bars || bars.length < MONTHS_WINDOW + 1) {
        return null;
    }
    // bars is newest-first; we want the most recent 12 months, then reverse to oldest-first for plotting.
    const out = [];
    for (let i = 0; i < MONTHS_WINDOW; i++) {
        const cur = bars[i];
        const prev = bars[i + 1];
        const sign = cur.close > prev.close ? 1 : (cur.close < prev.close ? -1 : 0);
        out.push({
            date: cur.date,
            signed: sign * cur.close * cur.volume,
            close: cur.close,
            prevClose: prev.close
        });
    }
    return out.reverse();  // oldest → newest, left → right
}

// =============================================================================
// SVG RENDERING
// =============================================================================

const SVG_NS = 'http://www.w3.org/2000/svg';
const hostEl = document.getElementById('chartHost');
const scrollerEl = document.getElementById('sankeyScroller');
const theadEl = document.getElementById('sankeyThead');
const tfootEl = document.getElementById('sankeyTfoot');
const statusEl = document.getElementById('status');

let lastSectors = null;
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
        if (stillFailed.length === SECTORS.length) {
            setStatus(`All fetches failed: ${stillFailed[0].error}`, 'error');
        } else if (stillFailed.length) {
            setStatus(partialFailStatus(stillFailed), 'error', true);
        } else {
            setStatus('', null);
        }
        renderChart();
    } finally {
        isFetching = false;
    }
}

function renderEmpty(message) {
    hostEl.innerHTML = `<div class="empty">${message}</div>`;
    theadEl.innerHTML = '';
    tfootEl.innerHTML = '';
}

function svgEl(tag, attrs, text) {
    const el = document.createElementNS(SVG_NS, tag);
    if (attrs) {
        for (const k of Object.keys(attrs)) {
            el.setAttribute(k, attrs[k]);
        }
    }
    if (text !== undefined) {
        el.textContent = text;
    }
    return el;
}

// Smooth horizontal-tangent cubic-Bezier path through a list of points (top edge).
// Returns SVG d-string starting with M and continuing with C commands.
function smoothTopEdge(pts) {
    if (!pts.length) {
        return '';
    }
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
        const p0 = pts[i - 1];
        const p1 = pts[i];
        const cx = (p0.x + p1.x) / 2;
        d += ` C ${cx} ${p0.y}, ${cx} ${p1.y}, ${p1.x} ${p1.y}`;
    }
    return d;
}

function ribbonPath(pts, centerY) {
    // pts: oldest→newest, each {x, y} where y is the outer edge of the ribbon.
    // The ribbon's inner edge runs along centerY.
    if (!pts.length) {
        return '';
    }
    const first = pts[0];
    const last = pts[pts.length - 1];
    return [
        smoothTopEdge(pts),
        `L ${last.x} ${centerY}`,
        `L ${first.x} ${centerY}`,
        'Z'
    ].join(' ');
}

function renderChart() {
    if (!lastSectors) {
        renderEmpty(
            'Enter your free Alpha Vantage key above, then press refresh. <br><br><a href="https://www.alphavantage.co/support/#api-key" target="_blank" rel="noopener">Get a free key →</a>');
        return;
    }

    // Compute per-sector flow series and the global max for scaling.
    const sectorData = lastSectors.map(s => ({
        ...s,
        flows: monthlyFlows(s.bars)
    }));

    let maxAbs = 0;
    let monthLabels = null;
    const monthTotals = new Array(MONTHS_WINDOW).fill(0);
    for (const s of sectorData) {
        if (!s.flows) {
            continue;
        }
        if (!monthLabels) {
            monthLabels = s.flows.map(f => f.date);
        }
        for (let i = 0; i < s.flows.length; i++) {
            const f = s.flows[i];
            const abs = Math.abs(f.signed);
            if (abs > maxAbs) {
                maxAbs = abs;
            }
            monthTotals[i] += f.signed;
        }
    }
    if (maxAbs === 0) {
        maxAbs = 1;
    }

    // ---- Render HTML thead (sticky monthly totals) ----
    theadEl.innerHTML = '';
    const theadFirst = document.createElement('div');
    theadFirst.className = 'cell first-col';
    theadEl.appendChild(theadFirst);
    const monthTotalEls = [];
    for (let i = 0; i < MONTHS_WINDOW; i++) {
        const cell = document.createElement('div');
        cell.className = 'cell month-total';
        cell.dataset.monthIdx = i;
        const total = monthTotals[i];
        const sign = total > 0 ? '+' : (total < 0 ? '−' : '±');
        cell.dataset.sign = total > 0 ? 'pos' : (total < 0 ? 'neg' : 'zero');
        cell.textContent = sign + fmtMoneyAbs(total);
        theadEl.appendChild(cell);
        monthTotalEls.push(cell);
    }

    // ---- Render HTML tfoot (sticky month labels) ----
    tfootEl.innerHTML = '';
    const tfootFirst = document.createElement('div');
    tfootFirst.className = 'cell first-col';
    tfootEl.appendChild(tfootFirst);
    const monthLabelEls = [];
    for (let i = 0; i < MONTHS_WINDOW; i++) {
        const cell = document.createElement('div');
        cell.className = 'cell month-label';
        cell.dataset.monthIdx = i;
        if (monthLabels) {
            cell.textContent = fmtMonth(monthLabels[i]);
        }
        tfootEl.appendChild(cell);
        monthLabelEls.push(cell);
    }

    // ---- Body SVG layout (lanes only — header/footer are sticky HTML siblings) ----
    const W = Math.max(0, hostEl.clientWidth);
    const visibleBodyH = Math.max(0, scrollerEl.clientHeight - theadEl.offsetHeight - tfootEl.offsetHeight);
    if (W < 320 || visibleBodyH < 100) {
        return;  // too small to draw meaningfully
    }
    const MIN_LANE_H = 78;
    const marginLeft = 170;  // matches thead/tfoot grid first column
    const minH = MIN_LANE_H * SECTORS.length;
    const H = Math.max(visibleBodyH, minH);
    const chartW = W - marginLeft;
    const chartH = H;
    const laneH = chartH / SECTORS.length;
    const monthSlotW = chartW / MONTHS_WINDOW;
    const halfLaneUsable = ((laneH / 2) - 6) * 1.5;

    // Build SVG
    hostEl.innerHTML = '';
    const svg = svgEl('svg', {
        xmlns: SVG_NS,
        width: W,
        height: H,
        viewBox: `0 0 ${W} ${H}`,
        preserveAspectRatio: 'none'
    });

    // Lane backgrounds + dividers (tbody)
    for (let i = 0; i < SECTORS.length; i++) {
        const y = i * laneH;
        svg.appendChild(svgEl('rect', {
            class: 'lane-bg' + (i % 2 ? ' alt' : ''),
            x: 0, y, width: W, height: laneH
        }));
        if (i > 0) {
            svg.appendChild(svgEl('line', {
                class: 'lane-divider',
                x1: 0, y1: y, x2: W, y2: y
            }));
        }
    }

    // Vertical month grid lines spanning the body
    if (monthLabels) {
        for (let i = 0; i < MONTHS_WINDOW; i++) {
            const x = marginLeft + (i + 0.5) * monthSlotW;
            svg.appendChild(svgEl('line', {
                class: 'month-grid',
                x1: x, y1: 0, x2: x, y2: chartH
            }));
        }
    }

    // Per-sector lane content
    const laneCenters = [];  // remembered for the hover overlay
    for (let i = 0; i < sectorData.length; i++) {
        const s = sectorData[i];
        const laneTop = i * laneH;
        const centerY = laneTop + laneH / 2;
        laneCenters.push(centerY);

        const laneG = svgEl('g', {class: 'lane', 'data-etf': s.etf});

        // Y-axis label area: sector name on top, ETF link below. Font sizes come from CSS
        // (13px) to match stocks.css `td`/`td.ticker` exactly.
        const labelY = centerY - 4;
        const etfY = centerY + 14;

        const labelText = svgEl('text', {
            class: 'lane-label',
            x: 14, y: labelY
        }, s.name);
        laneG.appendChild(labelText);

        const etfText = svgEl('text', {
            class: 'lane-etf',
            x: 14, y: etfY
        });
        const etfLink = svgEl('a', {
            href: tickerHref(s.etf),
            target: '_blank',
            rel: 'noopener'
        }, s.etf);
        etfText.appendChild(etfLink);
        laneG.appendChild(etfText);

        // Center axis line spanning chart area
        laneG.appendChild(svgEl('line', {
            class: 'lane-axis',
            x1: marginLeft, y1: centerY,
            x2: marginLeft + chartW, y2: centerY
        }));

        if (s.flows) {
            const topPts = [];
            const botPts = [];
            for (let m = 0; m < s.flows.length; m++) {
                const x = marginLeft + (m + 0.5) * monthSlotW;
                const f = s.flows[m];
                const scaled = (Math.abs(f.signed) / maxAbs) * halfLaneUsable;
                if (f.signed > 0) {
                    topPts.push({x, y: centerY - scaled});
                    botPts.push({x, y: centerY});
                } else if (f.signed < 0) {
                    topPts.push({x, y: centerY});
                    botPts.push({x, y: centerY + scaled});
                } else {
                    topPts.push({x, y: centerY});
                    botPts.push({x, y: centerY});
                }
            }

            laneG.appendChild(svgEl('path', {
                class: 'ribbon ribbon-pos',
                d: ribbonPath(topPts, centerY)
            }));
            laneG.appendChild(svgEl('path', {
                class: 'ribbon ribbon-neg',
                d: ribbonPath(botPts, centerY)
            }));
        } else {
            laneG.appendChild(svgEl('text', {
                class: 'lane-etf',
                x: marginLeft + chartW / 2,
                y: centerY + 4,
                'text-anchor': 'middle',
                'font-size': 11
            }, s.error || 'Insufficient history'));
        }

        svg.appendChild(laneG);
    }

    // ---- Hover overlay: vertical guide + per-sector value at hovered month ----
    const hoverG = svgEl('g', {class: 'hover-overlay', visibility: 'hidden'});
    const hoverLine = svgEl('line', {
        class: 'hover-line',
        x1: 0, y1: 0, x2: 0, y2: chartH
    });
    hoverG.appendChild(hoverLine);

    const hoverValues = [];
    for (let i = 0; i < sectorData.length; i++) {
        const text = svgEl('text', {
            class: 'hover-value',
            x: 0,
            y: laneCenters[i] + 4
        });
        hoverG.appendChild(text);
        hoverValues.push(text);
    }
    svg.appendChild(hoverG);

    // Transparent capture rect (on top) — drives mousemove
    const captureRect = svgEl('rect', {
        class: 'hover-capture',
        x: marginLeft, y: 0,
        width: chartW, height: chartH,
        fill: 'transparent'
    });
    svg.appendChild(captureRect);

    function showHoverAt(monthIdx) {
        const lineX = marginLeft + (monthIdx + 0.5) * monthSlotW;
        hoverLine.setAttribute('x1', lineX);
        hoverLine.setAttribute('x2', lineX);

        // Place labels on the side with more room
        const farRight = lineX > marginLeft + chartW * 0.7;
        const textX = farRight ? lineX - 6 : lineX + 6;
        const anchor = farRight ? 'end' : 'start';

        for (let i = 0; i < sectorData.length; i++) {
            const s = sectorData[i];
            const t = hoverValues[i];
            if (!s.flows) {
                t.setAttribute('visibility', 'hidden');
                continue;
            }
            const f = s.flows[monthIdx];
            const sign = f.signed > 0 ? '+' : (f.signed < 0 ? '−' : '±');
            t.textContent = sign + fmtMoneyAbs(f.signed);
            t.setAttribute('x', textX);
            t.setAttribute('text-anchor', anchor);
            t.setAttribute('data-sign', f.signed > 0 ? 'pos' : (f.signed < 0 ? 'neg' : 'zero'));
            t.removeAttribute('visibility');
        }

        // Bolder header total and footer label for the hovered month
        for (let i = 0; i < monthTotalEls.length; i++) {
            if (i === monthIdx) {
                monthTotalEls[i].setAttribute('data-active', 'true');
                if (monthLabelEls[i]) {
                    monthLabelEls[i].setAttribute('data-active', 'true');
                }
            } else {
                monthTotalEls[i].removeAttribute('data-active');
                if (monthLabelEls[i]) {
                    monthLabelEls[i].removeAttribute('data-active');
                }
            }
        }

        hoverG.removeAttribute('visibility');
    }

    function hideHover() {
        hoverG.setAttribute('visibility', 'hidden');
        monthTotalEls.forEach(el => el.removeAttribute('data-active'));
        monthLabelEls.forEach(el => el.removeAttribute('data-active'));
    }

    function monthIdxAt(e) {
        const r = svg.getBoundingClientRect();
        const localX = e.clientX - r.left - marginLeft;
        let idx = Math.floor(localX / monthSlotW);
        if (idx < 0) {
            idx = 0;
        }
        if (idx >= MONTHS_WINDOW) {
            idx = MONTHS_WINDOW - 1;
        }
        return idx;
    }

    captureRect.addEventListener('mousemove', (e) => showHoverAt(monthIdxAt(e)));
    captureRect.addEventListener('mouseleave', hideHover);
    captureRect.addEventListener('click', (e) => {
        if (!monthLabels) {
            return;
        }
        const ym = monthLabels[monthIdxAt(e)].slice(0, 7);  // 'YYYY-MM' from 'YYYY-MM-DD'
        window.location.href = `snapshot.html?month=${encodeURIComponent(ym)}&window=1`;
    });

    hostEl.appendChild(svg);
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
        if (failed.length === SECTORS.length) {
            setStatus(`All fetches failed: ${failed[0].error}`, 'error');
        } else if (failed.length) {
            setStatus(partialFailStatus(failed), 'error', true);
        } else {
            setStatus('', null);
        }
        renderChart();
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

// ---- AV key ----
const keyInput = document.getElementById('avKeyInput');
keyInput.value = state.avKey || '';
keyInput.addEventListener('change', () => {
    state.avKey = keyInput.value.trim();
    saveState();
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
        renderChart();
    }
});
ro.observe(scrollerEl);

// ---- Boot ----
(async function boot() {
    if (!state.avKey) {
        renderEmpty(
            'Enter your free Alpha Vantage key above, then press refresh. <br><br><a href="https://www.alphavantage.co/support/#api-key" target="_blank" rel="noopener">Get a free key →</a>');
        return;
    }
    // Load whatever cache we have (successes AND failures). A "null" entry
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
        // retry the failures; surface them in the status with a Reload link.
        lastSectors = cachedAll;
        renderChart();
        const failed = lastSectors.filter(s => s.error);
        if (failed.length === SECTORS.length) {
            setStatus(partialFailStatus(failed), 'error', true);
        } else if (failed.length) {
            setStatus(partialFailStatus(failed), 'error', true);
        } else {
            setStatus('Loaded from cache. Press refresh to fetch fresh data.', 'info');
        }
    } else {
        await refresh(false);
    }
})();
