document.addEventListener('DOMContentLoaded', () => {
    const resultsGrid = document.getElementById('results-grid');
    const filterType = document.getElementById('filter-type');
    const filterTag = document.getElementById('filter-tag');
    const filterSector = document.getElementById('filter-sector');

    let allData = [];
    let uniqueTags = new Set();
    let uniqueSectors = new Set();

    // Init App
    async function init() {
        try {
            const response = await fetch('data.json');
            
            // Handle if data.json doesn't exist yet
            if (!response.ok) {
                throw new Error('Data file not found. Ensure the backend export script has run.');
            }
            
            const rawData = await response.json();
            processData(rawData);
            populateDropdowns();
            renderGrid();
        } catch (error) {
            console.error('Error fetching data:', error);
            resultsGrid.innerHTML = `
                <div class="loading-state" style="color: var(--accent-rose);">
                    <svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                    <p>Failed to load intelligence data. <br/> <span style="font-size:0.8rem; color: var(--text-secondary)">(${error.message})</span></p>
                </div>`;
        }
    }

    // Process and normalize data from both tables
    function processData(data) {
        // Process Papers
        if (data.papers) {
            data.papers.forEach(item => {
                const tags = item.Tags ? item.Tags.split(',').map(t => t.trim()).filter(Boolean) : [];
                const sectors = item.Benefiting_Sectors ? item.Benefiting_Sectors.split(',').map(s => s.trim()).filter(Boolean) : [];
                
                tags.forEach(t => uniqueTags.add(t));
                sectors.forEach(s => uniqueSectors.add(s));

                allData.push({
                    type: 'paper',
                    id: item.Paper_ID,
                    title: item.Title,
                    summary: item.Abstract,
                    date: new Date(item.Published_Date).toLocaleDateString(),
                    url: item.Arxiv_URL,
                    score: item.Breakthrough_Score,
                    benefiting: item.Benefiting_Sectors,
                    disrupted: item.Disrupted_Sectors,
                    action: item.Decision_Perspective,
                    core: item.Core_Innovation,
                    tags: tags,
                    sectorsList: sectors
                });
            });
        }

        // Process News
        if (data.news) {
            data.news.forEach(item => {
                const tags = item.Economic_Tags ? item.Economic_Tags.split(',').map(t => t.trim()).filter(Boolean) : [];
                const sectors = item.Benefiting_Entities ? item.Benefiting_Entities.split(',').map(s => s.trim()).filter(Boolean) : [];
                
                tags.forEach(t => uniqueTags.add(t));
                sectors.forEach(s => uniqueSectors.add(s));

                let sentimentColor = '#94a3b8'; // Neutral
                if(item.Market_Sentiment && item.Market_Sentiment.toLowerCase().includes('positive')) sentimentColor = 'var(--accent-emerald)';
                if(item.Market_Sentiment && item.Market_Sentiment.toLowerCase().includes('negative')) sentimentColor = 'var(--accent-rose)';

                allData.push({
                    type: 'news',
                    id: item.News_ID,
                    title: item.Title,
                    summary: item.Snippet,
                    date: new Date(item.Published_Date).toLocaleDateString(),
                    url: item.News_URL,
                    score: item.Impact_Score,
                    benefiting: item.Benefiting_Entities,
                    disrupted: item.Disrupted_Entities,
                    action: item.Strategic_Action,
                    sentiment: item.Market_Sentiment,
                    sentimentColor: sentimentColor,
                    tickers: item.Related_Tickers,
                    tags: tags,
                    sectorsList: sectors
                });
            });
        }
    }

    // Populate filter dropdowns dynamically
    function populateDropdowns() {
        const sortedTags = Array.from(uniqueTags).sort();
        sortedTags.forEach(tag => {
            const option = document.createElement('option');
            option.value = tag;
            option.textContent = tag;
            filterTag.appendChild(option);
        });

        const sortedSectors = Array.from(uniqueSectors).sort();
        sortedSectors.forEach(sector => {
            const option = document.createElement('option');
            option.value = sector;
            option.textContent = sector;
            filterSector.appendChild(option);
        });
    }

    // Format single card HTML
    function createCardHTML(item) {
        const isPaper = item.type === 'paper';
        const typeClass = isPaper ? 'type-paper' : 'type-news';
        const typeLabel = isPaper ? 'Research Paper' : 'Market News';
        
        let tagsHTML = `<div class="tags">`;
        item.tags.forEach(t => tagsHTML += `<span class="tag">${t}</span>`);
        tagsHTML += `</div>`;

        let specificInfo = '';
        if (isPaper) {
            specificInfo = `
                <div class="insight-box">
                    <span class="insight-label">Decision Perspective</span>
                    <span class="insight-content">${item.action || 'N/A'}</span>
                </div>
            `;
        } else {
            specificInfo = `
                <div class="insight-box">
                    <span class="insight-label">Strategic Action</span>
                    <span class="insight-content">${item.action || 'N/A'}</span>
                </div>
                ${item.tickers ? `<p class="entities" style="color:var(--accent-blue)">Tickers: <span>${item.tickers}</span></p>` : ''}
            `;
        }

        return `
            <div class="card">
                <div class="card-header">
                    <span class="type-badge ${typeClass}">${typeLabel}</span>
                    <div class="score">
                        <svg class="score-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                        <span>${item.score}/10</span>
                    </div>
                </div>
                
                <div>
                    <h2 class="card-title">
                        <a href="${item.url}" target="_blank" rel="noopener noreferrer">${item.title}</a>
                    </h2>
                    <span class="card-date">${item.date} ${item.sentiment ? `• <span style="color:${item.sentimentColor}">${item.sentiment}</span>` : ''}</span>
                </div>
                
                <p class="card-body">
                    ${item.summary}
                </p>
                
                ${specificInfo}
                
                <p class="entities">Benefiting: <span>${item.benefiting || 'None specified'}</span></p>
                <p class="entities disrupted">Disrupted: <span>${item.disrupted || 'None specified'}</span></p>
                
                ${tagsHTML}
            </div>
        `;
    }

    // Filter and Render grid
    function renderGrid() {
        const typeFilter = filterType.value;
        const tagFilter = filterTag.value;
        const sectorFilter = filterSector.value;

        const filteredData = allData.filter(item => {
            let matchType = typeFilter === 'all' || item.type === typeFilter;
            let matchTag = tagFilter === 'all' || item.tags.includes(tagFilter);
            let matchSector = sectorFilter === 'all' || item.sectorsList.some(s => s === sectorFilter);
            
            return matchType && matchTag && matchSector;
        });

        if (filteredData.length === 0) {
            resultsGrid.innerHTML = `
                <div class="loading-state">
                    <svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.5"><circle cx="12" cy="12" r="10"></circle><line x1="8" y1="12" x2="16" y2="12"></line></svg>
                    <p>No intelligence found for selected filters.</p>
                </div>
            `;
            return;
        }

        // Sort by score (descending)
        filteredData.sort((a, b) => (b.score || 0) - (a.score || 0));

        let html = '';
        filteredData.forEach(item => {
            html += createCardHTML(item);
        });

        resultsGrid.innerHTML = html;
    }

    // Event Listeners for filters
    filterType.addEventListener('change', renderGrid);
    filterTag.addEventListener('change', renderGrid);
    filterSector.addEventListener('change', renderGrid);

    // Boot
    init();
});
