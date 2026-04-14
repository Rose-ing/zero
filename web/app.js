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
  const typing = showTyping("Pensando...");

  try {
    const res = await fetch("/api/intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: conversation }),
    });

    const data = await res.json();
    typing.remove();

    if (!res.ok) {
      addMessage("error", data.error || "Error del servidor");
      return;
    }

    if (data.done && data.search_params) {
      const summary = formatSearchSummary(data.search_params);
      addMessage("assistant", `Perfecto, voy a buscar **${summary}**.`);
      conversation.push({
        role: "assistant",
        content: `Voy a buscar ${summary}.`,
      });
      await runSearch(data.search_params);
    } else if (data.reply) {
      addMessage("assistant", data.reply);
      conversation.push({ role: "assistant", content: data.reply });
    }
  } catch (err) {
    typing.remove();
    addMessage("error", "No se pudo conectar con el servidor");
  } finally {
    setBusy(false);
    input.focus();
  }
}

async function runSearch(params) {
  const typing = showTyping("Buscando, calificando y enriqueciendo leads...");
  // Usa el primer mensaje del usuario como contexto del producto
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
      addMessage("error", data.error || "Error en la búsqueda");
      return;
    }

    renderResults(data);
    const resultsNote = `Encontré ${data.count} resultados.`;
    conversation.push({ role: "assistant", content: resultsNote });
  } catch (err) {
    typing.remove();
    addMessage("error", "No se pudo ejecutar la búsqueda");
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
  wrap.className = "msg assistant results";

  const header = document.createElement("div");
  header.className = "results-header";
  header.innerHTML = `<strong>${data.count}</strong> resultados encontrados`;
  wrap.appendChild(header);

  if (data.count === 0) {
    const empty = document.createElement("div");
    empty.className = "results-empty";
    empty.textContent = "No se encontraron negocios. Probá con otra zona o tipo de comercio.";
    wrap.appendChild(empty);
  } else {
    const table = document.createElement("table");
    table.className = "leads-table";
    table.innerHTML = `
      <thead>
        <tr>
          <th>#</th>
          <th>Score</th>
          <th>Nombre</th>
          <th>Categoría</th>
          <th>Rating / Reviews</th>
          <th>Price</th>
          <th>Visitas/mes</th>
          <th>Seguidores</th>
          <th>Mejor canal</th>
          <th>Ticket est. (ARS)</th>
          <th>Por qué</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    const tbody = table.querySelector("tbody");
    data.leads.forEach((lead, i) => {
      const tr = document.createElement("tr");
      const b = lead.breakdown || {};
      const scoreClass = scoreBadgeClass(lead.score || 0);
      const chainTag = b.is_chain ? `<span class="tag tag-chain" title="${escapeHtml(b.chain_reason || '')}">cadena</span>` : "";
      const maps = lead.maps_url
        ? `<a href="${lead.maps_url}" target="_blank" rel="noopener">${escapeHtml(lead.name)}</a>`
        : escapeHtml(lead.name);
      const reason = b.llm_reason
        ? escapeHtml(b.llm_reason)
        : (b.flags && b.flags.length ? b.flags.map(escapeHtml).join(" · ") : "—");
      const breakdownAttr = `Fit ${b.fit||0} · Contact ${b.contact||0} · Health ${b.health||0} · Likelihood ${b.likelihood||0}`;
      const price = formatPrice(lead.price_level);
      const channel = renderChannel(lead.best_channel, lead.contact_value);
      tr.innerHTML = `
        <td>${i + 1}</td>
        <td><span class="score-badge ${scoreClass}" title="${breakdownAttr}">${lead.score || 0}</span>${chainTag}</td>
        <td>${maps}<div class="lead-addr">${escapeHtml(lead.address || "")}</div></td>
        <td>${escapeHtml(lead.category || "—")}</td>
        <td>${lead.rating || "—"} · ${formatNum(lead.reviews || 0)}</td>
        <td>${price}</td>
        <td>${formatNum(lead.monthly_visitors_est || 0)}</td>
        <td>${lead.followers ? formatNum(lead.followers) : "—"}</td>
        <td>${channel}</td>
        <td>${lead.estimated_ticket_ars ? "$" + formatNum(lead.estimated_ticket_ars) : "—"}</td>
        <td class="reason-cell">${reason}</td>
      `;
      tbody.appendChild(tr);
    });
    wrap.appendChild(table);

    const exportBtn = document.createElement("button");
    exportBtn.className = "export-btn";
    exportBtn.textContent = "Descargar CSV";
    exportBtn.onclick = () => downloadCSV(data.leads);
    wrap.appendChild(exportBtn);
  }

  messagesEl.appendChild(wrap);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function downloadCSV(leads) {
  const headers = [
    "id", "name", "category", "address", "rating", "reviews", "price_level",
    "followers", "monthly_visitors_est", "best_channel", "contact_value",
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
  div.textContent = text || "Pensando...";
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

function setBusy(busy) {
  sendBtn.disabled = busy;
  input.disabled = busy;
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
  if (!channel || channel === "none" || !value) return "—";
  const safe = escapeHtml(value);
  const icons = { email: "📧", whatsapp: "💬", phone: "📞", instagram: "📸" };
  const icon = icons[channel] || "•";
  let linked = safe;
  if (channel === "email") linked = `<a href="mailto:${safe}">${safe}</a>`;
  else if (channel === "whatsapp") linked = `<a href="https://wa.me/${safe.replace(/[^\d+]/g, '')}" target="_blank">${safe}</a>`;
  else if (channel === "phone") linked = `<a href="tel:${safe.replace(/\s/g, '')}">${safe}</a>`;
  else if (channel === "instagram") linked = `<a href="https://instagram.com/${safe.replace('@','')}" target="_blank">${safe}</a>`;
  return `<span class="channel-tag channel-${channel}">${icon} ${channel}</span><div class="channel-val">${linked}</div>`;
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

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderMarkdown(text) {
  text = text.replace(/^(\|.+\|)\n(\|[-| :]+\|)\n((?:\|.+\|\n?)+)/gm, (_, header, sep, body) => {
    const headers = header.split("|").filter(Boolean).map((h) => `<th>${h.trim()}</th>`).join("");
    const rows = body.trim().split("\n").map((row) => {
      const cells = row.split("|").filter(Boolean).map((c) => `<td>${c.trim()}</td>`).join("");
      return `<tr>${cells}</tr>`;
    }).join("");
    return `<table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
  });
  text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/\*(.+?)\*/g, "<em>$1</em>");
  text = text.replace(/`(.+?)`/g, "<code>$1</code>");
  text = text.replace(/^- (.+)$/gm, "<li>$1</li>");
  text = text.replace(/((?:<li>.*<\/li>\n?)+)/g, "<ul>$1</ul>");
  text = text.replace(/\n{2,}/g, "</p><p>");
  text = `<p>${text}</p>`;
  text = text.replace(/<p>\s*<(ul|table)/g, "<$1");
  text = text.replace(/<\/(ul|table)>\s*<\/p>/g, "</$1>");
  return text;
}
