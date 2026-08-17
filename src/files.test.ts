import { describe, expect, it } from 'bun:test';
import {
    filesFromDataTransfer,
    formatBytes,
    getTotalSize,
    mergeSelectedFiles,
    normalizeArchivePath,
} from '../src/files';
import type { SelectedFile } from '../src/types';

function selected(path: string, id: string): SelectedFile {
    const file = new File([`fixture contents for ${id}`], path.split('/').at(-1) ?? id);
    return {
        file,
        id,
        lastModified: file.lastModified,
        path,
        size: file.size,
    };
}

describe('archive paths', () => {
    it('should normalize separators while preserving safe relative directories', () => {
        expect(normalizeArchivePath('folder\\nested/./file.txt')).toBe('folder/nested/file.txt');
    });

    it('should reject parent traversal, drive-absolute paths, and NUL bytes', () => {
        expect(() => normalizeArchivePath('../secret.txt')).toThrow();
        expect(() => normalizeArchivePath('folder/../secret.txt')).toThrow();
        expect(() => normalizeArchivePath('C:/secret.txt')).toThrow();
        expect(() => normalizeArchivePath('folder/evil\0name.txt')).toThrow();
    });

    it('should normalize Unicode names to NFC and reject control characters and UNC paths', () => {
        expect(normalizeArchivePath('cafe\u0301.txt')).toBe('café.txt');
        expect(() => normalizeArchivePath('folder/line\nfeed.txt')).toThrow();
        expect(() => normalizeArchivePath('\\\\server\\share\\file.txt')).toThrow();
    });

    it('should reject empty and separator-only paths', () => {
        expect(() => normalizeArchivePath('')).toThrow();
        expect(() => normalizeArchivePath('///')).toThrow();
    });

    it('should only return safe relative paths for a deterministic fuzz matrix', () => {
        const samples = [
            'a.txt',
            'nested\\path/file.txt',
            './file.txt',
            '.../file.txt',
            '../file.txt',
            'nested/../../file.txt',
            '/leading/file.txt',
            '\\\\server\\share\\file.txt',
            'C:/absolute/file.txt',
            'a\u0001b.txt',
            'cafe\u0301.txt',
            'emoji-😀.txt',
            'a//b///c.txt',
            '.../..hidden/file.txt',
        ];

        for (const sample of samples) {
            try {
                const normalized = normalizeArchivePath(sample);
                expect(normalized.startsWith('/')).toBe(false);
                expect(normalized.split('/')).not.toContain('..');
                expect(normalized).not.toMatch(/[\u0000-\u001f\u007f]/);
            } catch {
                // Unsafe inputs are expected to be rejected.
            }
        }
    });

    it('should replace duplicate archive paths with the newest selection', () => {
        const first = selected('docs/readme.txt', 'first');
        const replacement = selected('docs/readme.txt', 'replacement');
        const other = selected('data/file.bin', 'other');

        const merged = mergeSelectedFiles([first], [replacement, other]);
        expect(merged).toHaveLength(2);
        expect(merged.find((item) => item.path === 'docs/readme.txt')?.id).toBe('replacement');
    });

    it('should sort archive paths deterministically and handle empty inputs', () => {
        const merged = mergeSelectedFiles(
            [selected('z.txt', 'z'), selected('Hello.txt', 'upper')],
            [selected('hello.txt', 'lower'), selected('a.txt', 'a')],
        );
        expect(merged.map((item) => item.path)).toEqual(['Hello.txt', 'a.txt', 'hello.txt', 'z.txt']);
        expect(mergeSelectedFiles([], [])).toEqual([]);
    });

    it('should total selected file sizes', () => {
        const files = [selected('a.txt', 'a'), selected('b.txt', 'bb')];
        expect(getTotalSize(files)).toBe(45);
    });
});

describe('formatBytes', () => {
    it.each([
        [0, '0 B'],
        [0.5, '1 B'],
        [1023, '1023 B'],
        [1024, '1 KB'],
        [1024 * 1024, '1 MB'],
        [1024 * 1024 * 1024, '1 GB'],
    ])('formats %s bytes as %s', (bytes, expected) => {
        expect(formatBytes(bytes)).toBe(expected);
    });

    it('promotes values that would round to the next unit', () => {
        expect(formatBytes(1023.6 * 1024)).toBe('1 MB');
    });

    it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
        'rejects invalid byte count %s',
        (bytes) => {
            expect(() => formatBytes(bytes)).toThrow(RangeError);
        },
    );
});

describe('filesFromDataTransfer', () => {
    function fileEntry(name: string, file: File): FileSystemFileEntry {
        return {
            file: (success: FileCallback) => success(file),
            filesystem: null,
            fullPath: `/${name}`,
            isDirectory: false,
            isFile: true,
            name,
        } as unknown as FileSystemFileEntry;
    }

    function directoryEntry(name: string, batches: FileSystemEntry[][]): FileSystemDirectoryEntry {
        return {
            createReader: () => {
                let index = 0;
                return {
                    readEntries: (success: (entries: FileSystemEntry[]) => void) => success(batches[index++] ?? []),
                } as FileSystemDirectoryReader;
            },
            filesystem: null,
            fullPath: `/${name}`,
            isDirectory: true,
            isFile: false,
            name,
        } as unknown as FileSystemDirectoryEntry;
    }

    function transfer(items: DataTransferItem[], files: File[] = []): DataTransfer {
        return { files, items } as unknown as DataTransfer;
    }

    it('reads entry-backed files and preserves mixed non-entry files', async () => {
        const nested = new File(['nested'], 'nested.txt');
        const loose = new File(['loose'], 'loose.txt');
        const entryItem = {
            getAsFile: () => nested,
            kind: 'file',
            type: 'text/plain',
            webkitGetAsEntry: () => fileEntry('nested.txt', nested),
        } as unknown as DataTransferItem;
        const looseItem = {
            getAsFile: () => loose,
            kind: 'file',
            type: 'text/plain',
            webkitGetAsEntry: () => null,
        } as unknown as DataTransferItem;

        const selected = await filesFromDataTransfer(transfer([entryItem, looseItem], [nested, loose]));
        expect(selected.map((item) => item.path)).toEqual(['loose.txt', 'nested.txt']);
    });

    it('walks nested directory entries until each reader is exhausted', async () => {
        const file = new File(['nested'], 'file.txt');
        const entry = directoryEntry('folder', [[fileEntry('file.txt', file)], []]);
        const item = {
            getAsFile: () => null,
            kind: 'file',
            type: '',
            webkitGetAsEntry: () => entry,
        } as unknown as DataTransferItem;

        const selected = await filesFromDataTransfer(transfer([item]));
        expect(selected.map((item) => item.path)).toEqual(['folder/file.txt']);
    });

    it('falls back to the FileList when no item exposes an entry', async () => {
        const file = new File(['fallback'], 'fallback.txt');
        const item = {
            getAsFile: () => file,
            kind: 'file',
            type: 'text/plain',
            webkitGetAsEntry: () => null,
        } as unknown as DataTransferItem;
        const selected = await filesFromDataTransfer(transfer([item], [file]));
        expect(selected).toHaveLength(1);
        expect(selected[0]?.path).toBe('fallback.txt');
    });

    it('explains unsupported folder drops when Firefox exposes no files', async () => {
        const item = {
            getAsFile: () => null,
            kind: 'file',
            type: '',
            webkitGetAsEntry: undefined,
        } as unknown as DataTransferItem;
        await expect(filesFromDataTransfer(transfer([item]))).rejects.toThrow(/Choose folder/);
    });

    it('ignores string-only drops instead of reporting a folder-read failure', async () => {
        const item = {
            getAsFile: () => null,
            kind: 'string',
            type: 'text/plain',
            webkitGetAsEntry: undefined,
        } as unknown as DataTransferItem;
        await expect(filesFromDataTransfer(transfer([item]))).resolves.toEqual([]);
    });
});
