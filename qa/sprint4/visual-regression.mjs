import { runBrowserChecks } from './reliability-browser.mjs';

// Shared controlled API/GPS boundaries and identical responsive assertions.
await runBrowserChecks({ screenshots: true });
