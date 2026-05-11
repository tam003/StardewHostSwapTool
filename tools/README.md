# PowerShell tool

## Run

```powershell
1. Copy `Swap-StardewHost.ps1` and `Swap-StardewHost.bat` into save folder, for example `FarmName_123456789`
2. Double-click `Swap-StardewHost.bat`
```

## Notes

- By default, script uses folder where `.ps1` file is located.
- You can still pass `-SaveFolder` manually if needed.
- `.bat` launcher calls `.ps1` in same folder, so double-click works.
- If script is not inside save folder, it will ask you to enter save folder path.
- If you run it from Explorer, window waits before closing so you can read errors.
- Tool auto-discovers main save file and `SaveGameInfo`.
- If you do not pass `-NewHostIndex`, tool asks for 1..N farmhand number.
- Tool creates backups before overwrite unless `-NoBackup` is passed.
- Use `-WhatIf` to validate swap without writing files.
