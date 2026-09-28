import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workspace = new URL('../src/features/client/ClientWorkspace.tsx', import.meta.url);

test('notification controls load capabilities and subscriptions independently', async () => {
  const source = await readFile(workspace, 'utf8');
  assert.match(source, /setCapabilities\(await api\.getNotificationCapabilities\(\)\)/);
  assert.match(source, /setSubscriptions\(await api\.listNotificationSubscriptions\(ticket\.id, token\)\)/);
  assert.match(source, /Не удалось загрузить настройки уведомлений/);
  assert.match(source, />Повторить<\/button>/);
  assert.doesNotMatch(source, /Promise\.all\(\[api\.getNotificationCapabilities/);
});

test('notification controls retain secure ticket management and isolate provider availability', async () => {
  const source = await readFile(workspace, 'utf8');
  assert.match(source, /getSavedMgmtTokens\(ownerScope\)\[ticket\.id\] \|\| ticket\.managementToken/);
  assert.match(source, /Для этого талона управление уведомлениями недоступно\. Создайте новый талон\./);
  assert.match(source, /providerAction\('telegram', 'TELEGRAM'/);
  assert.match(source, /providerAction\('webPush', 'WEB_PUSH'/);
  assert.match(source, /subscriptionForm\('sms', smsForm\)/);
});

test('Telegram uses the local brand icon instead of a Lucide Send icon', async () => {
  const source = await readFile(workspace, 'utf8');
  assert.match(source, /function TelegramIcon/);
  assert.match(source, /fill="#229ED9"/);
  assert.match(source, /row\(<TelegramIcon\/>, 'Telegram'/);
  assert.doesNotMatch(source, /row\(<Send size=\{18\}\/, 'Telegram'/);
});

test('Telegram and WebPush handle configured, unavailable, connecting, and error states', async () => {
  const source = await readFile(workspace, 'utf8');
  assert.match(source, /'Telegram временно недоступен'/);
  assert.match(source, /'Уведомления браузера временно недоступны'/);
  assert.match(source, /Открываем Telegram…/);
  assert.match(source, /✓ Telegram подключён/);
  assert.match(source, /✓ Уведомления браузера включены/);
  assert.match(source, /Не удалось подключить Telegram/);
  assert.match(source, /Notification\.requestPermission\(\)/);
  assert.match(source, /Уведомления запрещены в настройках браузера/);
  assert.match(source, /saveNotificationSubscription\(ticket\.id, 'WEB_PUSH'/);
});
