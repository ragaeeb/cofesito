import { expect, it } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SelectedFile } from "../src/types";
import { createEncryptedZip } from "../src/zip";

const sevenZip = Bun.which("7zz") ?? Bun.which("7z");
const sevenZipExecutable = sevenZip ?? "";

it.skipIf(!sevenZip)("should be recognized and extracted by an independent 7-Zip implementation", async () => {
  const root = await mkdtemp(join(tmpdir(), "zero-upload-aes-zip-"));
  const archivePath = join(root, "fixture.zip");
  const outputPath = join(root, "extracted");
  const password = "disposable-7zip-interop-password-5E!u9";
  const file = new File(["7-Zip interoperability fixture\n"], "fixture.txt", {
    type: "text/plain",
  });
  const selected: SelectedFile = {
    id: "fixture",
    file,
    path: "nested/fixture.txt",
    size: file.size,
    lastModified: file.lastModified,
  };

  try {
    const archive = await createEncryptedZip({ files: [selected], password });
    await Bun.write(archivePath, archive);
    await mkdir(outputPath, { recursive: true });

    const list = Bun.spawn([sevenZipExecutable, "l", "-slt", archivePath], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [listExit, listStdout, listStderr] = await Promise.all([
      list.exited,
      list.stdout.text(),
      list.stderr.text(),
    ]);
    if (listExit !== 0) {
      throw new Error(`7-Zip could not inspect the generated archive: ${listStderr.trim()}`);
    }
    expect(listStdout).toMatch(/AES[- ]?256/i);

    const extract = Bun.spawn(
      [sevenZipExecutable, "x", `-p${password}`, `-o${outputPath}`, "-y", archivePath],
      {
        stdout: "ignore",
        stderr: "pipe",
      },
    );
    const [extractExit, extractStderr] = await Promise.all([
      extract.exited,
      extract.stderr.text(),
    ]);
    if (extractExit !== 0) {
      throw new Error(`7-Zip could not extract the generated archive: ${extractStderr.trim()}`);
    }
    expect(await Bun.file(join(outputPath, "nested/fixture.txt")).text()).toBe(
      "7-Zip interoperability fixture\n",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
