import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

async function loadTS(relativePath) {
  const filePath = resolve(import.meta.dirname, relativePath);
  const code = await readFile(filePath, 'utf8');
  const transpiled = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString('base64')}`);
}

test('countdown uses only the backend expiration and reaches an expired state', async () => {
  const { confirmationRemainingSeconds } = await loadTS('../src/features/client/appointmentConfirmationModel.ts');
  const now = Date.parse('2026-10-04T12:00:00.000Z');
  assert.equal(confirmationRemainingSeconds('2026-10-04T12:14:21.000Z', now), 861);
  assert.equal(confirmationRemainingSeconds('2026-10-04T11:59:59.000Z', now), 0);
  assert.equal(confirmationRemainingSeconds(undefined, now), 0);
});

test('restore decision opens only a non-expired pending appointment', async () => {
  const { confirmationRestoreDecision } = await loadTS('../src/features/client/appointmentConfirmationModel.ts');
  const now = Date.parse('2026-10-04T12:00:00.000Z');
  assert.equal(confirmationRestoreDecision({ status: 'PENDING_CONFIRMATION', confirmationExpiresAt: '2026-10-04T12:01:00Z' }, now), 'open');
  assert.equal(confirmationRestoreDecision({ status: 'PENDING_CONFIRMATION', confirmationExpiresAt: '2026-10-04T11:59:59Z' }, now), 'expired');
  assert.equal(confirmationRestoreDecision({ status: 'SCHEDULED', confirmationExpiresAt: '2026-10-04T12:01:00Z' }, now), 'confirmed');
  assert.equal(confirmationRestoreDecision({ status: 'CANCELLED', confirmationExpiresAt: '2026-10-04T12:01:00Z' }, now), 'closed');
});

test('confirmation errors map to safe Russian messages', async () => {
  const { appointmentConfirmationErrorMessage } = await loadTS('../src/features/client/appointmentConfirmationModel.ts');
  assert.equal(appointmentConfirmationErrorMessage({ status: 403, code: 'INVALID_CODE' }), 'Неверный код. Проверьте письмо и попробуйте ещё раз.');
  assert.equal(appointmentConfirmationErrorMessage({ status: 400, code: 'APPOINTMENT_EXPIRED' }), 'Время подтверждения истекло.');
  assert.equal(appointmentConfirmationErrorMessage({ status: 500, message: 'Internal Server Error' }), 'Не удалось подтвердить запись. Попробуйте ещё раз.');
});

test('resend response keeps the backend field names and original expiration', async () => {
  const { parseAppointmentResendResponse } = await loadTS('../src/features/client/appointmentConfirmationModel.ts');
  assert.deepEqual(
    parseAppointmentResendResponse({ ok: true, confirmationExpiresAt: '2026-10-04T12:15:00Z' }),
    { ok: true, confirmationExpiresAt: '2026-10-04T12:15:00Z' },
  );
  assert.throws(() => parseAppointmentResendResponse({ success: true, expiresAt: 'wrong-contract' }));
});
