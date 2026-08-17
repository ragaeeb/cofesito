export type SelectedFile = {
    readonly id: string;
    readonly file: File;
    readonly path: string;
    readonly size: number;
    readonly lastModified: number;
};

export type ZipProgress = {
    readonly processedBytes: number;
    readonly totalBytes: number;
    readonly currentFile: string;
    readonly fileIndex: number;
    readonly fileCount: number;
    readonly percent: number;
};
