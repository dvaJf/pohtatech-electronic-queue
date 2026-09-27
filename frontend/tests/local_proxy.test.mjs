import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('docker frontend proxies API requests to the backend service', async () => {
  const compose = await readFile(new URL('../../docker-compose.yml', import.meta.url), 'utf8');
  const vite = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8');
  assert.match(compose, /VITE_BACKEND_TARGET:\s*http:\/\/backend:8080/);
  assert.match(vite, /process\.env\.VITE_BACKEND_TARGET\s*\|\|\s*'http:\/\/localhost:8080'/);
  assert.doesNotMatch(vite, /'http:\/\/backend:8080'\s*\?/);
});
