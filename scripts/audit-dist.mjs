import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const rootPath = join(projectRoot, 'dist');
const forbiddenHtmlPatterns = [
    /<script(?![^>]*\bsrc=)[^>]*>/i,
    /<script[^>]+src=["']https?:\/\//i,
    /<link[^>]+href=["']https?:\/\//i,
    /<img[^>]+src=["']https?:\/\//i,
];
const forbiddenJavaScriptPatterns = [
    /\bfetch\s*\(/,
    /new\s+XMLHttpRequest\b/,
    /new\s+WebSocket\b/,
    /new\s+EventSource\b/,
    /\.sendBeacon\s*\(/,
];
const runtimeSourcePaths = [
    'index.html',
    'src/main.tsx',
    'src/app/App.tsx',
    'src/app/app-state.ts',
    'src/app/app-runtime.ts',
    'src/app/use-archive-controller.ts',
    'src/app/components/ArchivePanel.tsx',
    'src/app/components/FilePicker.tsx',
    'src/app/components/PasswordPanel.tsx',
    'src/archive/download.ts',
    'src/archive/files.ts',
    'src/archive/password.ts',
    'src/style.css',
    'src/archive/types.ts',
    'src/archive/zip.ts',
    'src/platform/network-guard.ts',
    'src/test/zip-format.ts',
    'public/_headers',
];
const forbiddenRuntimePatterns = [
    /https?:\/\//i,
    ...forbiddenJavaScriptPatterns,
    /\bindexedDB\b/,
    /location\.(search|hash)/,
    /history\.(pushState|replaceState)/,
    /\bconsole\.(log|info|warn|error|debug)\s*\(/,
];

for (const relativePath of runtimeSourcePaths) {
    const source = await readFile(join(projectRoot, relativePath), 'utf8');
    for (const pattern of forbiddenRuntimePatterns) {
        if (pattern.test(source)) {
            throw new Error(
                `Runtime source contains a forbidden network or navigation pattern in ${relativePath}: ${pattern}`,
            );
        }
    }
}

/** @param {string} directory @returns {Promise<string[]>} */
async function collectFiles(directory) {
    const entries = await readdir(directory);
    const output = [];
    for (const entry of entries) {
        const fullPath = join(directory, entry);
        const metadata = await stat(fullPath);
        if (metadata.isDirectory()) {
            output.push(...(await collectFiles(fullPath)));
        } else {
            output.push(fullPath);
        }
    }
    return output;
}

const html = await readFile(join(rootPath, 'index.html'), 'utf8');
for (const pattern of forbiddenHtmlPatterns) {
    if (pattern.test(html)) {
        throw new Error(`Built index.html contains an external runtime asset: ${pattern}`);
    }
}

const cspMeta = html.match(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]+>/i)?.[0] ?? '';
for (const required of ["connect-src 'none'", "script-src 'self'", "style-src 'self'", "worker-src 'none'"]) {
    if (!cspMeta.includes(required)) {
        throw new Error(`Built index.html is missing the CSP meta directive: ${required}`);
    }
}

const headers = await readFile(join(rootPath, '_headers'), 'utf8');
for (const required of [
    "connect-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "worker-src 'none'",
    'X-Content-Type-Options: nosniff',
    'X-Frame-Options: DENY',
    'Referrer-Policy: no-referrer',
    'Permissions-Policy:',
]) {
    if (!headers.includes(required)) {
        throw new Error(`Built _headers is missing required directive: ${required}`);
    }
}

if (headers.includes('unsafe-inline') || headers.includes('unsafe-eval')) {
    throw new Error('Built CSP contains an unsafe script/style exception.');
}

const builtFiles = await collectFiles(rootPath);
const builtRelativePaths = builtFiles.map((file) => relative(rootPath, file));
if (builtRelativePaths.some((file) => file.split('/').some((part) => part === '.DS_Store'))) {
    throw new Error('Unexpected .DS_Store file found in dist.');
}

const referencedPaths = [...html.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi)].flatMap((match) => {
    const path = match[1];
    if (!path?.startsWith('/') || path.startsWith('//')) {
        return [];
    }
    return [path.split(/[?#]/, 1)[0]?.replace(/^\//, '') ?? ''];
});
for (const referencedPath of referencedPaths) {
    if (!builtRelativePaths.includes(referencedPath)) {
        throw new Error(`Built index.html references a missing asset: ${referencedPath}`);
    }
}

const builtText = await Promise.all(builtFiles.map(async (file) => readFile(file, 'utf8').catch(() => '')));
for (const file of builtFiles.filter((candidate) => relative(rootPath, candidate).startsWith('assets/'))) {
    const filename = relative(rootPath, file).split('/').at(-1);
    if (filename && !builtText.some((source) => source.includes(filename))) {
        throw new Error(`Built asset is not referenced by another release file: ${relative(rootPath, file)}`);
    }
}
if (builtRelativePaths.some((file) => file.startsWith('functions/'))) {
    throw new Error('Unexpected server-side functions directory found in dist.');
}

for (const forbiddenArtifact of ['_worker.js', '.wasm', '.map']) {
    if (
        builtRelativePaths.some((file) =>
            forbiddenArtifact.startsWith('.') ? file.endsWith(forbiddenArtifact) : file === forbiddenArtifact,
        )
    ) {
        throw new Error(`Unexpected runtime/build artifact found in dist: ${forbiddenArtifact}`);
    }
}

for (const file of builtFiles.filter((candidate) => extname(candidate) === '.css')) {
    const source = await readFile(file, 'utf8');
    if (/url\(\s*["']?https?:\/\//i.test(source) || /@import\s+(?:url\()?\s*["']https?:\/\//i.test(source)) {
        throw new Error(`Built CSS contains an external runtime asset in ${relative(rootPath, file)}.`);
    }
}

for (const file of builtFiles.filter((candidate) => extname(candidate) === '.js')) {
    const source = await readFile(file, 'utf8');
    if (!source.includes('Network access is disabled by this application.')) {
        throw new Error(`Built JavaScript is missing the production network guard in ${relative(rootPath, file)}.`);
    }
    for (const pattern of forbiddenJavaScriptPatterns) {
        if (pattern.test(source)) {
            throw new Error(
                `Built JavaScript contains a forbidden network primitive in ${relative(rootPath, file)}: ${pattern}`,
            );
        }
    }
}

process.stdout.write(`Static dist audit passed (${builtFiles.length} files).\n`);
