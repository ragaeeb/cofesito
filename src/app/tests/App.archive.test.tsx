import { afterEach, beforeAll, describe, expect, it } from 'bun:test';
import type { ZipProgress } from '../../archive/types';
import { MemoryStorage } from '../../test/memory-storage';
import App from '../App';
import {
    type ArchiveCall,
    addFile,
    cleanupTestDom,
    createArchiveAndWait,
    createDependencies,
    expectText,
    getDownloadFallback,
    getInput,
    getTestingLibrary,
    setInput,
    setupTestDom,
    setValidPassword,
    type TestingLibrary,
} from './test-app';

let library: TestingLibrary;

beforeAll(async () => {
    await setupTestDom();
    library = getTestingLibrary();
});

afterEach(() => {
    cleanupTestDom();
});

describe('rendered archive lifecycle', () => {
    it('renders the accessible initial workflow and metadata', () => {
        const { screen } = library;
        library.render(<App dependencies={createDependencies()} />);

        expect(screen.getByRole('heading', { name: 'cofesito' })).toBeTruthy();
        expect(screen.getByRole('region', { name: 'Drop files or folders here' })).toBeTruthy();
        expect(getInput('Password')).toBeTruthy();
        expect(getInput('Confirm password')).toBeTruthy();
        expect(getInput('Filename')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Create ZIP' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Show password' }).getAttribute('aria-controls')).toBe(
            'password password-confirm',
        );
        expect(screen.getByRole('button', { name: 'Show password' }).getAttribute('aria-pressed')).toBe('false');
        expect(screen.getByRole('button', { hidden: true, name: 'Cancel' }).hasAttribute('disabled')).toBe(true);
        expect(screen.queryByRole('link', { name: 'Download ZIP' })).toBeNull();
        expect(screen.getByRole('link', { name: 'GitHub' }).getAttribute('href')).toBe(
            'https://github.com/ragaeeb/cofesito',
        );
        expect(screen.getByText('v1.0.0')).toBeTruthy();
        expect(screen.getByText('Ragaeeb Haq')).toBeTruthy();
        expect(screen.getByText(/remembering a password stores it in plaintext/i)).toBeTruthy();
        expect(screen.getByText(/same-origin JavaScript and browser extensions can read it/i)).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Secure ZIP creation, right in your browser.' })).toBeTruthy();
    });

    it('keeps archive progress active when a pending clipboard failure arrives during creation', async () => {
        let rejectClipboard: ((error: unknown) => void) | undefined;
        let clipboardStarted = false;
        let rejectArchive: ((error: unknown) => void) | undefined;
        const { fireEvent, screen, waitFor } = library;
        const dependencies = createDependencies({
            clipboard: {
                writeText: () =>
                    new Promise<void>((_resolve, reject) => {
                        clipboardStarted = true;
                        rejectClipboard = reject;
                    }),
            },
            createArchive: async () =>
                new Promise<Blob>((_resolve, reject) => {
                    rejectArchive = reject;
                }),
        });
        library.render(<App dependencies={dependencies} />);
        addFile();
        setValidPassword();
        fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
        await waitFor(() => expect(clipboardStarted).toBe(true));

        fireEvent.click(screen.getByRole('button', { name: 'Create ZIP' }));
        await waitFor(() =>
            expect(screen.getByRole('button', { name: 'Cancel' }).getAttribute('aria-disabled')).toBe('false'),
        );
        rejectClipboard?.(new Error('clipboard failed during creation'));
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(screen.getByRole('region', { name: 'Drop files or folders here' }).getAttribute('aria-busy')).toBe(
            'true',
        );
        expect(screen.getByRole('button', { name: 'Cancel' }).getAttribute('aria-disabled')).toBe('false');
        expectText(screen.getByRole('alert'), 'browser did not allow clipboard access');

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        rejectArchive?.(new DOMException('cancelled', 'AbortError'));
        await waitFor(() => expectText(screen.getByRole('alert'), 'Archive creation cancelled.'));
    });

    it('keeps a successful download fallback when a later clipboard failure is reported', async () => {
        const revoked: string[] = [];
        const { fireEvent, screen, waitFor } = library;
        const dependencies = createDependencies({
            clipboard: { writeText: async () => Promise.reject(new Error('clipboard failed after success')) },
            createObjectUrl: () => 'blob:successful-archive',
            revokeObjectUrl: (url) => revoked.push(url),
        });
        library.render(<App dependencies={dependencies} />);
        addFile();
        setValidPassword();
        await createArchiveAndWait();

        fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
        await waitFor(() => expectText(screen.getByRole('alert'), 'browser did not allow clipboard access'));

        expect(screen.getByRole('status')).toBeTruthy();
        expect(getDownloadFallback().getAttribute('href')).toBe('blob:successful-archive');
        expect(revoked).toEqual([]);
    });

    it('stops creation and keeps the storage failure visible when remembering fails during Create', () => {
        const { screen, fireEvent } = library;
        const storage = new MemoryStorage();
        const originalSetItem = storage.setItem.bind(storage);
        let setItemCalls = 0;
        storage.setItem = (key, value) => {
            setItemCalls += 1;
            if (setItemCalls === 2) {
                throw new Error('storage unavailable during create');
            }
            originalSetItem(key, value);
        };
        let createCalls = 0;
        const dependencies = createDependencies({
            createArchive: async () => {
                createCalls += 1;
                return new Blob(['archive'], { type: 'application/zip' });
            },
            storage,
        });
        library.render(<App dependencies={dependencies} />);
        addFile();
        setValidPassword();
        fireEvent.click(screen.getByRole('checkbox', { name: 'Remember on this device' }));
        expect(setItemCalls).toBe(1);

        fireEvent.click(screen.getByRole('button', { name: 'Create ZIP' }));

        expect(createCalls).toBe(0);
        expectText(screen.getByRole('alert'), 'local storage is unavailable');
        expect(screen.getByRole('button', { hidden: true, name: 'Cancel' }).hasAttribute('disabled')).toBe(true);
    });

    it('creates an archive from Enter in the functional fields', async () => {
        const calls: ArchiveCall[] = [];
        const { fireEvent, waitFor } = library;
        const dependencies = createDependencies({
            createArchive: async (options) => {
                calls.push(options);
                return new Blob(['archive'], { type: 'application/zip' });
            },
        });
        library.render(<App dependencies={dependencies} />);
        addFile();
        setValidPassword();

        fireEvent.keyDown(getInput('Password'), { key: 'Enter' });
        await waitFor(() => expect(calls).toHaveLength(1));
        expect(calls[0]?.password).toBe('correct horse battery staple');

        cleanupTestDom();
        library.render(<App dependencies={dependencies} />);
        addFile();
        setValidPassword();
        fireEvent.keyDown(getInput('Filename'), { key: 'Enter' });
        await waitFor(() => expect(calls).toHaveLength(2));
    });

    it('disables busy controls and cancels an in-flight archive', async () => {
        let rejectArchive: ((error: unknown) => void) | undefined;
        let signal: AbortSignal | undefined;
        const { fireEvent, screen, waitFor } = library;
        const dependencies = createDependencies({
            createArchive: async (options) => {
                signal = options.signal;
                return new Promise<Blob>((_resolve, reject) => {
                    rejectArchive = reject;
                });
            },
        });
        library.render(<App dependencies={dependencies} />);
        addFile();
        setValidPassword();
        fireEvent.click(screen.getByRole('button', { name: 'Create ZIP' }));

        await waitFor(() =>
            expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(false),
        );
        expect(screen.getByRole('button', { name: 'Create ZIP' }).hasAttribute('disabled')).toBe(true);
        expect(getInput('Password').hasAttribute('disabled')).toBe(true);
        expect(screen.getByRole('button', { name: 'Create ZIP' }).getAttribute('aria-disabled')).toBe('true');
        expect(getInput('Password').getAttribute('aria-disabled')).toBe('true');
        expect(screen.getByRole('button', { name: 'Generate' }).getAttribute('aria-disabled')).toBe('true');
        expect(screen.getByRole('button', { name: 'Cancel' }).getAttribute('aria-disabled')).toBe('false');

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(signal?.aborted).toBe(true);
        rejectArchive?.(new DOMException('cancelled', 'AbortError'));
        await waitFor(() => expectText(screen.getByRole('alert'), 'Archive creation cancelled.'));
    });

    it('renders progress and preserves a finalized archive after a late cancel', async () => {
        let resolveArchive: ((archive: Blob) => void) | undefined;
        let reportProgress: ((progress: ZipProgress) => void) | undefined;
        let signal: AbortSignal | undefined;
        const { fireEvent, screen, waitFor } = library;
        const dependencies = createDependencies({
            createArchive: async (options) => {
                signal = options.signal;
                reportProgress = options.onProgress;
                return new Promise<Blob>((resolve) => {
                    resolveArchive = resolve;
                });
            },
        });
        library.render(<App dependencies={dependencies} />);
        addFile('large.bin', '123456789');
        setValidPassword();
        fireEvent.click(screen.getByRole('button', { name: 'Create ZIP' }));
        await waitFor(() =>
            expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(false),
        );

        reportProgress?.({
            currentFile: 'large.bin',
            fileCount: 1,
            fileIndex: 1,
            percent: 42.4,
            processedBytes: 4,
            totalBytes: 9,
        });
        await waitFor(() => expect(screen.getByRole('progressbar').getAttribute('value')).toBe('42'));
        expect(screen.getByText('Encrypting 1/1: large.bin')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(signal?.aborted).toBe(true);
        resolveArchive?.(new Blob(['finalized'], { type: 'application/zip' }));
        await waitFor(() => expectText(screen.getByRole('status'), 'ZIP ready'));
        expect(screen.getByRole('link', { name: 'Download ZIP' }).getAttribute('href')).toBe('blob:test-archive');
    });

    it('exposes fallback download attributes and revokes owned URLs on invalidation and unmount', async () => {
        const revoked: string[] = [];
        const downloaded: Array<{ filename: string; url: string }> = [];
        const { screen } = library;
        const dependencies = createDependencies({
            createObjectUrl: () => 'blob:owned',
            revokeObjectUrl: (url) => revoked.push(url),
            triggerDownload: (url, filename) => downloaded.push({ filename, url }),
        });
        const view = library.render(<App dependencies={dependencies} />);
        addFile();
        setValidPassword();
        await createArchiveAndWait();

        const link = screen.getByRole('link', { name: 'Download ZIP' });
        expect(link.getAttribute('href')).toBe('blob:owned');
        expect(link.getAttribute('download')).toBe('encrypted.zip');
        expect(downloaded).toEqual([{ filename: 'encrypted.zip', url: 'blob:owned' }]);

        setInput('Filename', 'renamed');
        expect(revoked).toEqual(['blob:owned']);
        expect(getDownloadFallback().hasAttribute('hidden')).toBe(true);

        view.unmount();
        expect(revoked).toEqual(['blob:owned']);
    });

    it('revokes the owned object URL during before-unload cleanup', async () => {
        const revoked: string[] = [];
        const dependencies = createDependencies({
            createObjectUrl: () => 'blob:unloading',
            revokeObjectUrl: (url) => revoked.push(url),
        });
        library.render(<App dependencies={dependencies} />);
        addFile();
        setValidPassword();
        await createArchiveAndWait();

        window.dispatchEvent(new Event('beforeunload'));
        expect(revoked).toEqual(['blob:unloading']);
    });

    it('invalidates a successful archive when password or files change', async () => {
        const revoked: string[] = [];
        const dependencies = createDependencies({
            createObjectUrl: () => `blob:${revoked.length}`,
            revokeObjectUrl: (url) => revoked.push(url),
        });
        library.render(<App dependencies={dependencies} />);
        addFile();
        setValidPassword();
        await createArchiveAndWait();
        setInput('Password', 'changed password');
        expect(getDownloadFallback().hasAttribute('hidden')).toBe(true);
        addFile('new.txt', 'new');
        expect(revoked).toHaveLength(1);
    });

    it('reports archive errors through an alert and success through a polite live region', async () => {
        const { fireEvent, screen, waitFor } = library;
        const dependencies = createDependencies({
            createArchive: async () => {
                throw new Error('archive failed');
            },
        });
        library.render(<App dependencies={dependencies} />);
        addFile();
        setValidPassword();
        fireEvent.click(screen.getByRole('button', { name: 'Create ZIP' }));
        await waitFor(() => expectText(screen.getByRole('alert'), 'archive failed'));
        expect(screen.queryByRole('status')).toBeNull();
    });
});
