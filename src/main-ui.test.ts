import { expect, it } from 'bun:test';

it('declares keyboard and live-region affordances for the archive flow', async () => {
    const html = await Bun.file('index.html').text();

    expect(html).toContain('aria-controls="password password-confirm"');
    expect(html).toContain('aria-label="Show password"');
    expect(html).toContain('role="status" aria-live="polite" aria-atomic="true"');
    expect(html).toContain('id="cancel" class="text-button danger-text" type="button" disabled');
    expect(html).not.toContain('id="download-again" class="button success-button" href="#"');
});
