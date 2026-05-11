import type { HostSwapPreview, HostSwapResult, SaveFileBundle } from "./types";
import { childText, replaceDirectChild, serializeXml, requiredChildText } from "./xml";
import { validateAndSummarize } from "./validate";

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
  const farmhandsRoot = mainSaveDocument.querySelector("SaveGame > farmhands") as Element;
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

  const warnings: string[] = [];
  const after = validateAndSummarize(serializeXml(mainSaveDocument), serializeXml(saveGameInfoDocument));

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
