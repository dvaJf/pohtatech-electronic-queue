import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Completed ticket view removes take new ticket button and displays metadata rows', async () => {
  const content = await readFile(new URL('../src/features/client/ClientWorkspace.tsx', import.meta.url), 'utf8');

  // Verify that the "Взять новый талон" button excludes COMPLETED tickets
  assert.match(content, /terminalStatuses\.has\(ticket\.status\)\s*&&\s*ticket\.status\s*!==\s*['"]COMPLETED['"]/);

  // Verify that COMPLETED ticket renders all requested metadata rows:
  // 1. Window
  assert.match(content, /<span>Окно<\/span>/);
  // 2. Operator name
  assert.match(content, /<span>Оператор<\/span>/);
  // 3. Date
  assert.match(content, /<span>Дата<\/span>/);
  // 4. Working hours (start and end)
  assert.match(content, /<span>Время работы<\/span>/);
  // 5. Total working time
  assert.match(content, /<span>Общее время работы<\/span>/);

  // Verify getCompletedTicketMetadata and DEFAULT_OPERATOR_NAMES helpers exist
  assert.match(content, /getCompletedTicketMetadata/);
  assert.match(content, /DEFAULT_OPERATOR_NAMES/);
});

test('CSS rules properly hide empty ticket actions and pad completed ticket details', async () => {
  const css = await readFile(new URL('../src/features/client/client.css', import.meta.url), 'utf8');
  assert.match(css, /\.cx-ticket-actions:empty\s*\{\s*display:\s*none;/);
  assert.match(css, /\.cx-active-ticket\s+\.cx-ticket-details:last-child/);
});
