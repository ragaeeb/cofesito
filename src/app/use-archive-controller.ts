import { useCallback, useEffect, useReducer, useRef } from 'preact/hooks';
import { normalizeDownloadName } from '../archive/download';
import { clearRememberedPassword, updateRememberedPassword, validatePasswords } from '../archive/password';
import type { SelectedFile } from '../archive/types';
import { type AppDependencies, createRuntime } from './app-runtime';
import { type AppState, appReducer } from './app-state';

export type ArchiveControllerActions = {
    readonly onArchiveNameChange: (name: string) => void;
    readonly onCancel: () => void;
    readonly onClearFiles: () => void;
    readonly onClearRemembered: () => void;
    readonly onCommitPassword: () => void;
    readonly onCopy: (password: string) => Promise<boolean>;
    readonly onCreate: () => void;
    readonly onFileError: (message: string) => void;
    readonly onFilesAdded: (files: readonly SelectedFile[]) => void;
    readonly onGenerate: (password: string) => void;
    readonly onPasswordChange: (password: string, confirmation?: boolean) => void;
    readonly onRememberChange: (remember: boolean) => void;
    readonly onRemoveFile: (id: string) => void;
};

export type ArchiveController = {
    readonly state: AppState;
    readonly actions: ArchiveControllerActions;
};

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'The archive could not be created.';
}

function isAbortError(error: unknown): boolean {
    return (
        (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError') ||
        (typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError')
    );
}

export function useArchiveController(dependencies?: AppDependencies): ArchiveController {
    const runtimeRef = useRef<ReturnType<typeof createRuntime> | undefined>(undefined);
    if (!runtimeRef.current) {
        runtimeRef.current = createRuntime(dependencies);
    }
    const runtime = runtimeRef.current;
    const [state, dispatch] = useReducer(appReducer, runtime.initialState);
    const activeControllerRef = useRef<AbortController | null>(null);
    const buildingRef = useRef(false);
    const ownedObjectUrlRef = useRef<string | null>(null);
    const mountedRef = useRef(true);

    buildingRef.current = state.lifecycle.kind === 'building';

    const revokeOwnedObjectUrl = useCallback(() => {
        const objectUrl = ownedObjectUrlRef.current;
        if (!objectUrl) {
            return;
        }
        ownedObjectUrlRef.current = null;
        runtime.revokeObjectUrl(objectUrl);
    }, [runtime]);

    useEffect(() => {
        const beforeUnload = (): void => {
            activeControllerRef.current?.abort();
            revokeOwnedObjectUrl();
        };
        window.addEventListener('beforeunload', beforeUnload);
        return () => {
            mountedRef.current = false;
            activeControllerRef.current?.abort();
            revokeOwnedObjectUrl();
            window.removeEventListener('beforeunload', beforeUnload);
        };
    }, [revokeOwnedObjectUrl]);

    const reportNotice = useCallback((message: string): void => {
        if (!mountedRef.current) {
            return;
        }
        dispatch({ message, type: 'notice' });
    }, []);

    const persistPassword = useCallback(
        (password: string, shouldRemember: boolean): boolean => {
            if (!runtime.storage) {
                if (shouldRemember) {
                    dispatch({
                        message: 'Browser local storage is unavailable; the password was not remembered.',
                        type: 'storage-failure',
                    });
                    return false;
                }
                return true;
            }
            try {
                updateRememberedPassword(runtime.storage, password, shouldRemember);
                return true;
            } catch {
                dispatch({
                    message: 'Browser local storage is unavailable; the password was not remembered.',
                    type: 'storage-failure',
                });
                return false;
            }
        },
        [runtime.storage],
    );

    const onFilesAdded = useCallback(
        (files: readonly SelectedFile[]): void => {
            if (!mountedRef.current || buildingRef.current || activeControllerRef.current) {
                return;
            }
            revokeOwnedObjectUrl();
            dispatch({ files, type: 'files-added' });
        },
        [revokeOwnedObjectUrl],
    );

    const onFileError = useCallback(
        (message: string): void => {
            if (!mountedRef.current || buildingRef.current || activeControllerRef.current) {
                return;
            }
            reportNotice(message);
        },
        [reportNotice],
    );

    const onRemoveFile = useCallback(
        (id: string): void => {
            revokeOwnedObjectUrl();
            dispatch({ id, type: 'file-removed' });
        },
        [revokeOwnedObjectUrl],
    );

    const onClearFiles = useCallback((): void => {
        revokeOwnedObjectUrl();
        dispatch({ files: [], type: 'files-changed' });
    }, [revokeOwnedObjectUrl]);

    const onPasswordChange = useCallback(
        (value: string, confirmation = false): void => {
            revokeOwnedObjectUrl();
            const clearRemembered = !confirmation && value.length === 0;
            dispatch({
                type: 'passwords-changed',
                ...(confirmation ? { confirmation: value } : { password: value }),
                ...(clearRemembered ? { rememberPassword: false } : {}),
            });
            if (clearRemembered) {
                persistPassword('', false);
            }
        },
        [persistPassword, revokeOwnedObjectUrl],
    );

    const onRememberChange = useCallback(
        (remember: boolean): void => {
            if (remember && state.password.length === 0) {
                dispatch({ type: 'remember-changed', value: false });
                persistPassword('', false);
                return;
            }
            dispatch({ type: 'remember-changed', value: remember });
            persistPassword(state.password, remember);
        },
        [persistPassword, state.password],
    );

    const onClearRemembered = useCallback((): void => {
        let failureMessage: string | undefined;
        if (runtime.storage) {
            try {
                clearRememberedPassword(runtime.storage);
            } catch {
                failureMessage = 'Browser local storage is unavailable. No stored password could be accessed.';
            }
        }
        dispatch({ type: 'clear-password' });
        if (failureMessage) {
            dispatch({ message: failureMessage, type: 'storage-failure' });
        }
    }, [runtime.storage]);

    const onCopy = useCallback(
        async (password: string): Promise<boolean> => {
            if (!password) {
                reportNotice('Enter or generate a password before copying it.');
                return false;
            }
            if (!runtime.clipboard) {
                reportNotice('The browser did not allow clipboard access. Use Show and copy the password manually.');
                return false;
            }
            try {
                await runtime.clipboard.writeText(password);
                return true;
            } catch {
                reportNotice('The browser did not allow clipboard access. Use Show and copy the password manually.');
                return false;
            }
        },
        [reportNotice, runtime.clipboard],
    );

    const onGenerate = useCallback(
        (password: string): void => {
            revokeOwnedObjectUrl();
            dispatch({ confirmation: password, password, type: 'passwords-changed' });
            if (state.rememberPassword) {
                persistPassword(password, true);
            }
        },
        [persistPassword, revokeOwnedObjectUrl, state.rememberPassword],
    );

    const onCommitPassword = useCallback((): void => {
        if (state.rememberPassword) {
            persistPassword(state.password, true);
        }
    }, [persistPassword, state.password, state.rememberPassword]);

    const onCreate = useCallback((): void => {
        if (activeControllerRef.current) {
            return;
        }

        if (state.selectedFiles.length === 0) {
            dispatch({ message: 'Select at least one file before creating an archive.', type: 'archive-error' });
            return;
        }

        const validation = validatePasswords(state.password, state.confirmation);
        if (!validation.valid) {
            dispatch({ message: validation.message ?? 'Check the password fields.', type: 'archive-error' });
            return;
        }

        const filename = normalizeDownloadName(state.archiveName);
        if (state.rememberPassword && !persistPassword(state.password, true)) {
            return;
        }

        revokeOwnedObjectUrl();
        const controller = new AbortController();
        activeControllerRef.current = controller;
        dispatch({ filename, type: 'start-building' });

        void runtime
            .createArchive({
                files: state.selectedFiles,
                onProgress: (progress) => dispatch({ progress, type: 'progress' }),
                password: state.password,
                signal: controller.signal,
            })
            .then((archive) => {
                if (!mountedRef.current) {
                    return;
                }
                const objectUrl = runtime.createObjectUrl(archive);
                ownedObjectUrlRef.current = objectUrl;
                dispatch({ filename, objectUrl, size: archive.size, type: 'success' });
                try {
                    runtime.triggerDownload(objectUrl, filename);
                } catch {
                    // The fallback link remains available when an automatic click is blocked.
                }
            })
            .catch((error: unknown) => {
                if (!mountedRef.current) {
                    return;
                }
                if (isAbortError(error)) {
                    dispatch({ type: 'cancelled' });
                } else {
                    dispatch({ message: errorMessage(error), type: 'archive-error' });
                }
            })
            .finally(() => {
                if (activeControllerRef.current === controller) {
                    activeControllerRef.current = null;
                }
            });
    }, [
        persistPassword,
        revokeOwnedObjectUrl,
        runtime,
        state.archiveName,
        state.confirmation,
        state.password,
        state.rememberPassword,
        state.selectedFiles,
    ]);

    const onArchiveNameChange = useCallback(
        (name: string): void => {
            revokeOwnedObjectUrl();
            dispatch({ type: 'archive-name-changed', value: name });
        },
        [revokeOwnedObjectUrl],
    );

    const onCancel = useCallback((): void => {
        activeControllerRef.current?.abort();
    }, []);

    return {
        actions: {
            onArchiveNameChange,
            onCancel,
            onClearFiles,
            onClearRemembered,
            onCommitPassword,
            onCopy,
            onCreate,
            onFileError,
            onFilesAdded,
            onGenerate,
            onPasswordChange,
            onRememberChange,
            onRemoveFile,
        },
        state,
    };
}
