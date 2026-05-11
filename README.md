# Stardew Host Swap Tool

Stardew Host Swap Tool helps move host ownership in a Stardew Valley multiplayer save.
It promotes one farmhand to host, keeps the original host as a farmhand, and keeps each farmer profile as intact as possible.

## Project status

This repository currently contains:

- a PowerShell script for local save editing
- a React web app for browser-based host swapping
- a spec document that describes validation and swap rules

## What problem it solves

In some multiplayer saves, the person who originally hosted the farm can no longer act as host.
This project swaps the host role by moving full farmer blocks instead of patching only a few text fields.

## Core behavior

- reads a Stardew save folder
- finds the main save file and `SaveGameInfo`
- shows current host and available farmhands
- promotes selected farmhand to host
- keeps host-related fields in sync
- validates output before writing or exporting

## Repository layout

- `tools/` - PowerShell workflow for local save files
- `web/` - React + Vite web interface
- `docs/` - project notes and swap specification

## Safety notes

- back up your save before any manual testing
- modded saves are supported only as long as unrelated XML data stays untouched
- validation is strict for host identity and sync fields

## Related documents

- `docs/host-swap-spec.md` - host swap rules, validation, and failure conditions
- `tools/README.md` - PowerShell usage
- `web/README.md` - web app usage
