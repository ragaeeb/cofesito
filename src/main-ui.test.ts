import { expect, it } from 'bun:test';

it('declares keyboard and live-region affordances for the archive flow', async () => {
    const html = await Bun.file('index.html').text();

    expect(html).toContain('aria-controls="password password-confirm"');
    expect(html).toContain('aria-label="Show password"');
    expect(html).toContain('role="status" aria-live="polite" aria-atomic="true"');
    expect(html).toContain('id="cancel" class="text-button danger-text" type="button" disabled');
    expect(html).not.toContain('id="download-again" class="button success-button" href="#"');
});

it('keeps the primary workflow compact and reserves package metadata slots', async () => {
    const html = await Bun.file('index.html').text();
    const source = await Bun.file('src/main.ts').text();

    expect(html).toContain('class="primary-workflow"');
    expect(html).toContain('id="app-name"');
    expect(html).toContain('id="github-link"');
    expect(html).toContain('id="developer-link"');
    expect(html).toContain('id="app-version"');
    expect(html).toContain('class="marketing-panel"');
    expect(html).not.toContain('class="privacy-strip"');
    expect(source).toContain("import packageMetadata from '../package.json';");
    expect(source).toContain('packageMetadata.homepage');
    expect(source).toContain('packageMetadata.author.name');
    expect(source).toContain('packageMetadata.version');
});
