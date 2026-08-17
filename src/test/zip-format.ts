const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_FILE_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const AES_EXTRA_FIELD_ID = 0x9901;
const AES_COMPRESSION_METHOD = 99;

export type AesExtraField = {
    readonly vendorVersion: number;
    readonly vendorId: string;
    readonly strength: number;
    readonly actualCompressionMethod: number;
};

export type ParsedZipEntry = {
    readonly filename: string;
    readonly flags: number;
    readonly compressionMethod: number;
    readonly crc32: number;
    readonly aes: AesExtraField | null;
};

function readUint16(view: DataView, offset: number): number {
    return view.getUint16(offset, true);
}

function readUint32(view: DataView, offset: number): number {
    return view.getUint32(offset, true);
}

function decodeAscii(bytes: Uint8Array): string {
    return String.fromCharCode(...bytes);
}

function parseAesExtraField(bytes: Uint8Array): AesExtraField | null {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 0;

    while (offset + 4 <= bytes.length) {
        const id = readUint16(view, offset);
        const length = readUint16(view, offset + 2);
        const dataStart = offset + 4;
        const dataEnd = dataStart + length;
        if (dataEnd > bytes.length) {
            throw new Error('Malformed ZIP extra field.');
        }

        if (id === AES_EXTRA_FIELD_ID) {
            if (length < 7) {
                throw new Error('Malformed WinZip AES extra field.');
            }
            return {
                actualCompressionMethod: readUint16(view, dataStart + 5),
                strength: bytes[dataStart + 4] ?? 0,
                vendorId: decodeAscii(bytes.subarray(dataStart + 2, dataStart + 4)),
                vendorVersion: readUint16(view, dataStart),
            };
        }

        offset = dataEnd;
    }

    return null;
}

export function parseFirstLocalEntry(bytes: Uint8Array): ParsedZipEntry {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (readUint32(view, 0) !== LOCAL_FILE_HEADER_SIGNATURE) {
        throw new Error('ZIP local file header not found.');
    }

    const filenameLength = readUint16(view, 26);
    const extraLength = readUint16(view, 28);
    const filenameStart = 30;
    const extraStart = filenameStart + filenameLength;
    const filename = new TextDecoder().decode(bytes.subarray(filenameStart, extraStart));
    const extra = bytes.subarray(extraStart, extraStart + extraLength);

    return {
        aes: parseAesExtraField(extra),
        compressionMethod: readUint16(view, 8),
        crc32: readUint32(view, 14),
        filename,
        flags: readUint16(view, 6),
    };
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const minimum = Math.max(0, bytes.length - 65_557);
    for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
        if (readUint32(view, offset) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
            return offset;
        }
    }
    throw new Error('ZIP end of central directory not found.');
}

export function parseCentralEntries(bytes: Uint8Array): ParsedZipEntry[] {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const eocdOffset = findEndOfCentralDirectory(bytes);
    const entryCount = readUint16(view, eocdOffset + 10);
    let offset = readUint32(view, eocdOffset + 16);
    const entries: ParsedZipEntry[] = [];

    for (let index = 0; index < entryCount; index += 1) {
        if (readUint32(view, offset) !== CENTRAL_FILE_HEADER_SIGNATURE) {
            throw new Error('ZIP central directory entry not found.');
        }

        const filenameLength = readUint16(view, offset + 28);
        const extraLength = readUint16(view, offset + 30);
        const commentLength = readUint16(view, offset + 32);
        const filenameStart = offset + 46;
        const extraStart = filenameStart + filenameLength;
        const filename = new TextDecoder().decode(bytes.subarray(filenameStart, extraStart));
        const extra = bytes.subarray(extraStart, extraStart + extraLength);

        entries.push({
            aes: parseAesExtraField(extra),
            compressionMethod: readUint16(view, offset + 10),
            crc32: readUint32(view, offset + 16),
            filename,
            flags: readUint16(view, offset + 8),
        });

        offset = extraStart + extraLength + commentLength;
    }

    return entries;
}

export function assertWinZipAes256Ae2(entry: ParsedZipEntry): void {
    if ((entry.flags & 0x0001) === 0) {
        throw new Error('Entry is not marked encrypted.');
    }
    if (entry.compressionMethod !== AES_COMPRESSION_METHOD) {
        throw new Error(`Expected WinZip AES method 99, got ${entry.compressionMethod}.`);
    }
    if (!entry.aes) {
        throw new Error('WinZip AES extra field 0x9901 is missing.');
    }
    if (entry.aes.vendorVersion !== 2) {
        throw new Error(`Expected AE-2 vendor version 2, got ${entry.aes.vendorVersion}.`);
    }
    if (entry.aes.vendorId !== 'AE') {
        throw new Error(`Expected WinZip AES vendor id AE, got ${entry.aes.vendorId}.`);
    }
    if (entry.aes.strength !== 3) {
        throw new Error(`Expected AES-256 strength 3, got ${entry.aes.strength}.`);
    }
    if (entry.aes.actualCompressionMethod !== 0 && entry.aes.actualCompressionMethod !== 8) {
        throw new Error(`Expected stored or deflated data inside AES, got ${entry.aes.actualCompressionMethod}.`);
    }
    if (entry.crc32 !== 0) {
        throw new Error(`AE-2 entries must store CRC-32 as zero, got ${entry.crc32}.`);
    }
}
