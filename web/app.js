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

  if (data.count === 0) {
    wrap.innerHTML = `
      <div class="results-header">
        <div class="results-header-left">
          <span class="results-count">0</span>
          <span class="results-subtitle">resultados</span>
        </div>
      </div>
      <div class="results-empty">no se encontraron negocios. probá con otra zona o tipo de comercio.</div>
    `;
    messagesEl.appendChild(wrap);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return;
  }

  // Calculate stats
  const ready = data.leads.filter((l) => l.score >= 55 && !(l.breakdown && l.breakdown.is_chain)).length;
  const avgScore = Math.round(
    data.leads.reduce((s, l) => s + (l.score || 0), 0) / data.leads.length
  );
  const totalTAM = data.leads.reduce((s, l) => s + (l.estimated_ticket_ars || 0), 0);

  wrap.innerHTML = `
    <div class="results-header">
      <div class="results-header-left">
        <span class="results-count">${data.count}</span>
        <span class="results-subtitle">clientes potenciales</span>
      </div>
      <div class="results-subtitle">ordenado por score ↓</div>
    </div>
    <div class="stats-strip">
      <div class="stat">
        <div class="stat-label">ready to contact</div>
        <div class="stat-value">${ready}<span class="unit">/ ${data.count}</span></div>
      </div>
      <div class="stat">
        <div class="stat-label">avg score</div>
        <div class="stat-value">${avgScore}<span class="unit">/100</span></div>
      </div>
      <div class="stat">
        <div class="stat-label">TAM mensual est.</div>
        <div class="stat-value">$${formatNumCompact(totalTAM)}<span class="unit">ARS</span></div>
      </div>
      <div class="stat">
        <div class="stat-label">con contacto directo</div>
        <div class="stat-value">${data.leads.filter((l) => l.best_channel === "email" || l.best_channel === "whatsapp").length}<span class="unit">leads</span></div>
      </div>
    </div>
    <div class="table-wrap">
      <table class="leads-table">
        <thead>
          <tr>
            <th class="col-rank">#</th>
            <th>Score</th>
            <th>Negocio</th>
            <th>Categoría</th>
            <th>Rating · Reviews</th>
            <th>Precio</th>
            <th>Visitas/mes</th>
            <th>Mejor canal</th>
            <th>Ticket est.</th>
            <th>Por qué</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    </div>
    <div class="results-footer">
      <div class="footer-note">${data.leads.filter(l => l.breakdown && l.breakdown.is_chain).length} cadenas detectadas · listas para derivar al agente de outreach</div>
      <button class="export-btn" type="button">↓ Exportar CSV</button>
    </div>
  `;

  const tbody = wrap.querySelector("tbody");
  data.leads.forEach((lead, i) => {
    tbody.appendChild(renderRow(lead, i));
  });

  wrap.querySelector(".export-btn").onclick = () => downloadCSV(data.leads);

  messagesEl.appendChild(wrap);
  messagesEl.scrollTop = messagesEl.scrollHeight;
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
