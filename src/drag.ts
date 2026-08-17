/** Returns true when a drag leaves the drop zone rather than moving between children. */
export function isDragLeaveOutside(relatedTarget: unknown, contains: (target: object) => boolean): boolean {
    return relatedTarget === null || typeof relatedTarget !== 'object' || !contains(relatedTarget);
}
