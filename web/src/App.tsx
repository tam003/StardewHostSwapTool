import JSZip from "jszip";
import { useMemo, useRef, useState } from "react";
import type { FarmerSummary, HostSwapPreview, HostSwapResult, SaveFileBundle } from "./lib/types";
import { discoverSaveBundleFromDrop, discoverSaveBundleFromFolder } from "./lib/discover";
import { buildPreview, swapHost } from "./lib/hostSwap";

type AppState =
  | { kind: "idle" }
  | { kind: "loaded"; bundle: SaveFileBundle; preview: HostSwapPreview }
  | { kind: "result"; bundle: SaveFileBundle; result: HostSwapResult };

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function formatInfo(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "-";
}

function renderFarmerPreview(title: string, subtitle: string, farmer: FarmerSummary | null) {
  if (!farmer) {
    return (
      <div className="previewCard">
        <span>{title}</span>
        <strong>-</strong>
        <small>{subtitle}</small>
      </div>
    );
  }

  return (
    <div className="previewCard">
      <span>{title}</span>
      <strong>{farmer.name}</strong>
      <small>{subtitle}</small>
      <div className="previewInfoList">
        <div className="previewInfo">
          <span>User ID</span>
          <strong>{formatInfo(farmer.userID)}</strong>
        </div>
        <div className="previewInfo">
          <span>Multiplayer ID</span>
          <strong>{formatInfo(farmer.uniqueMultiplayerID)}</strong>
        </div>
        <div className="previewInfo">
          <span>Can host</span>
          <strong>{formatInfo(farmer.slotCanHost)}</strong>
        </div>
        <div className="previewInfo">
          <span>Home</span>
          <strong>{formatInfo(farmer.homeLocation)}</strong>
        </div>
        <div className="previewInfo">
          <span>Last sleep</span>
          <strong>{formatInfo(farmer.lastSleepLocation)}</strong>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [state, setState] = useState<AppState>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedHost, setSelectedHost] = useState("");
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const currentHostName = useMemo(() => {
    if (state.kind === "loaded") {
      return state.preview.currentHost.name;
    }

    if (state.kind === "result") {
      return state.result.newHost.name;
    }

    return "";
  }, [state]);

  const selectedFarmhand = useMemo(() => {
    if (state.kind !== "loaded") {
      return null;
    }

    return state.preview.farmhands.find((farmhand) => farmhand.name === selectedHost) ?? null;
  }, [state, selectedHost]);

  async function loadFromFolder(folder: FileSystemDirectoryHandle) {
    setBusy(true);
    setError(null);
    try {
      const bundle = await discoverSaveBundleFromFolder(folder);
      const preview = buildPreview(bundle);
      setSelectedHost(preview.farmhands[0]?.name ?? "");
      setState({ kind: "loaded", bundle, preview });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  async function onFileInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) {
      return;
    }

    const handles = files.map((file) => ({ file, name: file.webkitRelativePath.split("/")[0] || file.name }));
    const folderName = handles[0]?.name ?? "save";
    const folder = {
      name: folderName,
      async *entries() {
        const seen = new Map<string, File>();
        for (const item of handles) {
          const relativeName = item.file.webkitRelativePath.split("/").slice(1).join("/");
          const name = relativeName || item.file.name;
          seen.set(name, item.file);
        }
        for (const [name, file] of seen) {
          yield [name, { kind: "file", getFile: async () => file } as FileSystemFileHandle] as const;
        }
      },
    } as unknown as FileSystemDirectoryHandle;

    await loadFromFolder(folder);
  }

  async function onDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setError(null);
    const folder = await discoverSaveBundleFromDrop(event.dataTransfer.items);
    const preview = buildPreview(folder);
    setSelectedHost(preview.farmhands[0]?.name ?? "");
    setState({ kind: "loaded", bundle: folder, preview });
  }

  async function useNativeFolderPicker() {
    if (!("showDirectoryPicker" in window)) {
      setError("Browser does not support folder picker. Use drag-drop or file input.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const folder = await (window as Window & { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker();
      await loadFromFolder(folder);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  function runSwap() {
    if (state.kind !== "loaded") {
      return;
    }

    if (!selectedHost) {
      setError("Pick target host first.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = swapHost(state.bundle, selectedHost);
      setState({ kind: "result", bundle: state.bundle, result });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  async function downloadOutput() {
    if (state.kind !== "result") {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const zip = new JSZip();
      zip.file(state.bundle.mainSaveName, state.result.mainSaveText);
      zip.file("SaveGameInfo", state.result.saveGameInfoText);

      const blob = await zip.generateAsync({ type: "blob", mimeType: "application/zip" });
      downloadBlob(`${state.bundle.folderName}_swapped.zip`, blob);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  const folderInputProps = {
    webkitdirectory: "",
    directory: "",
  } as React.InputHTMLAttributes<HTMLInputElement> & {
    webkitdirectory?: string;
    directory?: string;
  };

  return (
    <div className="appShell">
      <header className="hero">
        <div className="heroCopy">
          <p className="eyebrow">Stardew host swap</p>
          <h1>Promote host, keep save intact.</h1>
          <p className="lede">Load folder, pick farmhand, export one zip.</p>
        </div>
      </header>

      <main className="contentGrid">
        <section className="dropZone" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
          <div className="dropCopy">
            <p className="panelTitle">Folder upload</p>
            <p className="panelText">Drag full save folder here. Tool finds `SaveGameInfo` + main save by itself.</p>
          </div>
          <div className="dropActions">
            <div className="buttonRow">
              <button className="primaryButton" onClick={useNativeFolderPicker} disabled={busy}>
                Pick save folder
              </button>
              <button className="ghostButton" onClick={() => folderInputRef.current?.click()} disabled={busy}>
                Use folder input
              </button>
            </div>
            <div className="dropDivider">
              <span>{busy ? "working..." : "or drop folder here"}</span>
            </div>
          </div>
          <input
            ref={folderInputRef}
            className="hiddenInput"
            type="file"
            {...folderInputProps}
            multiple
            onChange={onFileInputChange}
          />
        </section>

        <section className="glassCard controlCard">
          <div className="cardHeader">
            <p className="panelTitle">Host control</p>
            <span className="resultChip">
              {state.kind === "result" ? "Zip ready" : state.kind === "loaded" ? "Ready" : "Waiting"}
            </span>
          </div>
          <div className="metaList">
            {state.kind !== "idle" ? (
              <>
                <div>
                  <span>Folder</span>
                  <strong>{state.bundle.folderName}</strong>
                </div>
                <div>
                  <span>Main save</span>
                  <strong>{state.bundle.mainSaveName}</strong>
                </div>
              </>
            ) : null}
          </div>
          {state.kind === "loaded" ? (
            <div className="hostSwapRow">
              <div className="selectLabel">
                Current Host
                <div className="hostBadge">{currentHostName || "No save loaded"}</div>
              </div>
              <div className="swapArrow" aria-hidden="true">
                →
              </div>
              <label className="selectLabel">
                New Host
                <select value={selectedHost} onChange={(event) => setSelectedHost(event.target.value)}>
                  <option value="">Select new host</option>
                  {state.preview.farmhands.map((farmhand) => (
                    <option key={farmhand.uniqueMultiplayerID} value={farmhand.name}>
                      {farmhand.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : (
            <div className="selectLabel">
              Current Host
              <div className="hostBadge">{currentHostName || "No save loaded"}</div>
            </div>
          )}
          {state.kind === "loaded" ? (
            <>
              <button className="primaryButton" onClick={runSwap} disabled={busy || !selectedHost}>
                Swap host
              </button>
            </>
          ) : (
            <p className="panelText">Load folder first.</p>
          )}
          <div className="previewBlock">
            <p className="panelTitle">Preview</p>
            {state.kind === "loaded" ? (
              <>
                <div className="previewGrid">
                  {renderFarmerPreview("Current host", "Will move to farmhand slot", state.preview.currentHost)}
                  {renderFarmerPreview("New host", "Will be promoted to host", selectedFarmhand)}
                </div>
                <div className="previewSummary">
                  <span>Available farmhands</span>
                  <strong>{state.preview.farmhands.length}</strong>
                  <small>{state.preview.farmhands.map((farmhand) => farmhand.name).join(", ") || "-"}</small>
                </div>
              </>
            ) : state.kind === "result" ? (
              <div className="previewGrid">
                {renderFarmerPreview("Host before swap", "Source host profile", state.result.oldHost)}
                {renderFarmerPreview("Host after swap", "Updated host profile", state.result.newHost)}
              </div>
            ) : (
              <p className="panelText">No preview yet.</p>
            )}
          </div>
          {state.kind === "result" ? (
            <div className="downloadRow">
              <button className="primaryButton" onClick={downloadOutput} disabled={busy}>Download zip</button>
              <div className="warningBox">
                {state.result.warnings.length ? state.result.warnings.join(" ") : "Ready."}
              </div>
            </div>
          ) : null}
        </section>

      </main>

      {error ? <div className="errorBar">{error}</div> : null}
    </div>
  );
}
