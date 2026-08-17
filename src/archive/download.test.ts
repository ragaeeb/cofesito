import { expect, it } from 'bun:test';
import { normalizeDownloadName, triggerDownload } from './download';

it.each([
    ['', 'encrypted.zip'],
    ['.zip', 'encrypted.zip'],
    ['CON', 'encrypted.zip'],
    ['report<>.zip', 'report--.zip'],
    ['folder/name', 'folder-name.zip'],
])('normalizes %s to %s', (input, expected) => {
    expect(normalizeDownloadName(input)).toBe(expected);
});

it('limits normalized download names to a portable length', () => {
    expect(normalizeDownloadName('x'.repeat(200))).toHaveLength(124);
});

it('creates, clicks, and removes a temporary download anchor', () => {
    let appended: unknown = null;
    let clicked = false;
    let removed = false;
    const anchor = {
        click: () => {
            clicked = true;
        },
        remove: () => {
            removed = true;
        },
    } as unknown as Record<string, unknown>;
    const ownerDocument = {
        body: {
            append: (node: Record<string, unknown>) => {
                appended = node;
            },
        },
        createElement: () => anchor,
    } as unknown as Document;

    triggerDownload('blob:test', 'encrypted.zip', ownerDocument);

    expect(appended).toBe(anchor);
    expect(anchor.href).toBe('blob:test');
    expect(anchor.download).toBe('encrypted.zip');
    expect(anchor.rel).toBe('noopener');
    expect(anchor.hidden).toBe(true);
    expect(clicked).toBe(true);
    expect(removed).toBe(true);
});
