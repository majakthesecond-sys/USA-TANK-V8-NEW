# USA Tank V8 offline Windows game

This folder packages the game code, tank models, textures, and audio as a
Windows desktop application. Single-player, training, free roam, local 1v1,
and AI co-op run from installed files without Render or an internet
connection. Online 1v1 and 2v2 connect to the existing Render WebSocket only
after the player selects an online mode.

## Local development

Requirements:

- Node.js 24
- npm

Run:

```bash
npm ci
npm run test:offline
npm start
```

## Build the Windows installer

On Windows:

```bash
npm ci
npm run make:windows
```

The Squirrel installer is written below `desktop/out/make/`.

The GitHub Actions workflow can also build the installer on a Windows runner.
Open the workflow run, download the
`USA-Tank-V8-Offline-Windows-Installer` artifact, extract the ZIP, and run the
setup executable.

## Architecture

- The installer includes `public/`, including the local GLB tank models and
  local gameplay textures.
- Electron starts an HTTP file server bound only to `127.0.0.1` on a stable
  app-specific port. The stable origin preserves local saves, and the server
  is not exposed to the local network.
- Three.js is installed in the package instead of loaded from a CDN.
- The renderer keeps Node integration disabled and runs in a sandbox.
- Electron blocks remote runtime requests except the optional Render
  multiplayer WebSocket.
- Non-game links open in the user's normal browser.

The installer is unsigned unless a Windows code-signing certificate is later
configured. Windows SmartScreen may therefore show an unknown-publisher
warning during private testing.
