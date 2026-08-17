import { describe, expect, it } from "bun:test";
import {
  BlobReader,
  TextWriter,
  ZipReader,
} from "@zip.js/zip.js/lib/zip-core-native.js";
import type { SelectedFile } from "../src/types";
import {
  AES_256_STRENGTH,
  WINZIP_AES_VERSION,
  ZIP_CRYPTO_ENABLED,
  createEncryptedZip,
} from "../src/zip";
import {
  assertWinZipAes256Ae2,
  parseCentralEntries,
  parseFirstLocalEntry,
} from "./helpers/zip-format";

function fixtureFiles(): SelectedFile[] {
  const now = Date.now();
  const first = new File(["hello encrypted world\n"], "hello.txt", {
    type: "text/plain",
    lastModified: now,
  });
  const second = new File([new Uint8Array([0, 1, 2, 3, 4, 5])], "bytes.bin", {
    lastModified: now,
  });

  return [
    { id: "one", file: first, path: "docs/hello.txt", size: first.size, lastModified: now },
    { id: "two", file: second, path: "data/bytes.bin", size: second.size, lastModified: now },
  ];
}

describe("encrypted ZIP generation", () => {
  it("should pin AES-256 and disable ZipCrypto in the auditable configuration", () => {
    expect(AES_256_STRENGTH).toBe(3);
    expect(ZIP_CRYPTO_ENABLED).toBe(false);
    expect(WINZIP_AES_VERSION).toBe(2);
  });

  it("should generate a decryptable ZIP containing the selected relative paths", async () => {
    const password = "a high entropy test password 9#E!x";
    const archive = await createEncryptedZip({ files: fixtureFiles(), password });
    const reader = new ZipReader(new BlobReader(archive));

    try {
      const entries = await reader.getEntries();
      expect(entries.map((entry) => entry.filename)).toEqual(["docs/hello.txt", "data/bytes.bin"]);
      expect(entries.every((entry) => entry.encrypted)).toBe(true);
      expect(entries.every((entry) => entry.zipCrypto === false)).toBe(true);

      const textEntry = entries[0];
      if (!textEntry) {
        throw new Error("Expected the first ZIP entry to exist.");
      }
      const extracted = await textEntry.getData?.(new TextWriter(), { password });
      expect(extracted).toBe("hello encrypted world\n");
    } finally {
      await reader.close();
    }
  });

  it("should emit WinZip AES-256 AE-2 metadata rather than ZipCrypto or plaintext", async () => {
    const archive = await createEncryptedZip({
      files: fixtureFiles(),
      password: "independent-header-parser-test-password",
    });
    const bytes = new Uint8Array(await archive.arrayBuffer());

    const localEntry = parseFirstLocalEntry(bytes);
    assertWinZipAes256Ae2(localEntry);

    const centralEntries = parseCentralEntries(bytes);
    expect(centralEntries).toHaveLength(2);
    for (const entry of centralEntries) {
      assertWinZipAes256Ae2(entry);
    }
  });

  it("should not embed the plaintext password in the ZIP bytes", async () => {
    const password = "do-not-embed-this-password-L8!vJ2#q";
    const archive = await createEncryptedZip({ files: fixtureFiles(), password });
    const bytes = new Uint8Array(await archive.arrayBuffer());
    const passwordBytes = new TextEncoder().encode(password);

    let found = false;
    outer: for (let offset = 0; offset <= bytes.length - passwordBytes.length; offset += 1) {
      for (let index = 0; index < passwordBytes.length; index += 1) {
        if (bytes[offset + index] !== passwordBytes[index]) {
          continue outer;
        }
      }
      found = true;
      break;
    }

    expect(found).toBe(false);
  });

  it("should reject extraction with an incorrect password", async () => {
    const archive = await createEncryptedZip({
      files: fixtureFiles(),
      password: "correct-password-8z!",
    });
    const reader = new ZipReader(new BlobReader(archive));

    try {
      const [entry] = await reader.getEntries();
      if (!entry) {
        throw new Error("Expected an encrypted ZIP entry to exist.");
      }
      await expect(
        entry.getData?.(new TextWriter(), { password: "wrong-password" }),
      ).rejects.toBeDefined();
    } finally {
      await reader.close();
    }
  });

  it("should report progress across multiple files", async () => {
    const updates: number[] = [];
    await createEncryptedZip({
      files: fixtureFiles(),
      password: "progress-test-password",
      onProgress(progress) {
        updates.push(progress.percent);
      },
    });

    expect(updates.length).toBeGreaterThan(0);
    expect(updates.at(-1)).toBe(100);
  });

  it("should abort cleanly before reading files when cancelled", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      createEncryptedZip({
        files: fixtureFiles(),
        password: "cancel-test-password",
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
