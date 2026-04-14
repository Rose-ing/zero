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

  const maxBudget = Math.ceil(contactable.reduce((s, l) => s + (l.cost_per_contact_usd || 0), 0));
  const totalReach = contactable.reduce((s, l) => s + (l.monthly_visitors_est || 0), 0);
  const defaultBudget = Math.max(1, Math.min(20, Math.ceil(maxBudget / 3)));

  return `
    <div class="campaign">
      <div class="campaign-intro">
        <div class="campaign-kicker">paso final</div>
        <h3 class="campaign-title">¿cuánto querés invertir para cuánto alcance?</h3>
        <p class="campaign-subtitle">moveé cualquiera de las dos barras — van de la mano. nosotros armamos la estrategia más eficiente con tu presupuesto.</p>
      </div>

      <div class="campaign-body">
        <div class="slider-row" data-slider-mode="budget">
          <label class="slider-label">
            <span>💰 budget</span>
            <span class="slider-value"><span class="slider-unit">USD</span><span class="slider-number" data-budget-num>$${defaultBudget}</span></span>
          </label>
          <input type="range" class="slider" data-slider="budget" min="0.01" max="${maxBudget}" value="${defaultBudget}" step="0.01">
        </div>

        <div class="slider-row" data-slider-mode="reach">
          <label class="slider-label">
            <span>📣 alcance</span>
            <span class="slider-value"><span class="slider-number" data-reach-num>0</span><span class="slider-unit">personas/mes</span></span>
          </label>
          <input type="range" class="slider" data-slider="reach" min="0" max="${totalReach}" value="0" step="1000">
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
              <div class="plan-label">Alcance mensual</div>
              <div class="plan-value"><span class="pv-reach">—</span> <span class="unit">personas</span></div>
            </div>
            <div class="plan-stat">
              <div class="plan-label">Mercado potencial</div>
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
  const reachSlider = root.querySelector('[data-slider="reach"]');
  let lockedSlider = null; // "budget" | "reach" — qué slider acaba de mover el usuario

  // Estrategia única: ordenamos leads por ROI DESC (ticket por dólar invertido).
  // Así "sumar más" siempre es razonable en ambos sentidos.
  const sortedByROI = [...contactable].sort((a, b) => (b.roi_estimate || 0) - (a.roi_estimate || 0));

  // Dado un budget, devuelve los leads que entran (greedy por ROI desc)
  function pickByBudget(budget) {
    const picked = [];
    let spent = 0;
    for (const l of sortedByROI) {
      const c = l.cost_per_contact_usd || 0;
      if (spent + c > budget + 0.0001) continue;
      picked.push(l);
      spent += c;
    }
    return { picked, cost: spent };
  }

  // Dado un reach target, devuelve los leads acumulados por ROI desc hasta alcanzarlo
  function pickByReach(target) {
    const picked = [];
    let acc = 0;
    for (const l of sortedByROI) {
      if (acc >= target) break;
      picked.push(l);
      acc += l.monthly_visitors_est || 0;
    }
    return { picked, reach: acc };
  }

  budgetSlider.addEventListener("input", () => {
    lockedSlider = "budget";
    const budget = Number(budgetSlider.value);
    const { picked, cost } = pickByBudget(budget);
    // Actualizar reach slider al alcance resultante
    const resultingReach = picked.reduce((s, l) => s + (l.monthly_visitors_est || 0), 0);
    reachSlider.value = resultingReach;
    updateDisplay(picked, cost, resultingReach);
  });

  reachSlider.addEventListener("input", () => {
    lockedSlider = "reach";
    const target = Number(reachSlider.value);
    const { picked, reach } = pickByReach(target);
    const resultingCost = picked.reduce((s, l) => s + (l.cost_per_contact_usd || 0), 0);
    budgetSlider.value = resultingCost;
    updateDisplay(picked, resultingCost, reach);
  });

  function updateDisplay(picked, cost, reach) {
    root.querySelector('[data-budget-num]').textContent = `$${cost.toFixed(2)}`;
    root.querySelector('[data-reach-num]').textContent = formatNumCompact(reach);
    renderStats(picked, cost, reach);
  }

  function renderStats(picked, cost, reach) {
    const tam = picked.reduce((s, l) => s + (l.estimated_ticket_ars || 0), 0);
    const tamUSD = tam / 1000;
    const roi = cost > 0 ? tamUSD / cost : 0;

    root.querySelector(".pv-leads").textContent = picked.length;
    root.querySelector(".pv-cost").textContent = cost.toFixed(2);
    root.querySelector(".pv-reach").textContent = formatNumCompact(reach);
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
    const budget = Number(budgetSlider.value);
    const { picked, cost } = pickByBudget(budget);
    const resultingReach = picked.reduce((s, l) => s + (l.monthly_visitors_est || 0), 0);
    reachSlider.value = resultingReach;
    updateDisplay(picked, cost, resultingReach);
  }

  initial();

  root.querySelector(".execute-btn").onclick = () => {
    const picked = root._selectedLeads || [];
    if (picked.length === 0) return;
    const byCh = { email: 0, whatsapp: 0, phone: 0 };
    picked.forEach((l) => { byCh[l.best_channel] = (byCh[l.best_channel] || 0) + 1; });
    const cost = picked.reduce((s, l) => s + (l.cost_per_contact_usd || 0), 0);
    showCampaignLaunched(root, picked.length, cost, byCh);
  };
}

function showCampaignLaunched(root, n, cost, byCh) {
  const campaign = root.querySelector(".campaign");
  campaign.innerHTML = `
    <div class="launched">
      <div class="launched-icon">🚀</div>
      <div class="launched-kicker">campaña lanzada</div>
      <h3 class="launched-title">estamos contactando a tus ${n} clientes potenciales</h3>
      <div class="launched-grid">
        <div class="launched-stat"><span class="launched-num">${byCh.email}</span><span class="launched-label">emails personalizados</span></div>
        <div class="launched-stat"><span class="launched-num">${byCh.whatsapp}</span><span class="launched-label">mensajes whatsapp</span></div>
        <div class="launched-stat"><span class="launched-num">${byCh.phone}</span><span class="launched-label">llamadas con agente IA</span></div>
      </div>
      <div class="launched-footer">
        <div class="launched-cost">inversión total <strong>$${cost.toFixed(2)} USD</strong></div>
        <div class="launched-next">recibís el reporte con respuestas y reuniones agendadas en <strong>48–72 hs</strong> por mail.</div>
      </div>
    </div>
  `;
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
