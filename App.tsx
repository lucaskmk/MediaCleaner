import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { scanDirectory, formatBytes, copyFileToDirectory, deleteFile } from './services/fs-helpers';
import { FileItem, SwipeAction } from './types';
import { MediaViewer } from './components/MediaViewer';
import { Folder, Trash2, Save, ArrowRight, CheckCircle2, AlertTriangle, AlertCircle, Download, MonitorDown, StopCircle, Play, Layers, Search, FolderTree, Copy, X, RotateCcw, Upload, FileJson, RefreshCw, Info } from 'lucide-react';

enum AppState {
  IDLE = 'IDLE',
  SCANNING = 'SCANNING',
  SORTING = 'SORTING',
  REVIEW = 'REVIEW',
  FINISHED = 'FINISHED'
}

// -- WINDOW FRAME COMPONENT --
const WindowFrame: React.FC<{ 
  children: React.ReactNode; 
  title?: string;
  onSave?: () => void;
}> = ({ children, title = "Media Cleaner", onSave }) => {
  return (
    <div className="fixed inset-0 w-full h-full bg-slate-900 text-slate-200 select-none cursor-default font-sans overflow-hidden flex flex-col">
      {/* Native-like Title Bar */}
      <div className="h-9 bg-slate-950 flex items-center justify-between px-3 border-b border-white/5 shrink-0 draggable-region">
        <div className="flex items-center gap-2">
           <span className="text-xs text-slate-400 font-medium tracking-wide opacity-70">{title}</span>
        </div>
        <div className="flex items-center gap-3">
          {onSave && (
            <button 
              onClick={onSave}
              className="flex items-center gap-1.5 text-[10px] font-bold bg-indigo-600 hover:bg-indigo-500 text-white px-2 py-0.5 rounded transition-colors"
              title="Save progress to a file to resume later"
            >
              <Download className="w-3 h-3" />
              SAVE PROGRESS
            </button>
          )}
          <div className="text-[10px] text-slate-600 font-mono">v1.8</div>
        </div>
      </div>

      {/* App Body */}
      <div className="flex-1 overflow-hidden relative bg-slate-900">
        {children}
      </div>
    </div>
  );
};

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [sourceHandle, setSourceHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [destHandle, setDestHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [fileQueue, setFileQueue] = useState<FileItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  
  // Undo / History State
  const [pendingDelete, setPendingDelete] = useState<FileItem | null>(null);
  const [historyStack, setHistoryStack] = useState<number[]>([]);

  // Resume / Ignored State
  const [ignoredPaths, setIgnoredPaths] = useState<Set<string>>(new Set());
  const [resumeMode, setResumeMode] = useState(false);
  const [resumeFolderName, setResumeFolderName] = useState<string | null>(null);

  // Settings
  const [scanRecursive, setScanRecursive] = useState(true);

  // Scanning State
  const [scannedCount, setScannedCount] = useState(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  
  // Stats
  const [originalTotalBytes, setOriginalTotalBytes] = useState(0);
  const [bytesDeleted, setBytesDeleted] = useState(0);
  const [filesDeleted, setFilesDeleted] = useState(0);
  const [filesKept, setFilesKept] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  // PWA Install Prompt
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  // Browser Support Check
  const isSupported = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

  useEffect(() => {
    const handler = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  };

  const currentFile = fileQueue[currentIndex];
  const progress = useMemo(() => {
    if (fileQueue.length === 0) return 0;
    return ((currentIndex) / fileQueue.length) * 100;
  }, [currentIndex, fileQueue.length]);

  // -- SAVE PROGRESS FEATURE --
  const handleSaveProgress = () => {
    if (!sourceHandle) return;

    // We need to save:
    // 1. Everything that was already in ignoredPaths (from previous sessions)
    // 2. Everything processed in THIS session (up to currentIndex)
    const processedInSession = fileQueue.slice(0, currentIndex).map(f => f.path);
    const allProcessed = [...Array.from(ignoredPaths), ...processedInSession];

    const data = {
      folderName: sourceHandle.name,
      timestamp: new Date().toISOString(),
      processedCount: allProcessed.length,
      processedPaths: allProcessed
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `progress-${sourceHandle.name.replace(/\s+/g, '_')}-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // -- LOAD PROGRESS FEATURE --
  const handleLoadProgress = async () => {
    setErrorMsg(null);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e: any) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const text = await file.text();
        const data = JSON.parse(text);

        if (!data.processedPaths || !Array.isArray(data.processedPaths)) {
          throw new Error("Invalid progress file format.");
        }

        setIgnoredPaths(new Set(data.processedPaths));
        setResumeFolderName(data.folderName || "Unknown Folder");
        setResumeMode(true);
        
        // IMPORTANT: We do NOT auto-call handleSelectSource() here.
        // Browsers block file pickers that aren't directly triggered by a user click.
        // Instead, we update the UI to show a big "RESUME [FOLDER]" button.
      } catch (err) {
        console.error(err);
        setErrorMsg("Failed to load progress file.");
      }
    };
    input.click();
  };

  const handleSelectSource = async () => {
    try {
      setErrorMsg(null);
      setScannedCount(0);
      setHistoryStack([]);
      setPendingDelete(null);
      // NOTE: We do NOT clear ignoredPaths if resumeMode is true
      if (!resumeMode) {
        setIgnoredPaths(new Set());
        setResumeFolderName(null);
      }
      
      // @ts-ignore
      if (!window.showDirectoryPicker) {
        throw new Error("Your browser does not support local file access. Please use Chrome, Edge, or Opera on Desktop.");
      }

      // @ts-ignore
      const handle = await window.showDirectoryPicker({
        id: 'source-folder',
        mode: 'readwrite',
      });
      
      // Warning if resuming wrong folder
      if (resumeMode && resumeFolderName && handle.name !== resumeFolderName) {
        const confirm = window.confirm(`Warning: You loaded progress for "${resumeFolderName}" but selected "${handle.name}". Continue anyway?`);
        if (!confirm) {
          setAppState(AppState.IDLE);
          return;
        }
      }
      
      // Permission check
      // @ts-ignore
      if ((await handle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
         // @ts-ignore
         if ((await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') {
            throw new Error("Permission denied. We need 'Read & Write' access to delete files.");
         }
      }

      setSourceHandle(handle);
      setAppState(AppState.SCANNING);
      
      // Init AbortController for cancellation
      abortControllerRef.current = new AbortController();

      // Scan with progress
      const files = await scanDirectory(
        handle, 
        (count) => setScannedCount(count), 
        abortControllerRef.current.signal,
        scanRecursive
      );
      
      handleScanComplete(files);

    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.error(err);
      
      let msg = "Failed to access folder.";
      if (err.name === 'SecurityError') msg = "Security Error: Select a user folder (Downloads, Pictures), not a system folder.";
      else if (err.message) msg = err.message;
      
      setErrorMsg(msg);
      // Do not reset resume mode here, allow retry
      setAppState(AppState.IDLE);
    }
  };

  const stopScanningAndStart = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const handleScanComplete = (files: FileItem[]) => {
    if (files.length === 0) {
      setErrorMsg(scanRecursive ? "No supported media files found." : "No supported media files found in the root folder.");
      setAppState(AppState.IDLE);
      return;
    }

    setAppState(AppState.SORTING);
    
    // FILTER OUT ALREADY PROCESSED FILES
    let queue = files;
    if (ignoredPaths.size > 0) {
      queue = files.filter(f => !ignoredPaths.has(f.path));
    }

    if (queue.length === 0) {
      setErrorMsg("All files in this folder have already been processed!");
      setAppState(AppState.FINISHED);
      return;
    }

    // Sort: Heaviest first
    const sorted = queue.sort((a, b) => b.size - a.size);
    
    setFileQueue(sorted);
    setOriginalTotalBytes(sorted.reduce((acc, curr) => acc + curr.size, 0));
    setAppState(AppState.REVIEW);
  };

  const handleSelectDest = async () => {
    try {
      // @ts-ignore
      const handle = await window.showDirectoryPicker({ id: 'dest-folder', mode: 'readwrite' });
      // @ts-ignore
      await handle.requestPermission({ mode: 'readwrite' });
      setDestHandle(handle);
    } catch (err: any) {
       console.log("Dest selection cancelled");
    }
  };

  const executePendingDelete = async () => {
    if (pendingDelete) {
      try {
        await deleteFile(pendingDelete.handle);
        setBytesDeleted(prev => prev + pendingDelete.size);
        setFilesDeleted(prev => prev + 1);
      } catch (err) {
        console.error("Failed to execute pending delete", err);
      }
      setPendingDelete(null);
    }
  };

  const processAction = useCallback(async (action: SwipeAction) => {
    if (!currentFile) return;

    // 1. Flush any pending deletes from PREVIOUS steps
    await executePendingDelete();

    try {
      let isDeleteAction = false;

      if (action === SwipeAction.DELETE) {
        // LEFT ACTION
        if (destHandle) {
           // DESTINATION MODE: SKIP (Do nothing)
        } else {
           // SINGLE FOLDER MODE: DELETE
           isDeleteAction = true;
           // We do NOT delete immediately. We set it as pending.
           setPendingDelete(currentFile);
        }
      } else {
        // RIGHT ACTION
        if (destHandle) {
          // DESTINATION MODE: COPY
          await copyFileToDirectory(currentFile.handle, destHandle);
          setFilesKept(prev => prev + 1);
        } else {
           // SINGLE FOLDER MODE: KEEP
           setFilesKept(prev => prev + 1);
        }
      }

      // 2. Advance Queue
      setHistoryStack(prev => [...prev, currentIndex]);

      if (currentIndex + 1 >= fileQueue.length) {
        // If this was the last file, we need to flush the delete we just queued (if any)
        // because we are moving to FINISHED state immediately.
        if (isDeleteAction) {
           await deleteFile(currentFile.handle);
           setBytesDeleted(prev => prev + currentFile.size);
           setFilesDeleted(prev => prev + 1);
           setPendingDelete(null);
        }
        setAppState(AppState.FINISHED);
      } else {
        setCurrentIndex(prev => prev + 1);
      }
    } catch (err) {
      console.error("Action failed", err);
      if (currentIndex + 1 >= fileQueue.length) {
         setAppState(AppState.FINISHED);
      } else {
         setCurrentIndex(prev => prev + 1);
         setErrorMsg("File locked or removed externally. Skipped.");
         setTimeout(() => setErrorMsg(null), 2000);
      }
    }
  }, [currentFile, destHandle, currentIndex, fileQueue.length, pendingDelete]);

  const handleUndo = useCallback(() => {
    if (historyStack.length === 0) return;

    const prevIndex = historyStack[historyStack.length - 1];
    const prevFile = fileQueue[prevIndex];

    // If the previous file was marked for deletion (pending), we simply clear the pending flag.
    // It was never deleted, so "Undoing" is instant and 100% safe.
    if (pendingDelete && pendingDelete.path === prevFile.path) {
      setPendingDelete(null);
    }

    // Move index back
    setCurrentIndex(prevIndex);
    
    // Remove from history
    setHistoryStack(prev => prev.slice(0, -1));

  }, [historyStack, fileQueue, pendingDelete]);

  // -- RENDER STATES --

  if (appState === AppState.IDLE) {
    return (
      <WindowFrame>
        <div className="h-full flex flex-col items-center justify-center p-6 text-slate-100 bg-gradient-to-br from-slate-900 to-slate-800">
          
          <div className="max-w-2xl w-full flex flex-col gap-6">
            <div className="text-center space-y-2">
              <h1 className="text-4xl font-bold text-white tracking-tight">
                Media Cleaner
              </h1>
              <p className="text-slate-400 text-sm">
                Native Media Organizer
              </p>
            </div>

            {!isSupported && (
              <div className="mx-auto max-w-md w-full p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-start gap-3 text-left">
                <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-amber-400 font-bold text-sm">Browser Not Supported</h3>
                  <p className="text-amber-200/60 text-xs mt-1 leading-relaxed">
                    This browser (Firefox/Safari) doesn't support the <b>File System Access API</b> required to manage your local files.
                  </p>
                  <p className="text-amber-200 text-xs mt-2 font-medium">
                    Please use <u>Google Chrome</u>, <u>Edge</u>, or <u>Opera</u>.
                  </p>
                </div>
              </div>
            )}

            {deferredPrompt && (
                <button 
                  onClick={handleInstallClick}
                  className="mx-auto w-fit px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded-full text-white text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg transition-all"
                >
                  <MonitorDown className="w-4 h-4" />
                  Install App
                </button>
            )}

            {/* MAIN CARD */}
            <div className={`bg-slate-800/80 p-6 rounded-2xl border border-white/5 shadow-2xl grid md:grid-cols-2 gap-6 ${!isSupported ? 'opacity-50 pointer-events-none grayscale' : ''}`}>
              
              {/* LEFT COLUMN: SOURCE & SETTINGS */}
              <div className="space-y-4">
                 
                 {/* NORMAL MODE */}
                 {!resumeMode ? (
                   <>
                    <div className="flex items-center gap-2 text-indigo-400 uppercase text-xs font-bold tracking-wider mb-2">
                        <Search className="w-4 h-4" /> Step 1: Scan
                    </div>
                    {/* RECURSIVE TOGGLE */}
                    <div 
                      onClick={() => setScanRecursive(!scanRecursive)}
                      className={`cursor-pointer p-4 rounded-xl border transition-all flex items-center gap-4 ${
                        scanRecursive 
                          ? 'bg-indigo-600/20 border-indigo-500/50 hover:bg-indigo-600/30' 
                          : 'bg-slate-700/30 border-slate-600 hover:bg-slate-700/50'
                      }`}
                    >
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                          scanRecursive ? 'bg-indigo-500 text-white' : 'bg-slate-600 text-slate-400'
                        }`}>
                          <FolderTree className="w-5 h-5" />
                        </div>
                        <div className="flex-1">
                          <div className={`font-medium text-sm ${scanRecursive ? 'text-white' : 'text-slate-400'}`}>
                            {scanRecursive ? 'Subfolders Included' : 'Root Folder Only'}
                          </div>
                          <div className="text-xs text-slate-500">
                            {scanRecursive ? 'Deep scan (Slower)' : 'Shallow scan (Faster)'}
                          </div>
                        </div>
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                          scanRecursive ? 'border-indigo-400' : 'border-slate-500'
                        }`}>
                          {scanRecursive && <div className="w-2.5 h-2.5 rounded-full bg-indigo-400" />}
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <button
                          onClick={handleSelectSource}
                          className="flex flex-col items-center justify-center gap-2 py-6 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 rounded-xl transition-all text-white shadow-lg shadow-indigo-900/50 group"
                        >
                          <Folder className="w-8 h-8 group-hover:scale-110 transition-transform" />
                          <span className="font-bold text-sm">Start New</span>
                      </button>

                      <button
                          onClick={handleLoadProgress}
                          className="flex flex-col items-center justify-center gap-2 py-6 bg-slate-700 hover:bg-slate-600 active:bg-slate-800 rounded-xl transition-all text-white shadow-lg border border-slate-600 group"
                        >
                          <Upload className="w-8 h-8 group-hover:scale-110 transition-transform text-emerald-400" />
                          <div className="flex flex-col items-center">
                            <span className="font-bold text-sm">Resume</span>
                            <span className="text-[10px] text-slate-400">Load .json file</span>
                          </div>
                      </button>
                    </div>
                   </>
                 ) : (
                    /* RESUME MODE ACTIVE UI */
                   <div className="flex flex-col h-full animate-in fade-in zoom-in duration-300">
                      <div className="flex items-center gap-2 text-emerald-400 uppercase text-xs font-bold tracking-wider mb-2">
                          <FileJson className="w-4 h-4" /> Ready to Resume
                      </div>
                      
                      <div className="flex-1 bg-emerald-900/20 border border-emerald-500/30 rounded-xl p-4 flex flex-col items-center justify-center text-center gap-4">
                          <div className="w-12 h-12 bg-emerald-500/20 rounded-full flex items-center justify-center text-emerald-400">
                            <RefreshCw className="w-6 h-6 animate-spin-slow" />
                          </div>
                          <div>
                            <div className="text-xs text-emerald-200/60 uppercase font-bold">Target Folder</div>
                            <div className="text-lg font-bold text-emerald-100 break-all">{resumeFolderName}</div>
                            <div className="text-xs text-emerald-200/60 mt-1">{ignoredPaths.size} files processed previously</div>
                          </div>

                          <button 
                            onClick={handleSelectSource}
                            className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-bold rounded-lg shadow-lg shadow-emerald-900/50 transition-all hover:scale-105"
                          >
                            Open Folder & Continue
                          </button>
                          
                          <button 
                             onClick={() => { setResumeMode(false); setIgnoredPaths(new Set()); setResumeFolderName(null); }}
                             className="text-xs text-slate-400 hover:text-white underline"
                          >
                            Cancel / Start Over
                          </button>
                      </div>
                   </div>
                 )}
              </div>

              {/* RIGHT COLUMN: DESTINATION */}
              <div className="space-y-4 flex flex-col">
                 <div className="flex items-center gap-2 text-emerald-400 uppercase text-xs font-bold tracking-wider mb-2">
                    <Save className="w-4 h-4" /> Step 2: Keep (Optional)
                 </div>
                 
                 <div className="flex-1 bg-slate-900/50 rounded-xl border border-white/5 p-4 flex flex-col items-center justify-center text-center gap-3">
                    <p className="text-xs text-slate-400">
                      Where should kept files go?
                      <br/>
                      <span className="opacity-50">(If skipped, files stay in place)</span>
                    </p>
                    <button
                      onClick={handleSelectDest}
                      className={`w-full py-3 px-4 rounded-lg border transition-all text-sm font-medium flex items-center justify-center gap-2 ${
                        destHandle 
                        ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                        : "bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300"
                      }`}
                    >
                      {destHandle ? (
                        <>
                          <CheckCircle2 className="w-4 h-4" />
                          {destHandle.name}
                        </>
                      ) : (
                        <>
                          <ArrowRight className="w-4 h-4" />
                          Select Destination
                        </>
                      )}
                    </button>
                 </div>
              </div>

            </div>

            {errorMsg && (
              <div className="p-4 bg-red-500/20 border border-red-500/20 rounded-xl text-red-200 text-sm text-center flex items-center justify-center gap-2">
                <AlertCircle className="w-4 h-4" /> {errorMsg}
              </div>
            )}
            
            <div className="text-center text-[10px] text-slate-600 flex flex-col gap-1.5 mt-2">
               <p>Files are processed locally. No data leaves your device.</p>
               <p className="opacity-40 hover:opacity-100 transition-opacity">Made by Lucas Kamikawa</p>
               {isSupported && (
                 <div className="flex justify-center mt-1">
                   <span className="bg-slate-800 text-slate-500 px-3 py-1 rounded-full border border-slate-700/50 flex items-center gap-1.5">
                     <Info className="w-3 h-3" />
                     Recommended: Google Chrome or Microsoft Edge
                   </span>
                 </div>
               )}
            </div>

          </div>
        </div>
      </WindowFrame>
    );
  }

  if (appState === AppState.SCANNING) {
    return (
      <WindowFrame>
        <div className="h-full flex flex-col items-center justify-center bg-slate-900 text-white space-y-8">
          
          {/* Progress Ring */}
          <div className="relative">
             <div className="w-40 h-40 rounded-full border-4 border-slate-800 flex items-center justify-center">
                <div className="w-32 h-32 rounded-full bg-indigo-500/10 animate-pulse flex flex-col items-center justify-center">
                  <span className="text-3xl font-bold font-mono text-indigo-400">{scannedCount}</span>
                  <span className="text-xs text-indigo-300/50 uppercase tracking-widest mt-1">Files</span>
                </div>
             </div>
             <div className="absolute inset-0 rounded-full border-t-4 border-indigo-500 animate-spin"></div>
          </div>

          <div className="text-center space-y-2 max-w-sm px-4">
            <h2 className="text-xl font-medium">Scanning Folder...</h2>
            {resumeMode && (
              <div className="flex items-center justify-center gap-2 text-emerald-400 text-sm bg-emerald-500/10 py-1 px-3 rounded-full mb-2">
                <FileJson className="w-3 h-3" />
                <span>Resuming: Skipping {ignoredPaths.size} known files</span>
              </div>
            )}
            <div className="flex items-center justify-center gap-2 text-slate-400 text-sm bg-slate-800/50 py-1 px-3 rounded-full">
              {scanRecursive ? <FolderTree className="w-3 h-3" /> : <Folder className="w-3 h-3" />}
              <span>{scanRecursive ? "Deep Scan (Folder by Folder)" : "Root Only"}</span>
            </div>
            <p className="text-slate-500 text-xs mt-2">
              Note: Larger folders may take a moment to traverse.
            </p>
          </div>

          {/* STOP BUTTON */}
          <button 
            onClick={stopScanningAndStart}
            className={`flex items-center gap-2 px-8 py-3 rounded-full font-bold transition-all hover:scale-105 active:scale-95 ${
              scannedCount > 0 
                ? "bg-white text-slate-900 hover:bg-slate-200 shadow-xl shadow-white/10 cursor-pointer" 
                : "bg-slate-800 text-slate-500 cursor-not-allowed opacity-50"
            }`}
            disabled={scannedCount === 0}
          >
            {scannedCount > 0 ? <Play className="w-4 h-4 fill-current" /> : <StopCircle className="w-4 h-4" />}
            {scannedCount > 0 ? "Start Reviewing Now" : "Initializing..."}
          </button>

        </div>
      </WindowFrame>
    );
  }

  if (appState === AppState.SORTING) {
    return (
       <WindowFrame>
         <div className="h-full flex flex-col items-center justify-center bg-slate-900 text-white">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mb-4"></div>
            <p className="text-slate-400">Sorting heaviest files first...</p>
         </div>
       </WindowFrame>
    );
  }

  if (appState === AppState.FINISHED) {
    return (
      <WindowFrame>
        <div className="h-full flex flex-col items-center justify-center p-6 bg-slate-900">
          <div className="max-w-md w-full text-center space-y-6">
            <div className="w-16 h-16 bg-emerald-500 rounded-full flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/20">
              <CheckCircle2 className="w-8 h-8 text-white" />
            </div>
            
            <div>
              <h2 className="text-2xl font-bold text-white">All Done</h2>
              <p className="text-slate-500 text-sm mt-1">Directory clean.</p>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-slate-800 rounded-lg border border-white/5">
                <p className="text-slate-500 text-[10px] uppercase font-bold tracking-wider mb-1">Copied/Kept</p>
                <p className="text-2xl font-mono text-white">{filesKept}</p>
              </div>
              <div className="p-4 bg-slate-800 rounded-lg border border-white/5">
                <p className="text-slate-500 text-[10px] uppercase font-bold tracking-wider mb-1">Deleted</p>
                <p className="text-2xl font-mono text-white">{filesDeleted}</p>
              </div>
            </div>

            <button 
              onClick={() => window.location.reload()}
              className="px-8 py-3 bg-white/10 hover:bg-white/20 text-white rounded-lg text-sm font-medium transition-colors"
            >
              Start New Scan
            </button>
          </div>
        </div>
      </WindowFrame>
    );
  }

  // REVIEW STATE
  return (
    <WindowFrame 
      title={`Cleaning: ${sourceHandle?.name} (${currentIndex + 1}/${fileQueue.length})`}
      onSave={handleSaveProgress}
    >
      <div className="flex flex-col h-full bg-slate-900">
        
        {/* Progress Bar */}
        <div className="h-1 w-full bg-slate-800 relative">
          <div 
            className="h-full bg-indigo-500 transition-all duration-300 ease-out"
            style={{ width: `${progress}%` }}
          />
          {/* Pending Delete Indicator on Progress Bar */}
          {pendingDelete && (
             <div className="absolute top-0 right-0 h-full w-4 bg-red-500 animate-pulse" title="Pending Deletion"></div>
          )}
        </div>

        {/* Main Viewport */}
        <div className="flex-1 relative flex items-center justify-center p-6 overflow-hidden bg-black/40">
          {currentFile && (
            <div className="relative w-full h-full flex flex-col items-center justify-center">
               <MediaViewer item={currentFile} className="bg-transparent shadow-none" />
            </div>
          )}
           {errorMsg && (
              <div className="absolute bottom-20 bg-red-500 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 text-sm z-50 animate-bounce">
                <AlertTriangle className="w-4 h-4" />
                {errorMsg}
              </div>
            )}
        </div>

        {/* Control Bar */}
        <div className="h-20 bg-slate-950 border-t border-white/5 flex items-center justify-center gap-6 px-4">
          
          {/* RED BUTTON (Left) */}
          <button
            onClick={() => processAction(SwipeAction.DELETE)}
            className={`flex-1 max-w-[160px] h-12 flex items-center justify-center gap-2 rounded-lg transition-all group border ${
              destHandle 
              ? "bg-slate-700/50 hover:bg-slate-600 border-slate-600 text-slate-300 hover:text-white" // SKIP STYLE
              : "bg-red-500/10 hover:bg-red-500 border-red-500/20 hover:border-red-500 text-red-500 hover:text-white" // DELETE STYLE
            }`}
          >
            {destHandle ? <X className="w-4 h-4" /> : <Trash2 className="w-4 h-4" />}
            <span className="text-sm font-bold tracking-wide">
              {destHandle ? "SKIP" : "DELETE"}
            </span>
          </button>

          {/* UNDO BUTTON (Center) */}
          <button 
             onClick={handleUndo}
             disabled={historyStack.length === 0}
             className={`w-12 h-12 rounded-full flex items-center justify-center border transition-all ${
               historyStack.length === 0
               ? "border-slate-800 text-slate-800 cursor-not-allowed bg-slate-900"
               : "border-indigo-500/50 text-indigo-400 hover:bg-indigo-500 hover:text-white cursor-pointer hover:scale-110"
             }`}
             title="Undo last action"
          >
             <RotateCcw className="w-5 h-5" />
          </button>

          {/* GREEN BUTTON (Right) */}
          <button
            onClick={() => processAction(SwipeAction.KEEP)}
            className="flex-1 max-w-[160px] h-12 flex items-center justify-center gap-2 rounded-lg bg-emerald-500/10 hover:bg-emerald-500 text-emerald-500 hover:text-white border border-emerald-500/20 hover:border-emerald-500 transition-all group"
          >
            {destHandle ? <Copy className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            <span className="text-sm font-bold tracking-wide">{destHandle ? "COPY" : "KEEP"}</span>
          </button>

        </div>
      </div>
    </WindowFrame>
  );
};

export default App;