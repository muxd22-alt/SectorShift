/* Sector Shift — dashboard logic.
   Reads public/data.json produced by the daily pipeline:
   { generated_at, stats, history[], papers[], news[], digest } */

document.addEventListener('DOMContentLoaded', () => {
    const $ = (sel) => document.querySelector(sel);

    // ---------- state ----------
    let DATA = null;
    let allData = [];
    let anchorMs = 0;             // end of the rolling 24h read window (build time)
    let latestMs = 0;             // newest item on the tape
    let uniqueTags = new Set();
    let uniqueSectors = new Set();
    let entityToIds = {};

    const feed = { type: 'all', score: 7, tag: 'all', sector: 'all', entity: null, limit: 24 };
    let moverRange = 1;
    let chartGeom = null;

    // ---------- helpers ----------
    const esc = (s) => (s == null ? '' : String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;'));

    const splitList = (str) => {
        if (!str) return [];
        const parts = String(str)
            .replace(/,\s*(Inc\.|Inc|LLC|Ltd\.|Ltd|Corp\.|Corp|Co\.|Co)\b/gi, ' $1')
            .split(',').map(s => s.trim()).filter(Boolean);
        const suffix = /^(inc\.?|ltd\.?|corp\.?|llc|plc|co\.?|&)$/i;
        const cleaned = parts.filter(p => !suffix.test(p));
        return cleaned.length ? cleaned : parts;
    };

    const isNone = (name) => /^(none|n\/a|na|not applicable|-|unknown|)$/i.test((name || '').trim());

    const GENERIC_SECTORS = /^(healthcare|technology|tech|finance|financials|energy|retail|automotive|aerospace|agriculture|construction|education|entertainment|hospitality|manufacturing|media|telecommunications|transportation|utilities|semiconductors|software|hardware|logistics|materials|industrials|services|banking|biotech|insurance|reits|consumer|communications|pharma|metals|mining|real estate|commodities|crypto|blockchain|defense|cybersecurity|cloud|ai|robotics|quantum|space|gaming|autos|artificial intelligence)$/i;

    function isCompany(name) {
        const n = (name || '').trim();
        if (!n || isNone(n)) return false;
        if (n.startsWith('$')) return true;
        if (/^[A-Z][A-Z0-9.\-]{1,5}$/.test(n)) return true;
        if (/\b(Inc|Ltd|Corp|LLC|PLC|Group|Holdings|Therapeutics|Pharma|Biosciences|Labs|Networks|Systems|Solutions|Technologies)\b/i.test(n)) return true;
        if (GENERIC_SECTORS.test(n)) return false;
        return /^[A-Z][a-zA-Z0-9&\s\.]{2,}$/.test(n) && !GENERIC_SECTORS.test(n);
    }

    const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

    const fmtDate = (ms, opts) => {
        try {
            return new Date(ms).toLocaleDateString('en-US',
                opts || { month: 'short', day: 'numeric', year: 'numeric' });
        } catch { return ''; }
    };

    const signed = (n) => (n > 0 ? `+${n}` : `${n}`);

    function cssVar(name) {
        return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    }

    // ---------- theme ----------
    function setupTheme() {
        const saved = localStorage.getItem('ss-theme');
        if (saved === 'light' || saved === 'dark') {
            document.documentElement.dataset.theme = saved;
        }
        $('#theme-toggle').addEventListener('click', () => {
            const current = document.documentElement.dataset.theme ||
                (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
            const next = current === 'dark' ? 'light' : 'dark';
            document.documentElement.dataset.theme = next;
            localStorage.setItem('ss-theme', next);
            drawChart();
        });
    }

    // ---------- data ----------
    async function init() {
        try {
            const res = await fetch('data.json', { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            DATA = await res.json();
        } catch (err) {
            $('#today').innerHTML = `
                <div class="glass empty-state">
                    <h2>The tape didn't load</h2>
                    <p style="margin-top:8px;color:var(--text-2)">The daily job publishes <code>data.json</code> at 04:00 UTC.
                    ${esc(err.message)}</p>
                </div>`;
            return;
        }
        processData(DATA);
        renderChrome(DATA);
        renderDigest(DATA);
        renderDial(DATA);
        renderMovers();
        drawChart();
        renderTone();
        renderResearch();
        populateFilters();
        renderFeed();
        bindEvents();
        revealOnScroll();
        registerSW();
    }

    function processData(data) {
        (data.papers || []).forEach(item => {
            const tags = splitList(item.Tags);
            const ben = splitList(item.Benefiting_Sectors);
            const dis = splitList(item.Disrupted_Sectors);
            tags.forEach(t => uniqueTags.add(t));

            const ms = Date.parse(item.Published_Date);
            const entry = {
                type: 'paper',
                id: item.Paper_ID,
                title: item.Title || '',
                hook: (item.Hook || '').trim(),
                summary: item.Abstract || '',
                core: item.Core_Innovation || '',
                score: parseInt(item.Breakthrough_Score, 10) || 0,
                url: item.Arxiv_URL,
                ms: isNaN(ms) ? 0 : ms,
                sentiment: null,
                tickers: '',
                action: item.Decision_Perspective || '',
                ben, dis, tags,
            };
            indexEntities(entry);
            allData.push(entry);
        });

        (data.news || []).forEach(item => {
            const tags = splitList(item.Economic_Tags);
            const ben = splitList(item.Benefiting_Entities);
            const dis = splitList(item.Disrupted_Entities);
            tags.forEach(t => uniqueTags.add(t));

            const ms = Date.parse(item.Published_Date);
            const sentiment = item.Market_Sentiment || 'Neutral';
            const entry = {
                type: 'news',
                id: item.News_ID,
                title: item.Title || '',
                hook: (item.Hook || '').trim(),
                summary: item.Snippet || '',
                core: '',
                score: parseInt(item.Impact_Score, 10) || 0,
                url: item.News_URL,
                ms: isNaN(ms) ? 0 : ms,
                sentiment,
                tickers: item.Related_Tickers || '',
                action: item.Strategic_Action || '',
                ben, dis, tags,
            };
            indexEntities(entry);
            allData.push(entry);
        });

        allData.sort((a, b) => b.score - a.score || b.ms - a.ms);

        // The read covers the last 24 hours up to the build time, so items
        // published after yesterday's run are always part of today's tape.
        anchorMs = Date.parse(data.generated_at || '') || Date.now();
        latestMs = allData.reduce((m, i) => Math.max(m, i.ms), 0);
    }

    function indexEntities(entry) {
        [...entry.ben, ...entry.dis].forEach(name => {
            if (isNone(name)) return;
            if (!uniqueSectors.has(name) && !isCompany(name)) uniqueSectors.add(name);
            (entityToIds[name] = entityToIds[name] || []).push(entry.id);
        });
    }

    // ---------- chrome: topbar, footer ----------
    function renderChrome(data) {
        const gen = data.generated_at ? new Date(data.generated_at) : new Date();
        $('#nav-updated').textContent =
            `updated ${gen.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ` +
            `${String(gen.getUTCHours()).padStart(2, '0')}:${String(gen.getUTCMinutes()).padStart(2, '0')} UTC`;
        $('#generated-at').textContent =
            `Last build ${gen.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;

        const model = data.digest && data.digest.model;
        if (model && model !== 'deterministic') {
            $('#model-note').textContent = `Free-tier analysis by ${model} — $0 API spend.`;
        }
    }

    // ---------- hero briefing ----------
    function fallbackDigest() {
        const top = allData.slice().sort((a, b) => b.score - a.score).slice(0, 5);
        if (!top.length) return null;
        const bullets = top.map(i => i.hook || i.title).filter(Boolean).slice(0, 4);
        return {
            headline: bullets[0] || 'The tape is quiet.',
            bullets: bullets.slice(1),
            movers: [],
            watch: `Net shift ${signed(netShift(windowItems(1)))} over the last 24 hours.`,
            items: top.map(i => i.id),
            model: 'client-fallback',
        };
    }

    function renderDigest(data) {
        const digest = data.digest || fallbackDigest();
        const dateLabel = anchorMs
            ? new Date(anchorMs).toLocaleDateString('en-US',
                { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
            : 'Latest available';

        $('#digest-date').textContent = dateLabel;
        if (!digest) {
            $('#digest-headline').textContent = 'Waiting for the first run.';
            return;
        }
        $('#digest-headline').textContent = digest.headline || '';
        $('#digest-bullets').innerHTML = (digest.bullets || [])
            .map(b => `<li>${esc(b)}</li>`).join('');
        if (digest.watch) $('#digest-watch-text').textContent = digest.watch;

        const movers = (digest.movers || []).filter(m => m && m.name);
        if (movers.length) {
            const strip = $('#digest-movers');
            strip.hidden = false;
            strip.innerHTML = movers.map(m => {
                const dir = String(m.dir || '').toLowerCase().startsWith('d') ? 'down' : 'up';
                return `<span class="mover-chip ${dir}" title="${esc(m.why || '')}">
                    <span class="arrow">${dir === 'up' ? '▲' : '▼'}</span>${esc(m.name)}</span>`;
            }).join('');
        }

        // quiet-tape notice when nothing landed in the last 24 hours
        if (!windowItems(1).length && latestMs) {
            $('#digest-watch').insertAdjacentHTML('afterbegin',
                `<span class="watch-label" style="color:var(--amber)">Last read · ${esc(fmtDate(latestMs))}</span>`);
        }
    }

    // ---------- dial + stats ----------
    function renderDial(data) {
        const hist = data.history || [];
        const net = netShift(windowItems(1));
        const avg = Math.round(netShift(windowItems(7)) / 7 * 10) / 10;
        const maxAbs = Math.max(4, Math.abs(avg) * 2, Math.abs(net), ...hist.slice(-7).map(h => Math.abs(h.net)));
        const len = 219.9;
        const frac = Math.max(0, Math.min(1, (net + maxAbs) / (2 * maxAbs)));

        const fill = $('#dial-fill');
        fill.classList.toggle('pos', net > 0);
        fill.classList.toggle('neg', net < 0);
        requestAnimationFrame(() => {
            fill.style.strokeDashoffset = String(len * (1 - frac));
        });

        $('#dial-value').textContent = signed(net);
        $('#dial-value').style.color = net > 0 ? 'var(--up)' : net < 0 ? 'var(--down)' : 'var(--text)';
        $('#dial-label').textContent = 'net shift · last 24h';

        $('#dial-sub').textContent = net >= avg
            ? `At or above the 7-day average (${signed(avg)})`
            : `Below the 7-day average (${signed(avg)})`;

        let streak = 0;
        for (let i = hist.length - 1; i >= 0; i--) {
            if (hist[i].net > 0) streak++; else break;
        }
        const items7d = windowItems(7).length;

        const tone = toneCounts(7);
        const tonePct = tone.bull + tone.bear > 0
            ? Math.round(tone.bull / (tone.bull + tone.bear) * 100) : null;

        const statsHTML = [
            [signed(avg), '7-day avg'],
            [items7d, 'stories / 7d'],
            [streak ? `${streak}d` : '—', 'up-streak'],
            [tonePct == null ? '—' : `${tonePct}%`, 'bullish tone'],
        ].map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
        $('#stat-row').innerHTML = statsHTML;
    }

    // ---------- movers ----------
    function netShift(items) {
        return items.reduce((sum, e) =>
            sum + e.ben.filter(n => !isNone(n)).length - e.dis.filter(n => !isNone(n)).length, 0);
    }

    function windowItems(range) {
        if (!anchorMs) return allData;
        const start = anchorMs - range * 864e5;
        return allData.filter(i => i.ms >= start);
    }

    function entityNets(items) {
        const nets = {};
        items.forEach(e => {
            e.ben.forEach(n => { if (!isNone(n)) nets[n] = (nets[n] || 0) + 1; });
            e.dis.forEach(n => { if (!isNone(n)) nets[n] = (nets[n] || 0) - 1; });
        });
        return nets;
    }

    function renderMovers() {
        const items = windowItems(moverRange);
        const nets = entityNets(items);

        const sectors = [], companies = [];
        Object.entries(nets).forEach(([name, net]) => {
            if (!net) return;
            (isCompany(name) ? companies : sectors).push([name, net]);
        });
        sectors.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
        companies.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));

        const fill = (list, el) => {
            if (!list.length) {
                el.innerHTML = `<li class="mover-empty">No net movement in this window.</li>`;
                return;
            }
            const top = list.slice(0, 7);
            const max = Math.max(...top.map(([, n]) => Math.abs(n)));
            el.innerHTML = top.map(([name, net], i) => {
                const cls = net > 0 ? 'up' : net < 0 ? 'down' : 'flat';
                const w = Math.max(6, Math.abs(net) / max * 50);
                const bar = net >= 0
                    ? `<i class="up" style="left:50%;width:${w}%"></i>`
                    : `<i class="down" style="left:50%;width:${w}%"></i>`;
                return `<li class="mover-row" data-entity="${esc(name)}" tabindex="0"
                    role="button" aria-label="Filter by ${esc(name)}">
                    <span class="mover-rank">${i + 1}</span>
                    <span class="mover-name"><b>${esc(name)}</b>
                        <span class="mover-bar">${bar}</span></span>
                    <span class="mover-net ${cls}">${signed(net)}</span>
                </li>`;
            }).join('');
        };

        fill(sectors, $('#movers-sectors'));
        fill(companies, $('#movers-companies'));

        document.querySelectorAll('.mover-row').forEach(row => {
            const go = () => activateEntity(row.dataset.entity);
            row.addEventListener('click', go);
            row.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
        });
    }

    // ---------- chart ----------
    function movingAvg(values, window) {
        return values.map((_, i) => {
            const slice = values.slice(Math.max(0, i - window + 1), i + 1);
            return slice.reduce((a, b) => a + b, 0) / slice.length;
        });
    }

    function drawChart() {
        const canvas = $('#shift-chart');
        if (!canvas) return;
        const hist = (DATA && DATA.history) || [];
        if (!hist.length) return;

        const dpr = window.devicePixelRatio || 1;
        const W = canvas.clientWidth || canvas.parentElement.clientWidth;
        const H = 240;
        canvas.width = W * dpr;
        canvas.height = H * dpr;
        canvas.style.height = H + 'px';
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);

        const pad = { l: 6, r: 6, t: 16, b: 12 };
        const innerW = W - pad.l - pad.r;
        const innerH = H - pad.t - pad.b;

        const nets = hist.map(h => h.net);
        const maxAbs = Math.max(2, ...nets.map(Math.abs));
        const y = (v) => pad.t + (maxAbs - v) / (2 * maxAbs) * innerH;
        const slot = innerW / hist.length;
        const barW = Math.max(2, Math.min(14, slot - 2));

        const up = cssVar('--up') || '#248a3d';
        const down = cssVar('--down') || '#d70015';
        const sep = cssVar('--sep-strong') || 'rgba(0,0,0,.16)';
        const accent = cssVar('--accent') || '#0071e3';

        // bars
        hist.forEach((h, i) => {
            const x = pad.l + i * slot + (slot - barW) / 2;
            const y0 = y(0);
            const yv = y(h.net);
            ctx.fillStyle = h.net > 0 ? up : h.net < 0 ? down : sep;
            const top = Math.min(y0, yv);
            const hgt = Math.max(h.net === 0 ? 1.5 : 2, Math.abs(yv - y0));
            ctx.beginPath();
            ctx.roundRect ? ctx.roundRect(x, top, barW, hgt, 2) : ctx.rect(x, top, barW, hgt);
            ctx.fill();
        });

        // zero line
        ctx.strokeStyle = sep;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pad.l, y(0));
        ctx.lineTo(W - pad.r, y(0));
        ctx.stroke();

        // 7-day average line
        const avg = movingAvg(nets, 7);
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.6;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        avg.forEach((v, i) => {
            const x = pad.l + i * slot + slot / 2;
            const yy = y(v);
            i === 0 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
        });
        ctx.stroke();

        chartGeom = { pad, slot, innerW, hist, y, maxAbs, W };

        // axis labels
        const fmt = (d) => new Date(d + 'T12:00:00Z')
            .toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const mid = hist[Math.floor(hist.length / 2)];
        $('#chart-axis').innerHTML =
            `<span>${fmt(hist[0].date)}</span><span>${fmt(mid.date)}</span><span>${fmt(hist[hist.length - 1].date)}</span>`;
    }

    function bindChartHover() {
        const canvas = $('#shift-chart');
        const tip = $('#chart-tip');

        const move = (evt) => {
            if (!chartGeom) return;
            const rect = canvas.getBoundingClientRect();
            const x = (evt.touches ? evt.touches[0].clientX : evt.clientX) - rect.left;
            const { pad, slot, hist, y } = chartGeom;
            let idx = Math.floor((x - pad.l) / slot);
            idx = Math.max(0, Math.min(hist.length - 1, idx));
            const h = hist[idx];
            const cx = pad.l + idx * slot + slot / 2;
            tip.hidden = false;
            tip.style.left = cx + 'px';
            tip.style.top = y(h.net) + 'px';
            tip.innerHTML = `${h.date} &middot; net <b>${signed(h.net)}</b><br>${h.items} items`;
        };

        canvas.addEventListener('mousemove', move);
        canvas.addEventListener('touchstart', move, { passive: true });
        canvas.addEventListener('touchmove', move, { passive: true });
        canvas.addEventListener('mouseleave', () => { tip.hidden = true; });
    }

    // ---------- tone ----------
    function toneCounts(rangeDays) {
        const items = windowItems(rangeDays).filter(i => i.type === 'news');
        const out = { bull: 0, bear: 0, neutral: 0 };
        items.forEach(i => {
            const s = (i.sentiment || '').toLowerCase();
            if (s.includes('negative') || s.includes('disastrous')) out.bear++;
            else if (s.includes('positive')) out.bull++;
            else out.neutral++;
        });
        return out;
    }

    function renderTone() {
        const tone = toneCounts(7);
        const total = tone.bull + tone.bear + tone.neutral;
        const bar = $('#tone-bar');
        const legend = $('#tone-legend');
        const figure = $('#tone-figure');

        if (!total) {
            figure.textContent = '—';
            legend.innerHTML = '<span>No news items in the last 7 days.</span>';
            return;
        }
        const pct = (n) => Math.round(n / total * 100);
        const [b, n, r] = [pct(tone.bull), pct(tone.neutral), pct(tone.bear)];
        const segs = bar.querySelectorAll('.tone-seg');
        segs[0].style.width = b + '%';
        segs[1].style.width = n + '%';
        segs[2].style.width = r + '%';

        const tilt = b - r;
        figure.textContent = tilt > 0 ? `${b}% bullish` : tilt < 0 ? `${r}% bearish` : 'balanced';
        figure.style.color = tilt > 0 ? 'var(--up)' : tilt < 0 ? 'var(--down)' : 'var(--text-2)';

        legend.innerHTML = `
            <span><b>${b}%</b> positive · ${tone.bull} items</span>
            <span><b>${n}%</b> neutral · ${tone.neutral} items</span>
            <span><b>${r}%</b> negative · ${tone.bear} items</span>`;
    }

    // ---------- research rail ----------
    function renderResearch() {
        const papers = allData.filter(e => e.type === 'paper')
            .sort((a, b) => b.score - a.score || b.ms - a.ms)
            .slice(0, 8);

        const rail = $('#research-rail');
        if (!papers.length) {
            rail.innerHTML = '<div class="empty-state">No research on the tape yet.</div>';
            return;
        }
        rail.innerHTML = papers.map(p => {
            const cls = p.score >= 8 ? 'hot' : p.score >= 6 ? 'warm' : '';
            return `<article class="paper-card">
                <div class="paper-top">
                    <span class="score ${cls}">${p.score}/10</span>
                    <span class="paper-meta">${fmtDate(p.ms, { month: 'short', day: 'numeric' })}</span>
                </div>
                <a class="paper-title" href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title)}</a>
                <p class="paper-hook">${esc(p.hook || p.core || '')}</p>
                <div class="paper-meta">${(p.tags.slice(0, 3).map(t => esc(t)).join(' · ')) || ''}</div>
            </article>`;
        }).join('');
    }

    // ---------- filters ----------
    function populateFilters() {
        const tagSel = $('#filter-tag');
        Array.from(uniqueTags).sort().forEach(t => {
            const o = document.createElement('option');
            o.value = t; o.textContent = t; tagSel.appendChild(o);
        });
        const secSel = $('#filter-sector');
        Array.from(uniqueSectors).sort().forEach(s => {
            const o = document.createElement('option');
            o.value = s; o.textContent = s; secSel.appendChild(o);
        });
    }

    function filtered() {
        return allData.filter(item => {
            if (feed.type !== 'all' && item.type !== feed.type) return false;
            if (feed.score !== 'all' && item.score < feed.score) return false;
            if (feed.tag !== 'all' && !item.tags.includes(feed.tag)) return false;
            if (feed.sector !== 'all' &&
                !item.ben.includes(feed.sector) && !item.dis.includes(feed.sector)) return false;
            if (feed.entity) {
                const ids = entityToIds[feed.entity] || [];
                const inline = [...item.ben, ...item.dis].includes(feed.entity);
                if (!ids.includes(item.id) && !inline) return false;
            }
            return true;
        });
    }

    function scoreClass(score) {
        return score >= 8 ? 'hot' : score >= 6 ? 'warm' : '';
    }

    function sentimentBadge(item) {
        if (item.type !== 'news') return '';
        const s = (item.sentiment || 'Neutral').toLowerCase();
        const cls = s.includes('negative') || s.includes('disastrous') ? 'neg'
            : s.includes('positive') ? 'pos' : '';
        return `<span class="badge-sent ${cls}">${esc(item.sentiment)}</span>`;
    }

    function cardHTML(item) {
        const isPaper = item.type === 'paper';
        const badge = isPaper
            ? '<span class="badge badge-paper">Research</span>'
            : '<span class="badge badge-news">News</span>';

        const lead = item.hook || item.title;
        const showSource = item.hook && item.title && item.hook.trim().toLowerCase().replace(/\.$/, '') !== item.title.trim().toLowerCase().replace(/\.$/, '');
        const source = showSource
            ? `<div class="card-source"><a href="${esc(item.url)}" target="_blank" rel="noopener">${esc(item.title)}</a></div>`
            : (item.hook ? '' : `<div class="card-source"><a href="${esc(item.url)}" target="_blank" rel="noopener">Open source ↗</a></div>`);

        const bodyText = isPaper ? (item.core || item.summary) : item.summary;
        const whyLabel = isPaper ? 'What to do about it' : 'What happens next';

        const entRow = (label, list, cls) => {
            const clean = list.filter(n => !isNone(n));
            if (!clean.length) return '';
            return `<div class="ent-row"><span class="ent-label ${cls}">${label}</span>${
                clean.map(n => `<button class="ent" data-entity="${esc(n)}">${esc(n)}</button>`).join('')}</div>`;
        };

        const tickers = splitList(item.tickers);

        return `<article class="card">
            <div class="card-top">${badge}${sentimentBadge(item)}
                <span class="score ${scoreClass(item.score)}">${item.score}/10</span>
                <span class="card-date">${fmtDate(item.ms, { month: 'short', day: 'numeric' })}</span>
            </div>
            <a class="card-hook" href="${esc(item.url)}" target="_blank" rel="noopener">${esc(lead)}</a>
            ${source}
            ${bodyText ? `<p class="card-body">${esc(bodyText)}</p>` : ''}
            ${item.action ? `<div class="why"><span class="why-label">${whyLabel}</span><p>${esc(item.action)}</p></div>` : ''}
            <div class="ents">
                ${entRow('Gains', item.ben, 'up')}
                ${entRow('Loses', item.dis, 'down')}
                ${tickers.length ? `<div class="ent-row"><span class="ent-label">Tickers</span>${
                    tickers.map(t => `<button class="ent" data-entity="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}
            </div>
            ${item.tags.length ? `<div class="tags">${item.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
        </article>`;
    }

    function renderFeed() {
        const list = filtered();
        const shown = list.slice(0, feed.limit);
        const grid = $('#results-grid');

        if (!list.length) {
            grid.innerHTML = `<div class="empty-state">
                Nothing on the tape matches these filters.<br>
                <button class="ghost-btn" style="margin-top:12px" onclick="document.getElementById('clear-filters').click()">Reset filters</button>
            </div>`;
        } else {
            grid.innerHTML = shown.map(cardHTML).join('');
        }

        $('#feed-count').textContent =
            `${list.length} item${list.length === 1 ? '' : 's'} on the tape · showing ${shown.length}`;
        $('#load-more').hidden = shown.length >= list.length;
        $('#clear-filters').hidden = !(feed.tag !== 'all' || feed.sector !== 'all' ||
            feed.entity || feed.type !== 'all' || feed.score !== 7);

        grid.querySelectorAll('.ent').forEach(btn => {
            btn.addEventListener('click', () => activateEntity(btn.dataset.entity));
        });
    }

    function activateEntity(name) {
        feed.entity = name;
        feed.limit = 24;
        const bar = $('#active-filter-bar');
        bar.hidden = false;
        $('#active-filter-label').innerHTML = `Showing the tape around <strong>${esc(name)}</strong>`;
        renderFeed();
        document.getElementById('read').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function clearEntity() {
        feed.entity = null;
        $('#active-filter-bar').hidden = true;
        renderFeed();
    }

    // ---------- events ----------
    function bindEvents() {
        $('#range-seg').addEventListener('click', (e) => {
            const btn = e.target.closest('.seg');
            if (!btn) return;
            $('#range-seg').querySelectorAll('.seg').forEach(s => s.classList.remove('active'));
            btn.classList.add('active');
            moverRange = parseInt(btn.dataset.range, 10);
            renderMovers();
        });

        $('#type-seg').addEventListener('click', (e) => {
            const btn = e.target.closest('.seg');
            if (!btn) return;
            $('#type-seg').querySelectorAll('.seg').forEach(s => s.classList.remove('active'));
            btn.classList.add('active');
            feed.type = btn.dataset.type;
            feed.limit = 24;
            renderFeed();
        });

        $('#score-pills').addEventListener('click', (e) => {
            const btn = e.target.closest('.fpill');
            if (!btn) return;
            $('#score-pills').querySelectorAll('.fpill').forEach(s => s.classList.remove('active'));
            btn.classList.add('active');
            feed.score = btn.dataset.score === 'all' ? 'all' : parseInt(btn.dataset.score, 10);
            feed.limit = 24;
            renderFeed();
        });

        $('#filter-tag').addEventListener('change', (e) => { feed.tag = e.target.value; feed.limit = 24; renderFeed(); });
        $('#filter-sector').addEventListener('change', (e) => { feed.sector = e.target.value; feed.limit = 24; renderFeed(); });

        $('#clear-filters').addEventListener('click', () => {
            feed.type = 'all'; feed.score = 7; feed.tag = 'all'; feed.sector = 'all';
            feed.entity = null; feed.limit = 24;
            $('#filter-tag').value = 'all';
            $('#filter-sector').value = 'all';
            $('#active-filter-bar').hidden = true;
            $('#type-seg').querySelectorAll('.seg').forEach(s => s.classList.toggle('active', s.dataset.type === 'all'));
            $('#score-pills').querySelectorAll('.fpill').forEach(s => s.classList.toggle('active', s.dataset.score === '7'));
            renderFeed();
        });

        $('#dismiss-filter').addEventListener('click', clearEntity);
        $('#load-more').addEventListener('click', () => { feed.limit += 24; renderFeed(); });

        window.addEventListener('resize', debounce(drawChart, 150));

        // topbar scroll state + section title
        const topbar = $('#topbar');
        const titles = [['today', 'Briefing'], ['movers', 'Sector movers'], ['research', 'Research'], ['read', 'The read']];
        const onScroll = () => {
            topbar.classList.toggle('scrolled', window.scrollY > 26);
            let current = 'Today';
            for (const [id, label] of titles) {
                const el = document.getElementById(id);
                if (el && el.getBoundingClientRect().top <= 120) current = label;
            }
            $('#topbar-title').textContent = current;
        };
        window.addEventListener('scroll', onScroll, { passive: true });
        onScroll();

        bindChartHover();
    }

    // ---------- misc ----------
    function debounce(fn, ms) {
        let t;
        return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
    }

    function revealOnScroll() {
        const els = document.querySelectorAll('.reveal');
        if (!('IntersectionObserver' in window)) {
            els.forEach(el => el.classList.add('in'));
            return;
        }
        const io = new IntersectionObserver((entries) => {
            entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
        }, { threshold: 0.08 });
        els.forEach(el => io.observe(el));
    }

    function registerSW() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('sw.js').catch(() => {});
        }
    }

    setupTheme();
    init();
});
