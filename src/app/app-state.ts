import { mergeSelectedFiles } from '../archive/files';
import { loadRememberedPassword } from '../archive/password';
import type { SelectedFile, ZipProgress } from '../archive/types';

export type ArchiveLifecycle =
    | { readonly kind: 'idle' }
    | { readonly kind: 'building'; readonly progress: ZipProgress | null }
    | { readonly kind: 'success'; readonly filename: string; readonly objectUrl: string; readonly size: number }
    | { readonly kind: 'cancelled'; readonly message: string }
    | { readonly kind: 'error'; readonly message: string };

export type AppState = {
    readonly archiveName: string;
    readonly confirmation: string;
    readonly lifecycle: ArchiveLifecycle;
    readonly notice: string | null;
    readonly password: string;
    readonly rememberPassword: boolean;
    readonly selectedFiles: readonly SelectedFile[];
    readonly storageAvailable: boolean;
};

export type AppAction =
    | { readonly type: 'archive-name-changed'; readonly value: string }
    | { readonly type: 'cancelled' }
    | { readonly type: 'clear-password' }
    | { readonly type: 'archive-error'; readonly message: string }
    | { readonly type: 'file-removed'; readonly id: string }
    | { readonly type: 'files-added'; readonly files: readonly SelectedFile[] }
    | { readonly type: 'files-changed'; readonly files: readonly SelectedFile[] }
    | {
          readonly type: 'passwords-changed';
          readonly confirmation?: string;
          readonly password?: string;
          readonly rememberPassword?: boolean;
      }
    | { readonly type: 'progress'; readonly progress: ZipProgress }
    | { readonly type: 'remember-changed'; readonly value: boolean }
    | { readonly type: 'start-building'; readonly filename: string }
    | { readonly type: 'storage-failure'; readonly message: string }
    | { readonly type: 'notice'; readonly message: string }
    | { readonly type: 'success'; readonly filename: string; readonly objectUrl: string; readonly size: number };

function idleLifecycle(): ArchiveLifecycle {
    return { kind: 'idle' };
}

export function createInitialState(storage: Storage | null): AppState {
    if (!storage) {
        return {
            archiveName: 'encrypted.zip',
            confirmation: '',
            lifecycle: idleLifecycle(),
            notice: null,
            password: '',
            rememberPassword: false,
            selectedFiles: [],
            storageAvailable: false,
        };
    }

    try {
        const remembered = loadRememberedPassword(storage);
        return {
            archiveName: 'encrypted.zip',
            confirmation: remembered ?? '',
            lifecycle: idleLifecycle(),
            notice: null,
            password: remembered ?? '',
            rememberPassword: remembered !== null,
            selectedFiles: [],
            storageAvailable: true,
        };
    } catch {
        return {
            archiveName: 'encrypted.zip',
            confirmation: '',
            lifecycle: idleLifecycle(),
            notice: null,
            password: '',
            rememberPassword: false,
            selectedFiles: [],
            storageAvailable: false,
        };
    }
}

function invalidate(state: AppState, update: Partial<AppState>): AppState {
    if (state.lifecycle.kind === 'building') {
        return state;
    }
    return { ...state, ...update, lifecycle: idleLifecycle(), notice: null };
}

export function appReducer(state: AppState, action: AppAction): AppState {
    switch (action.type) {
        case 'archive-name-changed':
            return invalidate(state, { archiveName: action.value });
        case 'cancelled':
            return { ...state, lifecycle: { kind: 'cancelled', message: 'Archive creation cancelled.' }, notice: null };
        case 'clear-password':
            return invalidate(state, { confirmation: '', password: '', rememberPassword: false });
        case 'archive-error':
            return { ...state, lifecycle: { kind: 'error', message: action.message }, notice: null };
        case 'file-removed':
            return invalidate(state, { selectedFiles: state.selectedFiles.filter((file) => file.id !== action.id) });
        case 'files-added':
            return invalidate(state, { selectedFiles: mergeSelectedFiles(state.selectedFiles, action.files) });
        case 'files-changed':
            return invalidate(state, { selectedFiles: action.files });
        case 'passwords-changed':
            return invalidate(state, {
                confirmation: action.confirmation ?? state.confirmation,
                password: action.password ?? state.password,
                ...(action.rememberPassword === undefined ? {} : { rememberPassword: action.rememberPassword }),
            });
        case 'progress':
            return state.lifecycle.kind === 'building'
                ? { ...state, lifecycle: { ...state.lifecycle, progress: action.progress } }
                : state;
        case 'remember-changed':
            return { ...state, rememberPassword: action.value };
        case 'start-building':
            return {
                ...state,
                archiveName: action.filename,
                lifecycle: { kind: 'building', progress: null },
                notice: null,
            };
        case 'storage-failure':
            return {
                ...state,
                notice: action.message,
                rememberPassword: false,
                storageAvailable: false,
            };
        case 'notice':
            return { ...state, notice: action.message };
        case 'success':
            return {
                ...state,
                lifecycle: {
                    filename: action.filename,
                    kind: 'success',
                    objectUrl: action.objectUrl,
                    size: action.size,
                },
                notice: null,
            };
    }
}
