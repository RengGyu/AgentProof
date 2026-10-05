import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
export default defineConfig({ resolve: { alias: {'@': fileURLToPath(new URL('../src', import.meta.url))} }, oxc: {jsx: {runtime: 'automatic'}}, test: { include: ['mobile/src/**/*.test.ts', 'mobile/src/**/*.test.tsx'] } });
