document.addEventListener('DOMContentLoaded', () => {
    const resultsGrid = document.getElementById('results-grid');
    const filterType = document.getElementById('filter-type');
    const filterTag = document.getElementById('filter-tag');
    const filterSector = document.getElementById('filter-sector');
    const filterScore = document.getElementById('filter-score');
    const clearBtn = document.getElementById('clear-filters');

    const summaryPanel = document.getElementById('executive-summary');
    const summaryNarrative = document.getElementById('summary-narrative');
    const summaryDate = document.getElementById('summary-date');
    const benSectors = document.getElementById('ben-sectors');
    const benTickers = document.getElementById('ben-tickers');
    const disSectors = document.getElementById('dis-sectors');
    const disTickers = document.getElementById('dis-tickers');

    const activeFilterBar = document.getElementById('active-filter-bar');
    const activeFilterLabel = document.getElementById('active-filter-label');
    const dismissFilter = document.getElementById('dismiss-filter');

    let allData = [];
    let uniqueTags = new Set();
    let uniqueSectors = new Set();

    // Separate benefiting/disrupted into sectors vs tickers
    let benSectorCounts = {};
    let benTickerCounts = {};
    let disSectorCounts = {};
    let disTickerCounts = {};

    // Entity → list of item IDs for clickable filtering
    let entityToItems = {};

    // Currently active entity filter (from clicking a summary tag)
    let activeEntityFilter = null;

    // ---- Helpers ----
    // Heuristic: if a name looks like a ticker or company name (contains uppercase abbreviation,
    // ends with Inc/Ltd/Corp, or is a known short all-caps word), treat it as a ticker
    function isTicker(name) {
        if (!name) return false;
        const n = name.trim();
        
        if (/^(none|n\/a|na|not applicable)$/i.test(n)) return false;
        
        // All-caps 1-5 chars
        if (/^[A-Z\.]+$/.test(n) && n.length <= 6) return true;
        
        // Contains company suffixes
        if (/\b(Inc|Ltd|Corp|Co|Group|LLC|PLC|Technologies|Holdings|Therapeutics|Pharma|Biosciences|Labs|Networks|Systems|Solutions)\b/i.test(n)) return true;
        
        // Specific companies often missed
        if (/\b(Nvidia|Apollo|Neuronetics|Apple|Microsoft|Google|Meta|Amazon|Tesla|OpenAI|Anthropic|Codexis|AGL)\b/i.test(n)) return true;
        
        // $ prefix
        if (n.startsWith('$')) return true;

        // Single capitalized word not matching a standard sector
        if (/^[A-Z][a-zA-Z0-9]+$/.test(n)) {
            const genericSectors = /^(Healthcare|Technology|Finance|Energy|Retail|Automotive|Aerospace|Agriculture|Construction|Education|Entertainment|Hospitality|Manufacturing|Media|Telecommunications|Transportation|Utilities|Semiconductors|Software|Hardware|Logistics|Materials|Industrials|Services)$/i;
            if (!genericSectors.test(n)) {
                return true;
            }
        }
        
        return false;
    }

    function isGenericNone(name) {
        return /^(none|n\/a|na|not applicable|-|)$/i.test((name || '').trim());
    }

    // ---- Init ----
    async function init() {
        try {
            const response = await fetch('data.json');
            if (!response.ok) {
                throw new Error('Data file not found. Ensure the pipeline has run at least once.');
            }
            const rawData = await response.json();
            processData(rawData);
            populateDropdowns();
            renderGrid();
        } catch (error) {
            console.error('Error fetching data:', error);
            resultsGrid.innerHTML = `
                <div class="loading-state" style="color: var(--accent-rose);">
                    <svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" stroke-width="2" fill="none"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                    <p>Failed to load intelligence data.<br/><span style="font-size:0.8rem; color: var(--text-secondary)">(${error.message})</span></p>
                </div>`;
        }
    }

    // ---- Process Data ----
    function processData(data) {
        if (data.papers) {
            data.papers.forEach(item => {
                const tags = splitList(item.Tags);
                const benefiting = splitList(item.Benefiting_Sectors);
                const disrupted = splitList(item.Disrupted_Sectors);

                tags.forEach(t => uniqueTags.add(t));
                benefiting.forEach(s => uniqueSectors.add(s));

                const entry = {
                    type: 'paper',
                    id: item.Paper_ID,
                    title: item.Title,
                    summary: item.Abstract,
                    date: item.Published_Date,
                    dateFormatted: formatDate(item.Published_Date),
                    url: item.Arxiv_URL,
                    score: parseInt(item.Breakthrough_Score) || 0,
                    benefiting: benefiting,
                    disrupted: disrupted,
                    action: item.Decision_Perspective,
                    core: item.Core_Innovation,
                    tags: tags,
                    sentiment: null,
                    sentimentColor: null,
                    tickers: null
                };

                classifyEntities(benefiting, benSectorCounts, benTickerCounts, entry);
                classifyEntities(disrupted, disSectorCounts, disTickerCounts, entry);

                allData.push(entry);
            });
        }

        if (data.news) {
            data.news.forEach(item => {
                const tags = splitList(item.Economic_Tags);
                const benefiting = splitList(item.Benefiting_Entities);
                const disrupted = splitList(item.Disrupted_Entities);

                tags.forEach(t => uniqueTags.add(t));
                benefiting.forEach(s => uniqueSectors.add(s));

                let sentimentColor = '#94a3b8';
                let sentimentLabel = 'Neutral';
                if (item.Market_Sentiment && item.Market_Sentiment.toLowerCase().includes('positive')) {
                    sentimentColor = 'var(--accent-emerald)';
                    sentimentLabel = 'Positive';
                }
                if (item.Market_Sentiment && item.Market_Sentiment.toLowerCase().includes('negative')) {
                    sentimentColor = 'var(--accent-rose)';
                    sentimentLabel = 'Negative';
                }

                const entry = {
                    type: 'news',
                    id: item.News_ID,
                    title: item.Title,
                    summary: item.Snippet,
                    date: item.Published_Date,
                    dateFormatted: formatDate(item.Published_Date),
                    url: item.News_URL,
                    score: parseInt(item.Impact_Score) || 0,
                    benefiting: benefiting,
                    disrupted: disrupted,
                    action: item.Strategic_Action,
                    sentiment: sentimentLabel,
                    sentimentColor: sentimentColor,
                    tickers: item.Related_Tickers,
                    tags: tags,
                    core: null
                };

                classifyEntities(benefiting, benSectorCounts, benTickerCounts, entry);
                classifyEntities(disrupted, disSectorCounts, disTickerCounts, entry);

                allData.push(entry);
            });
        }
    }

    function splitList(str) {
        if (!str) return [];
        // Pre-process to avoid breaking on ", Inc." or ", Ltd."
        str = str.replace(/,\s*(Inc\.|Inc|LLC|Ltd\.|Ltd|Corp\.|Corp|Co\.|Co)\b/gi, ' $1');
        return str.split(',').map(s => s.trim()).filter(s => s.length > 0);
    }

    function formatDate(dateStr) {
        try {
            return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        } catch {
            return dateStr || '';
        }
    }

    function classifyEntities(list, sectorMap, tickerMap, entry) {
        list.forEach(name => {
            if (isGenericNone(name)) return;
            const key = name.trim();
            if (isTicker(key)) {
                tickerMap[key] = (tickerMap[key] || 0) + 1;
            } else {
                sectorMap[key] = (sectorMap[key] || 0) + 1;
            }
            // Map entity to items
            if (!entityToItems[key]) entityToItems[key] = [];
            entityToItems[key].push(entry.id);
        });
    }

    // ---- Render Summary ----
    function updateSummary(filteredData) {
        if (allData.length === 0) return;

        summaryPanel.style.display = 'block';
        const d = new Date();
        summaryDate.textContent = d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

        let bSCounts = {};
        let bTCounts = {};
        let dSCounts = {};
        let dTCounts = {};

        filteredData.forEach(entry => {
            entry.benefiting.forEach(name => {
                if (isGenericNone(name)) return;
                const key = name.trim();
                if (isTicker(key)) bTCounts[key] = (bTCounts[key] || 0) + 1;
                else bSCounts[key] = (bSCounts[key] || 0) + 1;
            });
            entry.disrupted.forEach(name => {
                if (isGenericNone(name)) return;
                const key = name.trim();
                if (isTicker(key)) dTCounts[key] = (dTCounts[key] || 0) + 1;
                else dSCounts[key] = (dSCounts[key] || 0) + 1;
            });
        });

        // Build narrative
        const totalPapers = filteredData.filter(d => d.type === 'paper').length;
        const totalNews = filteredData.filter(d => d.type === 'news').length;
        const highImpact = filteredData.filter(d => d.score >= 8).length;
        const topBenSector = getTopN(bSCounts, 3).map(e => e[0]).join(', ');
        const topDisSector = getTopN(dSCounts, 3).map(e => e[0]).join(', ');

        summaryNarrative.innerHTML = `
            Showing <strong>${totalPapers} research papers</strong> and <strong>${totalNews} market news</strong> items.
            <strong>${highImpact}</strong> entries scored 8+ (critical or breakthrough level).
            ${topBenSector ? `Top benefiting sectors: <strong>${topBenSector}</strong>.` : ''}
            ${topDisSector ? ` Most disrupted areas: <strong>${topDisSector}</strong>.` : ''}
            Click any entity below to filter the intelligence feed.
        `;

        // Render entity tags
        renderEntityTags(benSectors, bSCounts, 'tag-sector-green');
        renderEntityTags(benTickers, bTCounts, 'tag-ticker-green');
        renderEntityTags(disSectors, dSCounts, 'tag-sector-red');
        renderEntityTags(disTickers, dTCounts, 'tag-ticker-red');
    }

    function getTopN(obj, n) {
        return Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);
    }

    function renderEntityTags(container, countsMap, cssClass) {
        const sorted = Object.entries(countsMap).sort((a, b) => b[1] - a[1]);
        if (sorted.length === 0) {
            container.innerHTML = '<span class="no-data-msg">No data yet</span>';
            return;
        }
        let html = '';
        sorted.forEach(([name, count]) => {
            html += `<span class="entity-tag ${cssClass}" data-entity="${escapeHTML(name)}">${escapeHTML(name)} <small>(${count})</small></span>`;
        });
        container.innerHTML = html;

        // Add click listeners
        container.querySelectorAll('.entity-tag').forEach(tag => {
            tag.addEventListener('click', () => {
                const entity = tag.dataset.entity;
                activateEntityFilter(entity);
            });
        });
    }

    function activateEntityFilter(entityName) {
        activeEntityFilter = entityName;
        activeFilterBar.style.display = 'flex';
        activeFilterLabel.innerHTML = `🔍 Showing items related to: <strong>${escapeHTML(entityName)}</strong>`;
        renderGrid();
        // Scroll to grid
        resultsGrid.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function clearEntityFilter() {
        activeEntityFilter = null;
        activeFilterBar.style.display = 'none';
        renderGrid();
    }

    // ---- Dropdowns ----
    function populateDropdowns() {
        Array.from(uniqueTags).sort().forEach(tag => {
            const opt = document.createElement('option');
            opt.value = tag;
            opt.textContent = tag;
            filterTag.appendChild(opt);
        });

        Array.from(uniqueSectors).sort().forEach(sector => {
            const opt = document.createElement('option');
            opt.value = sector;
            opt.textContent = sector;
            filterSector.appendChild(opt);
        });
    }

    // ---- Card Rendering ----
    function createCardHTML(item) {
        const isPaper = item.type === 'paper';
        const typeClass = isPaper ? 'type-paper' : 'type-news';
        const typeLabel = isPaper ? 'Research Paper' : 'Market News';

        // Score color
        let scoreClass = 'score-low';
        if (item.score >= 8) scoreClass = 'score-high';
        else if (item.score >= 6) scoreClass = 'score-mid';

        let tagsHTML = '<div class="tags">';
        item.tags.forEach(t => tagsHTML += `<span class="tag">${escapeHTML(t)}</span>`);
        tagsHTML += '</div>';

        let specificInfo = '';
        if (isPaper) {
            specificInfo = `
                <div class="insight-box">
                    <span class="insight-label">Decision Perspective</span>
                    <span class="insight-content">${escapeHTML(item.action || 'N/A')}</span>
                </div>
            `;
        } else {
            specificInfo = `
                <div class="insight-box">
                    <span class="insight-label">Strategic Action</span>
                    <span class="insight-content">${escapeHTML(item.action || 'N/A')}</span>
                </div>
                ${item.tickers ? `<p class="entities" style="color:var(--accent-blue)">Tickers: <span>${escapeHTML(item.tickers)}</span></p>` : ''}
            `;
        }

        const benefitStr = item.benefiting.filter(b => !isGenericNone(b)).join(', ') || 'None specified';
        const disruptStr = item.disrupted.filter(b => !isGenericNone(b)).join(', ') || 'None specified';

        return `
            <div class="card">
                <div class="card-header">
                    <span class="type-badge ${typeClass}">${typeLabel}</span>
                    <div class="score ${scoreClass}">
                        <svg class="score-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                        <span>${item.score}/10</span>
                    </div>
                </div>
                
                <div>
                    <h2 class="card-title">
                        <a href="${item.url}" target="_blank" rel="noopener noreferrer">${escapeHTML(item.title)}</a>
                    </h2>
                    <span class="card-date">${item.dateFormatted}${item.sentiment ? ` · <span style="color:${item.sentimentColor}">${item.sentiment}</span>` : ''}</span>
                </div>
                
                <p class="card-body">${escapeHTML(item.summary || '')}</p>
                
                ${specificInfo}
                
                <p class="entities">Benefiting: <span>${escapeHTML(benefitStr)}</span></p>
                <p class="entities disrupted">Disrupted: <span>${escapeHTML(disruptStr)}</span></p>
                
                ${tagsHTML}
            </div>
        `;
    }

    // ---- Grid Rendering ----
    function renderGrid() {
        const typeFilter = filterType.value;
        const tagFilter = filterTag.value;
        const sectorFilter = filterSector.value;
        const scoreFilter = filterScore.value;

        const filteredData = allData.filter(item => {
            // Type filter
            if (typeFilter !== 'all' && item.type !== typeFilter) return false;

            // Tag filter
            if (tagFilter !== 'all' && !item.tags.includes(tagFilter)) return false;

            // Sector filter (dropdown)
            if (sectorFilter !== 'all') {
                const inBen = item.benefiting.some(s => s === sectorFilter);
                const inDis = item.disrupted.some(s => s === sectorFilter);
                if (!inBen && !inDis) return false;
            }

            // Score filter (applies to both papers and news)
            if (scoreFilter !== 'all') {
                if (item.score < parseInt(scoreFilter)) return false;
            }

            // Active entity filter (from clicking a summary tag)
            if (activeEntityFilter) {
                const entityIds = entityToItems[activeEntityFilter] || [];
                if (!entityIds.includes(item.id)) {
                    // Also check if the entity name appears inline
                    const allEntities = [...item.benefiting, ...item.disrupted];
                    if (!allEntities.some(e => e === activeEntityFilter)) return false;
                }
            }

            return true;
        });

        if (filteredData.length === 0) {
            resultsGrid.innerHTML = `
                <div class="loading-state">
                    <svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" stroke-width="2" fill="none" style="opacity: 0.5"><circle cx="12" cy="12" r="10"></circle><line x1="8" y1="12" x2="16" y2="12"></line></svg>
                    <p>No intelligence found for selected filters.</p>
                </div>
            `;
            updateSummary([]);
            return;
        }

        filteredData.sort((a, b) => (b.score || 0) - (a.score || 0));

        let html = '';
        filteredData.forEach(item => html += createCardHTML(item));
        resultsGrid.innerHTML = html;
        
        updateSummary(filteredData);
    }

    // ---- Escape HTML ----
    function escapeHTML(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ---- Events ----
    filterType.addEventListener('change', renderGrid);
    filterTag.addEventListener('change', renderGrid);
    filterSector.addEventListener('change', renderGrid);
    filterScore.addEventListener('change', renderGrid);

    clearBtn.addEventListener('click', () => {
        filterType.value = 'all';
        filterScore.value = '7';
        filterTag.value = 'all';
        filterSector.value = 'all';
        clearEntityFilter();
    });

    dismissFilter.addEventListener('click', clearEntityFilter);

    init();
});
