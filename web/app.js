/* ═══════════════════════════════════════════
   Zero — Dashboard + Chat
   ═══════════════════════════════════════════ */

const $ = (s, r) => (r || document).querySelector(s);
const mainEl = $("#main");
const messagesEl = $("#messages");
const form = $("#form");
const input = $("#input");
const sendBtn = $("#send-btn");

let conversation = [];

// ── Persistence (localStorage) ──

const STORE_KEY = "zero_data";

function loadStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || defaultStore(); }
  catch { return defaultStore(); }
}
function saveStore(s) { localStorage.setItem(STORE_KEY, JSON.stringify(s)); }
function defaultStore() { return { activeProjectId: null, activeCampaignId: null, projects: [] }; }

let store = loadStore();

// ── Project / Campaign CRUD ──

function createProject(name) {
  const p = { id: uid(), name, created: today(), campaigns: [] };
  store.projects.push(p);
  store.activeProjectId = p.id;
  store.activeCampaignId = null;
  saveStore(store);
  return p;
}

function activeProject() { return store.projects.find(p => p.id === store.activeProjectId) || null; }
function activeCampaign() {
  const p = activeProject();
  return p ? p.campaigns.find(c => c.id === store.activeCampaignId) || null : null;
}

function createCampaign(name, searchParams, leads) {
  const p = activeProject();
  if (!p) return null;
  const contactable = leads.filter(l => l.best_channel && l.best_channel !== "none" && !(l.breakdown && l.breakdown.is_chain));
  const c = {
    id: uid(), name, created: today(), status: "draft",
    searchParams,
    universe: leads.length,
    contactable: contactable.length,
    leads: contactable,
    funnel: { contactados: 0, respondieron: 0, interesados: 0, agenda: 0, descartados: 0 },
    channels: { email: 0, whatsapp: 0, phone: 0 },
    events: [],
  };
  p.campaigns.unshift(c);
  store.activeCampaignId = c.id;
  saveStore(store);
  return c;
}

function saveCampaignState(camp) { saveStore(store); }

// ── Render router ──

function render() {
  updateProjectSelector();
  const camp = activeCampaign();
  const proj = activeProject();
  if (camp) {
    renderCampaignDetail(camp);
  } else if (proj) {
    renderProjectDash(proj);
  } else {
    renderEmpty();
  }
}

function renderEmpty() {
  mainEl.innerHTML = `<div class="dash-empty"><p class="dash-empty-title">creá un proyecto para empezar</p><p class="dash-empty-sub">usá el chat o hacé click en "+ proyecto"</p></div>`;
}

function renameProject(proj) {
  const name = prompt("Nombre del proyecto:", proj.name);
  if (!name || !name.trim() || name.trim() === proj.name) return;
  proj.name = name.trim();
  saveStore(store);
  render();
}

function renderProjectDash(proj) {
  let html = `<div class="dash-header"><div><div class="dash-title">${esc(proj.name)} <button class="btn-edit" data-action="rename" title="renombrar">✎</button></div><div class="dash-subtitle">${proj.campaigns.length} campaña${proj.campaigns.length !== 1 ? "s" : ""}</div></div></div>`;
  if (proj.campaigns.length === 0) {
    html += `<div class="dash-empty" style="height:auto;padding:60px 0"><p class="dash-empty-title">sin campañas</p><p class="dash-empty-sub">buscá leads desde el chat para crear una</p></div>`;
  } else {
    html += `<div class="campaign-list">`;
    for (const c of proj.campaigns) {
      const f = c.funnel;
      html += `
        <div class="campaign-card" data-cid="${c.id}">
          <div class="cc-left">
            <div class="cc-name">${esc(c.name)}</div>
            <div class="cc-date">${c.created}</div>
          </div>
          <div class="cc-right">
            <div class="cc-stat"><div class="cc-stat-num">${c.universe}</div><div class="cc-stat-label">leads</div></div>
            <div class="cc-stat"><div class="cc-stat-num">${f.agenda}</div><div class="cc-stat-label">agenda</div></div>
            <span class="status-badge ${c.status}">${c.status === "completed" ? "completada" : c.status === "running" ? "en curso" : "borrador"}</span>
          </div>
        </div>`;
    }
    html += `</div>`;
  }
  mainEl.innerHTML = html;
  const renameBtn = mainEl.querySelector('[data-action="rename"]');
  if (renameBtn) renameBtn.onclick = (e) => { e.stopPropagation(); renameProject(proj); };
  mainEl.querySelectorAll(".campaign-card").forEach(el => {
    el.onclick = () => { store.activeCampaignId = el.dataset.cid; saveStore(store); render(); };
  });
}

function renderCampaignDetail(camp) {
  const f = camp.funnel;
  const total = camp.contactable;

  let html = `<button class="detail-back" id="back-to-project">← campañas</button>`;
  html += `<div class="dash-header"><div><div class="dash-title">${esc(camp.name)}</div><div class="dash-subtitle">${camp.universe} leads encontrados · ${camp.contactable} contactables</div></div><span class="status-badge ${camp.status}">${camp.status === "completed" ? "completada" : camp.status === "running" ? "en curso" : "borrador"}</span></div>`;

  // Funnel
  const steps = [
    ["universo", camp.universe],
    ["alcance", f.contactados],
    ["respondieron", f.respondieron],
    ["interesados", f.interesados],
    ["agenda", f.agenda],
  ];
  html += `<div class="funnel">`;
  steps.forEach(([label, val], i) => {
    if (i > 0) html += `<div class="funnel-arrow">→</div>`;
    html += `<div class="funnel-step${val > 0 ? " active" : ""}"><div class="funnel-num">${val}</div><div class="funnel-label">${label}</div></div>`;
  });
  html += `</div>`;

  // Channel pills
  html += `<div class="channels-strip">
    <span class="ch-pill ch-email"><span class="ch-dot"></span>email <strong>${camp.channels.email}</strong></span>
    <span class="ch-pill ch-whatsapp"><span class="ch-dot"></span>whatsapp <strong>${camp.channels.whatsapp}</strong></span>
    <span class="ch-pill ch-phone"><span class="ch-dot"></span>llamada IA <strong>${camp.channels.phone}</strong></span>
  </div>`;

  // Conversion cards
  const sinResp = Math.max(0, f.contactados - f.respondieron - f.descartados);
  const pct = (n, d) => d > 0 ? `${Math.round(n / d * 100)}%` : "—";
  html += `<div class="conv-grid">
    <div class="conv-card"><div class="conv-label c-contactados"><span class="conv-dot"></span>contactados</div><div class="conv-num">${f.contactados}</div><div class="conv-pct">${pct(f.contactados, total)} del alcance</div></div>
    <div class="conv-card"><div class="conv-label c-respondieron"><span class="conv-dot"></span>respondieron</div><div class="conv-num">${f.respondieron}</div><div class="conv-pct">${pct(f.respondieron, f.contactados)} tasa respuesta</div></div>
    <div class="conv-card"><div class="conv-label c-interesados"><span class="conv-dot"></span>interesados</div><div class="conv-num">${f.interesados}</div><div class="conv-pct">${pct(f.interesados, f.respondieron)} de respuestas</div></div>
    <div class="conv-card"><div class="conv-label c-agenda"><span class="conv-dot"></span>agenda</div><div class="conv-num">${f.agenda}</div><div class="conv-pct">${pct(f.agenda, f.interesados)} conversión</div></div>
    <div class="conv-card"><div class="conv-label c-descartados"><span class="conv-dot"></span>descartados</div><div class="conv-num">${f.descartados + sinResp}</div><div class="conv-pct">${f.descartados} no interesa · ${sinResp} sin rta</div></div>
  </div>`;

  // Setup panel (if draft)
  if (camp.status === "draft") {
    html += renderSetupPanel(camp);
  }

  // Feed (if running or completed)
  if (camp.status === "running" || camp.status === "completed") {
    html += `<div class="feed-card"><div class="feed-header"><div class="feed-title">actividad</div><div class="feed-live${camp.status === "completed" ? " done" : ""}"><span class="dot"></span><span id="feed-status">${camp.status === "completed" ? "completada" : "en curso"}</span></div></div><div class="feed" id="campaign-feed">`;
    for (const ev of camp.events.slice(-50)) {
      html += `<div class="feed-item ${ev.cls || ""}"><div class="feed-icon">${ev.icon}</div><div class="feed-text">${ev.text}</div><div class="feed-time">${ev.time}</div></div>`;
    }
    html += `</div></div>`;
  }

  mainEl.innerHTML = html;
  mainEl.scrollTop = 0;

  // Wire back button
  const backBtn = $("#back-to-project");
  if (backBtn) backBtn.onclick = () => { store.activeCampaignId = null; saveStore(store); render(); };

  // Wire setup panel
  if (camp.status === "draft") wireSetupPanel(camp);
}

function renderSetupPanel(camp) {
  const leads = camp.leads;
  const total = leads.length;
  const maxBudget = Math.ceil(leads.reduce((s, l) => s + (l.cost_per_contact_usd || 0), 0) * 100) / 100;
  const def = Math.max(3, Math.ceil(total * 0.5));
  return `
    <div class="setup-card" id="setup-panel">
      <div class="setup-title">configurar campaña</div>
      <div class="setup-sub">elegí cuántos negocios contactar — priorizamos por mejor ROI</div>
      <div class="slider-row">
        <div class="slider-label"><span>negocios</span><span><span class="slider-val" id="sl-leads-val">${def}</span><span class="slider-unit">de ${total}</span></span></div>
        <input type="range" class="slider" id="sl-leads" min="1" max="${total}" value="${def}" step="1">
      </div>
      <div class="slider-row">
        <div class="slider-label"><span>inversión</span><span><span class="slider-unit">USD </span><span class="slider-val" id="sl-budget-val">$0</span></span></div>
        <input type="range" class="slider" id="sl-budget" min="0.01" max="${maxBudget}" value="${maxBudget}" step="0.01">
      </div>
      <div class="plan-stats">
        <div class="ps-item"><div class="ps-label">costo total</div><div class="ps-val">$<span id="ps-cost">—</span> <span class="u">USD</span></div></div>
        <div class="ps-item"><div class="ps-label">costo / lead</div><div class="ps-val">$<span id="ps-cpl">—</span> <span class="u">USD</span></div></div>
        <div class="ps-item"><div class="ps-label">venta potencial</div><div class="ps-val">$<span id="ps-tam">—</span> <span class="u">ARS/mes</span></div></div>
        <div class="ps-item"><div class="ps-label">ROI</div><div class="ps-val roi"><span id="ps-roi">—</span>x</div></div>
      </div>
      <div class="strategy-line" id="strategy-line"></div>
      <button class="btn-primary" id="btn-launch">lanzar campaña →</button>
      <div class="btn-note">los resultados se actualizan en tiempo real</div>
    </div>`;
}

function wireSetupPanel(camp) {
  const leads = camp.leads;
  const sorted = [...leads].sort((a, b) => (b.roi_estimate || 0) - (a.roi_estimate || 0));

  const slLeads = $("#sl-leads");
  const slBudget = $("#sl-budget");
  let currentPicked = [];

  function pickN(n) {
    const p = sorted.slice(0, n);
    return { picked: p, cost: p.reduce((s, l) => s + (l.cost_per_contact_usd || 0), 0) };
  }
  function pickBudget(b) {
    const p = []; let s = 0;
    for (const l of sorted) { const c = l.cost_per_contact_usd || 0; if (s + c > b + .0001) break; p.push(l); s += c; }
    return { picked: p, cost: s };
  }
  function update(picked, cost) {
    currentPicked = picked;
    const n = picked.length;
    $("#sl-leads-val").textContent = n;
    $("#sl-budget-val").textContent = `$${cost.toFixed(2)}`;
    const tam = picked.reduce((s, l) => s + (l.estimated_ticket_ars || 0), 0);
    const tamUSD = tam / 1000;
    const roi = cost > 0 ? tamUSD / cost : 0;
    const cpl = n > 0 ? cost / n : 0;
    $("#ps-cost").textContent = cost.toFixed(2);
    $("#ps-cpl").textContent = cpl.toFixed(2);
    $("#ps-tam").textContent = fmtCompact(tam);
    $("#ps-roi").textContent = roi >= 1 ? roi.toFixed(1) : roi.toFixed(2);
    const byCh = { email: 0, whatsapp: 0, phone: 0 };
    picked.forEach(l => { if (byCh[l.best_channel] !== undefined) byCh[l.best_channel]++; });
    $("#strategy-line").innerHTML = `<strong class="s-email">${byCh.email}</strong> email · <strong class="s-wa">${byCh.whatsapp}</strong> whatsapp · <strong class="s-phone">${byCh.phone}</strong> llamada IA`;
  }

  slLeads.oninput = () => { const r = pickN(+slLeads.value); slBudget.value = r.cost; update(r.picked, r.cost); };
  slBudget.oninput = () => { const r = pickBudget(+slBudget.value); slLeads.value = r.picked.length; update(r.picked, r.cost); };

  const init = pickN(+slLeads.value);
  slBudget.value = init.cost;
  update(init.picked, init.cost);

  $("#btn-launch").onclick = () => {
    if (currentPicked.length === 0) return;
    const byCh = { email: 0, whatsapp: 0, phone: 0 };
    currentPicked.forEach(l => { byCh[l.best_channel] = (byCh[l.best_channel] || 0) + 1; });
    camp.channels = { ...byCh };
    camp.leads = currentPicked;
    camp.contactable = currentPicked.length;
    camp.status = "running";
    saveCampaignState(camp);
    addMessage("assistant", `campaña lanzada: **${currentPicked.length}** negocios.`);
    render();
    setTimeout(() => runSimulation(camp), 300);
  };
}

// ── Simulation (fixed cascading logic) ──

function runSimulation(camp) {
  const leads = camp.leads;
  const n = leads.length;
  const state = { contactados: 0, respondieron: 0, interesados: 0, agenda: 0, descartados: 0, byChannel: { email: 0, whatsapp: 0, phone: 0 } };
  const events = [];
  const startTs = Date.now();

  // Build event plan per lead with correct cascading
  leads.forEach((lead, idx) => {
    const base = 600 + idx * 400 + Math.random() * 500;
    const ch = lead.best_channel;

    // Step 1: contact
    if (ch === "phone") {
      events.push({ at: base, type: "call_start", lead, ch });
      events.push({ at: base + 2000 + Math.random() * 1500, type: "contacted", lead, ch });
    } else {
      events.push({ at: base, type: "contacted", lead, ch });
    }

    // Step 2: response? (only contacted leads can respond)
    const responds = Math.random() < (ch === "phone" ? 0.55 : 0.35);
    if (responds) {
      const respDelay = ch === "phone" ? 500 : 2500 + Math.random() * 3000;
      const respAt = base + (ch === "phone" ? 2500 + Math.random() * 1500 : 0) + respDelay;
      events.push({ at: respAt, type: "responded", lead, ch });

      // Step 3: interested? (only responders can be interested)
      const interested = Math.random() < 0.6;
      if (interested) {
        events.push({ at: respAt + 1200 + Math.random() * 1500, type: "interested", lead, ch });

        // Step 4: meeting? (only interested can book)
        if (Math.random() < 0.5) {
          events.push({ at: respAt + 2500 + Math.random() * 2000, type: "meeting", lead, ch });
        }
      } else {
        events.push({ at: respAt + 800 + Math.random() * 1000, type: "not_interested", lead, ch });
      }
    }
  });

  events.sort((a, b) => a.at - b.at);
  let lastAt = 0;

  events.forEach(ev => {
    setTimeout(() => {
      const nm = ev.lead.name;
      const ago = relTime((Date.now() - startTs) / 1000);

      if (ev.type === "call_start") {
        pushEvent(camp, "📞", `llamando a <strong>${esc(nm)}</strong>…`, ago, "");
      } else if (ev.type === "contacted") {
        state.contactados++;
        state.byChannel[ev.ch]++;
        const label = ev.ch === "email" ? "email enviado" : ev.ch === "whatsapp" ? "whatsapp enviado" : "llamada completada";
        const icon = ev.ch === "email" ? "📧" : ev.ch === "whatsapp" ? "💬" : "✅";
        pushEvent(camp, icon, `<strong>${esc(nm)}</strong> · ${label}`, ago, "");
      } else if (ev.type === "responded") {
        state.respondieron++;
        const icon = ev.ch === "phone" ? "🗣" : "💬";
        pushEvent(camp, icon, `<strong>${esc(nm)}</strong> respondió`, ago, "");
      } else if (ev.type === "interested") {
        state.interesados++;
        pushEvent(camp, "🔥", `<strong>${esc(nm)}</strong> está interesado`, ago, "feed-item-win");
      } else if (ev.type === "meeting") {
        state.agenda++;
        pushEvent(camp, "📅", `reunión agendada con <strong>${esc(nm)}</strong>`, ago, "feed-item-win");
      } else if (ev.type === "not_interested") {
        state.descartados++;
        pushEvent(camp, "✖", `<strong>${esc(nm)}</strong> no interesado`, ago, "");
      }

      // Persist funnel
      camp.funnel = { ...state };
      camp.channels = { ...state.byChannel };
      saveCampaignState(camp);

      // Re-render live
      if (activeCampaign()?.id === camp.id) renderCampaignDetail(camp);

      lastAt = ev.at;
    }, ev.at);
  });

  // Finalize
  setTimeout(() => {
    camp.status = "completed";
    pushEvent(camp, "🏁", `<strong>campaña completada</strong>`, relTime((Date.now() - startTs) / 1000), "feed-item-done");
    saveCampaignState(camp);
    if (activeCampaign()?.id === camp.id) renderCampaignDetail(camp);
  }, (events.length ? events[events.length - 1].at : 2000) + 1000);
}

function pushEvent(camp, icon, text, time, cls) {
  camp.events.push({ icon, text, time, cls });
  // Keep max 80
  if (camp.events.length > 80) camp.events = camp.events.slice(-80);
}

// ── Project selector dropdown ──

function updateProjectSelector() {
  const proj = activeProject();
  $("#project-name").textContent = proj ? proj.name : "sin proyecto";
}

function toggleProjectDropdown() {
  const dd = $("#project-dropdown");
  if (dd.classList.contains("open")) { dd.classList.remove("open"); return; }
  const btn = $("#project-selector");
  const r = btn.getBoundingClientRect();
  dd.style.top = r.bottom + 4 + "px";
  dd.style.left = r.left + "px";

  let html = "";
  for (const p of store.projects) {
    const active = p.id === store.activeProjectId;
    html += `<div class="dropdown-item${active ? " active" : ""}" data-pid="${p.id}"><span>${esc(p.name)}</span><div class="dropdown-right"><span class="badge">${p.campaigns.length} camp.</span><button class="btn-dd-edit" data-rename="${p.id}" title="renombrar">✎</button></div></div>`;
  }
  if (store.projects.length === 0) html = `<div class="dropdown-item" style="color:var(--text-muted);cursor:default">sin proyectos</div>`;
  dd.innerHTML = html;
  dd.classList.add("open");

  dd.querySelectorAll("[data-pid]").forEach(el => {
    el.onclick = (e) => {
      if (e.target.closest("[data-rename]")) return;
      store.activeProjectId = el.dataset.pid;
      store.activeCampaignId = null;
      saveStore(store);
      dd.classList.remove("open");
      render();
    };
  });
  dd.querySelectorAll("[data-rename]").forEach(el => {
    el.onclick = (e) => {
      e.stopPropagation();
      const p = store.projects.find(p => p.id === el.dataset.rename);
      if (p) { renameProject(p); dd.classList.remove("open"); }
    };
  });
}

// Close dropdown on outside click
document.addEventListener("click", e => {
  const dd = $("#project-dropdown");
  if (!dd.classList.contains("open")) return;
  if (!e.target.closest("#project-dropdown") && !e.target.closest("#project-selector")) dd.classList.remove("open");
});

$("#project-selector").onclick = toggleProjectDropdown;
$("#btn-new-project").onclick = () => {
  const name = prompt("Nombre del proyecto:");
  if (!name || !name.trim()) return;
  createProject(name.trim());
  render();
};

// ── Chat ──

form.addEventListener("submit", async e => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  addMessage("user", text);
  conversation.push({ role: "user", content: text });

  // Auto-create project if none active
  if (!activeProject()) {
    createProject("Proyecto " + (store.projects.length + 1));
    render();
  }

  await runIntakeTurn();
});

async function runIntakeTurn() {
  setBusy(true);
  const typing = showTyping("analizando…");
  try {
    const res = await fetch("/api/intake", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: conversation }) });
    const data = await res.json();
    typing.remove();
    if (!res.ok) { addMessage("error", data.error || "error del servidor"); return; }
    if (data.done && data.search_params) {
      const summary = fmtSearch(data.search_params);
      addMessage("assistant", `perfecto, buscando **${summary}**…`);
      conversation.push({ role: "assistant", content: `Buscando ${summary}.` });
      await runSearch(data.search_params);
    } else if (data.reply) {
      addMessage("assistant", data.reply);
      conversation.push({ role: "assistant", content: data.reply });
      if (data.options && data.options.length) renderOptions(data.options);
    }
  } catch { typing.remove(); addMessage("error", "no se pudo conectar"); }
  finally { setBusy(false); input.focus(); }
}

async function runSearch(params) {
  const typing = showTyping("buscando · scoring · enriqueciendo…");
  const productCtx = (conversation.find(m => m.role === "user") || {}).content || "";
  try {
    const res = await fetch("/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...params, product_context: productCtx }) });
    const data = await res.json();
    typing.remove();
    if (!res.ok) { addMessage("error", data.error || "error en búsqueda"); return; }

    const campName = params.business_type + " — " + params.location;
    const camp = createCampaign(campName, params, data.leads);
    addMessage("assistant", `**${data.count}** leads encontrados, **${camp.contactable}** contactables. configurá la campaña en el panel.`);
    render();
  } catch { typing.remove(); addMessage("error", "error en búsqueda"); }
}

function fmtSearch(p) {
  const parts = [p.business_type, `en ${p.location}`];
  if (p.min_rating) parts.push(`rating ≥ ${p.min_rating}`);
  return parts.join(" · ");
}

// ── Chat UI helpers ──

function addMessage(role, content) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.innerHTML = role === "assistant" ? md(content) : esc(content);
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderOptions(options) {
  const wrap = document.createElement("div");
  wrap.className = "options";
  options.forEach(opt => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "option-chip";
    btn.textContent = opt;
    btn.onclick = async () => {
      wrap.remove();
      if (/otro.*escribir|otro.*especificar/i.test(opt)) { input.focus(); return; }
      addMessage("user", opt);
      conversation.push({ role: "user", content: opt });
      await runIntakeTurn();
    };
    wrap.appendChild(btn);
  });
  messagesEl.appendChild(wrap);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function showTyping(text) {
  const div = document.createElement("div");
  div.className = "typing";
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

function setBusy(b) { sendBtn.disabled = b; input.disabled = b; }

// ── Utilities ──

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function today() { return new Date().toISOString().slice(0, 10); }
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function md(t) { t = t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>"); t = t.replace(/\*(.+?)\*/g, "<em>$1</em>"); return `<p>${t}</p>`; }
function relTime(s) { return s < 1 ? "ahora" : s < 60 ? `${Math.round(s)}s` : `${Math.round(s / 60)}m`; }
function fmtCompact(n) { return n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M" : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K" : String(n); }

// ── Init ──
render();
