import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const nginxConfig = await readFile(new URL('../nginx.conf', import.meta.url), 'utf8');

test('missing Vite assets return 404 instead of the SPA shell', () => {
  const assetsLocation = nginxConfig.match(/location \^~ \/assets\/ \{([\s\S]*?)\n    \}/)?.[1] ?? '';

  assert.match(assetsLocation, /try_files \$uri =404;/);
  assert.doesNotMatch(assetsLocation, /index\.html/);
});

test('hashed assets are immutable while the application shell is not cached', () => {
  assert.match(nginxConfig, /Cache-Control "public, max-age=31536000, immutable"/);
  assert.doesNotMatch(nginxConfig, /Cache-Control "public, max-age=31536000, immutable" always/);
  assert.match(nginxConfig, /location = \/index\.html \{[\s\S]*?Cache-Control "no-cache, no-store, must-revalidate"/);
});

test('frontend deployment does not mix hashed assets from different revisions', async () => {
  const deployment = await readFile(
    new URL('../../helm/queue-chart/templates/frontend.yaml', import.meta.url),
    'utf8',
  );

  assert.match(deployment, /strategy:\s*[\s\S]*?type: Recreate/);
  assert.doesNotMatch(deployment, /strategy:\s*[\s\S]*?type: RollingUpdate/);
});
