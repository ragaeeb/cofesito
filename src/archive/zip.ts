import { BlobReader, BlobWriter, configure, TextReader, ZipWriter } from '@zip.js/zip.js/lib/zip-core-native.js';
import type { SelectedFile, ZipProgress } from './types';

export const AES_256_STRENGTH = 3 as const;
export const ZIP_COMPRESSION_LEVEL = 6 as const;
export const ZIP_COMPRESSION_STREAM_ENABLED = true as const;
export const ZIP_CRYPTO_ENABLED = false as const;
export const ZIP_WORKERS_ENABLED = false as const;
export const WINZIP_AES_VERSION = 2 as const;

let isConfigured = false;

function configureZipRuntime(): void {
    if (isConfigured) {
        return;
    }
    configure({
        useCompressionStream: ZIP_COMPRESSION_STREAM_ENABLED,
        useWebWorkers: ZIP_WORKERS_ENABLED,
    });
    isConfigured = true;
}

export type CreateEncryptedZipOptions = {
    readonly files: readonly SelectedFile[];
    readonly password: string;
    readonly signal?: AbortSignal;
    readonly onProgress?: (progress: ZipProgress) => void;
};

function assertNotAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
        throw new DOMException('Archive creation cancelled.', 'AbortError');
    }
}

/**
 * Creates a WinZip AES-256 AE-2 archive entirely in memory.
 *
 * Files are read sequentially, and `onProgress` reports aggregate bytes after
 * each zip.js callback and after each completed entry. Passing an AbortSignal
 * cancels before the next entry and during active reads.
 */
export async function createEncryptedZip({
    files,
    password,
    signal,
    onProgress,
}: CreateEncryptedZipOptions): Promise<Blob> {
    configureZipRuntime();
    if (files.length === 0) {
        throw new Error('Select at least one file before creating an archive.');
    }
    if (password.length === 0) {
        throw new Error('A non-empty password is required for AES-256 encryption.');
    }

    assertNotAborted(signal);

    const totalBytes = files.reduce((sum, item) => sum + item.size, 0);
    let completedBytes = 0;
    const writer = new BlobWriter('application/zip');
    const entryOptions = {
        encryptionStrength: AES_256_STRENGTH,
        level: ZIP_COMPRESSION_LEVEL,
        useCompressionStream: ZIP_COMPRESSION_STREAM_ENABLED,
        useWebWorkers: ZIP_WORKERS_ENABLED,
        zipCrypto: ZIP_CRYPTO_ENABLED,
    } as const;
    const zipWriter = new ZipWriter(writer, {
        password,
        ...entryOptions,
    });
    let closeAttempted = false;

    let lastProgressKey = '';
    const emitProgress = (progress: ZipProgress, force = false): void => {
        const key = `${progress.processedBytes}:${progress.currentFile}:${progress.fileIndex}:${progress.percent}`;
        if (!force && key === lastProgressKey) {
            return;
        }
        lastProgressKey = key;
        onProgress?.(progress);
    };

    try {
        for (const [index, item] of files.entries()) {
            assertNotAborted(signal);

            // zip.js's native BlobReader has an empty-stream edge case in Bun;
            // TextReader represents an empty entry without producing a bogus byte.
            const reader = item.size === 0 ? new TextReader('') : new BlobReader(item.file);
            await zipWriter.add(item.path, reader, {
                password,
                ...entryOptions,
                // exactOptionalPropertyTypes rejects `signal: undefined`; only add
                // the option when a caller supplied an AbortSignal.
                ...(signal ? { signal } : {}),
                lastModDate: new Date(item.lastModified),
                onprogress: (loaded) => {
                    // zip.js reports input bytes for BlobReader, but clamp per entry so
                    // a compression/encryption implementation cannot jump past 100%.
                    const loadedBytes = Math.min(item.size, Math.max(0, loaded));
                    const processedBytes = Math.min(totalBytes, completedBytes + loadedBytes);
                    const percent = totalBytes === 0 ? 100 : Math.min(100, (processedBytes / totalBytes) * 100);
                    emitProgress({
                        currentFile: item.path,
                        fileCount: files.length,
                        fileIndex: index + 1,
                        percent,
                        processedBytes,
                        totalBytes,
                    });
                },
            });

            completedBytes += item.size;
            emitProgress({
                currentFile: item.path,
                fileCount: files.length,
                fileIndex: index + 1,
                percent: totalBytes === 0 ? 100 : Math.min(100, (completedBytes / totalBytes) * 100),
                processedBytes: completedBytes,
                totalBytes,
            });
        }

        assertNotAborted(signal);
        closeAttempted = true;
        const archive = await zipWriter.close();
        emitProgress(
            {
                currentFile: files.at(-1)?.path ?? '',
                fileCount: files.length,
                fileIndex: files.length,
                percent: 100,
                processedBytes: totalBytes,
                totalBytes,
            },
            true,
        );
        return archive;
    } catch (error) {
        if (!closeAttempted) {
            closeAttempted = true;
            await zipWriter.close().catch(() => undefined);
        }
        throw error;
    }
}
