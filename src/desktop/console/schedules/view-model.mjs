export function buildSchedulesViewModel(schedules = [], scheduleRuns = []) {
  return {
    title: "计划任务",
    columns: ["name", "trigger", "execution_mode", "next_run_at", "last_run_status", "enabled"],
    actions: ["create", "pause", "resume", "delete", "run_now"],
    schedules: schedules.map((schedule) => ({
      schedule_id: schedule.schedule_id,
      name: schedule.name,
      trigger_type: schedule.trigger_type,
      execution_mode: schedule.execution_mode,
      next_run_at: schedule.next_run_at,
      last_run_status: schedule.last_run_status,
      enabled: schedule.enabled
    })),
    historyCount: scheduleRuns.length
  };
}
