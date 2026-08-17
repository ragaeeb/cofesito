import { afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { REMEMBERED_PASSWORD_KEY } from '../../archive/password';
import { MemoryStorage } from '../../test/memory-storage';
import App from '../App';
import {
    addFile,
    cleanupTestDom,
    createDependencies,
    expectText,
    getInput,
    getTestingLibrary,
    setInput,
    setupTestDom,
    type TestingLibrary,
} from './test-app';

let library: TestingLibrary;

beforeAll(async () => {
    await setupTestDom();
    library = getTestingLibrary();
});

afterEach(() => {
    cleanupTestDom();
});

describe('rendered password and storage interaction', () => {
    it('validates passwords and supports show, generation, and copying', async () => {
        let copied = '';
        const { fireEvent, screen, waitFor } = library;
        const dependencies = createDependencies({ clipboard: { writeText: async (value) => void (copied = value) } });
        library.render(<App dependencies={dependencies} />);
        addFile();

        fireEvent.click(screen.getByRole('button', { name: 'Create ZIP' }));
        expectText(screen.getByRole('alert'), 'Enter a password before creating the archive.');

        setInput('Password', 'not-the-same');
        setInput('Confirm password', 'different');
        fireEvent.click(screen.getByRole('button', { name: 'Create ZIP' }));
        expectText(screen.getByRole('alert'), 'The password and confirmation do not match.');

        const password = getInput('Password');
        const confirmation = getInput('Confirm password');
        const toggle = screen.getByRole('button', { name: 'Show password' });
        fireEvent.click(toggle);
        expect(password.type).toBe('text');
        expect(confirmation.type).toBe('text');
        expect(toggle.getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByRole('button', { name: 'Hide password' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
        expect(password.value.length).toBeGreaterThanOrEqual(16);
        expect(confirmation.value).toBe(password.value);
        fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
        await waitFor(() => expect(copied).toBe(password.value));
        expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
    });

    it('persists only committed password changes and handles storage failures', () => {
        const storage = new MemoryStorage();
        const { fireEvent, screen } = library;
        library.render(<App dependencies={createDependencies({ storage })} />);

        setInput('Password', 'committed password');
        expect(storage.getItem(REMEMBERED_PASSWORD_KEY)).toBeNull();
        fireEvent.change(getInput('Password'), { target: { value: 'committed password' } });
        fireEvent.change(getInput('Confirm password'), { target: { value: 'committed password' } });
        fireEvent.click(screen.getByRole('checkbox', { name: 'Remember on this device' }));
        expect(storage.getItem(REMEMBERED_PASSWORD_KEY)).toBe('committed password');

        fireEvent.click(screen.getByRole('button', { name: 'Clear saved' }));
        expect(storage.getItem(REMEMBERED_PASSWORD_KEY)).toBeNull();
        expect(getInput('Password').value).toBe('');

        const failingStorage = new MemoryStorage();
        failingStorage.setItem = () => {
            throw new Error('storage unavailable');
        };
        cleanupTestDom();
        library.render(<App dependencies={createDependencies({ storage: failingStorage })} />);
        setInput('Password', 'will not persist');
        fireEvent.change(getInput('Password'), { target: { value: 'will not persist' } });
        fireEvent.click(screen.getByRole('checkbox', { name: 'Remember on this device' }));
        expectText(screen.getByRole('alert'), 'local storage is unavailable');
        expect(screen.getByRole('checkbox', { name: 'Remember on this device' }).hasAttribute('checked')).toBe(false);
    });

    it('clears remembered storage and unchecks the option when the primary password is emptied', () => {
        const storage = new MemoryStorage();
        const { fireEvent, screen } = library;
        library.render(<App dependencies={createDependencies({ storage })} />);

        setInput('Password', 'remember this password');
        fireEvent.change(getInput('Password'), { target: { value: 'remember this password' } });
        fireEvent.click(screen.getByRole('checkbox', { name: 'Remember on this device' }));
        expect((screen.getByRole('checkbox', { name: 'Remember on this device' }) as HTMLInputElement).checked).toBe(
            true,
        );
        expect(storage.getItem(REMEMBERED_PASSWORD_KEY)).toBe('remember this password');

        setInput('Password', '');

        expect((screen.getByRole('checkbox', { name: 'Remember on this device' }) as HTMLInputElement).checked).toBe(
            false,
        );
        expect(storage.getItem(REMEMBERED_PASSWORD_KEY)).toBeNull();
    });

    it('returns focus to the password field and keeps the functional controls keyboard reachable', () => {
        const { fireEvent, screen } = library;
        library.render(<App dependencies={createDependencies()} />);

        fireEvent.click(screen.getByRole('button', { name: 'Clear saved' }));
        expect(document.activeElement).toBe(getInput('Password'));

        const keyboardControls = [
            screen.getByRole('button', { name: 'Choose files' }),
            screen.getByRole('button', { name: 'Choose folder' }),
            getInput('Password'),
            screen.getByRole('button', { name: 'Show password' }),
            getInput('Confirm password'),
            screen.getByRole('button', { name: 'Generate' }),
            screen.getByRole('button', { name: 'Copy' }),
            screen.getByRole('checkbox', { name: 'Remember on this device' }),
            screen.getByRole('button', { name: 'Clear saved' }),
            getInput('Filename'),
            screen.getByRole('button', { name: 'Create ZIP' }),
        ];
        for (const control of keyboardControls) {
            expect((control as HTMLElement).tabIndex).toBe(0);
        }
    });

    it('restores remembered password values on startup', () => {
        const storage = new MemoryStorage();
        storage.setItem(REMEMBERED_PASSWORD_KEY, 'remembered password');
        library.render(<App dependencies={createDependencies({ storage })} />);

        expect(getInput('Password').value).toBe('remembered password');
        expect(getInput('Confirm password').value).toBe('remembered password');
        expect(
            (library.screen.getByRole('checkbox', { name: 'Remember on this device' }) as HTMLInputElement).checked,
        ).toBe(true);
    });
});
