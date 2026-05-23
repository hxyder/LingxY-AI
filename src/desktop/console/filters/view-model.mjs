export function buildConsoleFiltersViewModel(tasks) {
  return {
    status: [...new Set(tasks.map((task) => task.status))].sort(),
    source_type: [...new Set(tasks.map((task) => task.context_packet?.source_type ?? task.source_type).filter(Boolean))].sort(),
    executor: [...new Set(tasks.map((task) => task.executor))].sort()
  };
}
