import type { FarmerSummary } from "./types";
import { childText, parseXml, requiredChildText } from "./xml";

export function summarizeFarmer(node: Element): FarmerSummary {
  return {
    name: childText(node, "name"),
    userID: childText(node, "userID"),
    uniqueMultiplayerID: childText(node, "UniqueMultiplayerID"),
    slotCanHost: childText(node, "slotCanHost"),
    homeLocation: childText(node, "homeLocation"),
    lastSleepLocation: childText(node, "lastSleepLocation"),
  };
}

export function validateAndSummarize(mainSaveText: string, saveGameInfoText: string) {
  const mainSaveDocument = parseXml(mainSaveText, "main save");
  const saveGameInfoDocument = parseXml(saveGameInfoText, "SaveGameInfo");

  if (mainSaveDocument.documentElement.localName !== "SaveGame") {
    throw new Error("Main save root must be SaveGame.");
  }

  if (saveGameInfoDocument.documentElement.localName !== "Farmer") {
    throw new Error("SaveGameInfo root must be Farmer.");
  }

  const player = mainSaveDocument.querySelector(":scope > player, SaveGame > player");
  const farmhandNodes = Array.from(mainSaveDocument.querySelectorAll("SaveGame > farmhands > Farmer"));

  if (!player) {
    throw new Error("Missing player node.");
  }

  if (!farmhandNodes.length) {
    throw new Error("Missing farmhands.");
  }

  const playerName = requiredChildText(player, "name", "player");
  const playerUid = requiredChildText(player, "UniqueMultiplayerID", "player");
  const infoName = requiredChildText(saveGameInfoDocument.documentElement, "name", "SaveGameInfo");
  const infoUid = requiredChildText(saveGameInfoDocument.documentElement, "UniqueMultiplayerID", "SaveGameInfo");

  if (playerName !== infoName) {
    throw new Error("SaveGameInfo/name does not match player/name.");
  }

  if (playerUid !== infoUid) {
    throw new Error("SaveGameInfo/UniqueMultiplayerID does not match player/UniqueMultiplayerID.");
  }

  const seen = new Set<string>();
  const allFarmers = [player, ...farmhandNodes];
  for (const farmer of allFarmers) {
    const uid = requiredChildText(farmer, "UniqueMultiplayerID", `farmer ${childText(farmer, "name") || "unknown"}`);
    if (seen.has(uid)) {
      throw new Error(`Duplicate UniqueMultiplayerID found: ${uid}`);
    }
    seen.add(uid);
  }

  return {
    mainSaveDocument,
    saveGameInfoDocument,
    playerSummary: summarizeFarmer(player),
    farmhandSummaries: farmhandNodes.map(summarizeFarmer),
  };
}
