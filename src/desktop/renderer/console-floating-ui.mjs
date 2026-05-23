export function createConsoleToastController({
  host,
  documentRef = document,
  setTimeoutRef = setTimeout
} = {}) {
  function showToast(message, { kind = "info", durationMs = 3200, actionLabel = "", onAction = null } = {}) {
    if (!host || !message) return;
    const toast = documentRef.createElement("div");
    toast.className = `toast toast--${kind}`;
    toast.setAttribute("role", "status");
    const glyphMap = {
      ok: "✓",
      err: "!",
      info: "i"
    };
    toast.innerHTML = `
      <span class="toast-glyph">${glyphMap[kind] ?? "i"}</span>
      <span class="toast-body"></span>
      ${actionLabel && typeof onAction === "function" ? `<button type="button" class="toast-action"></button>` : ""}
    `;
    toast.querySelector(".toast-body").textContent = String(message);
    const actionButton = toast.querySelector(".toast-action");
    if (actionButton) {
      actionButton.textContent = actionLabel;
      actionButton.addEventListener("click", async (event) => {
        event.stopPropagation();
        actionButton.disabled = true;
        try {
          await onAction();
          dismiss();
        } catch (error) {
          actionButton.disabled = false;
          showToast(`操作失败：${error?.message ?? error}`, { kind: "err" });
        }
      });
    }
    host.appendChild(toast);
    let timer = setTimeoutRef(dismiss, durationMs);
    function dismiss() {
      clearTimeout(timer);
      if (!toast.isConnected) return;
      toast.classList.add("toast--leaving");
      toast.addEventListener("animationend", () => toast.remove(), { once: true });
    }
    toast.addEventListener("click", dismiss);
  }

  return { showToast };
}

export function createConsoleContextMenuController({
  menu,
  documentRef = document,
  windowRef = window,
  escapeHtml,
  showToast
} = {}) {
  function closeMenu() {
    if (!menu) return;
    menu.hidden = true;
    menu.innerHTML = "";
  }

  function openMenu(items, x, y) {
    if (!menu) return;
    menu.innerHTML = items.map((item) => {
      if (item.separator) return `<div class="ctx-sep" role="separator"></div>`;
      return `
        <button type="button" class="ctx-item" role="menuitem" data-act="${item.id}">
          <span class="ctx-glyph">${item.glyph ?? ""}</span>
          <span>${escapeHtml(item.label)}</span>
        </button>
      `;
    }).join("");
    menu.hidden = false;
    const rect = menu.getBoundingClientRect();
    const maxX = windowRef.innerWidth - rect.width - 8;
    const maxY = windowRef.innerHeight - rect.height - 8;
    menu.style.left = `${Math.max(8, Math.min(x, maxX))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, maxY))}px`;
    for (const btn of menu.querySelectorAll("[data-act]")) {
      btn.addEventListener("click", () => {
        const item = items.find((candidate) => candidate.id === btn.dataset.act);
        closeMenu();
        try {
          item?.onClick?.();
        } catch (error) {
          showToast(`操作失败：${error?.message ?? error}`, { kind: "err" });
        }
      });
    }
  }

  documentRef.addEventListener("click", (event) => {
    if (menu && !menu.hidden && !menu.contains(event.target)) closeMenu();
  });
  documentRef.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menu && !menu.hidden) closeMenu();
  });
  windowRef.addEventListener("blur", closeMenu);
  windowRef.addEventListener("scroll", closeMenu, true);

  return { closeMenu, openMenu };
}

export function installConsoleChatContextMenu({
  messagesEl,
  inputEl,
  openMenu,
  showToast,
  openNoteTargetPicker,
  regenerateTask
} = {}) {
  messagesEl?.addEventListener("contextmenu", (event) => {
    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    const wrapper = target?.closest?.(".chat-msg");
    if (!wrapper) return;
    event.preventDefault();
    const role = wrapper.classList.contains("user") ? "user"
      : wrapper.classList.contains("assistant") || wrapper.classList.contains("ai") ? "assistant"
        : "system";
    if (role === "system") return;
    const bubble = wrapper.querySelector(".chat-msg-bubble");
    const text = bubble?.dataset.rawText || bubble?.textContent || "";
    const taskId = wrapper.dataset.taskId || null;
    const items = [
      {
        id: "copy",
        label: "复制",
        glyph: "⧉",
        onClick: () => {
          try { navigator.clipboard?.writeText?.(text); } catch { /* ignore */ }
          showToast("已复制到剪贴板", { kind: "ok" });
        }
      },
      {
        id: "quote",
        label: "引用并回复",
        glyph: "›",
        onClick: () => {
          const quoted = String(text).split("\n").map((line) => `> ${line}`).join("\n");
          const prefix = inputEl.value.trim() ? `${inputEl.value}\n\n` : "";
          inputEl.value = `${prefix}${quoted}\n\n`;
          inputEl.focus();
          inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
          try { inputEl.scrollIntoView({ behavior: "smooth", block: "end" }); } catch { /* ignore */ }
          inputEl.classList.add("composer-flash");
          setTimeout(() => inputEl.classList.remove("composer-flash"), 1200);
          showToast("已引用到输入框", { kind: "info", durationMs: 1600 });
        }
      },
      {
        id: "note",
        label: "添加到 Note",
        glyph: "+",
        onClick: () => {
          openNoteTargetPicker(text, wrapper);
        }
      }
    ];
    if (role === "assistant" && taskId) {
      items.push({ separator: true });
      items.push({
        id: "regen",
        label: "重新生成",
        glyph: "↻",
        onClick: () => {
          void regenerateTask(taskId, null);
        }
      });
    }
    openMenu(items, event.clientX, event.clientY);
  });
}
