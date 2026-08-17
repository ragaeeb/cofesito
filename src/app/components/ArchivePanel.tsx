import { formatBytes } from '../../archive/files';
import type { ArchiveLifecycle } from '../app-state';

export type ArchivePanelProps = {
    readonly archiveName: string;
    readonly lifecycle: ArchiveLifecycle;
    readonly notice: string | null;
    readonly onArchiveNameChange: (name: string) => void;
    readonly onCancel: () => void;
    readonly onCreate: () => void;
};

export default function ArchivePanel({
    archiveName,
    lifecycle,
    notice,
    onArchiveNameChange,
    onCancel,
    onCreate,
}: ArchivePanelProps) {
    const building = lifecycle.kind === 'building';
    const success = lifecycle.kind === 'success' ? lifecycle : null;
    const progress = building ? lifecycle.progress : null;
    const percent = progress ? Math.max(0, Math.min(100, Math.round(progress.percent))) : 0;
    const archiveMessage = lifecycle.kind === 'error' || lifecycle.kind === 'cancelled' ? lifecycle.message : null;
    const message = [archiveMessage, notice].filter((value): value is string => value !== null).join(' ');

    return (
        <>
            <section class="control-section archive-section" aria-labelledby="archive-heading">
                <div class="section-heading">
                    <h2 id="archive-heading">Output</h2>
                </div>

                <div class="archive-row">
                    <label class="field archive-name-field">
                        <span>Filename</span>
                        <input
                            type="text"
                            value={archiveName}
                            autocomplete="off"
                            spellcheck={false}
                            disabled={building}
                            aria-disabled={building}
                            onInput={(event) => onArchiveNameChange(event.currentTarget.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    onCreate();
                                }
                            }}
                        />
                    </label>
                    <button
                        class="button primary"
                        type="button"
                        disabled={building}
                        aria-disabled={building}
                        onClick={onCreate}
                    >
                        Create ZIP
                    </button>
                </div>
            </section>

            <div class="status-panel">
                {message ? (
                    <div class="notice error-notice" role="alert">
                        {message}
                    </div>
                ) : null}

                <div class="progress-panel" hidden={!building}>
                    <div class="progress-copy">
                        <span id="progress-label">
                            {progress
                                ? `Encrypting ${progress.fileIndex}/${progress.fileCount}: ${progress.currentFile}`
                                : 'Preparing encrypted archive…'}
                        </span>
                        <span id="progress-percent">{percent}%</span>
                    </div>
                    <progress id="progress" max="100" value={percent} aria-labelledby="progress-label progress-percent">
                        {percent}%
                    </progress>
                    <button
                        class="danger-text text-button"
                        type="button"
                        disabled={!building}
                        aria-disabled={!building}
                        onClick={onCancel}
                    >
                        Cancel
                    </button>
                </div>

                <div class="success-panel" role="status" aria-live="polite" aria-atomic="true" hidden={!success}>
                    <div>
                        <strong>ZIP ready</strong>
                        <span>{success ? `${success.filename} · ${formatBytes(success.size)}` : ''}</span>
                    </div>
                    <a
                        class="button success-button"
                        href={success?.objectUrl}
                        download={success?.filename}
                        hidden={!success}
                        aria-disabled={!success}
                    >
                        Download ZIP
                    </a>
                </div>
            </div>
        </>
    );
}
