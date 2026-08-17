import type { SelectedFile } from './types';

type DataTransferItemWithEntry = DataTransferItem & {
    webkitGetAsEntry?: () => FileSystemEntry | null;
};

let nextFileId = 1;

function createId(): string {
    const id = `file-${nextFileId}`;
    nextFileId += 1;
    return id;
}

export function normalizeArchivePath(path: string): string {
    const normalized = path.replaceAll('\\', '/').replace(/^\/+/, '');
    const parts = normalized.split('/').filter((part) => part.length > 0 && part !== '.');

    if (
        normalized.includes('\0') ||
        /^[A-Za-z]:\//.test(normalized) ||
        parts.length === 0 ||
        parts.some((part) => part === '..')
    ) {
        throw new Error('A selected file has an unsafe archive path.');
    }

    return parts.join('/');
}

export function selectedFileFromFile(file: File, explicitPath?: string): SelectedFile {
    const relativePath = explicitPath ?? file.webkitRelativePath ?? file.name;
    return {
        id: createId(),
        file,
        path: normalizeArchivePath(relativePath || file.name),
        size: file.size,
        lastModified: file.lastModified,
    };
}

export function mergeSelectedFiles(
    current: readonly SelectedFile[],
    incoming: readonly SelectedFile[],
): SelectedFile[] {
    const byPath = new Map<string, SelectedFile>();
    for (const item of current) {
        byPath.set(item.path, item);
    }
    for (const item of incoming) {
        byPath.set(item.path, item);
    }
    return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export function filesFromFileList(fileList: FileList): SelectedFile[] {
    return Array.from(fileList, (file) => selectedFileFromFile(file));
}

function getFile(entry: FileSystemFileEntry): Promise<File> {
    return new Promise((resolve, reject) => {
        entry.file(resolve, reject);
    });
}

function readDirectoryBatch(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
    return new Promise((resolve, reject) => {
        reader.readEntries(resolve, reject);
    });
}

async function readAllDirectoryEntries(directory: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
    const reader = directory.createReader();
    const entries: FileSystemEntry[] = [];

    for (;;) {
        const batch = await readDirectoryBatch(reader);
        if (batch.length === 0) {
            return entries;
        }
        entries.push(...batch);
    }
}

async function traverseEntry(entry: FileSystemEntry, parentPath: string): Promise<SelectedFile[]> {
    const path = parentPath ? `${parentPath}/${entry.name}` : entry.name;

    if (entry.isFile) {
        const file = await getFile(entry as FileSystemFileEntry);
        return [selectedFileFromFile(file, path)];
    }

    if (!entry.isDirectory) {
        return [];
    }

    const children = await readAllDirectoryEntries(entry as FileSystemDirectoryEntry);
    const nested = await Promise.all(children.map((child) => traverseEntry(child, path)));
    return nested.flat();
}

export async function filesFromDataTransfer(dataTransfer: DataTransfer): Promise<SelectedFile[]> {
    const items = Array.from(dataTransfer.items) as DataTransferItemWithEntry[];
    const entries = items
        .map((item) => item.webkitGetAsEntry?.() ?? null)
        .filter((entry): entry is FileSystemEntry => entry !== null);

    if (entries.length > 0) {
        const nested = await Promise.all(entries.map((entry) => traverseEntry(entry, '')));
        return mergeSelectedFiles([], nested.flat());
    }

    return filesFromFileList(dataTransfer.files);
}

export function getTotalSize(files: readonly SelectedFile[]): number {
    return files.reduce((sum, item) => sum + item.size, 0);
}

export function formatBytes(bytes: number): string {
    if (bytes === 0) {
        return '0 B';
    }

    const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
    const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / 1024 ** unitIndex;
    const digits = unitIndex === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2;
    return `${value.toFixed(digits)} ${units[unitIndex]}`;
}
