"use strict";
// electron-builder configuration (.cjs so it works next to the package's tooling).
// The engine (out/engine/index.js) is a CommonJS bundle with its dependencies left external, so production node_modules
// are packed with it. Natives (sharp, the keyring) cannot load from inside app.asar and are unpacked.
// The engine finds the player and live-client bundles by walking up from out/engine, so they stay inside the archive.
module.exports = {
  appId: "dev.selak.edu-studio",
  productName: "Edu Studio",
  copyright: "Tihomir Selak",
  directories: { output: "release", buildResources: "build" },
  npmRebuild: false,
  asar: true,
  files: ["out/**/*", "!out/**/*.map", "package.json"],
  // Read from disk: the seed (main passes --seed), the game themes (main sets EDU_THEMES) and the window/tray icon.
  extraResources: [
    { from: "seed", to: "seed" },
    { from: "themes", to: "themes" },
    { from: "build/icon.png", to: "icon.png" },
  ],
  asarUnpack: ["node_modules/sharp/**", "node_modules/@img/**", "node_modules/@napi-rs/**"],
  win: {
    icon: "build/icon.ico",
    target: [{ target: "nsis", arch: ["x64"] }, { target: "portable", arch: ["x64"] }],
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    artifactName: "Edu-Studio-Setup-${version}-${arch}.${ext}",
  },
  portable: { artifactName: "Edu-Studio-Portable-${version}-${arch}.${ext}" },
};
