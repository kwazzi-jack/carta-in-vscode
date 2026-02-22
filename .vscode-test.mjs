import { defineConfig } from '@vscode/test-cli';

export default defineConfig([
    {
        files: 'out/test/**/*.test.js',
        version: 'stable',        // test on latest stable
    },
    {
        files: 'out/test/**/*.test.js',
        version: '1.85.0',        // test on minimum version
    },
    {
        files: 'out/test/**/*.test.js',
        version: '1.100.0',       // test on median version
    },
    {
        files: 'out/test/**/*.test.js',
        version: 'insiders',      // test on insiders version
    },
]);