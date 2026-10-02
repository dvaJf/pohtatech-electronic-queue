import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workspaceUrl = new URL('../src/features/client/ClientWorkspace.tsx', import.meta.url);
const branchSelectUrl = new URL('../src/components/common/SearchableBranchSelect.tsx', import.meta.url);
const profileModalUrl = new URL('../src/features/auth/UserProfileModal.tsx', import.meta.url);

test('ClientWorkspace preserves user-selected branch and prevents reversion to default branch', async () => {
  const source = await readFile(workspaceUrl, 'utf8');

  // Verify userSelectedBranchRef guards default branch override
  assert.match(source, /const userSelectedBranchRef = useRef\(false\);/);
  assert.match(source, /userSelectedBranchRef\.current = true;/);
  assert.match(source, /if \(userSelectedBranchRef\.current\) return;/);

  // Default branch effect should not revert branch when user has selected one
  assert.doesNotMatch(source, /if \(matched && matched\.id !== branchId\)\s*\{\s*handleBranchSelect\(matched\.id\);\s*\}/);
});

test('SearchableBranchSelect does not render duplicate Building2 icon in trigger', async () => {
  const source = await readFile(branchSelectUrl, 'utf8');

  // Building2 should not be in the trigger button
  assert.doesNotMatch(source, /<Building2 className="w-3\.5 h-3\.5 text-\[#003B73\] shrink-0"/);
  // Disabled state only has Lock icon
  assert.match(source, /\{disabled && \(\s*<Lock className=/);
});

test('UserProfileModal uses clean switch toggle for browser push notifications', async () => {
  const source = await readFile(profileModalUrl, 'utf8');

  // Duplicate status badges should be gone
  assert.doesNotMatch(source, /✓ Включено/);
  assert.doesNotMatch(source, /✓ Системные уведомления активны/);

  // Switch toggle should be present
  assert.match(source, /aria-label="Включить или отключить уведомления в браузере"/);
});

test('ClientWorkspace uses direct switch toggles for notifications without redundant master switch', async () => {
  const source = await readFile(workspaceUrl, 'utf8');

  // Master switch header removed
  assert.doesNotMatch(source, /const toggleHeader =/);
  assert.doesNotMatch(source, /Уведомления по талону отключены тумблером/);

  // Direct switch toggles present for channels
  assert.match(source, /aria-label="Включить или отключить Telegram"/);
  assert.match(source, /aria-label="Включить или отключить уведомления браузера"/);
  assert.match(source, /ticket\.source === 'APPOINTMENT' && row\(/);
});
