# USA Tank V8 Windows launcher

This folder packages the existing online game as a Windows desktop
application. The installed app loads `https://cinrostro.onrender.com/`, so the
existing Render deployment continues to serve the game and multiplayer
WebSocket connection.

## Local development

Requirements:

- Node.js 24
- npm

Run:

```bash
npm ci
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
Open the workflow run, download the `USA-Tank-V8-Windows-Installer` artifact,
extract the ZIP, and run the setup executable.

## Architecture

- The EXE is a secure Electron launcher.
- The game and multiplayer server remain on Render.
- Game updates appear without rebuilding the launcher.
- Node integration is disabled for remote content.
- Non-game links open in the user's normal browser.

The installer is unsigned unless a Windows code-signing certificate is later
configured. Windows SmartScreen may therefore show an unknown-publisher
warning during private testing.
