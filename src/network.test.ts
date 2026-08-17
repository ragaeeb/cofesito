import { describe, expect, it } from 'bun:test';
import { installNoNetworkRuntimeGuard, NETWORK_DISABLED_MESSAGE, type NetworkRuntime } from './network-guard';

const RUNTIME_FILES = [
    'index.html',
    'src/main.ts',
    'src/network-guard.ts',
    'src/files.ts',
    'src/password.ts',
    'src/types.ts',
    'src/zip.ts',
    'src/style.css',
    'public/_headers',
] as const;

describe('zero-upload runtime behavior', () => {
    it('should block fetch, XHR, WebSocket, EventSource, and sendBeacon', async () => {
        const original = () => 'original';
        const originalConstructor = class {};
        const runtime: NetworkRuntime = {
            EventSource: originalConstructor,
            fetch: original,
            navigator: { sendBeacon: original },
            WebSocket: originalConstructor,
            XMLHttpRequest: originalConstructor,
        };

        const restore = installNoNetworkRuntimeGuard(runtime);

        await expect(runtime.fetch?.()).rejects.toThrow(NETWORK_DISABLED_MESSAGE);
        expect(() => (runtime.XMLHttpRequest as unknown as () => unknown)()).toThrow(NETWORK_DISABLED_MESSAGE);
        expect(() => (runtime.WebSocket as unknown as () => unknown)()).toThrow(NETWORK_DISABLED_MESSAGE);
        expect(() => (runtime.EventSource as unknown as () => unknown)()).toThrow(NETWORK_DISABLED_MESSAGE);
        expect(runtime.navigator?.sendBeacon?.()).toBe(false);

        restore();
        expect(runtime.fetch?.()).toBe('original');
        expect(runtime.navigator?.sendBeacon?.()).toBe('original');
    });

    it('should keep application runtime files free of external URLs and network calls', async () => {
        for (const path of RUNTIME_FILES) {
            const source = await Bun.file(path).text();
            expect(source).not.toMatch(/https?:\/\//i);
            expect(source).not.toMatch(/\bfetch\s*\(/);
            expect(source).not.toMatch(/new\s+XMLHttpRequest\b/);
            expect(source).not.toMatch(/new\s+WebSocket\b/);
            expect(source).not.toMatch(/\.sendBeacon\s*\(/);
            expect(source).not.toMatch(/\bindexedDB\b/);
            expect(source).not.toMatch(/location\.(search|hash)/);
            expect(source).not.toMatch(/history\.(pushState|replaceState)/);
            expect(source).not.toMatch(/\bconsole\.(log|info|warn|error|debug)\s*\(/);
        }
    });

    it('should declare a CSP that forbids application network connections', async () => {
        const headers = await Bun.file('public/_headers').text();
        expect(headers).toContain("connect-src 'none'");
        expect(headers).toContain("script-src 'self'");
        expect(headers).toContain("style-src 'self'");
        expect(headers).toContain("worker-src 'none'");
        expect(headers).not.toContain('unsafe-inline');
        expect(headers).not.toContain('unsafe-eval');
    });

    it('should expose a development opt-in for exercising the production guard', async () => {
        const source = await Bun.file('src/main.ts').text();
        expect(source).toContain("import.meta.env.VITE_ENFORCE_NO_NETWORK === 'true'");
        expect(source).toContain('installNoNetworkRuntimeGuard()');
    });

    it('should restore inherited primitives without leaving own shadow properties', () => {
        const inheritedFetch = () => Promise.resolve('inherited');
        const prototype = { fetch: inheritedFetch };
        const runtime = Object.create(prototype) as NetworkRuntime;

        const restore = installNoNetworkRuntimeGuard(runtime);
        expect(runtime.fetch).not.toBe(inheritedFetch);
        restore();

        expect(Object.hasOwn(runtime, 'fetch')).toBe(false);
        expect(runtime.fetch).toBe(inheritedFetch);
    });

    it('fails closed when a network primitive cannot be replaced and rolls back prior replacements', async () => {
        const runtime = { fetch: (() => Promise.resolve('original')) as NetworkRuntime['fetch'] } as NetworkRuntime;
        Object.defineProperty(runtime, 'WebSocket', {
            configurable: false,
            value: class {},
            writable: false,
        });

        expect(() => installNoNetworkRuntimeGuard(runtime)).toThrow(/WebSocket/);
        await expect(runtime.fetch?.()).resolves.toBe('original');
    });
});
