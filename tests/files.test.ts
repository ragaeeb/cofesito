import { describe, expect, it } from "bun:test";
import { mergeSelectedFiles, normalizeArchivePath } from "../src/files";
import type { SelectedFile } from "../src/types";

function selected(path: string, id: string): SelectedFile {
  const file = new File([id], path.split("/").at(-1) ?? id);
  return {
    id,
    file,
    path,
    size: file.size,
    lastModified: file.lastModified,
  };
}

describe("archive paths", () => {
  it("should normalize separators while preserving safe relative directories", () => {
    expect(normalizeArchivePath("folder\\nested/./file.txt")).toBe("folder/nested/file.txt");
  });

  it("should reject parent traversal, drive-absolute paths, and NUL bytes", () => {
    expect(() => normalizeArchivePath("../secret.txt")).toThrow();
    expect(() => normalizeArchivePath("folder/../secret.txt")).toThrow();
    expect(() => normalizeArchivePath("C:/secret.txt")).toThrow();
    expect(() => normalizeArchivePath("folder/evil\0name.txt")).toThrow();
  });

  it("should replace duplicate archive paths with the newest selection", () => {
    const first = selected("docs/readme.txt", "first");
    const replacement = selected("docs/readme.txt", "replacement");
    const other = selected("data/file.bin", "other");

    const merged = mergeSelectedFiles([first], [replacement, other]);
    expect(merged).toHaveLength(2);
    expect(merged.find((item) => item.path === "docs/readme.txt")?.id).toBe("replacement");
  });
});
