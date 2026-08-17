import { useEffect, useRef, useState } from 'preact/hooks';
import { generateStrongPassword } from '../../archive/password';

export type PasswordPanelProps = {
    readonly busy: boolean;
    readonly confirmation: string;
    readonly password: string;
    readonly rememberPassword: boolean;
    readonly storageAvailable: boolean;
    readonly onClearRemembered: () => void;
    readonly onCommit: () => void;
    readonly onCopy: (password: string) => Promise<boolean>;
    readonly onGenerate: (password: string) => void;
    readonly onPasswordChange: (password: string, confirmation?: boolean) => void;
    readonly onRememberChange: (remember: boolean) => void;
    readonly onSubmit: () => void;
};

export default function PasswordPanel({
    busy,
    confirmation,
    onClearRemembered,
    onCommit,
    onCopy,
    onGenerate,
    onPasswordChange,
    onRememberChange,
    onSubmit,
    password,
    rememberPassword,
    storageAvailable,
}: PasswordPanelProps) {
    const [showPassword, setShowPassword] = useState(false);
    const [copyLabel, setCopyLabel] = useState('Copy');
    const passwordInputRef = useRef<HTMLInputElement>(null);
    const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        return () => {
            if (copyResetTimerRef.current !== null) {
                clearTimeout(copyResetTimerRef.current);
            }
        };
    }, []);

    const handleCopy = async (): Promise<void> => {
        if (await onCopy(password)) {
            setCopyLabel('Copied');
            if (copyResetTimerRef.current !== null) {
                clearTimeout(copyResetTimerRef.current);
            }
            copyResetTimerRef.current = setTimeout(() => setCopyLabel('Copy'), 1400);
        }
    };

    const handleClearRemembered = (): void => {
        onClearRemembered();
        passwordInputRef.current?.focus();
    };

    const passwordType = showPassword ? 'text' : 'password';

    return (
        <section class="control-section" aria-labelledby="security-heading">
            <div class="section-heading">
                <h2 id="security-heading">Password</h2>
                <div class="encryption-badge">AES-256</div>
            </div>

            <div class="field-grid two-col">
                <label class="field">
                    <span>Password</span>
                    <div class="input-action-group">
                        <input
                            ref={passwordInputRef}
                            id="password"
                            type={passwordType}
                            value={password}
                            autocomplete="new-password"
                            spellcheck={false}
                            autocapitalize="off"
                            disabled={busy}
                            aria-disabled={busy}
                            onInput={(event) => onPasswordChange(event.currentTarget.value)}
                            onChange={onCommit}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    onSubmit();
                                }
                            }}
                        />
                        <button
                            class="input-button"
                            type="button"
                            aria-label={showPassword ? 'Hide password' : 'Show password'}
                            aria-controls="password password-confirm"
                            aria-pressed={showPassword}
                            disabled={busy}
                            aria-disabled={busy}
                            onClick={() => setShowPassword((visible) => !visible)}
                        >
                            {showPassword ? 'Hide' : 'Show'}
                        </button>
                    </div>
                </label>
                <label class="field">
                    <span>Confirm password</span>
                    <input
                        id="password-confirm"
                        type={passwordType}
                        value={confirmation}
                        autocomplete="new-password"
                        spellcheck={false}
                        autocapitalize="off"
                        disabled={busy}
                        aria-disabled={busy}
                        onInput={(event) => onPasswordChange(event.currentTarget.value, true)}
                        onChange={onCommit}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                onSubmit();
                            }
                        }}
                    />
                </label>
            </div>

            <div class="password-tools">
                <button
                    class="text-button"
                    type="button"
                    disabled={busy}
                    aria-disabled={busy}
                    onClick={() => onGenerate(generateStrongPassword())}
                >
                    Generate
                </button>
                <button
                    class="text-button"
                    type="button"
                    disabled={busy}
                    aria-disabled={busy}
                    onClick={() => void handleCopy()}
                >
                    {copyLabel}
                </button>
            </div>

            <div class="remember-row">
                <label class="check-row">
                    <input
                        type="checkbox"
                        checked={rememberPassword}
                        disabled={busy || !storageAvailable}
                        aria-disabled={busy || !storageAvailable}
                        onChange={(event) => onRememberChange(event.currentTarget.checked)}
                    />
                    <span>Remember on this device</span>
                </label>
                <button
                    class="danger-text text-button"
                    type="button"
                    disabled={busy || !storageAvailable}
                    aria-disabled={busy || !storageAvailable}
                    onClick={handleClearRemembered}
                >
                    Clear saved
                </button>
            </div>
            <p class="remember-disclosure">
                Remembering a password stores it in plaintext. Same-origin JavaScript and browser extensions can read
                it; this is not a secure vault.
            </p>
        </section>
    );
}
