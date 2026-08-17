import { describe, expect, it } from 'bun:test';
import { REMEMBERED_PASSWORD_KEY } from '../../archive/password';
import type { SelectedFile } from '../../archive/types';
import { MemoryStorage } from '../../test/memory-storage';
import { type AppState, appReducer, createInitialState } from '../app-state';

function createState(overrides: Partial<AppState> = {}): AppState {
    return {
        archiveName: 'encrypted.zip',
        confirmation: 'password',
        lifecycle: { kind: 'idle' },
        notice: null,
        password: 'password',
        rememberPassword: false,
        selectedFiles: [],
        storageAvailable: true,
        ...overrides,
    };
}

function selectedFile(path: string): SelectedFile {
    const file = new File(['contents'], path);
    return { file, id: path, lastModified: file.lastModified, path, size: file.size };
}

describe('app state', () => {
    it('creates an empty initial state and restores a remembered password', () => {
        const empty = createInitialState(null);
        expect(empty.lifecycle).toEqual({ kind: 'idle' });
        expect(empty.selectedFiles).toEqual([]);
        expect(empty.storageAvailable).toBe(false);

        const storage = new MemoryStorage();
        storage.setItem(REMEMBERED_PASSWORD_KEY, 'remembered');
        const restored = createInitialState(storage);
        expect(restored.password).toBe('remembered');
        expect(restored.confirmation).toBe('remembered');
        expect(restored.rememberPassword).toBe(true);
    });

    it('rejects input invalidation while an archive is building', () => {
        const building = createState({
            lifecycle: { kind: 'building', progress: null },
            selectedFiles: [selectedFile('initial.txt')],
        });

        expect(appReducer(building, { files: [selectedFile('late.txt')], type: 'files-added' })).toBe(building);
        expect(appReducer(building, { type: 'archive-name-changed', value: 'changed' })).toBe(building);
        expect(appReducer(building, { password: 'changed', type: 'passwords-changed' })).toBe(building);
    });

    it('keeps notices separate from archive errors and preserves successful downloads', () => {
        const successful = createState({
            lifecycle: { filename: 'encrypted.zip', kind: 'success', objectUrl: 'blob:archive', size: 12 },
        });

        const noticed = appReducer(successful, { message: 'Clipboard unavailable.', type: 'notice' });
        expect(noticed.lifecycle).toBe(successful.lifecycle);
        expect(noticed.notice).toBe('Clipboard unavailable.');

        const failed = appReducer(noticed, { message: 'Archive failed.', type: 'archive-error' });
        expect(failed.lifecycle).toEqual({ kind: 'error', message: 'Archive failed.' });
        expect(failed.notice).toBeNull();
    });

    it('keeps storage failures visible without corrupting archive lifecycle or URL ownership', () => {
        const successful = createState({
            lifecycle: { filename: 'encrypted.zip', kind: 'success', objectUrl: 'blob:archive', size: 12 },
            rememberPassword: true,
        });

        const failed = appReducer(successful, { message: 'Storage unavailable.', type: 'storage-failure' });
        expect(failed.lifecycle).toBe(successful.lifecycle);
        expect(failed.notice).toBe('Storage unavailable.');
        expect(failed.rememberPassword).toBe(false);
        expect(failed.storageAvailable).toBe(false);
    });

    it('clears a notice when a new archive succeeds', () => {
        const noticed = createState({ notice: 'Clipboard unavailable.' });
        const successful = appReducer(noticed, {
            filename: 'encrypted.zip',
            objectUrl: 'blob:archive',
            size: 12,
            type: 'success',
        });

        expect(successful.lifecycle).toEqual({
            filename: 'encrypted.zip',
            kind: 'success',
            objectUrl: 'blob:archive',
            size: 12,
        });
        expect(successful.notice).toBeNull();
    });
});
