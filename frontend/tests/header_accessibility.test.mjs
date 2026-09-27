import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('header delegates one geolocation request and exposes locating state', async () => {
  const content = await readFile(new URL('../src/components/common/ProductHeader.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(content, /handleRequestGeo[\s\S]*navigator\.geolocation\.getCurrentPosition/);
  assert.match(content, /geoStatus === 'locating'/);
  assert.match(content, /aria-busy=/);
});

test('accessibility panel has one source of truth for scale and keyboard-safe dialog semantics', async () => {
  const content = await readFile(new URL('../src/components/common/ProductHeader.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(content, /Увеличенный текст/);
  assert.match(content, /role="dialog"/);
  assert.match(content, /aria-labelledby="a11y-settings-title"/);
  assert.match(content, /a11yButtonRef\.current\?\.focus/);
  assert.match(content, /pochta_a11y_scale/);
});

test('focus system removes pointer outlines while retaining a shared focus-visible ring', async () => {
  const content = await readFile(new URL('../src/product.css', import.meta.url), 'utf8');
  assert.match(content, /--focus-ring-color:/);
  assert.match(content, /:focus:not\(:focus-visible\)/);
  assert.match(content, /\.cx-link-button/);
});
