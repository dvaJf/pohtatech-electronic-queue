import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const page = new URL('../src/pages/FAQPage.tsx', import.meta.url);
const app = new URL('../src/App.tsx', import.meta.url);
const header = new URL('../src/components/common/ProductHeader.tsx', import.meta.url);
const styles = new URL('../src/pages/faq.css', import.meta.url);

test('FAQ screen, entry point and deep links are present', async () => {
  const [source, appSource, headerSource] = await Promise.all([readFile(page, 'utf8'), readFile(app, 'utf8'), readFile(header, 'utf8')]);
  assert.match(source, /Помощь и FAQ/);
  assert.match(appSource, /path: '\/faq'/);
  assert.match(headerSource, /Помощь и FAQ/);
  assert.match(source, /window\.location\.hash/);
  assert.match(source, /hashchange/);
});

test('FAQ supports title, answer and keyword search with empty state and categories', async () => {
  const source = await readFile(page, 'utf8');
  assert.match(source, /question, item\.answer, \.\.\.item\.keywords/);
  assert.match(source, /Найти ответ\.\.\./);
  assert.match(source, /Ничего не найдено/);
  for (const label of ['Все', 'Очередь', 'Талоны', 'Запись', 'Уведомления', 'О стенде']) assert.match(source, new RegExp(`label: '${label}'`));
  for (const term of ['Telegram', 'QR', 'запись', 'рейтинг']) assert.match(source, new RegExp(term));
});

test('FAQ accordion is accessible and includes product explanations', async () => {
  const source = await readFile(page, 'utf8');
  assert.match(source, /aria-expanded/);
  assert.match(source, /aria-controls/);
  assert.match(source, /Как работает цифровая очередь/);
  for (const scenario of ['Взять талон онлайн', 'QR-код в отделении', 'Предварительная запись', 'Через сотрудника']) assert.match(source, new RegExp(scenario));
  for (const topic of ['Как подключить Telegram', 'Где посмотреть прошлые визиты', 'Как отзыв влияет на рейтинг отделения']) assert.match(source, new RegExp(topic));
});

test('stand status keeps health and providers independent and can retry', async () => {
  const source = await readFile(page, 'utf8');
  assert.match(source, /Promise\.allSettled/);
  assert.match(source, /checkHealth/);
  assert.match(source, /getNotificationCapabilities/);
  assert.match(source, /Проверить снова/);
  assert.match(source, /Не удалось проверить состояние стенда/);
  assert.match(source, /Статус уведомлений временно недоступен/);
  for (const provider of ['Telegram', 'Web Push', 'SMS', 'Email']) assert.match(source, new RegExp(`name="${provider}"`));
  assert.match(source, /Демонстрационный режим/);
  assert.match(source, /Проверено/);
});

test('FAQ mobile layout keeps controls touch-sized and stacks narrow status content', async () => {
  const source = await readFile(styles, 'utf8');
  assert.match(source, /min-height: 44px/);
  assert.match(source, /@media \(max-width: 640px\)/);
  assert.match(source, /flex-direction: column/);
  assert.match(source, /@media \(max-width: 360px\)/);
  assert.match(source, /overflow-wrap: anywhere/);
});
