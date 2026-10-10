/**
 * Sequential announcement queue to play voice calls one at a time.
 */
/**
  * FIFO-очередь голосовых объявлений для табло зала «Почта России»
  * Гарантирует последовательное воспроизведение объявлений:
 * если освободились два окна одновременно — объявления идут по очереди,
 * не перебивая друг друга.
 *
 * Использование:
 *   import { enqueueAnnouncement } from './announcementQueue';
 *   enqueueAnnouncement(() => announceTicketCall(ticket, window, options));
  */

/** Цепочка Promise — хвост очереди воспроизведения */
let _chain: Promise<void> = Promise.resolve();
let generation = 0;

/**
 * Ставит функцию-объявление в конец FIFO-очереди.
 * Следующее объявление начнётся только после завершения предыдущего.
 *
 * @param fn — асинхронная функция, возвращающая Promise<void | unknown>
 */
export function enqueueAnnouncement(fn: () => Promise<unknown>): void {
  const queuedGeneration = generation;
  _chain = _chain
    .then(() => queuedGeneration === generation ? fn() : undefined)
    .catch((err) => {
      // Ошибка в одном объявлении не должна блокировать очередь
      console.warn('[AnnouncementQueue] Error in queued announcement:', err);
    }) as Promise<void>;
}

/**
 * Сбросить очередь (например, при смене вкладки или ручной остановке).
 * Текущее воспроизведение не прерывается, но следующие элементы отбрасываются.
 */
export function clearAnnouncementQueue(): void {
  generation += 1;
}
