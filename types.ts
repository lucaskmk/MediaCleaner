export interface FileItem {
  handle: FileSystemFileHandle;
  file: File;
  path: string;
  size: number;
  type: 'image' | 'video' | 'unknown';
}

export interface FolderStats {
  totalSize: number;
  totalFiles: number;
}

export enum SwipeAction {
  KEEP = 'KEEP',
  DELETE = 'DELETE'
}
