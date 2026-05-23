export function createScreenShareMonitor(initialState = { active: false, sources: [] }) {
  let state = {
    active: Boolean(initialState.active),
    sources: [...(initialState.sources ?? [])]
  };

  return {
    snapshot() {
      return {
        active: state.active,
        sources: [...state.sources]
      };
    },
    setState(nextState) {
      state = {
        active: Boolean(nextState.active),
        sources: [...(nextState.sources ?? [])]
      };
      return this.snapshot();
    }
  };
}
