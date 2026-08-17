import { describe, expect, it } from 'bun:test';
import { MemoryStorage } from '../test/memory-storage';
import {
    clearRememberedPassword,
    generateStrongPassword,
    loadRememberedPassword,
    REMEMBERED_PASSWORD_KEY,
    updateRememberedPassword,
    validatePasswords,
} from './password';

describe('password validation', () => {
    it('should reject an empty password', () => {
        expect(validatePasswords('', '')).toEqual({
            message: 'Enter a password before creating the archive.',
            valid: false,
        });
    });

    it('should reject mismatched passwords', () => {
        expect(validatePasswords('correct horse', 'correct house').valid).toBe(false);
    });

    it('should accept a non-empty matching password', () => {
        expect(validatePasswords('correct horse battery staple', 'correct horse battery staple')).toEqual({
            valid: true,
        });
    });
});

describe('remembered passwords', () => {
    it('should store and restore a password only when remember is enabled', () => {
        const storage = new MemoryStorage();
        updateRememberedPassword(storage, 'remember-me', true);

        expect(storage.getItem(REMEMBERED_PASSWORD_KEY)).toBe('remember-me');
        expect(loadRememberedPassword(storage)).toBe('remember-me');
    });

    it('should forget a password when remember is disabled', () => {
        const storage = new MemoryStorage();
        updateRememberedPassword(storage, 'remember-me', true);
        updateRememberedPassword(storage, 'remember-me', false);

        expect(loadRememberedPassword(storage)).toBeNull();
    });

    it('should never persist an empty password', () => {
        const storage = new MemoryStorage();
        storage.setItem(REMEMBERED_PASSWORD_KEY, 'previous');
        updateRememberedPassword(storage, '', true);

        expect(loadRememberedPassword(storage)).toBeNull();
    });

    it('should clear an explicitly remembered password', () => {
        const storage = new MemoryStorage();
        storage.setItem(REMEMBERED_PASSWORD_KEY, 'secret');
        clearRememberedPassword(storage);

        expect(storage.getItem(REMEMBERED_PASSWORD_KEY)).toBeNull();
    });
});

describe('generated passwords', () => {
    it('should use getRandomValues rather than Math.random', () => {
        let calls = 0;
        const source = {
            getRandomValues<T extends ArrayBufferView | null>(array: T): T {
                calls += 1;
                if (array instanceof Uint8Array) {
                    array.forEach((_, index) => {
                        array[index] = index % 200;
                    });
                }
                return array;
            },
        };

        const originalMathRandom = Math.random;
        Math.random = () => {
            throw new Error('Math.random must not be used for password generation.');
        };

        try {
            const password = generateStrongPassword(28, source);
            expect(password).toHaveLength(28);
            expect(calls).toBeGreaterThan(0);
        } finally {
            Math.random = originalMathRandom;
        }
    });

    it.each([16, 28, 256])('should generate exactly the requested length (%s)', (length) => {
        const source = {
            getRandomValues<T extends ArrayBufferView | null>(array: T): T {
                if (array instanceof Uint8Array) {
                    array.fill(0);
                }
                return array;
            },
        };

        expect(generateStrongPassword(length, source)).toHaveLength(length);
    });

    it.each([Number.NaN, 15, 257, 16.5, Number.POSITIVE_INFINITY])(
        'should reject an invalid requested length (%s)',
        (length) => {
            expect(() => generateStrongPassword(length)).toThrow(RangeError);
        },
    );

    it('should only emit characters from the documented alphabet', () => {
        const source = {
            getRandomValues<T extends ArrayBufferView | null>(array: T): T {
                if (array instanceof Uint8Array) {
                    array.forEach((_, index) => {
                        array[index] = index;
                    });
                }
                return array;
            },
        };
        const password = generateStrongPassword(64, source);
        expect(password).toMatch(/^[A-Za-z0-9!@#$%^&*_+=-]+$/);
    });
});
