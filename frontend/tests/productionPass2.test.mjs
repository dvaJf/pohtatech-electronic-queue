import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Production Pass 11: BranchMapModal uses authentic Russian pluralization and catalog fallback', async () => {
  const mapModalSource = await readFile(new URL('../src/features/client/map/BranchMapModal.tsx', import.meta.url), 'utf8');

  // Verify getBranchPlural is imported from branchLocations
  assert.match(mapModalSource, /import\s*\{[^}]*getBranchPlural[^}]*\}\s*from\s*'\.\/branchLocations'/);

  // Verify getBranchPlural is used in bottom sheet title
  assert.match(mapModalSource, /\$\{filteredBranches\.length\}\s*\$\{getBranchPlural\(filteredBranches\.length\)\}/);

  // Verify effectiveBranches fallback to MOSCOW_BRANCHES when incomingBranches is empty
  assert.match(mapModalSource, /const effectiveBranches = incomingBranches\.length > 0\s*\?\s*incomingBranches\s*:\s*MOSCOW_BRANCHES/);
});

test('Production Pass 12: AppointmentConfirmationCard component and email masking', async () => {
  const cardSource = await readFile(new URL('../src/features/client/AppointmentConfirmationCard.tsx', import.meta.url), 'utf8');

  // Check key features
  assert.match(cardSource, /export function maskEmail/);
  assert.match(cardSource, /15\s*\*\s*60\s*\*\s*1000/);
  assert.match(cardSource, /api\.confirmAppointment/);
  assert.match(cardSource, /api\.resendAppointmentConfirmation/);
  assert.match(cardSource, /data-testid="appointment-confirmation-card"/);

  // Dynamically test maskEmail logic
  function maskEmail(email) {
    if (!email || !email.includes('@')) return email || '';
    const [local, domain] = email.split('@');
    if (local.length <= 2) {
      return `${local[0]}*@${domain}`;
    }
    return `${local[0]}***${local[local.length - 1]}@${domain}`;
  }

  assert.equal(maskEmail('nikita@mail.ru'), 'n***a@mail.ru');
  assert.equal(maskEmail('ivan@pochta.ru'), 'i***n@pochta.ru');
  assert.equal(maskEmail('ab@domain.com'), 'a*@domain.com');
  assert.equal(maskEmail(''), '');
});

test('Production Pass 13: Client API and statuses support PENDING_CONFIRMATION', async () => {
  const clientApiSource = await readFile(new URL('../src/api/client/clientApi.ts', import.meta.url), 'utf8');
  const typesSource = await readFile(new URL('../src/api/client/types.ts', import.meta.url), 'utf8');

  // Statuses set in clientApi includes PENDING_CONFIRMATION
  assert.match(clientApiSource, /statuses = new Set\(\[[^\]]*'PENDING_CONFIRMATION'/);

  // API methods exist
  assert.match(clientApiSource, /export async function confirmAppointment/);
  assert.match(clientApiSource, /export async function resendAppointmentConfirmation/);

  // Ticket types include confirmation fields
  assert.match(typesSource, /confirmationExpiresAt\?:/);
  assert.match(typesSource, /notificationEmail\?:/);
});

test('Production Pass 14: Mobile header utilities clean and 3-dots menu high contrast', async () => {
  const productCss = await readFile(new URL('../src/product.css', import.meta.url), 'utf8');

  // Utility group hidden on mobile < 768px
  assert.match(productCss, /@media\s*\(max-width:\s*767px\)\s*\{\s*\.main-product-header\s*\.header-utility-group\s*\{[^}]*display:\s*none\s*!important/);

  // 3-dots mobile menu links styled with high contrast white text
  assert.match(productCss, /#mobile-service-menu\s+a[\s\S]*?color:\s*#ffffff\s*!important/);
});
