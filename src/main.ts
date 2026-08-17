import './style.css';
import { normalizeDownloadName, triggerDownload } from './download';
import { isDragLeaveOutside } from './drag';
import { filesFromDataTransfer, filesFromFileList, formatBytes, getTotalSize, mergeSelectedFiles } from './files';
import { installNoNetworkRuntimeGuard } from './network-guard';
import {
    clearRememberedPassword,
    generateStrongPassword,
    loadRememberedPassword,
    updateRememberedPassword,
    validatePasswords,
} from './password';
import type { SelectedFile, ZipProgress } from './types';
import { createEncryptedZip } from './zip';

// Production is always guarded. Dev can opt in for network-regression testing;
// leaving it off preserves Vite's HMR connection during normal development.
if (import.meta.env.PROD || import.meta.env.VITE_ENFORCE_NO_NETWORK === 'true') {
    installNoNetworkRuntimeGuard();
}

function byId<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`Required UI element is missing: ${id}`);
    }
    return element as T;
}

const dropZone = byId<HTMLDivElement>('drop-zone');
const fileInput = byId<HTMLInputElement>('file-input');
const folderInput = byId<HTMLInputElement>('folder-input');
const pickFilesButton = byId<HTMLButtonElement>('pick-files');
const pickFolderButton = byId<HTMLButtonElement>('pick-folder');
const clearFilesButton = byId<HTMLButtonElement>('clear-files');
const fileList = byId<HTMLUListElement>('file-list');
const fileListWrap = byId<HTMLDivElement>('file-list-wrap');
const fileSummary = byId<HTMLDivElement>('file-summary');
const passwordInput = byId<HTMLInputElement>('password');
const confirmationInput = byId<HTMLInputElement>('password-confirm');
const togglePasswordButton = byId<HTMLButtonElement>('toggle-password');
const generatePasswordButton = byId<HTMLButtonElement>('generate-password');
const copyPasswordButton = byId<HTMLButtonElement>('copy-password');
const rememberPasswordCheckbox = byId<HTMLInputElement>('remember-password');
const clearRememberedButton = byId<HTMLButtonElement>('clear-remembered');
const archiveNameInput = byId<HTMLInputElement>('archive-name');
const createButton = byId<HTMLButtonElement>('create-zip');
const cancelButton = byId<HTMLButtonElement>('cancel');
const errorBox = byId<HTMLDivElement>('error-box');
const progressPanel = byId<HTMLDivElement>('progress-panel');
const progressElement = byId<HTMLProgressElement>('progress');
const progressLabel = byId<HTMLSpanElement>('progress-label');
const progressPercent = byId<HTMLSpanElement>('progress-percent');
const successPanel = byId<HTMLDivElement>('success-panel');
const successDetail = byId<HTMLSpanElement>('success-detail');
const downloadAgain = byId<HTMLAnchorElement>('download-again');

let selectedFiles: SelectedFile[] = [];
let activeController: AbortController | null = null;
let activeObjectUrl: string | null = null;
let passwordStorage: Storage | null = getPasswordStorage();
let copyResetTimer: number | null = null;
let pendingProgress: ZipProgress | null = null;
let progressFrame: number | null = null;

function getPasswordStorage(): Storage | null {
    try {
        return window.localStorage;
    } catch {
        return null;
    }
}

function showError(message: string): void {
    errorBox.textContent = message;
    errorBox.hidden = false;
}

function clearError(): void {
    errorBox.textContent = '';
    errorBox.hidden = true;
}

function revokeArchiveUrl(): void {
    if (activeObjectUrl) {
        URL.revokeObjectURL(activeObjectUrl);
        activeObjectUrl = null;
    }
    downloadAgain.removeAttribute('href');
    downloadAgain.removeAttribute('download');
    downloadAgain.hidden = true;
    successDetail.textContent = '';
    successPanel.hidden = true;
}

function setBusy(isBusy: boolean): void {
    for (const element of document.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input')) {
        if (element === cancelButton) {
            continue;
        }
        element.toggleAttribute('disabled', isBusy);
        element.setAttribute('aria-disabled', String(isBusy));
    }

    dropZone.setAttribute('aria-busy', String(isBusy));
    cancelButton.disabled = !isBusy;
    cancelButton.setAttribute('aria-disabled', String(!isBusy));
    progressPanel.hidden = !isBusy;
}

function renderFiles(): void {
    fileList.replaceChildren();
    fileListWrap.hidden = selectedFiles.length === 0;
    const totalSize = getTotalSize(selectedFiles);
    fileSummary.textContent = `${selectedFiles.length} ${selectedFiles.length === 1 ? 'file' : 'files'} · ${formatBytes(totalSize)}`;

    for (const item of selectedFiles) {
        const row = document.createElement('li');
        const fileMeta = document.createElement('div');
        const path = document.createElement('span');
        const size = document.createElement('span');
        const remove = document.createElement('button');

        fileMeta.className = 'file-meta';
        path.className = 'file-path';
        path.textContent = item.path;
        path.title = item.path;
        size.className = 'file-size';
        size.textContent = formatBytes(item.size);
        fileMeta.append(path, size);

        remove.className = 'remove-file';
        remove.type = 'button';
        remove.textContent = 'Remove';
        remove.dataset.fileId = item.id;
        remove.setAttribute('aria-label', `Remove ${item.path}`);

        row.append(fileMeta, remove);
        fileList.append(row);
    }
}

function addFiles(files: readonly SelectedFile[]): void {
    selectedFiles = mergeSelectedFiles(selectedFiles, files);
    revokeArchiveUrl();
    clearError();
    renderFiles();
}

function updatePasswordPersistence(): void {
    if (rememberPasswordCheckbox.checked && passwordInput.value.length === 0) {
        rememberPasswordCheckbox.checked = false;
        if (passwordStorage) {
            try {
                clearRememberedPassword(passwordStorage);
            } catch {
                passwordStorage = null;
            }
        }
        return;
    }

    if (!passwordStorage) {
        if (rememberPasswordCheckbox.checked) {
            rememberPasswordCheckbox.checked = false;
            showError('Browser local storage is unavailable; the password was not remembered.');
        }
        return;
    }

    try {
        updateRememberedPassword(passwordStorage, passwordInput.value, rememberPasswordCheckbox.checked);
    } catch {
        passwordStorage = null;
        rememberPasswordCheckbox.checked = false;
        showError('Browser local storage is unavailable; the password was not remembered.');
    }
}

function applyProgress(progress: ZipProgress): void {
    const roundedPercent = Math.max(0, Math.min(100, Math.round(progress.percent)));
    progressElement.value = roundedPercent;
    progressElement.textContent = `${roundedPercent}%`;
    progressPercent.textContent = `${roundedPercent}%`;
    progressLabel.textContent = `Encrypting ${progress.fileIndex}/${progress.fileCount}: ${progress.currentFile}`;
}

function renderProgress(progress: ZipProgress): void {
    pendingProgress = progress;
    if (progressFrame !== null) {
        return;
    }
    const flush = (): void => {
        progressFrame = null;
        const next = pendingProgress;
        pendingProgress = null;
        if (next) {
            applyProgress(next);
        }
    };
    if (typeof window.requestAnimationFrame === 'function') {
        progressFrame = window.requestAnimationFrame(flush);
    } else {
        progressFrame = window.setTimeout(flush, 0);
    }
}

function restoreRememberedPassword(): void {
    if (!passwordStorage) {
        return;
    }

    try {
        const remembered = loadRememberedPassword(passwordStorage);
        if (!remembered) {
            return;
        }
        passwordInput.value = remembered;
        confirmationInput.value = remembered;
        rememberPasswordCheckbox.checked = true;
    } catch {
        passwordStorage = null;
    }
}

pickFilesButton.addEventListener('click', () => fileInput.click());
pickFolderButton.addEventListener('click', () => folderInput.click());

dropZone.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (activeController) {
        return;
    }
    dropZone.classList.add('dragging');
    if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
    }
});

dropZone.addEventListener('dragenter', (event) => {
    event.preventDefault();
    if (!activeController) {
        dropZone.classList.add('dragging');
    }
});

dropZone.addEventListener('dragleave', (event) => {
    if (!isDragLeaveOutside(event.relatedTarget, (target) => dropZone.contains(target as Node))) {
        return;
    }
    dropZone.classList.remove('dragging');
});

dropZone.addEventListener('drop', async (event) => {
    event.preventDefault();
    dropZone.classList.remove('dragging');
    if (activeController || !event.dataTransfer) {
        return;
    }

    try {
        addFiles(await filesFromDataTransfer(event.dataTransfer));
    } catch (error) {
        showError(error instanceof Error ? error.message : 'Could not read the dropped files.');
    }
});

// A drop outside the designated target would otherwise navigate the page to the
// dropped file and destroy the in-memory selection.
document.addEventListener('dragover', (event) => {
    if (!(event.target instanceof Node) || !dropZone.contains(event.target)) {
        event.preventDefault();
    }
});
document.addEventListener('drop', (event) => {
    if (!(event.target instanceof Node) || !dropZone.contains(event.target)) {
        event.preventDefault();
    }
});

fileInput.addEventListener('change', () => {
    if (fileInput.files) {
        addFiles(filesFromFileList(fileInput.files));
    }
    fileInput.value = '';
});

folderInput.addEventListener('change', () => {
    if (folderInput.files) {
        addFiles(filesFromFileList(folderInput.files));
    }
    folderInput.value = '';
});

fileList.addEventListener('click', (event) => {
    if (activeController) {
        return;
    }
    const target = event.target;
    if (!(target instanceof Element)) {
        return;
    }
    const button = target.closest<HTMLButtonElement>('button[data-file-id]');
    if (!button?.dataset.fileId) {
        return;
    }
    selectedFiles = selectedFiles.filter((item) => item.id !== button.dataset.fileId);
    revokeArchiveUrl();
    renderFiles();
});

clearFilesButton.addEventListener('click', () => {
    selectedFiles = [];
    revokeArchiveUrl();
    renderFiles();
});

togglePasswordButton.addEventListener('click', () => {
    const reveal = passwordInput.type === 'password';
    const type = reveal ? 'text' : 'password';
    passwordInput.type = type;
    confirmationInput.type = type;
    togglePasswordButton.textContent = reveal ? 'Hide' : 'Show';
    togglePasswordButton.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
    togglePasswordButton.setAttribute('aria-pressed', String(reveal));
});

generatePasswordButton.addEventListener('click', () => {
    const generated = generateStrongPassword();
    passwordInput.value = generated;
    confirmationInput.value = generated;
    if (rememberPasswordCheckbox.checked) {
        updatePasswordPersistence();
    }
    clearError();
});

copyPasswordButton.addEventListener('click', async () => {
    if (!passwordInput.value) {
        showError('Enter or generate a password before copying it.');
        return;
    }

    try {
        await navigator.clipboard.writeText(passwordInput.value);
        if (copyResetTimer !== null) {
            window.clearTimeout(copyResetTimer);
        }
        copyPasswordButton.textContent = 'Copied';
        copyResetTimer = window.setTimeout(() => {
            copyResetTimer = null;
            copyPasswordButton.textContent = 'Copy password';
        }, 1400);
    } catch {
        showError('The browser did not allow clipboard access. Use Show and copy the password manually.');
    }
});

rememberPasswordCheckbox.addEventListener('change', updatePasswordPersistence);
passwordInput.addEventListener('input', () => {
    revokeArchiveUrl();
});
passwordInput.addEventListener('change', updatePasswordPersistence);
confirmationInput.addEventListener('input', revokeArchiveUrl);
archiveNameInput.addEventListener('input', revokeArchiveUrl);

for (const input of [passwordInput, confirmationInput, archiveNameInput]) {
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            createButton.click();
        }
    });
}

clearRememberedButton.addEventListener('click', () => {
    clearError();
    if (passwordStorage) {
        try {
            clearRememberedPassword(passwordStorage);
        } catch {
            passwordStorage = null;
            showError('Browser local storage is unavailable. No stored password could be accessed.');
        }
    }
    rememberPasswordCheckbox.checked = false;
    passwordInput.value = '';
    confirmationInput.value = '';
    passwordInput.focus();
});

cancelButton.addEventListener('click', () => {
    activeController?.abort();
});

createButton.addEventListener('click', async () => {
    clearError();
    revokeArchiveUrl();

    if (selectedFiles.length === 0) {
        showError('Select at least one file or directory first.');
        return;
    }

    const validation = validatePasswords(passwordInput.value, confirmationInput.value);
    if (!validation.valid) {
        showError(validation.message ?? 'Check the password fields.');
        return;
    }

    const filename = normalizeDownloadName(archiveNameInput.value);
    archiveNameInput.value = filename;
    if (rememberPasswordCheckbox.checked) {
        updatePasswordPersistence();
    }

    const controller = new AbortController();
    activeController = controller;
    setBusy(true);
    progressElement.value = 0;
    progressPercent.textContent = '0%';
    progressLabel.textContent = 'Preparing encrypted archive…';

    try {
        const archive = await createEncryptedZip({
            files: selectedFiles,
            onProgress: renderProgress,
            password: passwordInput.value,
            signal: controller.signal,
        });

        if (controller.signal.aborted) {
            return;
        }

        activeObjectUrl = URL.createObjectURL(archive);
        downloadAgain.href = activeObjectUrl;
        downloadAgain.download = filename;
        downloadAgain.hidden = false;
        successDetail.textContent = `${filename} · ${formatBytes(archive.size)} · WinZip AES-256. If the automatic download does not start, use the button below.`;
        successPanel.hidden = false;
        triggerDownload(activeObjectUrl, filename);
    } catch (error) {
        if (isAbortError(error)) {
            showError('Archive creation was cancelled. No output archive was kept.');
        } else {
            showError(error instanceof Error ? error.message : 'Could not create the encrypted archive.');
        }
    } finally {
        activeController = null;
        setBusy(false);
    }
});

window.addEventListener('beforeunload', revokeArchiveUrl);

restoreRememberedPassword();
renderFiles();

function isAbortError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError';
}
