import type { SelectedFile } from './types';

type DataTransferItemWithEntry = DataTransferItem & {
    webkitGetAsEntry?: () => FileSystemEntry | null;
};

let nextFileId = 1;

const ARCHIVE_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function createId(): string {
    const id = `file-${nextFileId}`;
    nextFileId += 1;
    return id;
}

/**
 * Converts browser-provided paths to safe relative ZIP paths.
 *
 * Backslashes become separators, Unicode is normalized to NFC, and absolute,
 * traversal, control-character, and empty paths are rejected before archive creation.
 */
export function normalizeArchivePath(path: string): string {
    const normalized = path.normalize('NFC').replaceAll('\\', '/');
    const parts = normalized.split('/').filter((part) => part.length > 0 && part !== '.');

    if (
        ARCHIVE_CONTROL_CHARACTERS.test(normalized) ||
        normalized.startsWith('//') ||
        /^[A-Za-z]:/.test(normalized) ||
        parts.length === 0 ||
        parts.some((part) => part === '..')
    ) {
        throw new Error('A selected file has an unsafe archive path.');
    }

    return parts.join('/').normalize('NFC');
}

/** Creates the archive metadata associated with a browser File. */
export function selectedFileFromFile(file: File, explicitPath?: string): SelectedFile {
    const relativePath = explicitPath ?? file.webkitRelativePath ?? file.name;
    return {
        file,
        id: createId(),
        lastModified: file.lastModified,
        path: normalizeArchivePath(relativePath || file.name),
        size: file.size,
    };
}

/** Merges selections by normalized archive path; later entries replace earlier ones. */
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
    return [...byPath.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Converts a browser FileList into normalized archive selections. */
export function filesFromFileList(fileList: FileList): SelectedFile[] {
    return Array.from(fileList, (file) => selectedFileFromFile(file));
}

function getFile(entry: FileSystemFileEntry): Promise<File> {
    return new Promise((resolve, reject) => {
        entry.file(resolve, reject);
    });
}

function isFileEntry(entry: FileSystemEntry): entry is FileSystemFileEntry {
    return entry.isFile;
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

    if (isFileEntry(entry)) {
        const file = await getFile(entry);
        return [selectedFileFromFile(file, path)];
    }

    if (!entry.isDirectory) {
        return [];
    }

    const children = await readAllDirectoryEntries(entry as FileSystemDirectoryEntry);
    const nested = await Promise.all(children.map((child) => traverseEntry(child, path)));
    return nested.flat();
}

/** Reads files and recursively traverses supported dropped directories. */
export async function filesFromDataTransfer(dataTransfer: DataTransfer): Promise<SelectedFile[]> {
    const items = Array.from(dataTransfer.items) as DataTransferItemWithEntry[];
    const itemResults = items.map((item) => ({
        entry: item.webkitGetAsEntry?.() ?? null,
        file: item.getAsFile(),
    }));
    const entries = itemResults.map(({ entry }) => entry).filter((entry): entry is FileSystemEntry => entry !== null);

    if (entries.length > 0) {
        const nested = await Promise.all(entries.map((entry) => traverseEntry(entry, '')));
        const looseFiles = itemResults
            .filter(({ entry }) => entry === null)
            .flatMap(({ file }) => (file ? [selectedFileFromFile(file)] : []));
        return mergeSelectedFiles([], [...nested.flat(), ...looseFiles]);
    }

    if (items.some((item) => item.kind === 'file') && dataTransfer.files.length === 0) {
        throw new Error('This browser cannot read folders dropped here. Use Choose folder instead.');
    }
    return filesFromFileList(dataTransfer.files);
}

/** Returns the aggregate byte size used by archive progress reporting. */
export function getTotalSize(files: readonly SelectedFile[]): number {
    return files.reduce((sum, item) => sum + item.size, 0);
}

/** Formats a finite, non-negative byte count for the UI. */
export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) {
        throw new RangeError('Byte size must be a finite, non-negative number.');
    }

    if (bytes === 0) {
        return '0 B';
    }

    const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
    let unitIndex = Math.min(Math.max(Math.floor(Math.log(bytes) / Math.log(1024)), 0), units.length - 1);
    let value = bytes / 1024 ** unitIndex;
    const digits = unitIndex === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2;
    const rounded = Number(value.toFixed(digits));
    if (rounded >= 1024 && unitIndex < units.length - 1) {
        unitIndex += 1;
        value = bytes / 1024 ** unitIndex;
    }

    const finalDigits = unitIndex === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2;
    const display = Number(value.toFixed(finalDigits)).toString();
    return `${display} ${units[unitIndex]}`;
}
