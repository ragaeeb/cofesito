type DownloadDocument = Pick<Document, 'createElement'> & {
    readonly body: Pick<HTMLElement, 'append'>;
};

export function normalizeDownloadName(value: string): string {
    const cleaned = value
        .trim()
        .replaceAll('\\', '-')
        .replaceAll('/', '-')
        .replace(/[<>:"|?*\u0000-\u001f]/g, '-')
        .replace(/[. ]+$/g, '')
        .slice(0, 120);
    const stem = cleaned.replace(/\.zip$/i, '');
    const reservedStem = /^(?:con|prn|aux|nul|clock\$|com[1-9]|lpt[1-9])(?:\..*)?$/i;
    if (stem.length === 0 || stem === '.' || stem === '..' || reservedStem.test(stem)) {
        return 'encrypted.zip';
    }
    return cleaned.toLowerCase().endsWith('.zip') ? cleaned : `${cleaned}.zip`;
}

/** Creates a short-lived download anchor without retaining a DOM node. */
export function triggerDownload(url: string, filename: string, ownerDocument: DownloadDocument = document): void {
    const anchor = ownerDocument.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    anchor.hidden = true;
    ownerDocument.body.append(anchor);
    anchor.click();
    anchor.remove();
}
