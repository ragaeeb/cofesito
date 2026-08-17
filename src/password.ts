export const REMEMBERED_PASSWORD_KEY = 'local-aes-zip.remembered-password';

const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*_-+=';
const DEFAULT_PASSWORD_LENGTH = 28;

export type PasswordValidationResult = {
    readonly valid: boolean;
    readonly message?: string;
};

export type RandomValuesSource = {
    getRandomValues<T extends ArrayBufferView | null>(array: T): T;
};

export function validatePasswords(password: string, confirmation: string): PasswordValidationResult {
    if (password.length === 0) {
        return { message: 'Enter a password before creating the archive.', valid: false };
    }

    if (password !== confirmation) {
        return { message: 'The password and confirmation do not match.', valid: false };
    }

    return { valid: true };
}

export function loadRememberedPassword(storage: Storage): string | null {
    const value = storage.getItem(REMEMBERED_PASSWORD_KEY);
    return value && value.length > 0 ? value : null;
}

export function updateRememberedPassword(storage: Storage, password: string, shouldRemember: boolean): void {
    if (shouldRemember && password.length > 0) {
        storage.setItem(REMEMBERED_PASSWORD_KEY, password);
        return;
    }

    storage.removeItem(REMEMBERED_PASSWORD_KEY);
}

export function clearRememberedPassword(storage: Storage): void {
    storage.removeItem(REMEMBERED_PASSWORD_KEY);
}

export function generateStrongPassword(
    length = DEFAULT_PASSWORD_LENGTH,
    randomSource: RandomValuesSource = crypto,
): string {
    if (!Number.isSafeInteger(length) || length < 16 || length > 256) {
        throw new RangeError('Generated password length must be an integer between 16 and 256.');
    }

    const alphabetLength = PASSWORD_ALPHABET.length;
    const largestAcceptedByte = Math.floor(256 / alphabetLength) * alphabetLength;
    const output: string[] = [];
    const randomBytes = new Uint8Array(Math.max(32, length * 2));

    while (output.length < length) {
        randomSource.getRandomValues(randomBytes);
        for (const byte of randomBytes) {
            if (byte >= largestAcceptedByte) {
                continue;
            }
            output.push(PASSWORD_ALPHABET[byte % alphabetLength] ?? '');
            if (output.length === length) {
                break;
            }
        }
    }

    return output.join('');
}
