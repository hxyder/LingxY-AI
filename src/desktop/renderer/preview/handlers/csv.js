// CSV / TSV handler (UCA-182 Phase 3).
//
// Parses on the renderer side to save a roundtrip, build a real
// HTMLTableElement (not innerHTML) so large files don't block
// parsing, and reuse the lp-pre / table styling already in the
// console.css scope. For very large files we delegate to the
// server-side provider via the iframe-remote fallback.

(function initCsvHandler() {
  if (!window.livePreviewClient) return;

  const MAX_LOCAL_ROWS = 2000;

  window.livePreviewClient.register({
    id: "client-csv",
    extensions: [".csv", ".tsv"],
    priority: 20,
    async render(container, ctx) {
      const shellClient = window.previewShellClient ?? window.createPreviewShellClient?.();
      if (!shellClient) throw new Error("preview shell client unavailable");
      const text = await shellClient.readTextFile(ctx.filePath, 512 * 1024);
      const delimiter = ctx.filePath.toLowerCase().endsWith(".tsv") ? "\t" : ",";
      const rows = parseCsv(text || "", delimiter);
      const truncated = rows.length > MAX_LOCAL_ROWS;
      const visible = truncated ? rows.slice(0, MAX_LOCAL_ROWS) : rows;

      container.innerHTML = "";
      if (truncated) {
        const banner = document.createElement("div");
        banner.className = "lp-banner";
        banner.textContent = `仅显示前 ${MAX_LOCAL_ROWS} 行（共 ${rows.length} 行）。`;
        container.appendChild(banner);
      }
      const table = document.createElement("table");
      table.className = "lp-table";
      const thead = document.createElement("thead");
      const tbody = document.createElement("tbody");
      (visible[0] || []).forEach((cell) => {
        const th = document.createElement("th");
        th.textContent = cell;
        thead.appendChild(th);
      });
      visible.slice(1).forEach((row) => {
        const tr = document.createElement("tr");
        row.forEach((cell) => {
          const td = document.createElement("td");
          td.textContent = cell;
          if (cell !== "" && !Number.isNaN(Number(cell))) td.classList.add("num");
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      if (thead.childElementCount > 0) table.appendChild(thead);
      if (tbody.childElementCount > 0) table.appendChild(tbody);
      container.appendChild(table);
    }
  });

  function parseCsv(input, delimiter) {
    const text = String(input ?? "").replace(/\r\n?/g, "\n");
    const lines = text.split("\n").filter((line) => line.length > 0);
    const rows = [];
    for (const line of lines) {
      const cells = [];
      let i = 0;
      while (i < line.length) {
        if (line[i] === '"') {
          let end = i + 1;
          let buf = "";
          while (end < line.length) {
            if (line[end] === '"' && line[end + 1] === '"') { buf += '"'; end += 2; continue; }
            if (line[end] === '"') break;
            buf += line[end];
            end += 1;
          }
          cells.push(buf);
          i = end + 1;
          if (line[i] === delimiter) i += 1;
        } else {
          const next = line.indexOf(delimiter, i);
          if (next === -1) { cells.push(line.slice(i)); break; }
          cells.push(line.slice(i, next));
          i = next + 1;
        }
      }
      rows.push(cells);
    }
    return rows;
  }
})();
