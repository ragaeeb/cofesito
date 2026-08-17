import { triggerDownload as startDownload } from '../archive/download';
import { type CreateEncryptedZipOptions, createEncryptedZip } from '../archive/zip';
import { type AppState, createInitialState } from './app-state';

export type ArchiveCreator = (options: CreateEncryptedZipOptions) => Promise<Blob>;

export type AppDependencies = {
    readonly clipboard?: Pick<Clipboard, 'writeText'>;
    readonly createArchive?: ArchiveCreator;
    readonly createObjectUrl?: (blob: Blob) => string;
    readonly revokeObjectUrl?: (url: string) => void;
    readonly storage?: Storage | null;
    readonly triggerDownload?: (url: string, filename: string) => void;
};

export type AppRuntime = {
    readonly clipboard: Pick<Clipboard, 'writeText'> | null;
    readonly createArchive: ArchiveCreator;
    readonly createObjectUrl: (blob: Blob) => string;
    readonly initialState: AppState;
    readonly revokeObjectUrl: (url: string) => void;
    readonly storage: Storage | null;
    readonly triggerDownload: (url: string, filename: string) => void;
};

function getBrowserStorage(): Storage | null {
    try {
        return typeof window === 'undefined' ? null : window.localStorage;
    } catch {
        return null;
    }
}

export function createRuntime(dependencies: AppDependencies | undefined): AppRuntime {
    const storage = dependencies && dependencies.storage !== undefined ? dependencies.storage : getBrowserStorage();
    const clipboard =
        dependencies?.clipboard ?? (typeof navigator !== 'undefined' ? (navigator.clipboard ?? null) : null);
    return {
        clipboard,
        createArchive: dependencies?.createArchive ?? createEncryptedZip,
        createObjectUrl: dependencies?.createObjectUrl ?? ((blob) => URL.createObjectURL(blob)),
        initialState: createInitialState(storage),
        revokeObjectUrl: dependencies?.revokeObjectUrl ?? ((url) => URL.revokeObjectURL(url)),
        storage,
        triggerDownload: dependencies?.triggerDownload ?? ((url, filename) => startDownload(url, filename)),
    };
}
