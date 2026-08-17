import { readFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, join, relative } from 'node:path';

const rootPath = fileURLToPath(new URL('../dist/', import.meta.url));
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
    for (const pattern of forbiddenJavaScriptPatterns) {
        if (pattern.test(source)) {
            throw new Error(
                `Built JavaScript contains a forbidden network primitive in ${relative(rootPath, file)}: ${pattern}`,
            );
        }
    }
}

process.stdout.write(`Static dist audit passed (${builtFiles.length} files).\n`);
