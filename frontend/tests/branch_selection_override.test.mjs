import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workspaceUrl = new URL('../src/features/client/ClientWorkspace.tsx', import.meta.url);
const branchSelectUrl = new URL('../src/components/common/SearchableBranchSelect.tsx', import.meta.url);
const profileModalUrl = new URL('../src/features/auth/UserProfileModal.tsx', import.meta.url);
const appointmentPickerUrl = new URL('../src/features/client/Appointment24hPicker.tsx', import.meta.url);
const clientCssUrl = new URL('../src/features/client/client.css', import.meta.url);

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

test('UserProfileModal uses clean switch toggle and scrollbar-none without ugly scrollbar thumb', async () => {
  const source = await readFile(profileModalUrl, 'utf8');

  // Duplicate status badges should be gone
  assert.doesNotMatch(source, /✓ Включено/);
  assert.doesNotMatch(source, /✓ Системные уведомления активны/);

  // Switch toggle should be present
  assert.match(source, /aria-label="Включить или отключить уведомления в браузере"/);

  // Native scrollbar thumb should be hidden with scrollbar-none
  assert.match(source, /scrollbar-none/);
});

test('ClientWorkspace uses direct switch toggles for notifications without redundant master switch', async () => {
  const source = await readFile(workspaceUrl, 'utf8');

  // Master switch header removed
  assert.doesNotMatch(source, /const toggleHeader =/);
  assert.doesNotMatch(source, /Уведомления по талону отключены тумблером/);

  // Direct switch toggles present for channels
  assert.match(source, /aria-label="Включить или отключить Telegram"/);
  assert.match(source, /aria-label="Включить или отключить уведомления браузера"/);
  assert.doesNotMatch(source, /Email для подтверждения записи/);
});

test('ClientWorkspace advances timeline to step 2 when arrival is confirmed', async () => {
  const source = await readFile(workspaceUrl, 'utf8');

  // getTicketTimelineStep handles isArrived flag
  assert.match(source, /function getTicketTimelineStep\(status: TicketStatus, isArrived = false\): number/);
  assert.match(source, /if \(isArrived && status === 'SCHEDULED'\)\s*\{\s*return 2;\s*\}/);

  // Timeline8 receives isTicketArrived
  assert.match(source, /const isTicketArrived = Boolean\(ticket\.arrivedAt \|\| arrivalAcknowledgedTicketIds\.has\(ticket\.id\)\);/);
  assert.match(source, /currentStep=\{getTicketTimelineStep\(ticket\.status, isTicketArrived\)\}/);
});

test('Appointment24hPicker leaves only interactive calendar and removes c-calendar-14 label', async () => {
  const source = await readFile(appointmentPickerUrl, 'utf8');

  // Label c-calendar-14 removed from JSX
  assert.doesNotMatch(source, />\s*c-calendar-14\s*</);
  assert.doesNotMatch(source, /Интерактивный календарь со слотами/);

  // Calendar14 rendered directly
  assert.match(source, /<Calendar14/);
});

test('client.css ensures cx-notification-row has proper padding so icons do not overflow', async () => {
  const source = await readFile(clientCssUrl, 'utf8');

  // cx-notification-row has proper horizontal padding and overflow hidden
  assert.match(source, /\.cx-notification-row\s*\{[^}]*padding:\s*12px\s+14px/);
  assert.match(source, /\.cx-notification-row\s*\{[^}]*overflow:\s*hidden/);
});
