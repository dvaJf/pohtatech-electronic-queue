import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function load(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } });
  return import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
}

test('visit rating is offered only for a completed ticket that has not already been reviewed or dismissed', async () => {
  const { shouldOfferVisitRating } = await load('../src/features/client/rating/visitRatingPolicy.ts');
  assert.equal(shouldOfferVisitRating('COMPLETED', 'ticket-1', [], []), true);
  assert.equal(shouldOfferVisitRating('WAITING', 'ticket-1', [], []), false);
  assert.equal(shouldOfferVisitRating('CANCELLED', 'ticket-1', [], []), false);
  assert.equal(shouldOfferVisitRating('COMPLETED', 'ticket-1', ['ticket-1'], []), false);
  assert.equal(shouldOfferVisitRating('COMPLETED', 'ticket-1', [], ['ticket-1']), false);
});

test('completed visit rating popup has a 1–5 star input and optional comment', async () => {
  const content = await readFile(new URL('../src/features/client/rating/VisitRatingSheet.tsx', import.meta.url), 'utf8');
  assert.match(content, /Оцените визит/);
  assert.match(content, /звезд/);
  assert.match(content, /textarea/);
  assert.match(content, /onSubmit/);
});
