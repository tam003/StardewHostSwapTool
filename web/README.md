# Web app

This folder contains browser-based Stardew host swap tool built with React, TypeScript, and Vite.

## What it does

- loads full save folder from drag and drop, folder input, or native folder picker
- finds `SaveGameInfo` and main save file automatically
- previews current host and available farmhands
- swaps host in memory
- exports updated files as one zip archive

## Stack

- React
- TypeScript
- Vite
- JSZip

## Run locally

Install dependencies:

```powershell
npm install
```

Start dev server:

```powershell
npm run dev
```

Create production build:

```powershell
npm run build
```

Preview production build:

```powershell
npm run preview
```

## Browser notes

- native folder picker needs browser support for `showDirectoryPicker`
- fallback folder input works when direct picker is unavailable
- app does not upload save data to any server

## Output

App exports zip file that contains:

- updated main save file
- updated `SaveGameInfo`
