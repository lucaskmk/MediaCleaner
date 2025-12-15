import { FileItem } from '../types';

/**
 * Iteratively scans a directory handle for images and videos using DFS (Depth-First Search).
 * DFS ensures we finish one sub-folder completely before moving to the next sibling.
 */
export async function scanDirectory(
  rootHandle: FileSystemDirectoryHandle,
  onProgress: (count: number) => void,
  signal?: AbortSignal,
  recursive: boolean = true
): Promise<FileItem[]> {
  const files: FileItem[] = [];
  
  // Stack for DFS: LIFO (Last In, First Out) behavior ensures deep traversal
  const stack: { handle: FileSystemDirectoryHandle; path: string }[] = [
    { handle: rootHandle, path: '' }
  ];

  while (stack.length > 0) {
    // Check if user cancelled
    if (signal?.aborted) {
      break;
    }

    // Pop from the end (Stack behavior for DFS)
    const { handle, path } = stack.pop()!;

    try {
      // Collect sub-directories to push to stack after files
      const subDirs: { handle: FileSystemDirectoryHandle; path: string }[] = [];

      for await (const entry of handle.values()) {
        if (signal?.aborted) break;

        const entryPath = path ? `${path}/${entry.name}` : entry.name;

        if (entry.kind === 'file') {
          try {
            const fileHandle = entry as FileSystemFileHandle;
            const file = await fileHandle.getFile();
            
            // Simple type check based on MIME
            const type = file.type.startsWith('image/')
              ? 'image'
              : file.type.startsWith('video/')
              ? 'video'
              : 'unknown';

            if (type !== 'unknown') {
              files.push({
                handle: fileHandle,
                file,
                path: entryPath,
                size: file.size,
                type,
              });
              
              // Notify UI periodically
              if (files.length % 5 === 0) {
                onProgress(files.length);
              }
            }
          } catch (err) {
            console.warn(`Skipping file ${entry.name}:`, err);
          }
        } else if (entry.kind === 'directory') {
          if (recursive) {
            subDirs.push({
              handle: entry as FileSystemDirectoryHandle,
              path: entryPath,
            });
          }
        }
      }

      // Add subdirectories to stack. 
      // We reverse them so the first one found is popped first (preserving some order), 
      // but essentially this ensures we go deep into these folders in the next iterations.
      for (const dir of subDirs.reverse()) {
        stack.push(dir);
      }

    } catch (err) {
      console.warn(`Could not access folder ${path}:`, err);
    }
  }

  // Final update
  onProgress(files.length);
  return files;
}

/**
 * Formats bytes into human readable string
 */
export function formatBytes(bytes: number, decimals = 2) {
  if (!+bytes) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

/**
 * Copies a file from source handle to a destination directory handle.
 */
export async function copyFileToDirectory(
  fileHandle: FileSystemFileHandle,
  destDirHandle: FileSystemDirectoryHandle
) {
  const file = await fileHandle.getFile();
  const newFileHandle = await destDirHandle.getFileHandle(file.name, { create: true });

  // Prefer streaming copy when available to avoid buffering entire file in memory
  try {
    const readable = file.stream?.();
    if (readable && typeof readable.pipeTo === 'function') {
      const writable = await newFileHandle.createWritable();
      // `createWritable()` returns a writable stream-like object; pipe the readable directly
      await (readable as ReadableStream).pipeTo(writable as unknown as WritableStream);
      return;
    }
  } catch (err) {
    // Fall back to simple write below
    console.warn('Streaming copy failed, falling back to buffered copy', err);
  }

  // Fallback: read entire file and write in one go
  const writable = await newFileHandle.createWritable();
  await writable.write(file);
  await writable.close();
}

/**
 * Deletes a file.
 */
export async function deleteFile(fileHandle: FileSystemFileHandle) {
  // @ts-ignore 
  if (fileHandle.remove) {
     // @ts-ignore
    await fileHandle.remove();
  } else {
    console.warn("Direct delete not supported or permission denied.");
  }
}