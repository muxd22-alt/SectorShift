document.addEventListener('DOMContentLoaded', () => {
    const resultsGrid = document.getElementById('results-grid');
    const filterType = document.getElementById('filter-type');
    const filterTag = document.getElementById('filter-tag');
    const filterSector = document.getElementById('filter-sector');
    const filterScore = document.getElementById('filter-score');
    
    const summaryPanel = document.getElementById('executive-summary');
    const summaryBenefiting = document.getElementById('summary-benefiting');
    const summaryDisrupted = document.getElementById('summary-disrupted');

    let allData = [];
    let uniqueTags = new Set();
    let uniqueSectors = new Set();
    
    // Summary trackers
    let benefitingCounts = {};
    let disruptedCounts = {};

    // Init App
    async function init() {
        try {
            const response = await fetch('data.json');
            
            if (!response.ok) {
                throw new Error('ملف البيانات غير موجود. تأكد من عمل سكريبت التحديث.');
            }
            
            const rawData = await response.json();
            processData(rawData);
            populateDropdowns();
            renderSummary();
            renderGrid();
        } catch (error) {
            console.error('Error fetching data:', error);
            resultsGrid.innerHTML = `
                <div class="loading-state" style="color: var(--accent-rose);">
                    <svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                    <p>فشل تحميل البيانات. <br/> <span style="font-size:0.8rem; color: var(--text-secondary)">(${error.message})</span></p>
                </div>`;
        }
    }

    // Process and normalize data
    function processData(data) {
        // Process Papers
        if (data.papers) {
            data.papers.forEach(item => {
                const tags = item.Tags ? item.Tags.split(',').map(t => t.trim()).filter(Boolean) : [];
                const sectors = item.Benefiting_Sectors ? item.Benefiting_Sectors.split(',').map(s => s.trim()).filter(Boolean) : [];
                const disrupted = item.Disrupted_Sectors ? item.Disrupted_Sectors.split(',').map(s => s.trim()).filter(Boolean) : [];
                
                tags.forEach(t => uniqueTags.add(t));
                sectors.forEach(s => {
                    uniqueSectors.add(s);
                    benefitingCounts[s] = (benefitingCounts[s] || 0) + 1;
                });
                disrupted.forEach(s => {
                    disruptedCounts[s] = (disruptedCounts[s] || 0) + 1;
                });

                allData.push({
                    type: 'paper',
                    id: item.Paper_ID,
                    title: item.Title,
                    summary: item.Abstract,
                    date: new Date(item.Published_Date).toLocaleDateString(),
                    url: item.Arxiv_URL,
                    score: parseInt(item.Breakthrough_Score) || 0,
                    benefitingList: sectors,
                    disruptedList: disrupted,
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
                const disrupted = item.Disrupted_Entities ? item.Disrupted_Entities.split(',').map(s => s.trim()).filter(Boolean) : [];
                
                tags.forEach(t => uniqueTags.add(t));
                sectors.forEach(s => {
                    uniqueSectors.add(s);
                    benefitingCounts[s] = (benefitingCounts[s] || 0) + 1;
                });
                disrupted.forEach(s => {
                    disruptedCounts[s] = (disruptedCounts[s] || 0) + 1;
                });

                let sentimentColor = '#94a3b8'; // Neutral
                let sentimentAr = 'محايد';
                if(item.Market_Sentiment && item.Market_Sentiment.toLowerCase().includes('positive')) {
                    sentimentColor = 'var(--accent-emerald)';
                    sentimentAr = 'إيجابي';
                }
                if(item.Market_Sentiment && item.Market_Sentiment.toLowerCase().includes('negative')) {
                    sentimentColor = 'var(--accent-rose)';
                    sentimentAr = 'سلبي';
                }

                allData.push({
                    type: 'news',
                    id: item.News_ID,
                    title: item.Title,
                    summary: item.Snippet,
                    date: new Date(item.Published_Date).toLocaleDateString(),
                    url: item.News_URL,
                    score: parseInt(item.Impact_Score) || 0,
                    benefitingList: sectors,
                    disruptedList: disrupted,
                    action: item.Strategic_Action,
                    sentiment: sentimentAr,
                    sentimentColor: sentimentColor,
                    tickers: item.Related_Tickers,
                    tags: tags,
                    sectorsList: sectors
                });
            });
        }
    }

    function renderSummary() {
        summaryPanel.style.display = 'block';
        
        // Sort and get top benefiting
        const sortedBenefiting = Object.entries(benefitingCounts).sort((a,b) => b[1] - a[1]);
        let benHTML = '';
        sortedBenefiting.forEach(item => {
            benHTML += `<span class="tag tag-green">${item[0]} <small>(${item[1]})</small></span>`;
        });
        summaryBenefiting.innerHTML = benHTML || '<span>لا يوجد بيانات</span>';

        // Sort and get top disrupted
        const sortedDisrupted = Object.entries(disruptedCounts).sort((a,b) => b[1] - a[1]);
        let disHTML = '';
        sortedDisrupted.forEach(item => {
            disHTML += `<span class="tag tag-red">${item[0]} <small>(${item[1]})</small></span>`;
        });
        summaryDisrupted.innerHTML = disHTML || '<span>لا يوجد بيانات</span>';
    }

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

    function createCardHTML(item) {
        const isPaper = item.type === 'paper';
        const typeClass = isPaper ? 'type-paper' : 'type-news';
        const typeLabel = isPaper ? 'ورقة بحثية' : 'أخبار السوق';
        
        let tagsHTML = `<div class="tags">`;
        item.tags.forEach(t => tagsHTML += `<span class="tag">${t}</span>`);
        tagsHTML += `</div>`;

        let specificInfo = '';
        if (isPaper) {
            specificInfo = `
                <div class="insight-box">
                    <span class="insight-label">المنظور الاستراتيجي</span>
                    <span class="insight-content">${item.action || 'لا يوجد'}</span>
                </div>
            `;
        } else {
            specificInfo = `
                <div class="insight-box">
                    <span class="insight-label">الإجراء الاستراتيجي</span>
                    <span class="insight-content">${item.action || 'لا يوجد'}</span>
                </div>
                ${item.tickers ? `<p class="entities" style="color:var(--accent-blue)">الأسهم: <span dir="ltr">${item.tickers}</span></p>` : ''}
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
                
                <p class="entities">المستفيدون: <span>${item.benefitingList.join('، ') || 'غير محدد'}</span></p>
                <p class="entities disrupted">المتضررون: <span>${item.disruptedList.join('، ') || 'غير محدد'}</span></p>
                
                ${tagsHTML}
            </div>
        `;
    }

    function renderGrid() {
        const typeFilter = filterType.value;
        const tagFilter = filterTag.value;
        const sectorFilter = filterSector.value;
        const scoreFilter = filterScore.value; 

        const filteredData = allData.filter(item => {
            let matchType = typeFilter === 'all' || item.type === typeFilter;
            let matchTag = tagFilter === 'all' || item.tags.includes(tagFilter);
            let matchSector = sectorFilter === 'all' || item.sectorsList.some(s => s === sectorFilter);
            
            let matchScore = true;
            // The score filter only applies to papers logically based on prompt (or both if desired, but defaults to papers)
            if (scoreFilter !== 'all' && item.type === 'paper') {
                matchScore = item.score >= parseInt(scoreFilter);
            }

            return matchType && matchTag && matchSector && matchScore;
        });

        if (filteredData.length === 0) {
            resultsGrid.innerHTML = `
                <div class="loading-state">
                    <svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.5"><circle cx="12" cy="12" r="10"></circle><line x1="8" y1="12" x2="16" y2="12"></line></svg>
                    <p>لا يوجد بيانات تطابق هذه الفلاتر.</p>
                </div>
            `;
            return;
        }

        filteredData.sort((a, b) => (b.score || 0) - (a.score || 0));

        let html = '';
        filteredData.forEach(item => {
            html += createCardHTML(item);
        });

        resultsGrid.innerHTML = html;
    }

    filterType.addEventListener('change', renderGrid);
    filterTag.addEventListener('change', renderGrid);
    filterSector.addEventListener('change', renderGrid);
    filterScore.addEventListener('change', renderGrid);

    init();
});
