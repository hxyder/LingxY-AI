export function createRendererShellClient({
  shellProvider = () => window.ucaShell
} = {}) {
  return new Proxy(Object.create(null), {
    get(_target, prop) {
      if (prop === "then") return undefined;
      const shell = shellProvider();
      const value = shell?.[prop];
      return typeof value === "function" ? value.bind(shell) : value;
    },
    has(_target, prop) {
      const shell = shellProvider();
      return Boolean(shell && prop in shell);
    }
  });
}
