import { defineConfig } from 'vitest/config';

// Vitest config for ClippingHub.
//
// Goals:
//   - Run pure-logic tests under tests/unit/*.test.js fast in node (default).
//   - Allow per-file `// @vitest-environment jsdom` for tests that touch
//     DOM helpers extracted from renderer.js / hub.html.
//   - Surface flake instead of hiding it: no retries, full isolation.
//   - Show slow tests so we notice perf regressions before users do.

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js', 'src/**/*.test.js'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      'server/**',
    ],

    // Default to node; opt into jsdom per-file with a directive header.
    environment: 'node',

    // Reliability on Windows + Electron-adjacent native deps.
    pool: 'forks',
    isolate: true,

    // Keep timeouts generous for any test that touches ffmpeg arg fixtures
    // or large playlist parses, but not so big that a true hang is hidden.
    testTimeout: 30000,
    hookTimeout: 30000,

    // Surface flake instead of hiding it.
    retry: 0,

    // Reset between tests so accidental shared mutable state in helpers
    // (e.g. cached parseSegments output) doesn't cross-contaminate.
    clearMocks: true,
    restoreMocks: true,
    mockReset: true,
    sequence: { shuffle: { tests: false, files: false } },

    // Anything slower than 250ms is worth investigating.
    slowTestThreshold: 250,

    reporters: ['default'],

    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/lib/**/*.js'],
      exclude: ['**/*.test.js'],
    },
  },
});
