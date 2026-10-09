const body             = document.body;
const modeRadios       = document.querySelectorAll('input[name="colorMode"]');
const fileInput        = document.getElementById('fileInput');
const loadButton       = document.getElementById('loadButton');
const contentDiv       = document.getElementById('content');
const prevBtn          = document.getElementById('prevBtn');
const nextBtn          = document.getElementById('nextBtn');
const pageInfo         = document.getElementById('pageInfo');
const showTextPosts    = document.getElementById('showTextPosts');
const showLinkPosts    = document.getElementById('showLinkPosts');
const showComments     = document.getElementById('showComments');
const showSavedOnly    = document.getElementById('showSavedOnly');
const sortBy           = document.getElementById('sortBy');
const searchInput      = document.getElementById('searchInput');
const fontSizeSelect   = document.getElementById('fontSizeSelect');
const lineHeightSelect = document.getElementById('lineHeightSelect');
const postCountDiv     = document.getElementById('postCount');
const paginationDiv    = document.querySelector('.pagination');
const dropZone         = document.getElementById('dropZone');
const fileListDiv      = document.getElementById('fileList');
const loadStatus       = document.getElementById('loadStatus');
const authorFilterBar  = document.getElementById('authorFilterBar');
const authorFilterName = document.getElementById('authorFilterName');
const clearAuthorBtn   = document.getElementById('clearAuthorFilter');

let readPosts           = new Set();
let savedPosts          = new Set();
let readingProgress     = {};
let lastReadPosition    = null;
let currentAuthorFilter = null;

let rawData      = [];
let postsData    = [];
let commentsMap  = {};
let filteredData = [];
let currentPage  = 1;
const pageSize   = 10;
let lastScrollY  = 0;
let pendingFiles = [];
let SQL = null;

document.addEventListener('DOMContentLoaded', () => {
    loadStoredData();
    setupDropZone();
    setupControls();
    initSqlJs();
});

async function initSqlJs() {
    if (typeof initSqlJs !== 'undefined' && !SQL) {
        try {
            SQL = await window.initSqlJs({
                locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}`
            });
        } catch (e) {
            console.error('Failed to initialize SQL.js:', e);
        }
    }
}

function loadStoredData() {
    try {
        const rp = localStorage.getItem('readPosts');
        const sp = localStorage.getItem('savedPosts');
        const rg = localStorage.getItem('readingProgress');
        const lr = localStorage.getItem('lastReadPosition');
        const af = localStorage.getItem('currentAuthorFilter');
        if (rp) readPosts           = new Set(JSON.parse(rp));
        if (sp) savedPosts          = new Set(JSON.parse(sp));
        if (rg) readingProgress     = JSON.parse(rg);
        if (lr) lastReadPosition    = JSON.parse(lr);
        if (af) currentAuthorFilter = af;
    } catch (e) {
        console.error('loadStoredData:', e);
        ['readPosts','savedPosts','readingProgress','lastReadPosition','currentAuthorFilter']
            .forEach(k => localStorage.removeItem(k));
    }
}

function saveToStorage(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
}

function setupDropZone() {
    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', ()  => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', e => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        addPendingFiles(Array.from(e.dataTransfer.files));
    });
    fileInput.addEventListener('change', () => {
        addPendingFiles(Array.from(fileInput.files));
        fileInput.value = '';
    });
}

function addPendingFiles(newFiles) {
    newFiles.forEach(f => {
        if (!pendingFiles.some(p => p.name === f.name && p.size === f.size))
            pendingFiles.push(f);
    });
    renderFileList();
    loadButton.disabled = pendingFiles.length === 0;
}

function removePendingFile(index) {
    pendingFiles.splice(index, 1);
    renderFileList();
    loadButton.disabled = pendingFiles.length === 0;
}

function renderFileList() {
    fileListDiv.innerHTML = '';
    pendingFiles.forEach((f, i) => {
        const tag   = document.createElement('div');
        tag.className = 'file-tag';
        const icon  = '🗄️';
        const kb = (f.size / 1024).toFixed(1);
        tag.innerHTML = `<span>${icon} ${f.name} <em>(${kb} KB)</em></span>
                         <button class="remove-file" title="Remove">✕</button>`;
        tag.querySelector('.remove-file').addEventListener('click', e => {
            e.stopPropagation();
            removePendingFile(i);
        });
        fileListDiv.appendChild(tag);
    });
}

loadButton.addEventListener('click', async () => {
    if (!pendingFiles.length) return;
    loadButton.disabled    = true;
    loadButton.textContent = 'Loading…';
    loadStatus.textContent = '';

    if (!SQL) {
        await initSqlJs();
    }

    let combined = [];
    for (const file of pendingFiles) {
        const items = await parseDatabase(file);
        combined = combined.concat(items);
    }

    rawData = combined;
    buildIndex();

    let msg = `Loaded ${rawData.length} item(s) from ${pendingFiles.length} database file(s).`;
    loadStatus.textContent = msg;

    loadButton.textContent = 'Load Files';
    loadButton.disabled    = false;

    applyFilters();
    showResumeButton();
});

function parseDatabase(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = e => {
            const items = [];
            try {
                const Uints = new Uint8Array(e.target.result);
                const db = new SQL.Database(Uints);

                const postTables = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='posts'");
                if (postTables.length > 0) {
                    const postRes = db.exec("SELECT * FROM posts");
                    if (postRes.length > 0) {
                        const cols = postRes[0].columns;
                        postRes[0].values.forEach(row => {
                            const obj = {};
                            cols.forEach((col, idx) => {
                                obj[col] = row[idx];
                            });
                            items.push(obj);
                        });
                    }
                }

                const commentTables = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='comments'");
                if (commentTables.length > 0) {
                    const commentRes = db.exec("SELECT * FROM comments");
                    if (commentRes.length > 0) {
                        const cols = commentRes[0].columns;
                        commentRes[0].values.forEach(row => {
                            const obj = {};
                            cols.forEach((col, idx) => {
                                obj[col] = row[idx];
                            });
                            items.push(obj);
                        });
                    }
                }
                db.close();
            } catch (err) {
                console.error('Error reading database file:', err);
            }
            resolve(items);
        };
        reader.readAsArrayBuffer(file);
    });
}

function buildIndex() {
    postsData   = [];
    commentsMap = {};

    for (const item of rawData) {
        if (isComment(item)) {
            const parentId = (item.post_id || item.link_id || '').replace(/^t\d_/, '');
            if (!commentsMap[parentId]) commentsMap[parentId] = [];
            commentsMap[parentId].push(item);
        } else {
            postsData.push(item);
        }
    }

    for (const id of Object.keys(commentsMap)) {
        commentsMap[id].sort((a, b) => (a.created_utc || 0) - (b.created_utc || 0));
    }
}

modeRadios.forEach(radio => {
    radio.addEventListener('change', () => {
        body.classList.remove('dark-gray', 'true-black');
        if (radio.value === 'dark-gray')  body.classList.add('dark-gray');
        if (radio.value === 'true-black') body.classList.add('true-black');
    });
});

function isComment(item)  { return 'body' in item && !('title' in item); }
function isTextPost(item) { if (isComment(item)) return false; return ('is_self' in item) ? item.is_self  : !!item.selftext; }
function isLinkPost(item) { if (isComment(item)) return false; return ('is_self' in item) ? !item.is_self : (!!item.url && !item.selftext); }

function getPostId(item) {
    return item.id
        || `${item.author}_${item.created_utc}_${(item.title || item.body || '').substring(0, 20)}`;
}

function shortenText(text, max) {
    if (!text) return '';
    return text.length <= max ? text : text.substring(0, max) + '…';
}

function formatDate(item) {
    return new Date((item.created_utc || item.created || 0) * 1000).toLocaleString();
}

function applyFilters() {
    const showText  = showTextPosts.checked;
    const showLink  = showLinkPosts.checked;
    const savedOnly = showSavedOnly.checked;
    const query     = searchInput.value.toLowerCase().trim();

    filteredData = postsData.filter(item => {
        if (isTextPost(item) && !showText) return false;
        if (isLinkPost(item) && !showLink) return false;
        if (savedOnly && !savedPosts.has(getPostId(item))) return false;
        if (currentAuthorFilter && item.author !== currentAuthorFilter) return false;

        if (query) {
            const postHay = [item.title, item.selftext, item.url, item.author]
                .filter(Boolean).join(' ').toLowerCase();
            const commentHay = (commentsMap[item.id] || [])
                .map(c => `${c.body || ''} ${c.author || ''}`).join(' ').toLowerCase();
            if (!postHay.includes(query) && !commentHay.includes(query)) return false;
        }

        return true;
    });

    applySorting();
    currentPage = 1;
    renderPage(currentPage);
    updateAuthorFilterBar();
}

function applySorting() {
    const mode = sortBy.value;
    if (mode === 'none') return;
    filteredData.sort((a, b) => {
        switch (mode) {
            case 'textLength': return (b.selftext || '').length - (a.selftext || '').length;
            case 'scoreAsc':   return (a.score || 0) - (b.score || 0);
            case 'scoreDesc':  return (b.score || 0) - (a.score || 0);
            case 'dateAsc':    return (a.created_utc || 0) - (b.created_utc || 0);
            case 'dateDesc':   return (b.created_utc || 0) - (a.created_utc || 0);
            default:           return 0;
        }
    });
}

function filterByAuthor(author) {
    currentAuthorFilter = author;
    localStorage.setItem('currentAuthorFilter', author);
    applyFilters();
    window.scrollTo(0, 0);
}

function clearAuthorFilter() {
    currentAuthorFilter = null;
    localStorage.removeItem('currentAuthorFilter');
    applyFilters();
}

function updateAuthorFilterBar() {
    if (currentAuthorFilter) {
        authorFilterBar.style.display = 'flex';
        authorFilterName.textContent  = currentAuthorFilter;
    } else {
        authorFilterBar.style.display = 'none';
    }
}

clearAuthorBtn.addEventListener('click', clearAuthorFilter);

function markAsRead(item) {
    readPosts.add(getPostId(item));
    saveToStorage('readPosts', [...readPosts]);
}

function toggleRead(item, cardEl) {
    const id = getPostId(item);
    readPosts.has(id) ? readPosts.delete(id) : readPosts.add(id);
    saveToStorage('readPosts', [...readPosts]);
    cardEl.classList.toggle('read-post', readPosts.has(id));
    const btn = cardEl.querySelector('.btn-read');
    if (btn) btn.textContent = readPosts.has(id) ? '✓' : '○';
}

function toggleSaved(item, cardEl) {
    const id = getPostId(item);
    savedPosts.has(id) ? savedPosts.delete(id) : savedPosts.add(id);
    saveToStorage('savedPosts', [...savedPosts]);
    cardEl.classList.toggle('saved-post', savedPosts.has(id));
    const btn = cardEl.querySelector('.btn-save');
    if (btn) btn.textContent = savedPosts.has(id) ? '★' : '☆';
}

function buildCommentThread(postId, startCollapsed) {
    const allComments = commentsMap[postId] || [];
    const query       = searchInput.value.toLowerCase().trim();

    const visible = allComments.filter(c => {
        if (currentAuthorFilter && c.author !== currentAuthorFilter) return false;
        if (query) {
            const hay = `${c.body || ''} ${c.author || ''}`.toLowerCase();
            if (!hay.includes(query)) return false;
        }
        return true;
    });

    if (visible.length === 0) return null;

    const wrapper = document.createElement('div');
    wrapper.className = 'comment-thread';

    const header = document.createElement('div');
    header.className = 'comment-thread-header';
    header.innerHTML = `<span class="thread-count">💬 ${visible.length} comment${visible.length !== 1 ? 's' : ''}</span>
                        <span class="thread-toggle">${startCollapsed ? '▼ Show' : '▲ Hide'}</span>`;

    const list = document.createElement('div');
    list.className = 'comment-list';
    if (startCollapsed) list.style.display = 'none';

    visible.forEach(c => {
        const cId  = getPostId(c);
        const cDiv = document.createElement('div');
        cDiv.className = 'comment-item';
        if (readPosts.has(cId))  cDiv.classList.add('read-post');
        if (savedPosts.has(cId)) cDiv.classList.add('saved-post');

        const author = c.author || 'unknown';
        cDiv.innerHTML = `
            <div class="comment-meta">
                <span class="post-author comment-author" data-author="${author}">${author}</span>
                <span class="post-score">${c.score ?? 0} pts</span>
                <span class="post-date">${formatDate(c)}</span>
                <span class="comment-actions">
                    <button class="btn-action btn-read"  title="Toggle read">${readPosts.has(cId)  ? '✓' : '○'}</button>
                    <button class="btn-action btn-save"  title="Toggle saved">${savedPosts.has(cId) ? '★' : '☆'}</button>
                </span>
            </div>
            <div class="comment-body">${c.body || ''}</div>`;

        cDiv.querySelector('.comment-author').addEventListener('click', e => {
            e.stopPropagation();
            filterByAuthor(e.currentTarget.dataset.author);
        });
        cDiv.querySelector('.btn-read').addEventListener('click', e => {
            e.stopPropagation();
            toggleRead(c, cDiv);
        });
        cDiv.querySelector('.btn-save').addEventListener('click', e => {
            e.stopPropagation();
            toggleSaved(c, cDiv);
        });

        list.appendChild(cDiv);
    });

    let collapsed = !!startCollapsed;
    header.addEventListener('click', () => {
        collapsed = !collapsed;
        list.style.display = collapsed ? 'none' : '';
        header.querySelector('.thread-toggle').textContent = collapsed ? '▼ Show' : '▲ Hide';
    });

    wrapper.appendChild(header);
    wrapper.appendChild(list);
    return wrapper;
}

function buildCard(item, globalIndex) {
    const id  = getPostId(item);
    const div = document.createElement('div');
    div.className = 'post';
    if (readPosts.has(id))  div.classList.add('read-post');
    if (savedPosts.has(id)) div.classList.add('saved-post');

    const author = item.author || 'unknown';
    const sub    = item.subreddit || 'unknown';

    const metaHtml = `
        <div class="post-meta">
            <span class="post-author" data-author="${author}">${author}</span>
            in <span class="post-subreddit">r/${sub}</span>
            <span class="post-score">${item.score ?? 0} pts</span>
            <span class="post-date">${formatDate(item)}</span>
        </div>`;

    let bodyHtml = '';
    if (isTextPost(item)) {
        bodyHtml = `<h3>${item.title || '(No Title)'}</h3>` +
            (item.selftext ? `<div class="post-preview">${shortenText(item.selftext, 200)}</div>` : '');
    } else {
        bodyHtml = `<h3>${item.title || '(No Title)'}</h3>` +
            `<div class="post-preview link-preview">
                <a href="${item.url || '#'}" target="_blank" rel="noopener">${shortenText(item.url || '', 120)}</a>
             </div>`;
    }

    const actionsHtml = `
        <div class="post-actions">
            <button class="btn-action btn-read"  title="Toggle read">${readPosts.has(id)  ? '✓' : '○'}</button>
            <button class="btn-action btn-save"  title="Toggle saved">${savedPosts.has(id) ? '★' : '☆'}</button>
        </div>`;

    div.innerHTML = metaHtml + bodyHtml + actionsHtml;

    div.querySelector('.post-author').addEventListener('click', e => {
        e.stopPropagation();
        filterByAuthor(e.currentTarget.dataset.author);
    });
    div.querySelector('.btn-read').addEventListener('click', e => {
        e.stopPropagation();
        toggleRead(item, div);
    });
    div.querySelector('.btn-save').addEventListener('click', e => {
        e.stopPropagation();
        toggleSaved(item, div);
    });
    div.addEventListener('click', () => {
        markAsRead(item);
        div.classList.add('read-post');
        openPost(item, globalIndex);
    });

    if (showComments.checked) {
        const thread = buildCommentThread(item.id, true);
        if (thread) {
            thread.addEventListener('click', e => e.stopPropagation());
            div.appendChild(thread);
        }
    }

    return div;
}

function renderPage(page) {
    contentDiv.innerHTML = '';
    const start = (page - 1) * pageSize;
    const slice = filteredData.slice(start, start + pageSize);

    if (slice.length === 0) {
        contentDiv.innerHTML = '<p class="empty-msg">No items match the current filters.</p>';
    } else {
        slice.forEach((item, i) => contentDiv.appendChild(buildCard(item, start + i)));
    }

    let countText = `${filteredData.length} post${filteredData.length !== 1 ? 's' : ''}`;
    if (currentAuthorFilter) countText += ` by ${currentAuthorFilter}`;
    postCountDiv.textContent = countText;

    pageInfo.textContent = `Page ${page} / ${Math.max(1, Math.ceil(filteredData.length / pageSize))}`;
    prevBtn.disabled = page === 1;
    nextBtn.disabled = start + pageSize >= filteredData.length;
    paginationDiv.style.display = '';
    postCountDiv.style.display  = '';

    contentDiv.style.fontSize   = fontSizeSelect.value;
    contentDiv.style.lineHeight = lineHeightSelect.value;
}

function openPost(item, globalIndex) {
    lastScrollY = window.scrollY;

    lastReadPosition = { id: getPostId(item), index: globalIndex, page: currentPage };
    saveToStorage('lastReadPosition', lastReadPosition);

    contentDiv.innerHTML = '';
    paginationDiv.style.display = 'none';
    postCountDiv.style.display  = 'none';

    const nav = document.createElement('div');
    nav.className = 'blog-nav';

    const backBtn = document.createElement('button');
    backBtn.className   = 'nav-button back-button';
    backBtn.textContent = '← Back to List';
    backBtn.onclick = () => {
        renderPage(currentPage);
        window.scrollTo(0, lastScrollY);
        paginationDiv.style.display = '';
        postCountDiv.style.display  = '';
    };

    const prevPostBtn = document.createElement('button');
    prevPostBtn.className   = 'nav-button prev-post';
    prevPostBtn.textContent = '← Previous';
    prevPostBtn.disabled    = globalIndex <= 0;
    prevPostBtn.onclick = () => {
        if (globalIndex > 0) { const p = filteredData[globalIndex - 1]; markAsRead(p); openPost(p, globalIndex - 1); }
    };

    const nextPostBtn = document.createElement('button');
    nextPostBtn.className   = 'nav-button next-post';
    nextPostBtn.textContent = 'Next →';
    nextPostBtn.disabled    = globalIndex >= filteredData.length - 1;
    nextPostBtn.onclick = () => {
        if (globalIndex < filteredData.length - 1) { const p = filteredData[globalIndex + 1]; markAsRead(p); openPost(p, globalIndex + 1); }
    };

    nav.appendChild(backBtn);
    nav.appendChild(prevPostBtn);
    nav.appendChild(nextPostBtn);

    const id = getPostId(item);
    const actionBar = document.createElement('div');
    actionBar.className = 'single-post-actions';

    const readBtn = document.createElement('button');
    readBtn.className   = 'btn-action btn-read';
    readBtn.textContent = readPosts.has(id) ? '✓ Read' : '○ Mark as read';
    readBtn.onclick = () => {
        readPosts.has(id) ? readPosts.delete(id) : readPosts.add(id);
        readBtn.textContent = readPosts.has(id) ? '✓ Read' : '○ Mark as read';
        saveToStorage('readPosts', [...readPosts]);
    };

    const saveBtn = document.createElement('button');
    saveBtn.className   = 'btn-action btn-save';
    saveBtn.textContent = savedPosts.has(id) ? '★ Saved' : '☆ Save for later';
    saveBtn.onclick = () => {
        savedPosts.has(id) ? savedPosts.delete(id) : savedPosts.add(id);
        saveBtn.textContent = savedPosts.has(id) ? '★ Saved' : '☆ Save for later';
        saveToStorage('savedPosts', [...savedPosts]);
    };

    actionBar.appendChild(readBtn);
    actionBar.appendChild(saveBtn);

    const postDiv = document.createElement('div');
    postDiv.className = 'post single-post';

    const author     = item.author || 'unknown';
    const authorSpan = `<span class="post-author clickable" data-author="${author}">${author}</span>`;
    const metaBlock  = `
        <div class="single-meta">
            <div>${authorSpan} in <span class="post-subreddit">r/${item.subreddit || 'unknown'}</span></div>
            <div>Score: <strong>${item.score ?? 0}</strong> &nbsp;|&nbsp; ${formatDate(item)}</div>
        </div>`;

    if (isTextPost(item)) {
        postDiv.innerHTML = `<h3>${item.title || '(No Title)'}</h3>${metaBlock}
            <div class="post-content">${item.selftext || '(No content)'}</div>`;
    } else {
        postDiv.innerHTML = `<h3>${item.title || '(No Title)'}</h3>${metaBlock}
            <div class="post-content">
                <a href="${item.url || '#'}" target="_blank" rel="noopener">${item.url || '(No link)'}</a>
            </div>`;
    }

    postDiv.querySelector('.post-author.clickable')?.addEventListener('click', e => {
        filterByAuthor(e.currentTarget.dataset.author);
    });

    const thread = buildCommentThread(item.id, false);
    if (thread) {
        thread.classList.add('single-post-comments');
        postDiv.appendChild(thread);
    }

    contentDiv.appendChild(nav);
    contentDiv.appendChild(actionBar);
    contentDiv.appendChild(postDiv);

    const savedScroll = readingProgress[id];
    if (savedScroll) {
        setTimeout(() => window.scrollTo(0, savedScroll), 50);
    } else {
        window.scrollTo(0, 0);
    }

    let scrollTimer;
    const onScroll = () => {
        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(() => {
            readingProgress[id] = window.scrollY;
            saveToStorage('readingProgress', readingProgress);
        }, 400);
    };
    window.addEventListener('scroll', onScroll);
}

function showResumeButton() {
    document.querySelector('.resume-reading')?.remove();
    if (!lastReadPosition) return;

    const wrap = document.createElement('div');
    wrap.className = 'resume-reading';

    const btn = document.createElement('button');
    btn.textContent = '▶ Resume Reading';
    btn.onclick = () => {
        currentPage = lastReadPosition.page;
        renderPage(currentPage);
        setTimeout(() => {
            const target = filteredData.find(i => getPostId(i) === lastReadPosition.id)
                        || filteredData[lastReadPosition.index];
            if (target) openPost(target, filteredData.indexOf(target));
        }, 100);
    };

    wrap.appendChild(btn);
    const controls = document.querySelector('.controls');
    controls.parentNode.insertBefore(wrap, controls.nextSibling);
}

prevBtn.addEventListener('click', () => {
    if (currentPage > 1) { currentPage--; renderPage(currentPage); window.scrollTo(0, 0); }
});
nextBtn.addEventListener('click', () => {
    if (currentPage * pageSize < filteredData.length) { currentPage++; renderPage(currentPage); window.scrollTo(0, 0); }
});

function setupControls() {
    showTextPosts.addEventListener('change',    applyFilters);
    showLinkPosts.addEventListener('change',    applyFilters);
    showComments.addEventListener('change',     applyFilters);
    showSavedOnly.addEventListener('change',    applyFilters);
    sortBy.addEventListener('change', () => { applySorting(); renderPage(currentPage); });
    searchInput.addEventListener('input',       applyFilters);
    fontSizeSelect.addEventListener('change',   () => { contentDiv.style.fontSize   = fontSizeSelect.value; });
    lineHeightSelect.addEventListener('change', () => { contentDiv.style.lineHeight = lineHeightSelect.value; });
}

(function setupSwipe() {
    let startX = 0;
    document.addEventListener('touchstart', e => { startX = e.changedTouches[0].screenX; }, { passive: true });
    document.addEventListener('touchend', e => {
        const delta = e.changedTouches[0].screenX - startX;
        if (Math.abs(delta) < 80) return;
        const inSingle = !!contentDiv.querySelector('.single-post');
        if (inSingle) {
            if (delta > 0) document.querySelector('.prev-post')?.click();
            else           document.querySelector('.next-post')?.click();
        } else {
            if (delta > 0 && !prevBtn.disabled) prevBtn.click();
            else if (delta < 0 && !nextBtn.disabled) nextBtn.click();
        }
    }, { passive: true });
})();

document.addEventListener('click', e => {
    if (!contentDiv.querySelector('.single-post'))  return;
    if (e.target.closest('.single-post'))           return;
    if (e.target.closest('.blog-nav'))              return;
    if (e.target.closest('.single-post-actions'))   return;
    if (!e.target.closest('#wrapper'))              return;
    renderPage(currentPage);
    window.scrollTo(0, lastScrollY);
    paginationDiv.style.display = '';
    postCountDiv.style.display  = '';
});
