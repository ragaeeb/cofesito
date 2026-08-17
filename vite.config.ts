import { defineConfig } from 'vite';

const CSP_META =
    "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; base-uri 'none'; connect-src 'none'; font-src 'none'; form-action 'none'; frame-src 'none'; img-src 'self' data: blob:; media-src 'none'; object-src 'none'; script-src 'self'; style-src 'self'; worker-src 'none'\">";

export default defineConfig(({ command }) => ({
    build: {
        modulePreload: {
            polyfill: false,
        },
        // Source maps would expose the full audited source tree in production and
        // are intentionally excluded from the static release artifact.
        sourcemap: false,
        target: 'es2022',
    },
    plugins:
        command === 'build'
            ? [
                  {
                      name: 'static-csp-meta',
                      transformIndexHtml(html: string) {
                          return html.replace('</head>', `${CSP_META}\n</head>`);
                      },
                  },
              ]
            : [],
}));
