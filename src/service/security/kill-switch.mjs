export function createKillSwitchController(initialState = false) {
  let enabled = initialState;
  return {
    isEnabled() {
      return enabled;
    },
    setEnabled(nextState) {
      enabled = Boolean(nextState);
      return enabled;
    },
    toggle() {
      enabled = !enabled;
      return enabled;
    }
  };
}
