import { Window } from 'happy-dom';

const DOM_GLOBALS = [
    'window',
    'document',
    'navigator',
    'HTMLElement',
    'HTMLInputElement',
    'HTMLButtonElement',
    'HTMLAnchorElement',
    'HTMLDivElement',
    'HTMLUListElement',
    'HTMLProgressElement',
    'Node',
    'Element',
    'Event',
    'MouseEvent',
    'KeyboardEvent',
    'FocusEvent',
    'DragEvent',
    'DataTransfer',
    'File',
    'FileList',
    'Blob',
    'DOMException',
    'AbortController',
    'AbortSignal',
    'Storage',
    'localStorage',
    'URL',
    'getComputedStyle',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'MutationObserver',
] as const;

type GlobalRecord = Record<string, unknown>;

/** Installs the smallest browser-like surface needed by rendered Preact tests. */
export function installTestDom(): () => void {
    const testWindow = new Window({ url: 'http://localhost/' });
    const globalRecord = globalThis as GlobalRecord;
    const windowRecord = testWindow as unknown as GlobalRecord;
    const previous = new Map<string, unknown>();

    for (const name of DOM_GLOBALS) {
        previous.set(name, globalRecord[name]);
        globalRecord[name] = windowRecord[name];
    }

    return () => {
        for (const name of DOM_GLOBALS) {
            const value = previous.get(name);
            if (value === undefined) {
                delete globalRecord[name];
            } else {
                globalRecord[name] = value;
            }
        }
        testWindow.close();
    };
}
