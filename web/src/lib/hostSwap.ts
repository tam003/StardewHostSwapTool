import type { HostSwapPreview, HostSwapResult, SaveFileBundle } from "./types";
import { childText, replaceDirectChild, serializeXml, requiredChildText } from "./xml";
import { validateAndSummarize } from "./validate";

const xsiNs = "http://www.w3.org/2001/XMLSchema-instance";

function isInstancedCabinHomeLocation(home: string): boolean {
  const trimmed = home.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed === "FarmHouse") {
    return false;
  }
  return trimmed.startsWith("FarmHouse") && trimmed.length > 9;
}

/**
 * Cabin mailboxes use indoors/farmhandReference (UniqueMultiplayerID of the assigned farmhand).
 * Host swap updates homeLocation on farmers but does not update buildings; fix that here.
 */
function syncCabinFarmhandReferences(document: XMLDocument, player: Element, farmhands: Element[]): number {
  const uidByCabinHome = new Map<string, string>();
  for (const farmer of [player, ...farmhands]) {
    const home = childText(farmer, "homeLocation");
    if (!isInstancedCabinHomeLocation(home)) {
      continue;
    }
    const uid = requiredChildText(farmer, "UniqueMultiplayerID", `farmer ${childText(farmer, "name") || "unknown"}`);
    if (uidByCabinHome.has(home)) {
      throw new Error(`Duplicate homeLocation '${home}' on multiple farmers while syncing cabin mailboxes.`);
    }
    uidByCabinHome.set(home, uid);
  }

  if (uidByCabinHome.size === 0) {
    return 0;
  }

  let updates = 0;
  for (const indoors of Array.from(document.querySelectorAll("indoors"))) {
    if (indoors.getAttributeNS(xsiNs, "type") !== "Cabin") {
      continue;
    }
    const uniqueNameEl = indoors.querySelector(":scope > uniqueName");
    const uniqueName = uniqueNameEl?.textContent?.trim() ?? "";
    if (!uniqueName || !uidByCabinHome.has(uniqueName)) {
      continue;
    }
    const wantUid = uidByCabinHome.get(uniqueName)!;
    const refEl = indoors.querySelector(":scope > farmhandReference");
    if (!refEl) {
      continue;
    }
    const current = refEl.textContent?.trim() ?? "";
    if (current !== wantUid) {
      refEl.textContent = wantUid;
      updates += 1;
    }
  }

  return updates;
}

const roleFieldNames = [
  "slotCanHost",
  "homeLocation",
  "lastSleepLocation",
  "lastSleepPoint",
  "mostRecentBed",
  "disconnectLocation",
  "disconnectPosition",
];

function cloneNode(document: XMLDocument, node: Element, tagName: string): Element {
  const clone = document.createElement(tagName);
  for (const attr of Array.from(node.attributes)) {
    clone.setAttribute(attr.name, attr.value);
  }
  for (const child of Array.from(node.childNodes)) {
    clone.appendChild(child.cloneNode(true));
  }
  return clone;
}

function moveRoleFields(target: Element, source: Element, document: XMLDocument) {
  for (const field of roleFieldNames) {
    replaceDirectChild(target, field, null);
    const sourceField = source.querySelector(`:scope > ${field}`) as Element | null;
    if (sourceField) {
      target.appendChild(document.importNode(sourceField, true));
    }
  }
}

export function buildPreview(bundle: SaveFileBundle): HostSwapPreview {
  const parsed = validateAndSummarize(bundle.mainSaveText, bundle.saveGameInfoText);
  return {
    currentHost: parsed.playerSummary,
    farmhands: parsed.farmhandSummaries,
  };
}

export function swapHost(bundle: SaveFileBundle, newHostName: string): HostSwapResult {
  const parsed = validateAndSummarize(bundle.mainSaveText, bundle.saveGameInfoText);
  const mainSaveDocument = parsed.mainSaveDocument;
  const saveGameInfoDocument = parsed.saveGameInfoDocument;

  const player = mainSaveDocument.querySelector(":scope > player, SaveGame > player") as Element;
  const farmhands = Array.from(mainSaveDocument.querySelectorAll("SaveGame > farmhands > Farmer"));
  const target = farmhands.find((node) => childText(node, "name") === newHostName);

  if (!target) {
    throw new Error(`Cannot find farmhand named '${newHostName}'.`);
  }

  const oldHostName = requiredChildText(player, "name", "player");
  if (oldHostName === newHostName) {
    throw new Error("Target host is already current host.");
  }

  const newPlayer = cloneNode(mainSaveDocument, target, "player");
  const newFarmhand = cloneNode(mainSaveDocument, player, "Farmer");
  moveRoleFields(newPlayer, player, mainSaveDocument);
  moveRoleFields(newFarmhand, target, mainSaveDocument);

  player.replaceWith(newPlayer);
  target.replaceWith(newFarmhand);

  const infoRoot = saveGameInfoDocument.documentElement;
  while (infoRoot.firstChild) {
    infoRoot.removeChild(infoRoot.firstChild);
  }
  for (const child of Array.from(newPlayer.childNodes)) {
    infoRoot.appendChild(saveGameInfoDocument.importNode(child, true));
  }

  const farmhandsAfterSwap = Array.from(mainSaveDocument.querySelectorAll("SaveGame > farmhands > Farmer"));
  const cabinMailboxUpdates = syncCabinFarmhandReferences(mainSaveDocument, newPlayer, farmhandsAfterSwap);

  const warnings: string[] = [];
  const after = validateAndSummarize(serializeXml(mainSaveDocument), serializeXml(saveGameInfoDocument));

  if (cabinMailboxUpdates > 0) {
    warnings.push(`Synced ${cabinMailboxUpdates} cabin mailbox owner field(s) (farmhandReference).`);
  }

  if (!after.playerSummary.userID || !after.farmhandSummaries.some((f) => f.userID)) {
    warnings.push("Some userID fields are empty in source save.");
  }

  return {
    folderName: bundle.folderName,
    oldHost: parsed.playerSummary,
    newHost: after.playerSummary,
    mainSaveText: serializeXml(mainSaveDocument),
    saveGameInfoText: serializeXml(saveGameInfoDocument),
    warnings,
  };
}
