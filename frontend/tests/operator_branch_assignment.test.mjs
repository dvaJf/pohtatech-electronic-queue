import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('SearchableBranchSelect provides search by name and disabled locked state', async () => {
  const content = await readFile(new URL('../src/components/common/SearchableBranchSelect.tsx', import.meta.url), 'utf8');

  // Verify search input by branch name
  assert.match(content, /Поиск отделения по названию/);
  assert.match(content, /filteredBranches/);
  assert.match(content, /searchQuery/);

  // Verify disabled locked state
  assert.match(content, /disabled/);
  assert.match(content, /cursor-not-allowed/);
  assert.match(content, /Lock/);
});

test('UsersManagement supports assigning postal branches with searchable select', async () => {
  const content = await readFile(new URL('../src/features/admin/UsersManagement.tsx', import.meta.url), 'utf8');

  // Table header has Postal Branch column
  assert.match(content, /Почтовое отделение/);

  // Uses SearchableBranchSelect
  assert.match(content, /SearchableBranchSelect/);
  assert.match(content, /handleBranchChange/);
  assert.match(content, /operator_branch_updated/);
});

test('OperatorWorkspace locks branch selector for operator and reacts to assigned branch', async () => {
  const content = await readFile(new URL('../src/features/operator/OperatorWorkspace.tsx', import.meta.url), 'utf8');

  // Locked branch logic
  assert.match(content, /isBranchLocked\s*=\s*currentUser\?\.role\s*===\s*['"]employee['"]/);
  assert.match(content, /assignedBranchId/);
  assert.match(content, /operator_branch_updated/);

  // SearchableBranchSelect used with disabled lock
  assert.match(content, /<SearchableBranchSelect/);
  assert.match(content, /disabled=\{isBranchLocked\s*\|\|\s*pending\}/);
  assert.match(content, /Почтовое отделение назначено администратором/);
});

test('AdminWorkspace uses SearchableBranchSelect with search by name', async () => {
  const content = await readFile(new URL('../src/features/admin/AdminWorkspace.tsx', import.meta.url), 'utf8');

  assert.match(content, /SearchableBranchSelect/);
  assert.match(content, /selectedId=\{selectedBranchId\}/);
});

test('authApi supports branchId on User and changeUserBranch', async () => {
  const content = await readFile(new URL('../src/api/authApi.ts', import.meta.url), 'utf8');

  assert.match(content, /branchId\?:/);
  assert.match(content, /changeUserBranch/);
});
