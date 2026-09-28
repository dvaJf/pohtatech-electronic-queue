import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('UserProfileModal supports editing FIO and displays service history for clients', async () => {
  const modalContent = await readFile(new URL('../src/features/auth/UserProfileModal.tsx', import.meta.url), 'utf8');

  // Verify FIO input and save handler
  assert.match(modalContent, /Фамилия, Имя и Отчество/);
  assert.match(modalContent, /handleSaveFio/);
  assert.match(modalContent, /Сохранить/);

  // Verify service history rendered only for client role
  assert.match(modalContent, /user\.role\s*===\s*['"]client['"]/);
  assert.match(modalContent, /История обслуживаний/);
  assert.match(modalContent, /item\.publicNumber/);
  assert.match(modalContent, /item\.windowText/);
  assert.match(modalContent, /item\.operatorName/);

  // Verify modal is scrollable to accommodate history without breaking layout
  assert.match(modalContent, /overflow-y-auto/);

  // Verify empty history message
  assert.match(modalContent, /У вас пока нет завершённых визитов/);
});

test('serviceHistory module has no mock visits and exports operator resolution helpers', async () => {
  const serviceHistContent = await readFile(new URL('../src/features/client/serviceHistory.ts', import.meta.url), 'utf8');
  assert.match(serviceHistContent, /export\s+interface\s+ClientServiceRecord/);
  assert.match(serviceHistContent, /export\s+function\s+getClientServiceHistory/);
  assert.match(serviceHistContent, /export\s+function\s+saveClientServiceRecord/);
  assert.match(serviceHistContent, /export\s+const\s+DEFAULT_CLIENT_HISTORY:\s*ClientServiceRecord\[\]\s*=\s*\[\]/);
  assert.match(serviceHistContent, /export\s+function\s+recordTicketOperator/);
  assert.match(serviceHistContent, /export\s+function\s+resolveOperatorName/);

  // Verify prepending to place new visits at the top
  assert.match(serviceHistContent, /\[record,\s*\.\.\.existing/);
});

test('ClientWorkspace uses resolveOperatorName for completed tickets', async () => {
  const clientWsContent = await readFile(new URL('../src/features/client/ClientWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(clientWsContent, /resolveOperatorName\(ticket/);
  assert.match(clientWsContent, /getCompletedTicketMetadata/);
});

test('OperatorWorkspace records operator profile FIO and updates header', async () => {
  const opContent = await readFile(new URL('../src/features/operator/OperatorWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(opContent, /recordTicketOperator/);
  assert.match(opContent, /currentUser\?\.fio\s*\|\|\s*currentUser\?\.email/);
  assert.match(opContent, /auth_fio_updated/);
});

test('authApi supports user FIO and ProductHeader displays it', async () => {
  const authContent = await readFile(new URL('../src/api/authApi.ts', import.meta.url), 'utf8');
  assert.match(authContent, /fio\?:\s*string/);

  const headerContent = await readFile(new URL('../src/components/common/ProductHeader.tsx', import.meta.url), 'utf8');
  assert.match(headerContent, /currentUser\.fio\s*\|\|\s*currentUser\.email/);
});
