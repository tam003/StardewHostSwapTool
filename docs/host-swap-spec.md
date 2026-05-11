# Stardew host swap spec

## Input

- Folder save, usually named `[farmName]_[randomNumber]`.
- Folder must contain:
  - main save file (usually same name as folder, no `.xml` extension)
  - `SaveGameInfo`

## Goal

- Promote 1 farmhand to host.
- Keep original host as farmhand.
- Keep each farmer's own data intact as much as possible.

## Core rule

- Treat each farmer block as a full profile.
- Swap host by swapping full farmer blocks, not only name fields.

## Main files

- `SaveGame`
- `SaveGameInfo`

## Required sync fields

- `name`
- `userID`
- `UniqueMultiplayerID`
- `slotCanHost`
- `homeLocation`
- `lastSleepLocation`
- `lastSleepPoint`

## Required swap targets

- `SaveGame/player`
- matching `SaveGame/farmhands/Farmer`
- `SaveGameInfo/Farmer`

## Failure conditions

- Missing main save or `SaveGameInfo`
- XML parse error
- Cannot find exactly 1 host candidate and 1 target farmhand
- Missing required identity fields
- Duplicate `UniqueMultiplayerID` after transform
- `SaveGameInfo` mismatch after transform

## Validation

- Parse before and after transform.
- Host identity matches between main save and `SaveGameInfo`.
- Host and farmhand identities differ.
- Output folder/file set is complete.
- Backup created before overwrite.

## Folder discovery

- Prefer:
  - `SaveGameInfo`
  - one main save file in same folder
- Ignore backup files like `*.bak_*` and `*_old` unless user explicitly points at them.

## Notes

- Save may be modded.
- Validator must be strict for host identity, loose for unrelated mod data.
- Tool must not depend on sample save files in repo.
