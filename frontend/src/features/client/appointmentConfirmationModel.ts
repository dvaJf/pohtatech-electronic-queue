export type ConfirmationRestoreDecision = 'open' | 'confirmed' | 'expired' | 'closed';

export interface ConfirmationTicketSnapshot {
  status?: string | null;
  confirmationExpiresAt?: string | null;
}

export interface ConfirmationErrorLike {
  status?: number;
  code?: string;
  message?: string;
}

export interface AppointmentResendResponse {
  ok: boolean;
  confirmationExpiresAt: string;
}

export function confirmationRemainingSeconds(expiresAt: string | null | undefined, nowMs = Date.now()): number {
  if (!expiresAt) return 0;
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) return 0;
  return Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1000));
}

export function confirmationRestoreDecision(
  ticket: ConfirmationTicketSnapshot,
  nowMs = Date.now(),
): ConfirmationRestoreDecision {
  if (ticket.status === 'SCHEDULED') return 'confirmed';
  if (ticket.status !== 'PENDING_CONFIRMATION') return 'closed';
  return confirmationRemainingSeconds(ticket.confirmationExpiresAt, nowMs) > 0 ? 'open' : 'expired';
}

export function appointmentConfirmationErrorMessage(error: ConfirmationErrorLike): string {
  if (error.code === 'INVALID_CODE' || (error.status === 403 && error.code !== 'TEST_CONFIRM_DISABLED')) {
    return 'Неверный код. Проверьте письмо и попробуйте ещё раз.';
  }
  if (error.code === 'APPOINTMENT_EXPIRED' || error.code === 'CONFIRMATION_EXPIRED') {
    return 'Время подтверждения истекло.';
  }
  if (error.code === 'ALREADY_CONFIRMED') return 'Запись уже подтверждена.';
  return 'Не удалось подтвердить запись. Попробуйте ещё раз.';
}

export function parseAppointmentResendResponse(value: unknown): AppointmentResendResponse {
  if (!value || typeof value !== 'object') throw new Error('Некорректный ответ сервера');
  const response = value as Record<string, unknown>;
  if (response.ok !== true || typeof response.confirmationExpiresAt !== 'string' || !response.confirmationExpiresAt) {
    throw new Error('Некорректный ответ сервера');
  }
  return { ok: true, confirmationExpiresAt: response.confirmationExpiresAt };
}
