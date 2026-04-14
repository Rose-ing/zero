const messagesEl = document.getElementById("messages");
const form = document.getElementById("form");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send-btn");

let conversation = [];

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;

  input.value = "";
  addMessage("user", text);
  conversation.push({ role: "user", content: text });

  await runIntakeTurn();
});

async function runIntakeTurn() {
  setBusy(true);
  const typing = showTyping("analizando…");

  try {
    const res = await fetch("/api/intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: conversation }),
    });

    const data = await res.json();
    typing.remove();

    if (!res.ok) {
      addMessage("error", data.error || "error del servidor");
      return;
    }

    if (data.done && data.search_params) {
      const summary = formatSearchSummary(data.search_params);
      addMessage("assistant", `perfecto, voy a buscar **${summary}**.`);
      conversation.push({ role: "assistant", content: `Voy a buscar ${summary}.` });
      await runSearch(data.search_params);
    } else if (data.reply) {
      addMessage("assistant", data.reply);
      conversation.push({ role: "assistant", content: data.reply });
      if (data.options && data.options.length) {
        renderOptions(data.options);
      }
    }
  } catch (err) {
    typing.remove();
    addMessage("error", "no se pudo conectar con el servidor");
  } finally {
    setBusy(false);
    input.focus();
  }
}

async function runSearch(params) {
  const typing = showTyping("buscando · calificando · enriqueciendo · scoring con haiku…");
  const productContext = (conversation.find((m) => m.role === "user") || {}).content || "";
  try {
    const res = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...params, product_context: productContext }),
    });
    const data = await res.json();
    typing.remove();

    if (!res.ok) {
      addMessage("error", data.error || "error en la búsqueda");
      return;
    }

    renderResults(data);
    conversation.push({ role: "assistant", content: `${data.count} resultados.` });
  } catch (err) {
    typing.remove();
    addMessage("error", "no se pudo ejecutar la búsqueda");
  }
}

function formatSearchSummary(p) {
  const parts = [p.business_type, `en ${p.location}`];
  if (p.min_rating) parts.push(`rating ≥ ${p.min_rating}`);
  if (p.min_reviews) parts.push(`≥ ${p.min_reviews} reviews`);
  return parts.join(" · ");
}

function renderResults(data) {
  const wrap = document.createElement("div");
  wrap.className = "msg results";

  // Solo leads contactables (con canal y no cadenas) — el resto corre por detrás
  const contactable = data.leads.filter(
    (l) => l.best_channel && l.best_channel !== "none" && !(l.breakdown && l.breakdown.is_chain)
  );

  if (contactable.length === 0) {
    wrap.innerHTML = `
      <div class="hero-result">
        <div class="hero-kicker">sin resultados</div>
        <h2 class="hero-title">no encontramos clientes potenciales contactables</h2>
        <p class="hero-sub">probá con otra zona, otro tipo de comercio, o ajustá los filtros.</p>
      </div>
    `;
    messagesEl.appendChild(wrap);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return;
  }

  // Mix por categoría (para dar confianza sin exponer data lead-level)
  const categories = {};
  contactable.forEach((l) => {
    const c = prettifyMix(l.category);
    categories[c] = (categories[c] || 0) + 1;
  });
  const mix = Object.entries(categories)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([cat, n]) => `${Math.round((n / contactable.length) * 100)}% ${cat}`)
    .join(" · ");

  wrap.innerHTML = `
    <div class="hero-result">
      <div class="hero-kicker">análisis completo</div>
      <h2 class="hero-title">
        encontramos <span class="hero-number">${contactable.length}</span> clientes potenciales
      </h2>
      <p class="hero-sub">${escapeHtml(mix)} · analizados con scoring IA y listos para outreach</p>
    </div>
    ${renderCampaignPanel(data.leads)}
  `;

  wireCampaignPanel(wrap, data.leads);

  messagesEl.appendChild(wrap);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function prettifyMix(cat) {
  if (!cat) return "otros";
  const map = {
    "coffee shop": "cafeterías de especialidad",
    "cafeteria": "cafeterías",
    "cafe": "cafés",
    "bakery": "panaderías",
    "restaurant": "restaurantes",
    "brunch restaurant": "brunch",
  };
  return map[cat] || cat;
}

function renderCampaignPanel(leads) {
  const contactable = leads.filter((l) => l.best_channel && l.best_channel !== "none" && !(l.breakdown && l.breakdown.is_chain));
  if (contactable.length === 0) return "";

  const maxBudget = Math.ceil(contactable.reduce((s, l) => s + (l.cost_per_contact_usd || 0), 0) * 100) / 100;
  const totalLeads = contactable.length;
  const defaultLeads = Math.max(5, Math.ceil(totalLeads * 0.5));

  return `
    <div class="campaign">
      <div class="campaign-intro">
        <div class="campaign-kicker">paso final</div>
        <h3 class="campaign-title">¿a cuántos les querés vender?</h3>
        <p class="campaign-subtitle">moveé cualquiera de las dos barras — van de la mano. cuántos negocios contactamos y cuánto te sale. nosotros armamos la estrategia más eficiente.</p>
      </div>

      <div class="campaign-body">
        <div class="slider-row" data-slider-mode="leads">
          <label class="slider-label">
            <span>📣 negocios a contactar</span>
            <span class="slider-value"><span class="slider-number" data-leads-num>${defaultLeads}</span><span class="slider-unit">de ${totalLeads}</span></span>
          </label>
          <input type="range" class="slider" data-slider="leads" min="1" max="${totalLeads}" value="${defaultLeads}" step="1">
        </div>

        <div class="slider-row" data-slider-mode="budget">
          <label class="slider-label">
            <span>💰 inversión</span>
            <span class="slider-value"><span class="slider-unit">USD</span><span class="slider-number" data-budget-num>$0</span></span>
          </label>
          <input type="range" class="slider" data-slider="budget" min="0.01" max="${maxBudget}" value="${maxBudget}" step="0.01">
        </div>

        <div class="plan-card">
          <div class="plan-headline">
            <span class="plan-phrase">vamos a contactar</span>
            <span class="plan-number pv-leads">—</span>
            <span class="plan-phrase">negocios</span>
          </div>
          <div class="plan-grid">
            <div class="plan-stat">
              <div class="plan-label">Costo total</div>
              <div class="plan-value">$<span class="pv-cost">—</span> <span class="unit">USD</span></div>
            </div>
            <div class="plan-stat">
              <div class="plan-label">Costo por negocio</div>
              <div class="plan-value">$<span class="pv-cpl">—</span> <span class="unit">USD</span></div>
            </div>
            <div class="plan-stat">
              <div class="plan-label">Ventas potenciales</div>
              <div class="plan-value">$<span class="pv-tam">—</span> <span class="unit">ARS / mes</span></div>
            </div>
            <div class="plan-stat">
              <div class="plan-label">ROI estimado</div>
              <div class="plan-value plan-roi"><span class="pv-roi">—</span>x</div>
            </div>
          </div>

          <div class="plan-strategy">
            <div class="plan-strategy-label">estrategia</div>
            <div class="plan-strategy-breakdown">
              <span class="strategy-item strategy-email"><span class="strategy-num pv-ch-email">0</span> por email</span>
              <span class="strategy-sep">·</span>
              <span class="strategy-item strategy-whatsapp"><span class="strategy-num pv-ch-whatsapp">0</span> por whatsapp</span>
              <span class="strategy-sep">·</span>
              <span class="strategy-item strategy-phone"><span class="strategy-num pv-ch-phone">0</span> con llamada de agente IA</span>
            </div>
          </div>
        </div>

        <button type="button" class="execute-btn">lanzar campaña →</button>
        <div class="execute-note">sin compromiso · recibís un reporte con resultados en 48–72 hs</div>
      </div>
    </div>
  `;
}

function wireCampaignPanel(root, leads) {
  const contactable = leads.filter((l) => l.best_channel && l.best_channel !== "none" && !(l.breakdown && l.breakdown.is_chain));
  if (contactable.length === 0) return;

  const budgetSlider = root.querySelector('[data-slider="budget"]');
  const leadsSlider = root.querySelector('[data-slider="leads"]');

  // Estrategia única: ordenamos leads por ROI DESC (ticket por dólar invertido).
  // El cliente siempre elige cuántos contactar — contactamos los N mejores.
  const sortedByROI = [...contactable].sort((a, b) => (b.roi_estimate || 0) - (a.roi_estimate || 0));

  // Dado N, devuelve los N mejores leads
  function pickByLeads(n) {
    const picked = sortedByROI.slice(0, n);
    const cost = picked.reduce((s, l) => s + (l.cost_per_contact_usd || 0), 0);
    return { picked, cost };
  }

  // Dado un budget, cuántos leads entran (greedy por ROI desc)
  function pickByBudget(budget) {
    const picked = [];
    let spent = 0;
    for (const l of sortedByROI) {
      const c = l.cost_per_contact_usd || 0;
      if (spent + c > budget + 0.0001) break;
      picked.push(l);
      spent += c;
    }
    return { picked, cost: spent };
  }

  leadsSlider.addEventListener("input", () => {
    const n = Number(leadsSlider.value);
    const { picked, cost } = pickByLeads(n);
    budgetSlider.value = cost;
    updateDisplay(picked, cost);
  });

  budgetSlider.addEventListener("input", () => {
    const budget = Number(budgetSlider.value);
    const { picked, cost } = pickByBudget(budget);
    leadsSlider.value = picked.length;
    updateDisplay(picked, cost);
  });

  function updateDisplay(picked, cost) {
    root.querySelector('[data-budget-num]').textContent = `$${cost.toFixed(2)}`;
    root.querySelector('[data-leads-num]').textContent = picked.length;

    const tam = picked.reduce((s, l) => s + (l.estimated_ticket_ars || 0), 0);
    const tamUSD = tam / 1000;
    const roi = cost > 0 ? tamUSD / cost : 0;
    const cpl = picked.length > 0 ? cost / picked.length : 0;

    root.querySelector(".pv-leads").textContent = picked.length;
    root.querySelector(".pv-cost").textContent = cost.toFixed(2);
    root.querySelector(".pv-cpl").textContent = cpl.toFixed(2);
    root.querySelector(".pv-tam").textContent = formatNumCompact(tam);
    root.querySelector(".pv-roi").textContent = roi >= 1 ? roi.toFixed(1) : roi.toFixed(2);

    const byCh = { email: 0, whatsapp: 0, phone: 0 };
    picked.forEach((l) => { if (byCh[l.best_channel] !== undefined) byCh[l.best_channel]++; });
    root.querySelector(".pv-ch-email").textContent = byCh.email;
    root.querySelector(".pv-ch-whatsapp").textContent = byCh.whatsapp;
    root.querySelector(".pv-ch-phone").textContent = byCh.phone;

    root._selectedLeads = picked;
  }

  function initial() {
    const n = Number(leadsSlider.value);
    const { picked, cost } = pickByLeads(n);
    budgetSlider.value = cost;
    updateDisplay(picked, cost);
  }

  initial();

  root.querySelector(".execute-btn").onclick = () => {
    const picked = root._selectedLeads || [];
    if (picked.length === 0) return;
    const byCh = { email: 0, whatsapp: 0, phone: 0 };
    picked.forEach((l) => { byCh[l.best_channel] = (byCh[l.best_channel] || 0) + 1; });
    const cost = picked.reduce((s, l) => s + (l.cost_per_contact_usd || 0), 0);
    showCampaignLaunched(root, picked, cost, byCh);
  };
}

function showCampaignLaunched(root, picked, cost, byCh) {
  const n = picked.length;
  const campaign = root.querySelector(".campaign");
  campaign.innerHTML = `
    <div class="tracker">
      <div class="tracker-header">
        <div>
          <div class="tracker-kicker"><span class="live-dot"></span>campaña en curso · en tiempo real</div>
          <h3 class="tracker-title">contactando a ${n} negocios</h3>
        </div>
        <div class="tracker-invested">
          <div class="tracker-invested-label">inversión</div>
          <div class="tracker-invested-value">$${cost.toFixed(2)} <span>USD</span></div>
        </div>
      </div>

      <div class="tracker-metrics">
        <div class="metric">
          <div class="metric-label">Contactados</div>
          <div class="metric-value"><span data-metric="contacted">0</span><span class="metric-of">/${n}</span></div>
          <div class="metric-bar"><div class="metric-bar-fill" data-bar="contacted" style="width:0%"></div></div>
        </div>
        <div class="metric">
          <div class="metric-label">Respuestas</div>
          <div class="metric-value" data-metric="replies">0</div>
          <div class="metric-sub" data-sub="reply-rate">—</div>
        </div>
        <div class="metric">
          <div class="metric-label">Interesados</div>
          <div class="metric-value interested" data-metric="interested">0</div>
          <div class="metric-sub" data-sub="interest-rate">—</div>
        </div>
        <div class="metric">
          <div class="metric-label">Reuniones agendadas</div>
          <div class="metric-value meetings" data-metric="meetings">0</div>
          <div class="metric-sub">con tu equipo comercial</div>
        </div>
      </div>

      <div class="tracker-channels">
        <div class="channel-progress channel-email">
          <div class="cp-icon">📧</div>
          <div class="cp-body">
            <div class="cp-head"><span class="cp-name">email</span><span class="cp-count"><span data-channel-done="email">0</span>/${byCh.email}</span></div>
            <div class="cp-bar"><div class="cp-bar-fill" data-channel-bar="email" style="width:0%"></div></div>
          </div>
        </div>
        <div class="channel-progress channel-whatsapp">
          <div class="cp-icon">💬</div>
          <div class="cp-body">
            <div class="cp-head"><span class="cp-name">whatsapp</span><span class="cp-count"><span data-channel-done="whatsapp">0</span>/${byCh.whatsapp}</span></div>
            <div class="cp-bar"><div class="cp-bar-fill" data-channel-bar="whatsapp" style="width:0%"></div></div>
          </div>
        </div>
        <div class="channel-progress channel-phone">
          <div class="cp-icon">📞</div>
          <div class="cp-body">
            <div class="cp-head"><span class="cp-name">llamadas IA</span><span class="cp-count"><span data-channel-done="phone">0</span>/${byCh.phone}</span></div>
            <div class="cp-bar"><div class="cp-bar-fill" data-channel-bar="phone" style="width:0%"></div></div>
          </div>
        </div>
      </div>

      <div class="tracker-feed-wrap">
        <div class="feed-header">
          <div class="feed-title">actividad en vivo</div>
          <div class="feed-status"><span class="live-dot"></span><span data-feed-status>iniciando…</span></div>
        </div>
        <div class="feed" data-feed></div>
      </div>
    </div>
  `;

  simulateCampaign(campaign, picked, byCh);
}

function simulateCampaign(root, picked, byCh) {
  const feed = root.querySelector("[data-feed]");
  const state = {
    contacted: 0,
    replies: 0,
    interested: 0,
    meetings: 0,
    byChannelDone: { email: 0, whatsapp: 0, phone: 0 },
  };
  const n = picked.length;

  // Plan de eventos: por cada lead, orquestamos send → reply? → interested? → meeting?
  const events = [];
  picked.forEach((lead, idx) => {
    const baseDelay = 800 + idx * 450 + Math.random() * 600;
    const ch = lead.best_channel;
    // 1. Envío / llamada
    events.push({
      at: baseDelay,
      type: ch === "phone" ? "call_start" : "send",
      lead,
    });
    // 2. Posible completado
    if (ch === "phone") {
      events.push({ at: baseDelay + 2400 + Math.random() * 1800, type: "call_end", lead });
    } else {
      // ~40% respuesta
      if (Math.random() < 0.4) {
        events.push({ at: baseDelay + 3200 + Math.random() * 4000, type: "reply", lead });
      }
    }
  });

  // Eventos derivados post-reply/post-call
  const extendedEvents = [...events];
  events.forEach((e) => {
    const interestedRoll = Math.random();
    if (e.type === "reply" && interestedRoll < 0.55) {
      extendedEvents.push({ at: e.at + 1500 + Math.random() * 2000, type: "interested", lead: e.lead });
      if (Math.random() < 0.5) {
        extendedEvents.push({ at: e.at + 3500 + Math.random() * 2000, type: "meeting", lead: e.lead });
      }
    }
    if (e.type === "call_end" && interestedRoll < 0.35) {
      extendedEvents.push({ at: e.at + 500, type: "interested", lead: e.lead });
      if (Math.random() < 0.6) {
        extendedEvents.push({ at: e.at + 2000 + Math.random() * 1500, type: "meeting", lead: e.lead });
      }
    }
  });

  extendedEvents.sort((a, b) => a.at - b.at);

  const startTs = Date.now();
  let lastAt = 0;

  extendedEvents.forEach((ev) => {
    setTimeout(() => {
      const ch = ev.lead.best_channel;
      const nm = ev.lead.name;
      const ago = relTime((Date.now() - startTs) / 1000);

      if (ev.type === "send") {
        state.contacted++;
        state.byChannelDone[ch]++;
        pushFeed(feed, ch === "email" ? "📧" : "💬", `<strong>${escapeHtml(nm)}</strong> · ${ch === "email" ? "email enviado" : "mensaje whatsapp enviado"}`, ago);
      } else if (ev.type === "call_start") {
        pushFeed(feed, "📞", `llamando a <strong>${escapeHtml(nm)}</strong>…`, ago, "feed-item-pending");
      } else if (ev.type === "call_end") {
        state.contacted++;
        state.byChannelDone.phone++;
        pushFeed(feed, "✅", `llamada completada con <strong>${escapeHtml(nm)}</strong> · 2m 14s`, ago);
      } else if (ev.type === "reply") {
        state.replies++;
        pushFeed(feed, "💬", `<strong>${escapeHtml(nm)}</strong> respondió`, ago);
      } else if (ev.type === "interested") {
        state.interested++;
        if (!state.replies) state.replies++; // phone interested también cuenta
        pushFeed(feed, "🔥", `<strong>${escapeHtml(nm)}</strong> está interesado`, ago, "feed-item-win");
      } else if (ev.type === "meeting") {
        state.meetings++;
        pushFeed(feed, "📅", `reunión agendada con <strong>${escapeHtml(nm)}</strong>`, ago, "feed-item-win");
      }
      renderState(root, state, n, byCh);
      lastAt = ev.at;
    }, ev.at);
  });

  // Status final
  setTimeout(() => {
    root.querySelector("[data-feed-status]").textContent = `completa · ${state.replies} respuestas · ${state.meetings} reuniones`;
    root.querySelector(".live-dot").classList.add("done");
    pushFeed(feed, "🏁", `<strong>campaña completada</strong> · preparamos el reporte ejecutivo`, relTime((Date.now() - startTs) / 1000), "feed-item-done");
  }, lastAt + 1200);
}

function renderState(root, state, n, byCh) {
  root.querySelector('[data-metric="contacted"]').textContent = state.contacted;
  root.querySelector('[data-metric="replies"]').textContent = state.replies;
  root.querySelector('[data-metric="interested"]').textContent = state.interested;
  root.querySelector('[data-metric="meetings"]').textContent = state.meetings;

  root.querySelector('[data-bar="contacted"]').style.width = `${(state.contacted / n) * 100}%`;

  const replyRate = state.contacted ? Math.round((state.replies / state.contacted) * 100) : 0;
  const interestRate = state.replies ? Math.round((state.interested / state.replies) * 100) : 0;
  root.querySelector('[data-sub="reply-rate"]').textContent = state.contacted ? `${replyRate}% tasa de respuesta` : "—";
  root.querySelector('[data-sub="interest-rate"]').textContent = state.replies ? `${interestRate}% de respuestas` : "—";

  Object.keys(state.byChannelDone).forEach((ch) => {
    const done = state.byChannelDone[ch];
    const total = byCh[ch] || 0;
    root.querySelector(`[data-channel-done="${ch}"]`).textContent = done;
    const pct = total > 0 ? (done / total) * 100 : 0;
    root.querySelector(`[data-channel-bar="${ch}"]`).style.width = `${pct}%`;
  });
}

function pushFeed(feed, icon, html, when, extraClass = "") {
  const item = document.createElement("div");
  item.className = `feed-item ${extraClass}`;
  item.innerHTML = `
    <div class="feed-icon">${icon}</div>
    <div class="feed-text">${html}</div>
    <div class="feed-time">${when}</div>
  `;
  feed.insertBefore(item, feed.firstChild);
  // Limit to 40 items
  while (feed.children.length > 40) feed.removeChild(feed.lastChild);
}

function relTime(secs) {
  if (secs < 1) return "ahora";
  if (secs < 60) return `hace ${Math.round(secs)}s`;
  return `hace ${Math.round(secs / 60)}m`;
}

function renderRow(lead, i) {
  const tr = document.createElement("tr");
  const b = lead.breakdown || {};
  const scoreClass = scoreBadgeClass(lead.score || 0);
  const chainTag = b.is_chain
    ? `<span class="tag tag-chain" title="${escapeHtml(b.chain_reason || "")}">cadena</span>`
    : "";
  const maps = lead.maps_url
    ? `<a href="${lead.maps_url}" target="_blank" rel="noopener" class="lead-name">${escapeHtml(lead.name)}</a>`
    : `<span class="lead-name">${escapeHtml(lead.name)}</span>`;
  const reason = b.llm_reason
    ? escapeHtml(b.llm_reason)
    : (b.flags && b.flags.length ? b.flags.map(escapeHtml).join(" · ") : "—");
  const breakdownAttr = `Fit ${b.fit || 0} · Contact ${b.contact || 0} · Health ${b.health || 0} · Likelihood ${b.likelihood || 0}`;
  tr.innerHTML = `
    <td class="col-rank">${String(i + 1).padStart(2, "0")}</td>
    <td><span class="score-badge ${scoreClass}" title="${breakdownAttr}">${lead.score || 0}</span>${chainTag}</td>
    <td>${maps}<div class="lead-addr">${escapeHtml(lead.address || "")}</div></td>
    <td><span class="category-pill">${escapeHtml(lead.category || "—")}</span></td>
    <td>${lead.rating ? `<strong style="color:var(--text)">${lead.rating}</strong>` : "—"} <span style="color:var(--text-muted)">·</span> <span class="visits">${formatNum(lead.reviews || 0)}</span></td>
    <td><span class="price">${formatPrice(lead.price_level)}</span></td>
    <td class="visits">${formatNum(lead.monthly_visitors_est || 0)}</td>
    <td>${renderChannel(lead.best_channel, lead.contact_value)}</td>
    <td>${lead.estimated_ticket_ars ? `<span class="ticket">$${formatNum(lead.estimated_ticket_ars)}<span class="ticket-unit">ARS</span></span>` : "—"}</td>
    <td class="reason-cell">${reason}</td>
  `;
  return tr;
}

function downloadCSV(leads) {
  const headers = [
    "id", "name", "category", "address", "rating", "reviews", "price_level",
    "monthly_visitors_est", "best_channel", "contact_value",
    "estimated_ticket_ars", "score", "phone", "website", "maps_url",
  ];
  const rows = leads.map((l) =>
    headers.map((h) => `"${String(l[h] ?? "").replace(/"/g, '""')}"`).join(",")
  );
  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `zero-leads-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function addMessage(role, content) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  if (role === "assistant") {
    div.innerHTML = renderMarkdown(content);
  } else {
    div.textContent = content;
  }
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderOptions(options) {
  const wrap = document.createElement("div");
  wrap.className = "options";
  options.forEach((opt) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "option-chip";
    btn.textContent = opt;
    btn.onclick = async () => {
      // Remover el set de opciones al elegir
      wrap.remove();
      const isFreeText = /otro.*escribir|otro.*especificar/i.test(opt);
      if (isFreeText) {
        input.focus();
        return;
      }
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
  div.textContent = text || "pensando…";
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

function setBusy(busy) {
  sendBtn.disabled = busy;
  input.disabled = busy;
}

function scoreBadgeClass(n) {
  if (n >= 75) return "score-high";
  if (n >= 55) return "score-mid";
  if (n >= 35) return "score-low";
  return "score-drop";
}

function formatNum(n) {
  return new Intl.NumberFormat("es-AR").format(n);
}

function formatNumCompact(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

function formatPrice(p) {
  if (!p) return "—";
  const map = {
    PRICE_LEVEL_FREE: "gratis",
    PRICE_LEVEL_INEXPENSIVE: "$",
    PRICE_LEVEL_MODERATE: "$$",
    PRICE_LEVEL_EXPENSIVE: "$$$",
    PRICE_LEVEL_VERY_EXPENSIVE: "$$$$",
  };
  return map[p] || "—";
}

function renderChannel(channel, value) {
  if (!channel || channel === "none" || !value) {
    return `<span style="color:var(--text-muted);font-size:11px">sin contacto</span>`;
  }
  const safe = escapeHtml(value);
  let linked = safe;
  if (channel === "email") linked = `<a href="mailto:${safe}">${safe}</a>`;
  else if (channel === "whatsapp") linked = `<a href="https://wa.me/${safe.replace(/[^\d+]/g, "")}" target="_blank">${safe}</a>`;
  else if (channel === "phone") linked = `<a href="tel:${safe.replace(/\s/g, "")}">${safe}</a>`;
  return `<div class="channel-cell"><span class="channel-tag channel-${channel}">${channel}</span><span class="channel-val">${linked}</span></div>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderMarkdown(text) {
  text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/\*(.+?)\*/g, "<em>$1</em>");
  text = text.replace(/`(.+?)`/g, "<code>$1</code>");
  text = text.replace(/\n{2,}/g, "</p><p>");
  text = `<p>${text}</p>`;
  return text;
}
