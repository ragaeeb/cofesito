import { BlobReader, BlobWriter, ZipWriter, configure } from '@zip.js/zip.js/lib/zip-core-native.js';
import type { SelectedFile, ZipProgress } from './types';

export const AES_256_STRENGTH = 3 as const;
export const ZIP_CRYPTO_ENABLED = false as const;
export const WINZIP_AES_VERSION = 2 as const;

configure({
    useWebWorkers: false,
    useCompressionStream: true,
});

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

export async function createEncryptedZip({
    files,
    password,
    signal,
    onProgress,
}: CreateEncryptedZipOptions): Promise<Blob> {
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
    const zipWriter = new ZipWriter(writer, {
        password,
        encryptionStrength: AES_256_STRENGTH,
        zipCrypto: ZIP_CRYPTO_ENABLED,
        useWebWorkers: false,
        useCompressionStream: true,
        level: 6,
    });

    try {
        for (const [index, item] of files.entries()) {
            assertNotAborted(signal);

            await zipWriter.add(item.path, new BlobReader(item.file), {
                password,
                encryptionStrength: AES_256_STRENGTH,
                zipCrypto: ZIP_CRYPTO_ENABLED,
                useWebWorkers: false,
                useCompressionStream: true,
                level: 6,
                ...(signal ? { signal } : {}),
                lastModDate: new Date(item.lastModified),
                onprogress: (loaded) => {
                    const processedBytes = Math.min(totalBytes, completedBytes + loaded);
                    const percent = totalBytes === 0 ? 100 : Math.min(100, (processedBytes / totalBytes) * 100);
                    onProgress?.({
                        processedBytes,
                        totalBytes,
                        currentFile: item.path,
                        fileIndex: index + 1,
                        fileCount: files.length,
                        percent,
                    });
                },
            });

            completedBytes += item.size;
            onProgress?.({
                processedBytes: completedBytes,
                totalBytes,
                currentFile: item.path,
                fileIndex: index + 1,
                fileCount: files.length,
                percent: totalBytes === 0 ? 100 : Math.min(100, (completedBytes / totalBytes) * 100),
            });
        }

        assertNotAborted(signal);
        const archive = await zipWriter.close();
        onProgress?.({
            processedBytes: totalBytes,
            totalBytes,
            currentFile: files.at(-1)?.path ?? '',
            fileIndex: files.length,
            fileCount: files.length,
            percent: 100,
        });
        return archive;
    } catch (error) {
        await zipWriter.close().catch(() => undefined);
        throw error;
    }
}
