export async function updateDesktopTrayBadge({
  tray,
  serviceBaseUrl,
  brandIcons,
  trayTooltip,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!tray || typeof fetchImpl !== "function") return;
  try {
    const resp = await fetchImpl(`${serviceBaseUrl}/tasks`);
    if (!resp.ok) return;
    const data = await resp.json();
    const tasks = data.tasks ?? [];
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayMs = todayStart.getTime();
    const completed = tasks.filter((task) => {
      if (task.status !== "success" && task.status !== "partial_success") return false;
      const ms = new Date(task.updated_at ?? task.created_at).getTime();
      return Number.isFinite(ms) && ms >= todayMs;
    }).length;

    tray.setImage(brandIcons.composeTrayIcon({ count: completed, size: 32 }));
    tray.setToolTip(completed > 0
      ? `LingxY · 今日完成 ${completed} 个任务`
      : trayTooltip);
  } catch { /* service not ready */ }
}
