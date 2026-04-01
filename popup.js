// ── Browser compat shim ───────────────────────────────────────────────────────
const browser = window.browser || window.chrome;

// ── Session name memory (plain JS object — cleared when popup closes, zero storage) ──
const sessionNames = { patrols: '', deployments: '' };

// ── Tab switching ─────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-bar button').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-bar button').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
        // Restore last searched name for this tab
        const t = btn.dataset.tab;
        if (t === 'patrols' && sessionNames.patrols)
            document.getElementById('p-name').value = sessionNames.patrols;
        if (t === 'deployments' && sessionNames.deployments)
            document.getElementById('d-name').value = sessionNames.deployments;
    });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

// Animated spinner + message, used instead of plain italic text while running
function setSpinner(area, msg) {
    area.textContent = '';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;align-items:center;gap:8px;color:#555;font-style:italic;font-size:12px;margin-top:4px;';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '16'); svg.setAttribute('height', '16');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none');
    svg.style.cssText = 'animation:spin 0.8s linear infinite;flex-shrink:0;';
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx','12'); circle.setAttribute('cy','12'); circle.setAttribute('r','10');
    circle.setAttribute('stroke','#ccc'); circle.setAttribute('stroke-width','3');
    const arc = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    arc.setAttribute('d','M12 2a10 10 0 0 1 10 10');
    arc.setAttribute('stroke','#0f2940'); arc.setAttribute('stroke-width','3');
    arc.setAttribute('stroke-linecap','round');
    svg.appendChild(circle); svg.appendChild(arc);
    const txt = document.createElement('span');
    txt.textContent = msg;
    wrap.appendChild(svg); wrap.appendChild(txt);
    area.appendChild(wrap);
}

function setError(area, msg) {
    area.textContent = '';
    const d = document.createElement('div');
    d.style.cssText = 'color:red;font-size:12px;margin-top:4px;';
    d.textContent = msg;
    area.appendChild(d);
}

function setEmpty(area, msg) {
    area.textContent = '';
    const d = document.createElement('div');
    d.style.cssText = 'color:#888;font-style:italic;font-size:12px;margin-top:4px;';
    d.textContent = msg;
    area.appendChild(d);
}

// Show or clear a count badge on a tab button (e.g. "PATROLS · 12")
function setTabBadge(tabName, count) {
    const btn = document.querySelector(`.tab-bar button[data-tab="${tabName}"]`);
    if (!btn) return;
    const label = tabName === 'patrols' ? 'PATROLS' : 'DEPLOYMENTS';
    btn.textContent = count > 0 ? `${label} · ${count}` : label;
}

// Disable/re-enable the go-button while a search is running (prevents double-fire)
function setButtonBusy(btn, busy) {
    btn.disabled = busy;
    btn.style.opacity = busy ? '0.6' : '';
    btn.style.cursor  = busy ? 'not-allowed' : '';
}

function makeCopyBtn(btnEl, getText) {
    btnEl.addEventListener('click', () => {
        navigator.clipboard.writeText(getText()).catch(() => {});
        const orig = btnEl.textContent;
        btnEl.textContent = 'Copied!';
        btnEl.style.background = '#28a745';
        setTimeout(() => { btnEl.textContent = orig; btnEl.style.background = ''; }, 2000);
    });
}

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
    ta.className = 'bbbox'; ta.id = bbId; ta.readOnly = true; ta.value = bbcode;
    area.appendChild(ta);

    const btn = document.createElement('button');
    btn.className = 'copy-btn'; btn.id = copyId; btn.textContent = copyLabel;
    area.appendChild(btn);
    makeCopyBtn(btn, () => ta.value);
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. PATROLS
// ══════════════════════════════════════════════════════════════════════════════
async function runPatrols() {
    const nameInput = document.getElementById('p-name');
    const btn       = document.getElementById('p-btn');
    const area      = document.getElementById('p-results');
    const name      = nameInput.value.trim();
    if (!name || btn.disabled) return;

    sessionNames.patrols = name;   // remember for this session
    setButtonBusy(btn, true);
    setTabBadge('patrols', 0);
    setSpinner(area, 'Scanning pages...');

    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });

    browser.scripting.executeScript({
        target: { tabId: tab.id },
        func: async (searchString) => {
            const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const isSafeUrl   = url => { try { return ['https:','http:'].includes(new URL(url).protocol); } catch { return false; } };
            const fetchPage   = async url => { const r = await fetch(url, { credentials: 'same-origin' }); if (!r.ok) throw new Error(); return r.text(); };

            const getPaginationUrls = (doc, base) => {
                const s = new Set(), baseOrigin = new URL(base).origin;
                doc.querySelectorAll('.pagination a, a[href*="start="]').forEach(a => {
                    try { const u = new URL(a.href, base).href; if (new URL(u).origin === baseOrigin) s.add(u); } catch (_) {}
                });
                return [...s].filter(u => u !== base);
            };

            const dedupe     = arr => { const s = new Set(); return arr.filter(i => { const k = i.link; return s.has(k) ? false : (s.add(k), true); }); };
            const months     = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
            const sortByDate = arr => arr.slice().sort((a,b) => { const p = d => { const [dy,mn,yr] = d.toLowerCase().split('/'); return new Date(+yr,months[mn]??0,+dy); }; return p(a._raw)-p(b._raw); });
            const nameRegex  = new RegExp(escapeRegex(searchString), 'i');

            function extractPatrols(doc) {
                const out = [];
                doc.querySelectorAll('.postbody').forEach(post => {
                    const text = post.innerText || '';
                    if (!nameRegex.test(text)) return;
                    const dateMatch = text.match(/Date\s*of\s*Patrol\s*[:\-]?\s*(\d{1,2}\/\w{3}\/\d{4})/i);
                    if (!dateMatch) return;
                    let patrolType = 'UNKNOWN';
                    const typeSection = post.innerHTML.match(/3\.\s*Patrol\s*Type([\s\S]*?)4\./i);
                    if (typeSection) {
                        const tmp = new DOMParser().parseFromString(typeSection[1], 'text/html').body;
                        const checked = tmp.querySelector('img[src*="checked"], .checked, [checked]');
                        if (checked) {
                            patrolType = (checked.nextSibling?.textContent || 'CSP').trim();
                        } else {
                            const cl = (tmp.innerText || tmp.textContent || '').split('\n').find(l => /[☑✅✔]/.test(l));
                            if (cl) patrolType = cl.replace(/[☑✅✔\[\]\(\)]/g, '').trim();
                        }
                    }
                    const linkTag = post.querySelector('a[href*="p="], a[href*="t="]');
                    const rawLink = linkTag ? new URL(linkTag.getAttribute('href'), window.location.origin).href : window.location.href;
                    const link    = isSafeUrl(rawLink) ? rawLink : window.location.href;
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
        setButtonBusy(btn, false);
        const data = res?.result || [];
        if (!data.length) { setEmpty(area, 'No patrol logs found.'); return; }
        setTabBadge('patrols', data.length);
        const bbcode = data.map(d => `[url=${d.link}]${d.date} - ${d.type}[/url]`).join('\n');
        renderBBCode(area, data, `patrol log${data.length !== 1 ? 's' : ''} found (oldest first)`, bbcode, 'Copy BBCode', 'p-bb', 'p-copy');
    }).catch(e => { console.error(e); setButtonBusy(btn, false); setError(area, 'Something went wrong. Are you on the correct forum page?'); });
}

// ── Patrols Trigger ──
document.getElementById('p-btn').addEventListener('click', runPatrols);
document.getElementById('p-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); runPatrols(); }
});


// ══════════════════════════════════════════════════════════════════════════════
// 2. DEPLOYMENTS
// ══════════════════════════════════════════════════════════════════════════════
async function runDeployments() {
    const nameInput = document.getElementById('d-name');
    const btn       = document.getElementById('d-btn');
    const area      = document.getElementById('d-results');
    const name      = nameInput.value.trim();
    if (!name || btn.disabled) return;

    sessionNames.deployments = name;  // remember for this session
    setButtonBusy(btn, true);
    setTabBadge('deployments', 0);
    setSpinner(area, 'Searching...');

    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });

    browser.scripting.executeScript({
        target: { tabId: tab.id },
        func: async (searchString) => {
            const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const isSafeUrl   = url => { try { return ['https:','http:'].includes(new URL(url).protocol); } catch { return false; } };
            const fetchPage   = async url => { const r = await fetch(url, { credentials: 'same-origin' }); if (!r.ok) throw new Error(); return r.text(); };

            const getPaginationUrls = (doc, base) => {
                const s = new Set(), baseOrigin = new URL(base).origin;
                doc.querySelectorAll('.pagination a, a[href*="start="]').forEach(a => {
                    try { const u = new URL(a.href, base).href; if (new URL(u).origin === baseOrigin) s.add(u); } catch (_) {}
                });
                return [...s].filter(u => u !== base);
            };

            // Dedupe by date+label: catches the same deployment reposted across different page URLs
            const dedupe     = arr => { const s = new Set(); return arr.filter(i => { const k = `${i.date}|${i.label}`; return s.has(k) ? false : (s.add(k), true); }); };
            const months     = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
            const sortByDate = arr => arr.slice().sort((a,b) => { const p = d => { const [dy,mn,yr]=d.toLowerCase().split('/'); return new Date(+yr,months[mn]??0,+dy); }; return p(a._raw)-p(b._raw); });
            const nameRegex  = new RegExp(escapeRegex(searchString), 'i');

            function extractDeployments(doc) {
                const out = [];
                doc.querySelectorAll('.post, .search.post, .postbody, .inner').forEach(post => {
                    const text = post.innerText || post.textContent || '';
                    if (!nameRegex.test(text)) return;
                    const dateMatch = text.match(/DATE:\s*(\d{1,2}\/\w{3}\/\d{4})/i);
                    if (!dateMatch) return;
                    const typeMatch = text.match(/DEPLOYMENT\s*TYPE:\s*([\s\S]*?)(?=\n\s*\d\.\d|\n\s*2.|\n\s*LOCATION:|$)/i);
                    let label = 'CSP';
                    if (typeMatch?.[1]) { const ex = typeMatch[1].replace(/[\r\n]+/g,' ').replace(/\s+/g,' ').trim(); label = ex.length > 1 ? ex.toUpperCase() : 'UNKNOWN'; }
                    else if (/deployment/i.test(text)) label = 'UNKNOWN';
                    const linkTag = post.querySelector('a[href*="p="], a[href*="t="]');
                    const rawLink = linkTag ? linkTag.href : window.location.href;
                    const link    = isSafeUrl(rawLink) ? rawLink : window.location.href;
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
        setButtonBusy(btn, false);
        const data = res?.result || [];
        if (!data.length) { setEmpty(area, 'No records found.'); return; }
        setTabBadge('deployments', data.length);
        const bbcode = data.map(d => `[url=${d.link}]${d.date} - ${d.label}[/url]`).join('\n');
        renderBBCode(area, data, `deployment${data.length !== 1 ? 's' : ''} found (oldest first)`, bbcode, 'Copy BBCode', 'd-bb', 'd-copy');
    }).catch(e => { console.error(e); setButtonBusy(btn, false); setError(area, 'Something went wrong. Are you on the correct forum page?'); });
}

// ── Deployments Trigger ──
document.getElementById('d-btn').addEventListener('click', runDeployments);
document.getElementById('d-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); runDeployments(); }
});
