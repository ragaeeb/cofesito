import { describe, expect, it } from 'bun:test';
import { BlobReader, TextWriter, ZipReader } from '@zip.js/zip.js/lib/zip-core-native.js';
import type { SelectedFile } from '../src/types';
import {
    AES_256_STRENGTH,
    createEncryptedZip,
    WINZIP_AES_VERSION,
    ZIP_COMPRESSION_LEVEL,
    ZIP_COMPRESSION_STREAM_ENABLED,
    ZIP_CRYPTO_ENABLED,
    ZIP_WORKERS_ENABLED,
} from '../src/zip';
import type { ParsedZipEntry } from './helpers/zip-format';
import { assertWinZipAes256Ae2, parseCentralEntries, parseFirstLocalEntry } from './helpers/zip-format';

function fixtureFiles(): SelectedFile[] {
    const now = Date.now();
    const first = new File(['hello encrypted world\n'], 'hello.txt', {
        lastModified: now,
        type: 'text/plain',
    });
    const second = new File([new Uint8Array([0, 1, 2, 3, 4, 5])], 'bytes.bin', {
        lastModified: now,
    });

    return [
        { file: first, id: 'one', lastModified: now, path: 'docs/hello.txt', size: first.size },
        { file: second, id: 'two', lastModified: now, path: 'data/bytes.bin', size: second.size },
    ];
}

describe('encrypted ZIP generation', () => {
    it('should pin AES-256 and disable ZipCrypto in the auditable configuration', () => {
        expect(AES_256_STRENGTH).toBe(3);
        expect(ZIP_COMPRESSION_LEVEL).toBe(6);
        expect(ZIP_COMPRESSION_STREAM_ENABLED).toBe(true);
        expect(ZIP_CRYPTO_ENABLED).toBe(false);
        expect(ZIP_WORKERS_ENABLED).toBe(false);
        expect(WINZIP_AES_VERSION).toBe(2);
    });

    it('should generate a decryptable ZIP containing the selected relative paths', async () => {
        const password = 'a high entropy test password 9#E!x';
        const archive = await createEncryptedZip({ files: fixtureFiles(), password });
        const reader = new ZipReader(new BlobReader(archive));

        try {
            const entries = await reader.getEntries();
            expect(entries.map((entry) => entry.filename)).toEqual(['docs/hello.txt', 'data/bytes.bin']);
            expect(entries.every((entry) => entry.encrypted)).toBe(true);
            expect(entries.every((entry) => entry.zipCrypto === false)).toBe(true);

            const textEntry = entries[0];
            if (!textEntry) {
                throw new Error('Expected the first ZIP entry to exist.');
            }
            if (textEntry.directory) {
                throw new Error('Expected the first ZIP entry to be a file.');
            }
            const extracted = await textEntry.getData(new TextWriter(), { password });
            expect(extracted).toBe('hello encrypted world\n');
        } finally {
            await reader.close();
        }
    });

    it('should emit WinZip AES-256 AE-2 metadata rather than ZipCrypto or plaintext', async () => {
        const archive = await createEncryptedZip({
            files: fixtureFiles(),
            password: 'independent-header-parser-test-password',
        });
        const bytes = new Uint8Array(await archive.arrayBuffer());

        const localEntry = parseFirstLocalEntry(bytes);
        assertWinZipAes256Ae2(localEntry);

        const centralEntries = parseCentralEntries(bytes);
        expect(centralEntries).toHaveLength(2);
        for (const entry of centralEntries) {
            assertWinZipAes256Ae2(entry);
        }
    });

    it('should not embed the plaintext password in the ZIP bytes', async () => {
        const password = 'do-not-embed-this-password-L8!vJ2#q';
        const archive = await createEncryptedZip({ files: fixtureFiles(), password });
        const bytes = new Uint8Array(await archive.arrayBuffer());

        // Passwords are ASCII by contract, so decoding once avoids an O(n*m)
        // nested byte scan while still checking the exact archive payload.
        const archiveText = new TextDecoder().decode(bytes);
        expect(archiveText.includes(password)).toBe(false);
    });

    it('should reject extraction with an incorrect password', async () => {
        const archive = await createEncryptedZip({
            files: fixtureFiles(),
            password: 'correct-password-8z!',
        });
        const reader = new ZipReader(new BlobReader(archive));

        try {
            const [entry] = await reader.getEntries();
            if (!entry) {
                throw new Error('Expected an encrypted ZIP entry to exist.');
            }
            if (entry.directory) {
                throw new Error('Expected an encrypted ZIP file entry.');
            }
            await expect(entry.getData(new TextWriter(), { password: 'wrong-password' })).rejects.toThrow();
        } finally {
            await reader.close();
        }
    });

    it('should report progress across multiple files', async () => {
        const updates: number[] = [];
        await createEncryptedZip({
            files: fixtureFiles(),
            onProgress(progress) {
                updates.push(progress.percent);
            },
            password: 'progress-test-password',
        });

        expect(updates.length).toBeGreaterThan(0);
        expect(updates.at(-1)).toBe(100);
    });

    it('should abort cleanly before reading files when cancelled', async () => {
        const controller = new AbortController();
        controller.abort();

        await expect(
            createEncryptedZip({
                files: fixtureFiles(),
                password: 'cancel-test-password',
                signal: controller.signal,
            }),
        ).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('should preserve zero-byte entries and report completion', async () => {
        const empty = new File([], 'empty.txt');
        const updates: number[] = [];
        const archive = await createEncryptedZip({
            files: [{ file: empty, id: 'empty', lastModified: empty.lastModified, path: 'empty.txt', size: 0 }],
            onProgress: (progress) => updates.push(progress.percent),
            password: 'empty-entry-password',
        });
        expect(updates.at(-1)).toBe(100);
        const reader = new ZipReader(new BlobReader(archive));
        try {
            const [entry] = await reader.getEntries();
            if (!entry || entry.directory) {
                throw new Error('Expected an empty file entry.');
            }
            const extracted = await entry.arrayBuffer({ password: 'empty-entry-password' });
            expect(extracted.byteLength).toBe(0);
        } finally {
            await reader.close();
        }
    });

    it('should classify an abort raised during an active entry as cancellation', async () => {
        const controller = new AbortController();
        const file = new File([new Uint8Array(1024 * 1024)], 'large.bin');

        await expect(
            createEncryptedZip({
                files: [{ file, id: 'large', lastModified: file.lastModified, path: 'large.bin', size: file.size }],
                onProgress: () => controller.abort(),
                password: 'active-cancel-password',
                signal: controller.signal,
            }),
        ).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('should preserve a finalized archive when cancellation arrives after close', async () => {
        const controller = new AbortController();
        let reachedCompletion = false;
        const archive = await createEncryptedZip({
            files: fixtureFiles(),
            onProgress: (progress) => {
                if (progress.percent === 100 && !reachedCompletion) {
                    reachedCompletion = true;
                } else if (reachedCompletion) {
                    controller.abort();
                }
            },
            password: 'late-cancel-password',
            signal: controller.signal,
        });

        expect(archive.size).toBeGreaterThan(0);
        expect(controller.signal.aborted).toBe(true);
    });

    it('should reject AE-2 metadata mutations', () => {
        const validAes = { actualCompressionMethod: 8, strength: 3, vendorId: 'AE', vendorVersion: 2 };
        const valid: ParsedZipEntry = {
            aes: validAes,
            compressionMethod: 99,
            crc32: 0,
            filename: 'fixture.txt',
            flags: 1,
        };
        for (const mutation of [
            { ...valid, aes: { ...validAes, vendorVersion: 1 } },
            { ...valid, aes: { ...validAes, vendorId: 'XX' } },
            { ...valid, aes: { ...validAes, strength: 1 } },
        ]) {
            expect(() => assertWinZipAes256Ae2(mutation)).toThrow();
        }
    });
});
