import type { SaveFileBundle } from "./types";
import { parseXml } from "./xml";

const isIgnoredName = (name: string) => /\.bak_/i.test(name) || /_old$/i.test(name) || /SaveGameInfo$/i.test(name);

export async function discoverSaveBundleFromFolder(folder: FileSystemDirectoryHandle): Promise<SaveFileBundle> {
  const entries: { name: string; file: File }[] = [];

  for await (const [name, handle] of folder.entries()) {
    if (handle.kind !== "file") {
      continue;
    }

    const file = await handle.getFile();
    entries.push({ name, file });
  }

  const saveGameInfo = entries.find((entry) => entry.name === "SaveGameInfo");
  if (!saveGameInfo) {
    throw new Error("Missing SaveGameInfo in folder.");
  }

  const mainCandidates = entries.filter((entry) => !isIgnoredName(entry.name));
  const parsed: { name: string; text: string; doc: XMLDocument }[] = [];

  for (const candidate of mainCandidates) {
    const text = await candidate.file.text();
    try {
      const doc = parseXml(text, candidate.name);
      if (doc.documentElement?.localName === "SaveGame") {
        parsed.push({ name: candidate.name, text, doc });
      }
    } catch {
      continue;
    }
  }

  if (!parsed.length) {
    throw new Error("Cannot find main save file in folder. Stardew main save usually has no .xml extension, but content must still be valid XML.");
  }

  const folderName = folder.name;
  const preferred = parsed.find((entry) => entry.name === folderName) ?? (parsed.length === 1 ? parsed[0] : null);
  if (!preferred) {
    throw new Error(`Multiple main save candidates found: ${parsed.map((entry) => entry.name).join(", ")}`);
  }

  return {
    folderName,
    mainSaveName: preferred.name,
    mainSaveText: preferred.text,
    saveGameInfoText: await saveGameInfo.file.text(),
    mainSaveNameGuess: preferred.name === folderName ? preferred.name : null,
  };
}

export async function discoverSaveBundleFromDrop(items: DataTransferItemList): Promise<SaveFileBundle> {
  const directories: FileSystemDirectoryHandle[] = [];

  for (const item of Array.from(items)) {
    const handle = await item.getAsFileSystemHandle?.();
    if (handle?.kind === "directory") {
      directories.push(handle as FileSystemDirectoryHandle);
    }
  }

  if (!directories.length) {
    throw new Error("Drop save folder, not single file.");
  }

  return discoverSaveBundleFromFolder(directories[0]);
}
