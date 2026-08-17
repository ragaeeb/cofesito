import { render } from 'preact';
import App from './app/App';
import { installNoNetworkRuntimeGuard } from './platform/network-guard';
import './style.css';

// Production is always guarded. Dev can opt in for network-regression testing;
// leaving it off preserves Vite's HMR connection during normal development.
if (import.meta.env.PROD || import.meta.env.VITE_ENFORCE_NO_NETWORK === 'true') {
    installNoNetworkRuntimeGuard();
}

const root = document.getElementById('app');
if (!root) {
    throw new Error('The application mount element is missing.');
}

render(<App />, root);
