export type FarmerSummary = {
  name: string;
  userID: string;
  uniqueMultiplayerID: string;
  slotCanHost: string;
  homeLocation: string;
  lastSleepLocation: string;
};

export type SaveFileBundle = {
  folderName: string;
  mainSaveName: string;
  mainSaveText: string;
  saveGameInfoText: string;
  mainSaveNameGuess: string | null;
};

export type HostSwapPreview = {
  currentHost: FarmerSummary;
  farmhands: FarmerSummary[];
};

export type HostSwapResult = {
  folderName: string;
  oldHost: FarmerSummary;
  newHost: FarmerSummary;
  mainSaveText: string;
  saveGameInfoText: string;
  warnings: string[];
};
