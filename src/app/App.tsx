import packageMetadata from '../../package.json';
import type { AppDependencies } from './app-runtime';
import ArchivePanel from './components/ArchivePanel';
import FilePicker from './components/FilePicker';
import PasswordPanel from './components/PasswordPanel';
import { useArchiveController } from './use-archive-controller';

export default function App({ dependencies }: { readonly dependencies?: AppDependencies }) {
    const { actions, state } = useArchiveController(dependencies);
    const busy = state.lifecycle.kind === 'building';

    return (
        <main class="shell">
            <header class="app-header">
                <div class="brand">
                    <span class="status-dot" aria-hidden="true"></span>
                    <h1 id="app-name">{packageMetadata.name}</h1>
                </div>
                <span class="app-badge">AES-256</span>
            </header>

            <div class="primary-workflow">
                <FilePicker
                    busy={busy}
                    selectedFiles={state.selectedFiles}
                    onClear={actions.onClearFiles}
                    onError={actions.onFileError}
                    onFilesAdded={actions.onFilesAdded}
                    onRemove={actions.onRemoveFile}
                />
                <section class="card controls-card">
                    <PasswordPanel
                        busy={busy}
                        confirmation={state.confirmation}
                        password={state.password}
                        rememberPassword={state.rememberPassword}
                        storageAvailable={state.storageAvailable}
                        onClearRemembered={actions.onClearRemembered}
                        onCommit={actions.onCommitPassword}
                        onCopy={actions.onCopy}
                        onGenerate={actions.onGenerate}
                        onPasswordChange={actions.onPasswordChange}
                        onRememberChange={actions.onRememberChange}
                        onSubmit={actions.onCreate}
                    />
                    <ArchivePanel
                        archiveName={state.archiveName}
                        lifecycle={state.lifecycle}
                        notice={state.notice}
                        onArchiveNameChange={actions.onArchiveNameChange}
                        onCancel={actions.onCancel}
                        onCreate={actions.onCreate}
                    />
                </section>
            </div>

            <section class="marketing-panel" aria-labelledby="marketing-heading">
                <div class="marketing-intro">
                    <p class="marketing-kicker">Private by design</p>
                    <h2 id="marketing-heading">Secure ZIP creation, right in your browser.</h2>
                    <p>
                        Files, filenames, passwords, and archives stay on this device. No account or upload is required.
                    </p>
                </div>
                <div class="marketing-point">
                    <strong>Nothing is uploaded.</strong>
                    <span>Reading, compression, encryption, and download creation happen locally.</span>
                </div>
                <div class="marketing-point">
                    <strong>No telemetry.</strong>
                    <span>No analytics, beacons, external fonts, or third-party runtime scripts.</span>
                </div>
                <div class="marketing-point">
                    <strong>Static by design.</strong>
                    <span>No APIs, accounts, databases, or server-side functions are required.</span>
                </div>
            </section>

            <footer class="app-footer">
                <a id="github-link" href={packageMetadata.homepage} target="_blank" rel="noreferrer">
                    GitHub
                </a>
                <span aria-hidden="true">·</span>
                <span>
                    by{' '}
                    <a id="developer-link" href={packageMetadata.author.url} target="_blank" rel="noreferrer">
                        {packageMetadata.author.name}
                    </a>
                </span>
                <span aria-hidden="true">·</span>
                <span id="app-version">v{packageMetadata.version}</span>
            </footer>
        </main>
    );
}
