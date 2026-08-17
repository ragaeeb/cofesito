import { expect } from 'bun:test';
import type { CreateEncryptedZipOptions } from '../../archive/zip';
import { installTestDom } from '../../test/dom';
import { MemoryStorage } from '../../test/memory-storage';
import type { AppDependencies } from '../app-runtime';

export type ArchiveCall = CreateEncryptedZipOptions;
export type TestingLibrary = typeof import('@testing-library/preact');

let restoreDom: (() => void) | undefined;
let testingLibrary: TestingLibrary | undefined;

export async function setupTestDom(): Promise<void> {
    if (!restoreDom) {
        restoreDom = installTestDom();
    }
    testingLibrary ??= await import('@testing-library/preact');
}

export function cleanupTestDom(): void {
    testingLibrary?.cleanup();
}

export function restoreTestDom(): void {
    restoreDom?.();
    restoreDom = undefined;
    testingLibrary = undefined;
}

export function getTestingLibrary(): TestingLibrary {
    if (!testingLibrary) {
        throw new Error('The rendered test DOM has not been installed.');
    }
    return testingLibrary;
}

export function createDependencies(overrides: Partial<AppDependencies> = {}): AppDependencies {
    return {
        clipboard: { writeText: async () => undefined },
        createArchive: async () => new Blob(['archive'], { type: 'application/zip' }),
        createObjectUrl: () => 'blob:test-archive',
        revokeObjectUrl: () => undefined,
        storage: new MemoryStorage(),
        triggerDownload: () => undefined,
        ...overrides,
    };
}

export function addFile(name = 'hello.txt', contents = 'hello'): File {
    const { fireEvent, screen } = getTestingLibrary();
    const file = new File([contents], name, { lastModified: 1_700_000_000_000, type: 'text/plain' });
    const input = screen.getByLabelText('File picker input');
    fireEvent.change(input, { target: { files: [file] } });
    return file;
}

export function getInput(label: string): HTMLInputElement {
    return getTestingLibrary().screen.getByLabelText(label, { selector: 'input' }) as HTMLInputElement;
}

export function setInput(label: string, value: string): void {
    getTestingLibrary().fireEvent.input(getInput(label), { target: { value } });
}

export function setValidPassword(password = 'correct horse battery staple'): void {
    setInput('Password', password);
    setInput('Confirm password', password);
}

export function expectText(element: Element, text: string): void {
    expect(element.textContent ?? '').toContain(text);
}

export function getDownloadFallback(): HTMLAnchorElement {
    const link = getTestingLibrary().screen.getByText('Download ZIP').closest('a');
    if (!(link instanceof HTMLAnchorElement)) {
        throw new Error('The download fallback should remain an anchor.');
    }
    return link;
}

export function createArchiveAndWait(): Promise<void> {
    const { fireEvent, screen, waitFor } = getTestingLibrary();
    fireEvent.click(screen.getByRole('button', { name: 'Create ZIP' }));
    return waitFor(() => {
        expectText(screen.getByRole('status'), 'ZIP ready');
    });
}
