// ── Browser compat shim ───────────────────────────────────────────────────────
const browser = window.browser || window.chrome;

// ── Tab switching ─────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-bar button').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-bar button').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function setStatus(area, msg) {
    area.textContent = '';
    const d = document.createElement('div');
    d.style.cssText = 'color:#555;font-style:italic;';
    d.textContent = msg;
    area.appendChild(d);
}

function setError(area, msg) {
    area.textContent = '';
    const d = document.createElement('div');
    d.style.color = 'red';
    d.textContent = msg;
    area.appendChild(d);
}

function setEmpty(area, msg) {
    area.textContent = '';
    const d = document.createElement('div');
    d.style.cssText = 'color:#888;font-style:italic;';
    d.textContent = msg;
    area.appendChild(d);
}

// FIX #5: removed deprecated execCommand fallback — clipboard API works fine in extension popups
function makeCopyBtn(btnEl, getText) {
    btnEl.addEventListener('click', () => {
        navigator.clipboard.writeText(getText()).catch(() => {});
        const orig = btnEl.textContent;
        btnEl.textContent = 'Copied!';
        btnEl.style.background = '#28a745';
        setTimeout(() => { btnEl.textContent = orig; btnEl.style.background = ''; }, 2000);
    });
}

// Build a BBCode results block (patrols + deployments)
function renderBBCode(area, data, countLabel, bbcode, copyLabel, bbId, copyId) {
    area.textContent = '';

    const countDiv = document.createElement('div');
    countDiv.className = 'count-label';
    const strong = document.createElement('strong');
    strong.textContent = data.length;
    countDiv.appendChild(strong);
    countDiv.appendChild(document.createTextNode(` ${countLabel}`));
    area.appendChild(countDiv);

    const ta = document.createElement('textarea');
    ta.className = 'bbbox';
    ta.id = bbId;
    ta.readOnly = true;
    ta.value = bbcode;
    area.appendChild(ta);

    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.id = copyId;
    btn.textContent = copyLabel;
    area.appendChild(btn);
    makeCopyBtn(btn, () => ta.value);
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. PATROLS
// ══════════════════════════════════════════════════════════════════════════════
document.getElementById('p-btn').addEventListener('click', async () => {
    const name = document.getElementById('p-name').value.trim();
    if (!name) return;
    const area = document.getElementById('p-results');
    setStatus(area, 'Scanning pages...');

    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });

    browser.scripting.executeScript({
        target: { tabId: tab.id },
        func: async (searchString) => {
            // FIX #1: escape user input before using it in RegExp to prevent ReDoS
            const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            // FIX #3: only allow http/https URLs in BBCode output
            const isSafeUrl = url => { try { return ['https:', 'http:'].includes(new URL(url).protocol); } catch { return false; } };

            const fetchPage = async (url) => { const r = await fetch(url, { credentials: 'same-origin' }); if (!r.ok) throw new Error(); return r.text(); };

            // FIX #4: filter pagination URLs to same origin only
            const getPaginationUrls = (doc, base) => {
                const s = new Set();
                const baseOrigin = new URL(base).origin;
                doc.querySelectorAll('.pagination a, a[href*="start="]').forEach(a => {
                    try {
                        const u = new URL(a.href, base).href;
                        if (new URL(u).origin === baseOrigin) s.add(u);
                    } catch (_) {}
                });
                return [...s].filter(u => u !== base);
            };

            const dedupe = (arr) => { const s = new Set(); return arr.filter(i => { const k = i.link; return s.has(k) ? false : (s.add(k), true); }); };
            const months = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
            const sortByDate = (arr) => arr.slice().sort((a,b) => { const p = d => { const [day,mon,year] = d.toLowerCase().split('/'); return new Date(+year,months[mon]??0,+day); }; return p(a._raw)-p(b._raw); });
            const nameRegex = new RegExp(escapeRegex(searchString), 'i');

            function extractPatrols(doc) {
                const out = [];
                doc.querySelectorAll('.postbody').forEach(post => {
                    const text = post.innerText || '';
                    if (!nameRegex.test(text)) return;
                    const dateMatch = text.match(/Date\s*of\s*Patrol\s*[:\-]?\s*(\d{1,2}\/\w{3}\/\d{4})/i);
                    if (!dateMatch) return;
                    let patrolType = 'UNKNOWN';
                    const html = post.innerHTML;
                    const typeSection = html.match(/3\.\s*Patrol\s*Type([\s\S]*?)4\./i);
                    if (typeSection) {
                        // FIX #2: use DOMParser instead of innerHTML to avoid executing page scripts
                        const tmp = new DOMParser().parseFromString(typeSection[1], 'text/html').body;
                        const checked = tmp.querySelector('img[src*="checked"], .checked, [checked]');
                        if (checked) {
                            patrolType = (checked.nextSibling?.textContent || 'CSP').trim();
                        } else {
                            const lines = (tmp.innerText || tmp.textContent || '').split('\n');
                            const cl = lines.find(l => /[☑✅✔]/.test(l));
                            if (cl) patrolType = cl.replace(/[☑✅✔\[\]\(\)]/g, '').trim();
                        }
                    }
                    const linkTag = post.querySelector('a[href*="p="], a[href*="t="]');
                    const rawLink = linkTag ? new URL(linkTag.getAttribute('href'), window.location.origin).href : window.location.href;
                    // FIX #3: validate link protocol before including in output
                    const link = isSafeUrl(rawLink) ? rawLink : window.location.href;
                    out.push({ date: dateMatch[1].toUpperCase(), _raw: dateMatch[1], type: patrolType.toUpperCase(), link });
                });
                return out;
            }

            const baseUrl = window.location.href;
            let all = extractPatrols(document);
            const pages = getPaginationUrls(document, baseUrl);
            if (pages.length) {
                const fetched = await Promise.all(pages.map(u => fetchPage(u).then(h => extractPatrols(new DOMParser().parseFromString(h,'text/html'))).catch(()=>[])));
                fetched.forEach(r => all.push(...r));
            }
            return sortByDate(dedupe(all)).map(({ date, type, link }) => ({ date, type, link }));
        },
        args: [name]
    }).then(([res]) => {
        const data = res?.result || [];
        if (!data.length) { setEmpty(area, 'No patrol logs found.'); return; }
        const bbcode = data.map(d => `[url=${d.link}]${d.date} - ${d.type}[/url]`).join('\n');
        renderBBCode(area, data, `patrol log${data.length !== 1 ? 's' : ''} found (oldest first)`, bbcode, 'Copy BBCode', 'p-bb', 'p-copy');
    // FIX #6: don't expose internal error messages in the UI
    }).catch(e => { console.error(e); setError(area, 'Something went wrong. Are you on the correct forum page?'); });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. DEPLOYMENTS
// ══════════════════════════════════════════════════════════════════════════════
document.getElementById('d-btn').addEventListener('click', async () => {
    const name = document.getElementById('d-name').value.trim();
    if (!name) return;
    const area = document.getElementById('d-results');
    setStatus(area, 'Searching...');

    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });

    browser.scripting.executeScript({
        target: { tabId: tab.id },
        func: async (searchString) => {
            // FIX #1: escape user input before using it in RegExp to prevent ReDoS
            const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            // FIX #3: only allow http/https URLs in BBCode output
            const isSafeUrl = url => { try { return ['https:', 'http:'].includes(new URL(url).protocol); } catch { return false; } };

            const fetchPage = async (url) => { const r = await fetch(url, { credentials: 'same-origin' }); if (!r.ok) throw new Error(); return r.text(); };

            // FIX #4: filter pagination URLs to same origin only
            const getPaginationUrls = (doc, base) => {
                const s = new Set();
                const baseOrigin = new URL(base).origin;
                doc.querySelectorAll('.pagination a, a[href*="start="]').forEach(a => {
                    try {
                        const u = new URL(a.href, base).href;
                        if (new URL(u).origin === baseOrigin) s.add(u);
                    } catch (_) {}
                });
                return [...s].filter(u => u !== base);
            };

            const dedupe = (arr) => { const s = new Set(); return arr.filter(i => { const k = `${i.date}|${i.link}`; return s.has(k)?false:(s.add(k),true); }); };
            const months = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
            const sortByDate = arr => arr.slice().sort((a,b) => { const p = d => { const [day,mon,year]=d.toLowerCase().split('/'); return new Date(+year,months[mon]??0,+day); }; return p(a._raw)-p(b._raw); });
            const nameRegex = new RegExp(escapeRegex(searchString), 'i');

            function extractDeployments(doc) {
                const out = [];
                doc.querySelectorAll('.post, .search.post, .postbody, .inner').forEach(post => {
                    const text = post.innerText || post.textContent || '';
                    if (!nameRegex.test(text)) return;
                    const dateMatch = text.match(/DATE:\s*(\d{1,2}\/\w{3}\/\d{4})/i);
                    if (!dateMatch) return;
                    const typeMatch = text.match(/DEPLOYMENT\s*TYPE:\s*([\s\S]*?)(?=\n\s*\d\.\d|\n\s*2.|\n\s*LOCATION:|$)/i);
                    let label = 'CSP';
                    if (typeMatch?.[1]) { const ex = typeMatch[1].replace(/[\r\n]+/g,' ').replace(/\s+/g,' ').trim(); label = ex.length>1 ? ex.toUpperCase() : 'UNKNOWN'; }
                    else if (/deployment/i.test(text)) label = 'UNKNOWN';
                    const linkTag = post.querySelector('a[href*="p="], a[href*="t="]');
                    const rawLink = linkTag ? linkTag.href : window.location.href;
                    // FIX #3: validate link protocol before including in output
                    const link = isSafeUrl(rawLink) ? rawLink : window.location.href;
                    out.push({ date: dateMatch[1].toUpperCase(), _raw: dateMatch[1], label, link });
                });
                return out;
            }

            const baseUrl = window.location.href;
            let all = extractDeployments(document);
            const pages = getPaginationUrls(document, baseUrl);
            if (pages.length) {
                const fetched = await Promise.all(pages.map(u => fetchPage(u).then(h => extractDeployments(new DOMParser().parseFromString(h,'text/html'))).catch(()=>[])));
                fetched.forEach(r => all.push(...r));
            }
            return sortByDate(dedupe(all)).map(({ date, label, link }) => ({ date, label, link }));
        },
        args: [name]
    }).then(([res]) => {
        const data = res?.result || [];
        if (!data.length) { setEmpty(area, 'No records found.'); return; }
        const bbcode = data.map(d => `[url=${d.link}]${d.date} - ${d.label}[/url]`).join('\n');
        renderBBCode(area, data, `deployment${data.length !== 1 ? 's' : ''} found (oldest first)`, bbcode, 'Copy BBCode', 'd-bb', 'd-copy');
    // FIX #6: don't expose internal error messages in the UI
    }).catch(e => { console.error(e); setError(area, 'Something went wrong. Are you on the correct forum page?'); });
});