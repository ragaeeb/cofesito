import { useEffect, useRef, useState } from 'preact/hooks';
import { filesFromDataTransfer, filesFromFileList, formatBytes, getTotalSize } from '../../archive/files';
import type { SelectedFile } from '../../archive/types';

function isDragLeaveOutside(relatedTarget: EventTarget | null, contains: (target: EventTarget) => boolean): boolean {
    return !(relatedTarget instanceof Node) || !contains(relatedTarget);
}

export type FilePickerProps = {
    readonly busy: boolean;
    readonly selectedFiles: readonly SelectedFile[];
    readonly onClear: () => void;
    readonly onError: (message: string) => void;
    readonly onFilesAdded: (files: readonly SelectedFile[]) => void;
    readonly onRemove: (id: string) => void;
};

function fileSummary(files: readonly SelectedFile[]): string {
    const countLabel = files.length === 1 ? 'file' : 'files';
    return `${files.length} ${countLabel} · ${formatBytes(getTotalSize(files))}`;
}

export default function FilePicker({ busy, onClear, onError, onFilesAdded, onRemove, selectedFiles }: FilePickerProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const folderInputRef = useRef<HTMLInputElement>(null);
    const dropZoneRef = useRef<HTMLElement>(null);
    const busyRef = useRef(busy);
    const [dragging, setDragging] = useState(false);
    busyRef.current = busy;

    useEffect(() => {
        const preventOutsideDragover = (event: DragEvent): void => {
            const target = event.target;
            if (!(target instanceof Node) || !dropZoneRef.current?.contains(target)) {
                event.preventDefault();
            }
        };
        const preventOutsideDrop = (event: DragEvent): void => {
            const target = event.target;
            if (!(target instanceof Node) || !dropZoneRef.current?.contains(target)) {
                event.preventDefault();
            }
        };

        document.addEventListener('dragover', preventOutsideDragover);
        document.addEventListener('drop', preventOutsideDrop);
        folderInputRef.current?.setAttribute('webkitdirectory', '');
        return () => {
            document.removeEventListener('dragover', preventOutsideDragover);
            document.removeEventListener('drop', preventOutsideDrop);
        };
    }, []);

    const addFileList = (fileList: FileList | null): void => {
        if (!fileList || busyRef.current) {
            return;
        }
        try {
            onFilesAdded(filesFromFileList(fileList));
        } catch (error) {
            onError(error instanceof Error ? error.message : 'The selected files could not be read.');
        }
    };

    const handleDrop = (event: DragEvent): void => {
        event.preventDefault();
        setDragging(false);
        if (busyRef.current || !event.dataTransfer) {
            return;
        }

        void filesFromDataTransfer(event.dataTransfer)
            .then((files) => {
                if (!busyRef.current) {
                    onFilesAdded(files);
                }
            })
            .catch((error: unknown) => {
                if (!busyRef.current) {
                    onError(error instanceof Error ? error.message : 'The dropped files could not be read.');
                }
            });
    };

    return (
        <div class="file-picker-column">
            <section class="card files-card" aria-labelledby="files-heading">
                <div class="section-heading">
                    <h2 id="files-heading">Files</h2>
                    <div class="summary-pill">{fileSummary(selectedFiles)}</div>
                </div>

                <section
                    ref={dropZoneRef}
                    class={dragging ? 'dragging drop-zone' : 'drop-zone'}
                    aria-label="Drop files or folders here"
                    aria-busy={busy}
                    onDragEnter={(event) => {
                        event.preventDefault();
                        if (!busy) {
                            setDragging(true);
                        }
                    }}
                    onDragLeave={(event) => {
                        if (
                            isDragLeaveOutside(
                                event.relatedTarget,
                                (target) => target instanceof Node && (dropZoneRef.current?.contains(target) ?? false),
                            )
                        ) {
                            setDragging(false);
                        }
                    }}
                    onDragOver={(event) => {
                        event.preventDefault();
                        if (!busy) {
                            setDragging(true);
                            if (event.dataTransfer) {
                                event.dataTransfer.dropEffect = 'copy';
                            }
                        }
                    }}
                    onDrop={handleDrop}
                >
                    <div class="drop-icon" aria-hidden="true">
                        ↓
                    </div>
                    <strong>Drop files here</strong>
                    <span>or choose from your device</span>
                    <div class="picker-row">
                        <button
                            class="button secondary"
                            type="button"
                            disabled={busy}
                            aria-disabled={busy}
                            onClick={() => fileInputRef.current?.click()}
                        >
                            Choose files
                        </button>
                        <button
                            class="button secondary"
                            type="button"
                            disabled={busy}
                            aria-disabled={busy}
                            onClick={() => folderInputRef.current?.click()}
                        >
                            Choose folder
                        </button>
                    </div>
                </section>

                <label for="file-input" class="sr-only">
                    File picker input
                </label>
                <input
                    ref={fileInputRef}
                    id="file-input"
                    class="sr-only"
                    type="file"
                    multiple
                    tabIndex={-1}
                    disabled={busy}
                    aria-disabled={busy}
                    onChange={(event) => {
                        const fileList = event.currentTarget.files;
                        event.currentTarget.value = '';
                        addFileList(fileList);
                    }}
                />
                <label for="folder-input" class="sr-only">
                    Folder picker input
                </label>
                <input
                    ref={folderInputRef}
                    id="folder-input"
                    class="sr-only"
                    type="file"
                    multiple
                    tabIndex={-1}
                    disabled={busy}
                    aria-disabled={busy}
                    onChange={(event) => {
                        const fileList = event.currentTarget.files;
                        event.currentTarget.value = '';
                        addFileList(fileList);
                    }}
                />
            </section>

            <div class="file-list-wrap" hidden={selectedFiles.length === 0}>
                <div class="list-header">
                    <span>Selected files</span>
                    <button class="text-button" type="button" disabled={busy} aria-disabled={busy} onClick={onClear}>
                        Clear files
                    </button>
                </div>
                <ul class="file-list" aria-label="Selected files">
                    {selectedFiles.map((item) => (
                        <li key={item.id}>
                            <div class="file-meta">
                                <span class="file-path" title={item.path}>
                                    {item.path}
                                </span>
                                <span class="file-size">{formatBytes(item.size)}</span>
                            </div>
                            <button
                                class="remove-file"
                                type="button"
                                disabled={busy}
                                aria-disabled={busy}
                                aria-label={`Remove ${item.path}`}
                                onClick={() => onRemove(item.id)}
                            >
                                Remove
                            </button>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
}
