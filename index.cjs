const electron = require("electron");

import("./src/desktop/tray/electron-main.mjs")
  .then(({ initializeElectronShellRuntime }) =>
    initializeElectronShellRuntime({ electron })
  )
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
