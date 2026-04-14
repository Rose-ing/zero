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
  const typing = showTyping("Buscando en Google Maps...");
  try {
    const res = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
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
          <th>Nombre</th>
          <th>Rating</th>
          <th>Reviews</th>
          <th>Teléfono</th>
          <th>Dirección</th>
          <th>Web</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    const tbody = table.querySelector("tbody");
    data.leads.forEach((lead, i) => {
      const tr = document.createElement("tr");
      const website = lead.website
        ? `<a href="${lead.website}" target="_blank" rel="noopener">link</a>`
        : "—";
      const maps = lead.maps_url
        ? `<a href="${lead.maps_url}" target="_blank" rel="noopener">${escapeHtml(lead.name)}</a>`
        : escapeHtml(lead.name);
      tr.innerHTML = `
        <td>${i + 1}</td>
        <td>${maps}</td>
        <td>${lead.rating || "—"}</td>
        <td>${lead.reviews || 0}</td>
        <td>${escapeHtml(lead.phone || "—")}</td>
        <td>${escapeHtml(lead.address || "")}</td>
        <td>${website}</td>
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
  const headers = ["name", "rating", "reviews", "phone", "address", "website", "maps_url", "place_id"];
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
