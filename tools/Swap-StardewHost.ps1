[CmdletBinding()]
param(
    [string]$SaveFolder,

    [string]$NewHostName,

    [int]$NewHostIndex,

    [switch]$ListFarmers,

    [switch]$NoBackup,

    [switch]$WhatIf
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ShouldPauseOnExit = ($PSBoundParameters.Count -eq 0)

$RoleFieldNames = @(
    "slotCanHost",
    "homeLocation",
    "lastSleepLocation",
    "lastSleepPoint",
    "mostRecentBed",
    "disconnectLocation",
    "disconnectPosition"
)

function Fail {
    param([string]$Message)
    throw $Message
}

function Resolve-DefaultSaveFolder {
    param([string]$RequestedFolder)

    if (-not [string]::IsNullOrWhiteSpace($RequestedFolder)) {
        return (Resolve-Path -LiteralPath $RequestedFolder).Path
    }

    if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) {
        return (Resolve-Path -LiteralPath $PSScriptRoot).Path
    }

    return (Get-Location).Path
}

function Prompt-SaveFolder {
    param([string]$DefaultFolder)

    Write-Host ""
    Write-Host "Save folder not found." -ForegroundColor Yellow

    $prompt = "Enter full save folder path"
    if (-not [string]::IsNullOrWhiteSpace($DefaultFolder)) {
        $prompt += " [$DefaultFolder]"
    }
    $prompt += " or press Enter to quit"

    while ($true) {
        $input = Read-Host $prompt
        if ([string]::IsNullOrWhiteSpace($input)) {
            return $null
        }

        try {
            return (Resolve-Path -LiteralPath $input).Path
        }
        catch {
            Write-Host "Invalid path. Try again." -ForegroundColor Red
        }
    }
}

function Wait-ForExit {
    param([string]$Message)

    try {
        [void](Read-Host $Message)
    }
    catch {
        # Ignore non-interactive hosts.
    }
}

function Get-ElementText {
    param(
        [System.Xml.XmlNode]$Parent,
        [string]$Name
    )

    if (-not $Parent) {
        return $null
    }

    $child = $Parent.SelectSingleNode($Name)
    if (-not $child) {
        return $null
    }

    return $child.InnerText
}

function Get-RequiredElementText {
    param(
        [System.Xml.XmlNode]$Parent,
        [string]$Name,
        [string]$Context
    )

    $value = Get-ElementText -Parent $Parent -Name $Name
    if ([string]::IsNullOrWhiteSpace($value)) {
        Fail "Missing required field '$Name' in $Context."
    }

    return $value
}

function Read-XmlDocument {
    param([string]$Path)

    $doc = New-Object System.Xml.XmlDocument
    $doc.PreserveWhitespace = $true

    $settings = New-Object System.Xml.XmlReaderSettings
    $settings.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit

    $reader = [System.Xml.XmlReader]::Create($Path, $settings)
    try {
        $doc.Load($reader)
    }
    catch {
        Fail "Cannot parse XML: $Path. $($_.Exception.Message)"
    }
    finally {
        $reader.Close()
    }

    return $doc
}

function Write-XmlDocument {
    param(
        [System.Xml.XmlDocument]$Document,
        [string]$Path
    )

    $settings = New-Object System.Xml.XmlWriterSettings
    $settings.Encoding = New-Object System.Text.UTF8Encoding($false)
    $settings.Indent = $false
    $settings.OmitXmlDeclaration = $false
    $settings.NewLineHandling = [System.Xml.NewLineHandling]::None

    $writer = [System.Xml.XmlWriter]::Create($Path, $settings)
    try {
        $Document.Save($writer)
    }
    finally {
        $writer.Close()
    }
}

function Get-SaveFileSet {
    param([string]$FolderPath)

    if (-not (Test-Path -LiteralPath $FolderPath -PathType Container)) {
        Fail "Save folder does not exist: $FolderPath"
    }

    $resolvedFolder = (Resolve-Path -LiteralPath $FolderPath).Path
    $folderName = Split-Path -Leaf $resolvedFolder

    $infoPath = Join-Path $resolvedFolder "SaveGameInfo"
    if (-not (Test-Path -LiteralPath $infoPath -PathType Leaf)) {
        Fail "Cannot find SaveGameInfo in save folder. Put script inside save folder or pass -SaveFolder."
    }

    $candidates = Get-ChildItem -LiteralPath $resolvedFolder -File | Where-Object {
        $_.Name -ne "SaveGameInfo" -and
        $_.Name -notmatch "\.bak_" -and
        $_.BaseName -notmatch "_old$" -and
        $_.Name -notmatch "_old$"
    }

    if (-not $candidates) {
        Fail "Cannot find main save file in save folder. Put script inside save folder or pass -SaveFolder."
    }

    $parsedCandidates = @()
    foreach ($candidate in $candidates) {
        try {
            $doc = Read-XmlDocument -Path $candidate.FullName
            if ($doc.DocumentElement -and $doc.DocumentElement.LocalName -eq "SaveGame") {
                $parsedCandidates += [pscustomobject]@{
                    Path = $candidate.FullName
                    Name = $candidate.Name
                    Document = $doc
                }
            }
        }
        catch {
            continue
        }
    }

    if (-not $parsedCandidates) {
        Fail "Cannot find main save file with root SaveGame in save folder."
    }

    $preferred = $parsedCandidates | Where-Object { $_.Name -eq $folderName } | Select-Object -First 1
    if (-not $preferred) {
        if ($parsedCandidates.Count -gt 1) {
            $names = ($parsedCandidates | ForEach-Object { $_.Name }) -join ", "
            Fail "Found multiple valid main save files: $names. Keep only one main save file in folder."
        }

        $preferred = $parsedCandidates[0]
    }

    return [pscustomobject]@{
        SaveFolder = $resolvedFolder
        SaveName = $folderName
        MainSavePath = $preferred.Path
        SaveGameInfoPath = $infoPath
        MainSaveDocument = $preferred.Document
    }
}

function Get-FarmerNodeSummary {
    param([System.Xml.XmlNode]$FarmerNode)

    return [pscustomobject]@{
        Name = Get-ElementText -Parent $FarmerNode -Name "name"
        UserId = Get-ElementText -Parent $FarmerNode -Name "userID"
        UniqueMultiplayerID = Get-ElementText -Parent $FarmerNode -Name "UniqueMultiplayerID"
        SlotCanHost = Get-ElementText -Parent $FarmerNode -Name "slotCanHost"
        HomeLocation = Get-ElementText -Parent $FarmerNode -Name "homeLocation"
        LastSleepLocation = Get-ElementText -Parent $FarmerNode -Name "lastSleepLocation"
    }
}

function Format-OptionalValue {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return "-"
    }

    return $Value
}

function Get-Farmers {
    param([System.Xml.XmlDocument]$SaveDocument)

    $root = $SaveDocument.DocumentElement
    if (-not $root -or $root.LocalName -ne "SaveGame") {
        Fail "Main save file does not have valid root SaveGame."
    }

    $player = $root.SelectSingleNode("player")
    $farmhands = $root.SelectSingleNode("farmhands")

    if (-not $player) {
        Fail "Cannot find player node in save file."
    }

    if (-not $farmhands) {
        Fail "Cannot find farmhands node in save file."
    }

    $farmhandNodes = @($farmhands.SelectNodes("Farmer"))
    if (-not $farmhandNodes) {
        Fail "Cannot find any farmhand in save file."
    }

    return [pscustomobject]@{
        PlayerNode = $player
        FarmhandsNode = $farmhands
        FarmhandNodes = $farmhandNodes
    }
}

function New-NodeFromSource {
    param(
        [System.Xml.XmlDocument]$Document,
        [string]$TagName,
        [System.Xml.XmlNode]$SourceNode
    )

    $newNode = $Document.CreateElement($TagName)

    if ($SourceNode.Attributes) {
        foreach ($attribute in $SourceNode.Attributes) {
            $null = $newNode.SetAttribute($attribute.Name, $attribute.Value)
        }
    }

    foreach ($child in $SourceNode.ChildNodes) {
        $null = $newNode.AppendChild($child.CloneNode($true))
    }

    return $newNode
}

function Set-RoleFieldFromSource {
    param(
        [System.Xml.XmlDocument]$Document,
        [System.Xml.XmlNode]$TargetNode,
        [System.Xml.XmlNode]$SourceNode,
        [string]$FieldName
    )

    $existing = $TargetNode.SelectSingleNode($FieldName)
    if ($existing) {
        $null = $TargetNode.RemoveChild($existing)
    }

    $sourceField = $SourceNode.SelectSingleNode($FieldName)
    if ($sourceField) {
        $null = $TargetNode.AppendChild($Document.ImportNode($sourceField, $true))
    }
}

function Apply-RoleFieldSwap {
    param(
        [System.Xml.XmlDocument]$Document,
        [System.Xml.XmlNode]$NewPlayerNode,
        [System.Xml.XmlNode]$NewFarmhandNode,
        [System.Xml.XmlNode]$OldPlayerNode,
        [System.Xml.XmlNode]$OldFarmhandNode
    )

    foreach ($fieldName in $RoleFieldNames) {
        Set-RoleFieldFromSource -Document $Document -TargetNode $NewPlayerNode -SourceNode $OldPlayerNode -FieldName $fieldName
        Set-RoleFieldFromSource -Document $Document -TargetNode $NewFarmhandNode -SourceNode $OldFarmhandNode -FieldName $fieldName
    }
}

$XsiTypeNs = "http://www.w3.org/2001/XMLSchema-instance"

function Test-IsInstancedCabinHomeLocation {
    param([string]$HomeLocation)

    if ([string]::IsNullOrWhiteSpace($HomeLocation)) {
        return $false
    }

    if ($HomeLocation -eq "FarmHouse") {
        return $false
    }

    # Main farmhouse stays "FarmHouse"; cabins use the instanced name "FarmHouse{guid}" in many saves.
    if ($HomeLocation.StartsWith("FarmHouse") -and $HomeLocation.Length -gt 9) {
        return $true
    }

    return $false
}

function Sync-CabinFarmhandReferences {
    param([System.Xml.XmlDocument]$SaveDocument)

    $farmerData = Get-Farmers -SaveDocument $SaveDocument

    $uidByCabinHome = @{}
    foreach ($farmerNode in @($farmerData.PlayerNode) + @($farmerData.FarmhandNodes)) {
        $home = Get-ElementText -Parent $farmerNode -Name "homeLocation"
        if (-not (Test-IsInstancedCabinHomeLocation -HomeLocation $home)) {
            continue
        }

        $uid = Get-RequiredElementText -Parent $farmerNode -Name "UniqueMultiplayerID" -Context "farmer $(Get-ElementText -Parent $farmerNode -Name 'name')"
        if ($uidByCabinHome.ContainsKey($home)) {
            Fail "Duplicate homeLocation '$home' on multiple farmers while syncing cabin mailboxes."
        }

        $uidByCabinHome[$home] = $uid
    }

    if ($uidByCabinHome.Count -eq 0) {
        return 0
    }

    $updates = 0
    foreach ($indoorsNode in @($SaveDocument.SelectNodes("//indoors"))) {
        if (-not ($indoorsNode -is [System.Xml.XmlElement])) {
            continue
        }

        $indoorsEl = [System.Xml.XmlElement]$indoorsNode
        $typeName = $indoorsEl.GetAttribute("type", $XsiTypeNs)
        if ($typeName -ne "Cabin") {
            continue
        }

        $uniqueEl = $indoorsEl.SelectSingleNode("uniqueName")
        if (-not $uniqueEl) {
            continue
        }

        $uniqueName = $uniqueEl.InnerText
        if ([string]::IsNullOrWhiteSpace($uniqueName)) {
            continue
        }

        if (-not $uidByCabinHome.ContainsKey($uniqueName)) {
            continue
        }

        $wantUid = $uidByCabinHome[$uniqueName]
        $refEl = $indoorsEl.SelectSingleNode("farmhandReference")
        if (-not $refEl) {
            continue
        }

        if ($refEl.InnerText -ne $wantUid) {
            $refEl.InnerText = $wantUid
            $updates++
        }
    }

    return $updates
}

function Sync-SaveGameInfo {
    param(
        [System.Xml.XmlDocument]$InfoDocument,
        [System.Xml.XmlNode]$PlayerNode
    )

    $root = $InfoDocument.DocumentElement
    if (-not $root -or $root.LocalName -ne "Farmer") {
        Fail "SaveGameInfo does not have valid root Farmer."
    }

    while ($root.HasChildNodes) {
        $null = $root.RemoveChild($root.FirstChild)
    }

    foreach ($child in $PlayerNode.ChildNodes) {
        $null = $root.AppendChild($InfoDocument.ImportNode($child, $true))
    }
}

function Get-BackupPath {
    param([string]$Path)

    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    return "$Path.bak_$timestamp"
}

function Write-Backups {
    param(
        [string]$MainSavePath,
        [string]$SaveGameInfoPath
    )

    $mainBackup = Get-BackupPath -Path $MainSavePath
    $infoBackup = Get-BackupPath -Path $SaveGameInfoPath

    Copy-Item -LiteralPath $MainSavePath -Destination $mainBackup -Force
    Copy-Item -LiteralPath $SaveGameInfoPath -Destination $infoBackup -Force

    return [pscustomobject]@{
        MainSaveBackupPath = $mainBackup
        SaveGameInfoBackupPath = $infoBackup
    }
}

function Validate-SaveState {
    param(
        [System.Xml.XmlDocument]$SaveDocument,
        [System.Xml.XmlDocument]$InfoDocument
    )

    $farmerData = Get-Farmers -SaveDocument $SaveDocument
    $playerNode = $farmerData.PlayerNode

    $playerName = Get-RequiredElementText -Parent $playerNode -Name "name" -Context "player"
    $playerUserId = Get-ElementText -Parent $playerNode -Name "userID"
    $playerUniqueId = Get-RequiredElementText -Parent $playerNode -Name "UniqueMultiplayerID" -Context "player"

    foreach ($fieldName in @("slotCanHost", "homeLocation", "lastSleepLocation")) {
        $null = Get-RequiredElementText -Parent $playerNode -Name $fieldName -Context "player"
    }

    $seenIds = New-Object System.Collections.Generic.HashSet[string]
    if (-not $seenIds.Add($playerUniqueId)) {
        Fail "Duplicate UniqueMultiplayerID at player: $playerUniqueId"
    }

    foreach ($farmhand in $farmerData.FarmhandNodes) {
        $farmhandName = Get-RequiredElementText -Parent $farmhand -Name "name" -Context "farmhand"
        $farmhandUniqueId = Get-RequiredElementText -Parent $farmhand -Name "UniqueMultiplayerID" -Context "farmhand $farmhandName"
        if (-not $seenIds.Add($farmhandUniqueId)) {
            Fail "Duplicate UniqueMultiplayerID after host swap: $farmhandUniqueId"
        }
    }

    $infoRoot = $InfoDocument.DocumentElement
    if (-not $infoRoot -or $infoRoot.LocalName -ne "Farmer") {
        Fail "Invalid SaveGameInfo root."
    }

    $infoName = Get-RequiredElementText -Parent $infoRoot -Name "name" -Context "SaveGameInfo"
    $infoUserId = Get-ElementText -Parent $infoRoot -Name "userID"
    $infoUniqueId = Get-RequiredElementText -Parent $infoRoot -Name "UniqueMultiplayerID" -Context "SaveGameInfo"

    if ($playerName -ne $infoName) {
        Fail "SaveGameInfo/name does not match player/name."
    }

    if (
        -not [string]::IsNullOrWhiteSpace($playerUserId) -or
        -not [string]::IsNullOrWhiteSpace($infoUserId)
    ) {
        if ($playerUserId -ne $infoUserId) {
            Fail "SaveGameInfo/userID does not match player/userID."
        }
    }

    if ($playerUniqueId -ne $infoUniqueId) {
        Fail "SaveGameInfo/UniqueMultiplayerID does not match player/UniqueMultiplayerID."
    }

    return [pscustomobject]@{
        Player = Get-FarmerNodeSummary -FarmerNode $playerNode
        Farmhands = @($farmerData.FarmhandNodes | ForEach-Object { Get-FarmerNodeSummary -FarmerNode $_ })
    }
}

function Show-Farmers {
    param(
        [pscustomobject]$PlayerSummary,
        [object[]]$FarmhandSummaries
    )

    Write-Host ""
    Write-Host "Current host:" -ForegroundColor Cyan
    Write-Host "  - $($PlayerSummary.Name) | userID=$(Format-OptionalValue $PlayerSummary.UserId) | uid=$($PlayerSummary.UniqueMultiplayerID)"
    Write-Host ""
    Write-Host "Farmhands:" -ForegroundColor Cyan

    for ($i = 0; $i -lt $FarmhandSummaries.Count; $i++) {
        $farmhand = $FarmhandSummaries[$i]
        Write-Host ("  [{0}] {1} | userID={2} | uid={3}" -f ($i + 1), $farmhand.Name, (Format-OptionalValue $farmhand.UserId), $farmhand.UniqueMultiplayerID)
    }

    Write-Host ""
}

function Resolve-NewHostName {
    param(
        [string]$RequestedName,
        [int]$RequestedIndex,
        [object[]]$FarmhandSummaries
    )

    if (-not [string]::IsNullOrWhiteSpace($RequestedName)) {
        return $RequestedName.Trim()
    }

    if ($RequestedIndex -gt 0) {
        if ($RequestedIndex -gt $FarmhandSummaries.Count) {
            Fail "NewHostIndex is out of range. Pick value from 1 to $($FarmhandSummaries.Count)."
        }

        return $FarmhandSummaries[$RequestedIndex - 1].Name
    }

    Write-Host "Pick farmhand number to promote as host." -ForegroundColor Yellow
    $inputIndex = Read-Host "NewHostIndex"

    if ([string]::IsNullOrWhiteSpace($inputIndex)) {
        Fail "NewHostIndex is required."
    }

    $parsedIndex = 0
    if (-not [int]::TryParse($inputIndex, [ref]$parsedIndex)) {
        Fail "NewHostIndex must be a number."
    }

    if ($parsedIndex -lt 1 -or $parsedIndex -gt $FarmhandSummaries.Count) {
        Fail "NewHostIndex is out of range. Pick value from 1 to $($FarmhandSummaries.Count)."
    }

    return $FarmhandSummaries[$parsedIndex - 1].Name
}

function Find-FarmhandByName {
    param(
        [System.Xml.XmlNode[]]$FarmhandNodes,
        [string]$Name
    )

    $matches = @($FarmhandNodes | Where-Object { (Get-ElementText -Parent $_ -Name "name") -eq $Name })
    if (-not $matches) {
        Fail "Cannot find farmhand named '$Name'."
    }

    if ($matches.Count -gt 1) {
        Fail "Found multiple farmhands named '$Name'."
    }

    return $matches[0]
}

function Invoke-HostSwap {
    param(
        [System.Xml.XmlDocument]$SaveDocument,
        [System.Xml.XmlDocument]$InfoDocument,
        [string]$TargetFarmhandName
    )

    $farmerData = Get-Farmers -SaveDocument $SaveDocument
    $oldPlayerNode = $farmerData.PlayerNode
    $targetFarmhandNode = Find-FarmhandByName -FarmhandNodes $farmerData.FarmhandNodes -Name $TargetFarmhandName

    $oldHostName = Get-RequiredElementText -Parent $oldPlayerNode -Name "name" -Context "player"
    if ($oldHostName -eq $TargetFarmhandName) {
        Fail "Target host is already current host."
    }

    $newPlayerNode = New-NodeFromSource -Document $SaveDocument -TagName "player" -SourceNode $targetFarmhandNode
    $newFarmhandNode = New-NodeFromSource -Document $SaveDocument -TagName "Farmer" -SourceNode $oldPlayerNode

    Apply-RoleFieldSwap `
        -Document $SaveDocument `
        -NewPlayerNode $newPlayerNode `
        -NewFarmhandNode $newFarmhandNode `
        -OldPlayerNode $oldPlayerNode `
        -OldFarmhandNode $targetFarmhandNode

    $root = $SaveDocument.DocumentElement
    $farmhandsNode = $farmerData.FarmhandsNode

    $null = $root.ReplaceChild($newPlayerNode, $oldPlayerNode)
    $null = $farmhandsNode.ReplaceChild($newFarmhandNode, $targetFarmhandNode)

    Sync-SaveGameInfo -InfoDocument $InfoDocument -PlayerNode $newPlayerNode

    $cabinMailboxUpdates = Sync-CabinFarmhandReferences -SaveDocument $SaveDocument

    return [pscustomobject]@{
        OldHostName = $oldHostName
        NewHostName = $TargetFarmhandName
        CabinMailboxFieldsUpdated = $cabinMailboxUpdates
    }
}

try {
    $resolvedSaveFolder = Resolve-DefaultSaveFolder -RequestedFolder $SaveFolder
    try {
        $fileSet = Get-SaveFileSet -FolderPath $resolvedSaveFolder
    }
    catch {
        if (-not [string]::IsNullOrWhiteSpace($SaveFolder)) {
            throw
        }

        $promptedFolder = Prompt-SaveFolder -DefaultFolder $resolvedSaveFolder
        if (-not $promptedFolder) {
            Fail "Save folder required."
        }

        $resolvedSaveFolder = $promptedFolder
        $fileSet = Get-SaveFileSet -FolderPath $resolvedSaveFolder
    }

    $mainSaveDocument = $fileSet.MainSaveDocument
    $saveGameInfoDocument = Read-XmlDocument -Path $fileSet.SaveGameInfoPath

    $beforeState = Validate-SaveState -SaveDocument $mainSaveDocument -InfoDocument $saveGameInfoDocument

    Show-Farmers -PlayerSummary $beforeState.Player -FarmhandSummaries $beforeState.Farmhands

    if ($ListFarmers) {
        return
    }

    $resolvedNewHostName = Resolve-NewHostName -RequestedName $NewHostName -RequestedIndex $NewHostIndex -FarmhandSummaries $beforeState.Farmhands
    $swapResult = Invoke-HostSwap -SaveDocument $mainSaveDocument -InfoDocument $saveGameInfoDocument -TargetFarmhandName $resolvedNewHostName
    $afterState = Validate-SaveState -SaveDocument $mainSaveDocument -InfoDocument $saveGameInfoDocument

    if ($WhatIf) {
        Write-Host "WhatIf: no files written." -ForegroundColor Yellow
    }
    else {
        $backupInfo = $null
        if (-not $NoBackup) {
            $backupInfo = Write-Backups -MainSavePath $fileSet.MainSavePath -SaveGameInfoPath $fileSet.SaveGameInfoPath
        }

        Write-XmlDocument -Document $mainSaveDocument -Path $fileSet.MainSavePath
        Write-XmlDocument -Document $saveGameInfoDocument -Path $fileSet.SaveGameInfoPath

        if ($backupInfo) {
            Write-Host ""
            Write-Host "Backups created:" -ForegroundColor Green
            Write-Host "  - $($backupInfo.MainSaveBackupPath)"
            Write-Host "  - $($backupInfo.SaveGameInfoBackupPath)"
        }
    }

    Write-Host ""
    Write-Host "Host swap completed." -ForegroundColor Green
    Write-Host "  - Old host: $($swapResult.OldHostName)"
    Write-Host "  - New host: $($swapResult.NewHostName)"
    Write-Host "  - Cabin mailbox fields updated: $($swapResult.CabinMailboxFieldsUpdated)"
    Write-Host "  - Main save: $($fileSet.MainSavePath)"
    Write-Host "  - SaveGameInfo: $($fileSet.SaveGameInfoPath)"
    Write-Host ""

    Show-Farmers -PlayerSummary $afterState.Player -FarmhandSummaries $afterState.Farmhands
}
catch {
    Write-Error $_.Exception.Message
    if ($ShouldPauseOnExit) {
        Wait-ForExit -Message "Press Enter to close"
    }
    exit 1
}

if ($ShouldPauseOnExit) {
    Wait-ForExit -Message "Press Enter to close"
}
