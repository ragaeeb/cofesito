const requiredBun = [1, 3, 14];
const bunVersion = process.versions.bun;
const actual = bunVersion?.split('.').map(Number);

if (!actual || actual.some((part) => Number.isNaN(part))) {
    throw new Error(
        `This project requires Bun ${requiredBun.join('.')}. Run package scripts with Bun (found ${process.release.name}).`,
    );
}

const [major = 0, minor = 0, patch = 0] = actual;
const [requiredMajor = 1, requiredMinor = 3, requiredPatch = 14] = requiredBun;
const isAtLeastRequired =
    major > requiredMajor ||
    (major === requiredMajor && minor > requiredMinor) ||
    (major === requiredMajor && minor === requiredMinor && patch >= requiredPatch);

if (!isAtLeastRequired) {
    throw new Error(`Bun ${requiredBun.join('.')} or newer is required (found ${process.versions.bun}).`);
}

process.stdout.write(`Runtime check passed (Bun ${process.versions.bun}).\n`);
