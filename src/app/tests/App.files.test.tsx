import { afterEach, beforeAll, describe, expect, it } from 'bun:test';
import App from '../App';
import {
    type ArchiveCall,
    addFile,
    cleanupTestDom,
    createDependencies,
    expectText,
    getTestingLibrary,
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

describe('rendered file interaction', () => {
    it('adds, removes, clears files, and reports aggregate size', () => {
        const { fireEvent, screen } = library;
        library.render(<App dependencies={createDependencies()} />);

        addFile('one.txt', '1234');
        addFile('two.txt', '123456');

        expect(screen.getByText('2 files · 10 B')).toBeTruthy();
        expectText(screen.getByRole('list', { name: 'Selected files' }), 'one.txt');
        expectText(screen.getByRole('list', { name: 'Selected files' }), 'two.txt');

        fireEvent.click(screen.getByRole('button', { name: 'Remove one.txt' }));
        expect(screen.getByText('1 file · 6 B')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Clear files' }));
        expect(screen.getByText('0 files · 0 B')).toBeTruthy();
        expect(screen.queryByRole('list', { name: 'Selected files' })).toBeNull();
    });

    it('resets the file input after reading a selection so the same file can be chosen again', () => {
        const { fireEvent, screen } = library;
        library.render(<App dependencies={createDependencies()} />);
        const input = screen.getByLabelText('File picker input') as HTMLInputElement;
        let inputValue = 'C:\\fakepath\\same.txt';
        Object.defineProperty(input, 'value', {
            configurable: true,
            get: () => inputValue,
            set: (value: string) => {
                inputValue = value;
            },
        });
        const file = new File(['same'], 'same.txt', { type: 'text/plain' });

        fireEvent.change(input, { target: { files: [file] } });
        expect(inputValue).toBe('');
        fireEvent.click(screen.getByRole('button', { name: 'Remove same.txt' }));
        fireEvent.change(input, { target: { files: [file] } });

        expectText(screen.getByRole('list', { name: 'Selected files' }), 'same.txt');
    });

    it('keeps the active archive state when an asynchronous drop completes during creation', async () => {
        let resolveArchive: ((archive: Blob) => void) | undefined;
        let resolveDroppedFile: ((file: File) => void) | undefined;
        const calls: ArchiveCall[] = [];
        const droppedEntry = {
            file: (resolve: (file: File) => void) => {
                resolveDroppedFile = resolve;
            },
            isDirectory: false,
            isFile: true,
            name: 'late.txt',
        } as unknown as FileSystemFileEntry;
        const { fireEvent, screen, waitFor } = library;
        const dependencies = createDependencies({
            createArchive: async (options) => {
                calls.push(options);
                return new Promise<Blob>((resolve) => {
                    resolveArchive = resolve;
                });
            },
        });
        library.render(<App dependencies={dependencies} />);
        addFile('initial.txt', 'initial');
        setValidPassword();

        const dataTransfer = {
            files: [],
            items: [
                {
                    getAsFile: () => null,
                    kind: 'file',
                    webkitGetAsEntry: () => droppedEntry,
                },
            ],
        } as unknown as DataTransfer;
        const dropZone = screen.getByRole('region', { name: 'Drop files or folders here' });
        fireEvent.drop(dropZone, { dataTransfer });
        await waitFor(() => expect(resolveDroppedFile).toBeTruthy());

        fireEvent.click(screen.getByRole('button', { name: 'Create ZIP' }));
        await waitFor(() =>
            expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(false),
        );
        resolveDroppedFile?.(new File(['late'], 'late.txt', { type: 'text/plain' }));

        await waitFor(() => expect(dropZone.getAttribute('aria-busy')).toBe('true'));
        expect(screen.getByRole('button', { name: 'Cancel' }).getAttribute('aria-disabled')).toBe('false');
        expect(screen.getByRole('list', { name: 'Selected files' }).textContent).toContain('initial.txt');
        expect(screen.getByRole('list', { name: 'Selected files' }).textContent).not.toContain('late.txt');
        expect(calls).toHaveLength(1);
        expect(calls[0]?.files).toHaveLength(1);
        expect(calls[0]?.files[0]?.path).toBe('initial.txt');

        resolveArchive?.(new Blob(['archive'], { type: 'application/zip' }));
        await waitFor(() => expectText(screen.getByRole('status'), 'ZIP ready'));
        expect(screen.getByRole('list', { name: 'Selected files' }).textContent).not.toContain('late.txt');
    });

    it('does not surface an asynchronous drop error while an archive is building', async () => {
        let rejectArchive: ((error: unknown) => void) | undefined;
        let rejectDroppedFile: ((error: unknown) => void) | undefined;
        const droppedEntry = {
            file: (_resolve: (file: File) => void, reject: (error: unknown) => void) => {
                rejectDroppedFile = reject;
            },
            isDirectory: false,
            isFile: true,
            name: 'late-error.txt',
        } as unknown as FileSystemFileEntry;
        const { fireEvent, screen, waitFor } = library;
        const dependencies = createDependencies({
            createArchive: async () =>
                new Promise<Blob>((_resolve, reject) => {
                    rejectArchive = reject;
                }),
        });
        library.render(<App dependencies={dependencies} />);
        addFile('initial.txt', 'initial');
        setValidPassword();

        const dataTransfer = {
            files: [],
            items: [
                {
                    getAsFile: () => null,
                    kind: 'file',
                    webkitGetAsEntry: () => droppedEntry,
                },
            ],
        } as unknown as DataTransfer;
        const dropZone = screen.getByRole('region', { name: 'Drop files or folders here' });
        fireEvent.drop(dropZone, { dataTransfer });
        await waitFor(() => expect(rejectDroppedFile).toBeTruthy());

        fireEvent.click(screen.getByRole('button', { name: 'Create ZIP' }));
        await waitFor(() =>
            expect(screen.getByRole('button', { name: 'Cancel' }).getAttribute('aria-disabled')).toBe('false'),
        );
        rejectDroppedFile?.(new Error('drop failed'));
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(dropZone.getAttribute('aria-busy')).toBe('true');
        expect(screen.queryByRole('alert')?.textContent ?? '').not.toContain('drop failed');
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        rejectArchive?.(new DOMException('cancelled', 'AbortError'));
        await waitFor(() => expectText(screen.getByRole('alert'), 'Archive creation cancelled.'));
    });

    it('prevents outside drops and keeps nested drag transitions from sticking', () => {
        const { fireEvent, screen } = library;
        library.render(<App dependencies={createDependencies()} />);
        const dropZone = screen.getByRole('region', { name: 'Drop files or folders here' });
        const child = dropZone.querySelector('strong');
        const outsideDrop = new Event('drop', { bubbles: true, cancelable: true });
        document.body.dispatchEvent(outsideDrop);
        expect(outsideDrop.defaultPrevented).toBe(true);

        fireEvent.dragEnter(dropZone, { dataTransfer: new DataTransfer() });
        expect(dropZone.classList.contains('dragging')).toBe(true);
        if (!child) {
            throw new Error('The drop zone should include a nested drag target.');
        }
        fireEvent.dragEnter(child, { dataTransfer: new DataTransfer() });
        fireEvent.dragLeave(child, { relatedTarget: dropZone });
        expect(dropZone.classList.contains('dragging')).toBe(true);
        fireEvent.dragLeave(dropZone, { relatedTarget: null });
        expect(dropZone.classList.contains('dragging')).toBe(false);
    });
});
