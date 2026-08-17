import { describe, expect, it } from 'bun:test';
import { MemoryStorage } from './memory-storage';

describe('MemoryStorage', () => {
    it('stores, reads, overwrites, and removes string values', () => {
        const storage = new MemoryStorage();
        storage.setItem('answer', 42 as unknown as string);
        expect(storage.getItem('answer')).toBe('42');
        storage.setItem('answer', 'updated');
        expect(storage.getItem('answer')).toBe('updated');
        storage.removeItem('answer');
        expect(storage.getItem('answer')).toBeNull();
    });

    it('supports key, length, and clear according to the Storage contract', () => {
        const storage = new MemoryStorage();
        storage.setItem('first', '1');
        storage.setItem('second', '2');
        expect(storage.length).toBe(2);
        expect(storage.key(0)).toBe('first');
        expect(storage.key(1)).toBe('second');
        expect(storage.key(2)).toBeNull();
        storage.clear();
        expect(storage.length).toBe(0);
        expect(storage.key(0)).toBeNull();
    });
});
