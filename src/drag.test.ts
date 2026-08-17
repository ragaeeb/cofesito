import { expect, it } from 'bun:test';
import { isDragLeaveOutside } from './drag';

it('keeps the highlight while moving between drop-zone children', () => {
    const child = {};
    expect(isDragLeaveOutside(child, (target) => target === child)).toBe(false);
    expect(isDragLeaveOutside({}, (target) => target === child)).toBe(true);
    expect(isDragLeaveOutside(null, () => true)).toBe(true);
});
