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

function fmt(mins) {
    if (mins === null || mins === undefined) return '?';
    const h = Math.floor(mins / 60), m = mins % 60;
    return h === 0 ? `${m}m` : m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function makeCopyBtn(btnEl, getText) {
    btnEl.addEventListener('click', () => {
        const text = getText();
        navigator.clipboard.writeText(text).catch(() => {
            const ta = document.createElement('textarea');
            ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
            document.body.appendChild(ta); ta.select(); document.execCommand('copy');
            document.body.removeChild(ta);
        });
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
            const fetchPage = async (url) => { const r = await fetch(url, { credentials: 'same-origin' }); if (!r.ok) throw new Error(); return r.text(); };
            const getPaginationUrls = (doc, base) => { const s = new Set(); doc.querySelectorAll('.pagination a, a[href*="start="]').forEach(a => { try { s.add(new URL(a.href, base).href); } catch(_){} }); return [...s].filter(u => u !== base); };
            const dedupe = (arr) => { const s = new Set(); return arr.filter(i => { const k = i.link; return s.has(k) ? false : (s.add(k), true); }); };
            const months = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
            const sortByDate = (arr) => arr.slice().sort((a,b) => { const p = d => { const [day,mon,year] = d.toLowerCase().split('/'); return new Date(+year,months[mon]??0,+day); }; return p(a._raw)-p(b._raw); });
            const nameRegex = new RegExp(searchString, 'i');

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
                        const tmp = document.createElement('div');
                        tmp.innerHTML = typeSection[1];
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
                    const link = linkTag ? new URL(linkTag.getAttribute('href'), window.location.origin).href : window.location.href;
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
    }).catch(e => setError(area, `Error: ${e.message}`));
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
            const fetchPage = async (url) => { const r = await fetch(url, { credentials: 'same-origin' }); if (!r.ok) throw new Error(); return r.text(); };
            const getPaginationUrls = (doc, base) => { const s = new Set(); doc.querySelectorAll('.pagination a, a[href*="start="]').forEach(a => { try { s.add(new URL(a.href, base).href); } catch(_){} }); return [...s].filter(u => u !== base); };
            const dedupe = (arr) => { const s = new Set(); return arr.filter(i => { const k = `${i.date}|${i.link}`; return s.has(k)?false:(s.add(k),true); }); };
            const months = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
            const sortByDate = arr => arr.slice().sort((a,b) => { const p = d => { const [day,mon,year]=d.toLowerCase().split('/'); return new Date(+year,months[mon]??0,+day); }; return p(a._raw)-p(b._raw); });
            const nameRegex = new RegExp(searchString, 'i');

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
                    out.push({ date: dateMatch[1].toUpperCase(), _raw: dateMatch[1], label, link: linkTag ? linkTag.href : window.location.href });
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
    }).catch(e => setError(area, `Error: ${e.message}`));
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. OVERTIME
// ══════════════════════════════════════════════════════════════════════════════
document.getElementById('o-btn').addEventListener('click', async () => {
    const name = document.getElementById('o-name').value.trim();
    if (!name) return;
    const area = document.getElementById('o-results');
    setStatus(area, 'Calculating...');

    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });

    browser.scripting.executeScript({
        target: { tabId: tab.id },
        func: async (searchString) => {
            const toMins = t => { const m = t.match(/(\d{1,2}):(\d{2})/); return m ? +m[1]*60 + +m[2] : null; };
            const fetchPage = async (url) => { const r = await fetch(url, { credentials: 'same-origin' }); if (!r.ok) throw new Error(); return r.text(); };
            const getPaginationUrls = (doc, base) => { const s = new Set(); doc.querySelectorAll('.pagination a, a[href*="start="]').forEach(a => { try { s.add(new URL(a.href, base).href); } catch(_){} }); return [...s].filter(u => u !== base); };
            const dedupe = arr => { const s = new Set(); return arr.filter(i => { const k = `${i.date}|${i.link}`; return s.has(k)?false:(s.add(k),true); }); };
            const months = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
            const sortByDate = arr => arr.slice().sort((a,b) => { const p = d => { const [day,mon,year]=d.toLowerCase().split('/'); return new Date(+year,months[mon]??0,+day); }; return p(a._raw)-p(b._raw); });
            const nameRegex = new RegExp(searchString, 'i');

            function extractOT(doc) {
                const out = [];
                doc.querySelectorAll('.post, .search.post, .postbody, .inner').forEach(post => {
                    const text = post.innerText || post.textContent || '';
                    if (!nameRegex.test(text)) return;
                    const dateMatch = text.match(/DATE:\s*(\d{1,2}\/\w{3}\/\d{4})/i);
                    if (!dateMatch) return;
                    const startMatch = text.match(/START\s+OF\s+DEPLOYMENT:\s*(\d{1,2}:\d{2})/i);
                    const endMatch   = text.match(/END\s+OF\s+DEPLOYMENT:\s*(\d{1,2}:\d{2})/i);
                    const sm = startMatch ? toMins(startMatch[1]) : null;
                    const em = endMatch   ? toMins(endMatch[1])   : null;
                    let duration = null;
                    if (sm !== null && em !== null) duration = em >= sm ? em - sm : (1440 - sm) + em;
                    const typeMatch = text.match(/DEPLOYMENT\s*TYPE:\s*([\s\S]*?)(?=\n\s*\d\.\d|\n\s*2\.|\n\s*LOCATION:|$)/i);
                    let label = 'CSP';
                    if (typeMatch?.[1]) { const ex = typeMatch[1].replace(/[\r\n]+/g,' ').replace(/\s+/g,' ').trim(); label = ex.length>1 ? ex.toUpperCase() : 'UNKNOWN'; }
                    const linkTag = post.querySelector('a[href*="p="], a[href*="t="]');
                    out.push({ date: dateMatch[1].toUpperCase(), _raw: dateMatch[1], label, start: startMatch?.[1]||null, end: endMatch?.[1]||null, duration, link: linkTag?linkTag.href:window.location.href });
                });
                return out;
            }

            const baseUrl = window.location.href;
            let all = extractOT(document);
            const pages = getPaginationUrls(document, baseUrl);
            if (pages.length) {
                const fetched = await Promise.all(pages.map(u => fetchPage(u).then(h => extractOT(new DOMParser().parseFromString(h,'text/html'))).catch(()=>[])));
                fetched.forEach(r => all.push(...r));
            }
            const sorted = sortByDate(dedupe(all));
            const totalMins = sorted.reduce((a, d) => a + (d.duration ?? 0), 0);
            const knownCount = sorted.filter(d => d.duration !== null).length;
            return { entries: sorted, totalMins, knownCount };
        },
        args: [name]
    }).then(([res]) => {
        area.textContent = '';
        const { entries = [], totalMins = 0, knownCount = 0 } = res?.result || {};
        if (!entries.length) { setEmpty(area, 'No records found.'); return; }

        const missing = entries.length - knownCount;

        // Summary box
        const box = document.createElement('div');
        box.className = 'summary-box';
        const subTop = document.createElement('div');
        subTop.className = 'sub';
        subTop.textContent = `Total deployment time for ${name}`;
        box.appendChild(subTop);
        const total = document.createElement('div');
        total.className = 'total';
        total.textContent = fmt(totalMins);
        box.appendChild(total);
        const subBot = document.createElement('div');
        subBot.className = 'sub';
        subBot.textContent = `${entries.length} deployment${entries.length !== 1 ? 's' : ''} found${missing > 0 ? ` · ${missing} missing time data` : ''}`;
        box.appendChild(subBot);
        area.appendChild(box);

        // Table
        const table = document.createElement('table');
        const thead = document.createElement('thead');
        const hrow = document.createElement('tr');
        ['Date','Type','Time','Duration'].forEach(h => { const th = document.createElement('th'); th.textContent = h; hrow.appendChild(th); });
        thead.appendChild(hrow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        entries.forEach(e => {
            const tr = document.createElement('tr');

            const tdDate = document.createElement('td');
            const a = document.createElement('a');
            a.href = e.link; a.target = '_blank';
            a.style.cssText = 'color:#0056b3;text-decoration:none;';
            a.textContent = e.date;
            tdDate.appendChild(a);
            tr.appendChild(tdDate);

            const tdType = document.createElement('td');
            tdType.textContent = e.label;
            tr.appendChild(tdType);

            const tdTime = document.createElement('td');
            if (e.start && e.end) {
                tdTime.textContent = `${e.start} to ${e.end}`;
            } else {
                const span = document.createElement('span');
                span.className = 'na'; span.textContent = '--';
                tdTime.appendChild(span);
            }
            tr.appendChild(tdTime);

            const tdDur = document.createElement('td');
            const span = document.createElement('span');
            span.className = e.duration !== null ? 'dur' : 'na';
            span.textContent = e.duration !== null ? fmt(e.duration) : '--';
            tdDur.appendChild(span);
            tr.appendChild(tdDur);

            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        area.appendChild(table);

    }).catch(e => setError(area, `Error: ${e.message}`));
});