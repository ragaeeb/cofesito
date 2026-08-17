import { describe, expect, it } from "bun:test";
import {
  NETWORK_DISABLED_MESSAGE,
  installNoNetworkRuntimeGuard,
  type NetworkRuntime,
} from "../src/network-guard";

const RUNTIME_FILES = [
  "index.html",
  "src/main.ts",
  "src/network-guard.ts",
  "src/files.ts",
  "src/password.ts",
  "src/types.ts",
  "src/zip.ts",
  "src/style.css",
  "public/_headers",
] as const;

describe("zero-upload runtime behavior", () => {
  it("should block fetch, XHR, WebSocket, EventSource, and sendBeacon", async () => {
    const original = () => "original";
    const runtime: NetworkRuntime = {
      fetch: original,
      XMLHttpRequest: original,
      WebSocket: original,
      EventSource: original,
      navigator: { sendBeacon: original },
    };

    const restore = installNoNetworkRuntimeGuard(runtime);

    await expect(runtime.fetch?.()).rejects.toThrow(NETWORK_DISABLED_MESSAGE);
    expect(() => (runtime.XMLHttpRequest as () => unknown)()).toThrow(NETWORK_DISABLED_MESSAGE);
    expect(() => (runtime.WebSocket as () => unknown)()).toThrow(NETWORK_DISABLED_MESSAGE);
    expect(() => (runtime.EventSource as () => unknown)()).toThrow(NETWORK_DISABLED_MESSAGE);
    expect(runtime.navigator?.sendBeacon?.()).toBe(false);

    restore();
    expect(runtime.fetch?.()).toBe("original");
    expect(runtime.navigator?.sendBeacon?.()).toBe("original");
  });

  it("should keep application runtime files free of external URLs and network calls", async () => {
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

  it("should declare a CSP that forbids application network connections", async () => {
    const headers = await Bun.file("public/_headers").text();
    expect(headers).toContain("connect-src 'none'");
    expect(headers).toContain("script-src 'self'");
    expect(headers).toContain("style-src 'self'");
    expect(headers).toContain("worker-src 'none'");
    expect(headers).not.toContain("unsafe-inline");
    expect(headers).not.toContain("unsafe-eval");
  });
});
