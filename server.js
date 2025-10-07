const express = require('express');
const puppeteer = require('puppeteer');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// Конфигурация
const CONFIG = {
  URL: 'https://donor-mos.online/account/',
  EMAIL: 'vokelood@gmail.com',
  PASSWORD: 'EightLifes8',
  BOT_TOKEN: '8465771110:AAH7D2ThT0RF2EbeLzkxnsvrdUkBmxQbmqc',
  CHAT_ID: '487525838'
};

// Хранение последнего состояния дат (в памяти)
let lastDates = new Set();
let browser = null;
let isChecking = false;

// Инициализация браузера (переиспользуем для экономии памяти)
async function initBrowser() {
  if (!browser) {
    console.log('[INIT] Запуск браузера Puppeteer...');
    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath(),
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process'
      ]
    });
    console.log('[INIT] Браузер запущен');
  }
  return browser;
}

// Отправка сообщения в Telegram
async function sendTelegramMessage(text) {
  const url = `https://api.telegram.org/bot${CONFIG.BOT_TOKEN}/sendMessage`;

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CONFIG.CHAT_ID,
        text: text,
        parse_mode: 'HTML'
      })
    });
  } catch (error) {
    console.error('[TELEGRAM] Ошибка отправки:', error.message);
  }
}

// Проверка доступности дат
async function checkDates() {
  if (isChecking) {
    console.log('[CHECK] Предыдущая проверка еще выполняется, пропускаем');
    return { success: false, message: 'Already checking' };
  }

  isChecking = true;
  const startTime = Date.now();

  try {
    const browser = await initBrowser();
    const page = await browser.newPage();

    // Оптимизация: отключаем загрузку изображений и CSS
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (['image', 'stylesheet', 'font'].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    console.log('[CHECK] Переход на страницу авторизации...');
    await page.goto(CONFIG.URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Авторизация
    console.log('[AUTH] Ввод логина и пароля...');
    await page.type('input[name="log"]', CONFIG.EMAIL);
    await page.type('input[name="pwd"]', CONFIG.PASSWORD);

    console.log('[AUTH] Клик по кнопке авторизации...');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }),
      page.click('button#wp-submit')
    ]);

    console.log('[PARSE] Извлечение дат из таблицы...');

    // Извлекаем даты с кнопками "Забронировать время"
    const availableDates = await page.evaluate(() => {
      const dates = [];
      const rows = document.querySelectorAll('tr.dates-table__item');

      rows.forEach(row => {
        const dateCell = row.querySelector('.table-item__date');
        const btnCell = row.querySelector('.table-item__btn');

        if (dateCell && btnCell) {
          const dateText = dateCell.textContent.trim();
          const hasBookButton = btnCell.querySelector('button.btn-primary') !== null;

          if (hasBookButton) {
            dates.push(dateText);
          }
        }
      });

      return dates;
    });

    await page.close();

    const currentDates = new Set(availableDates);
    console.log(`[RESULT] Найдено доступных дат: ${availableDates.length} - ${availableDates.join(', ')}`);

    // Сравнение с предыдущим состоянием
    const newDates = [...currentDates].filter(date => !lastDates.has(date));

    if (newDates.length > 0) {
      console.log(`[ALERT] 🚨 Новые даты обнаружены: ${newDates.join(', ')}`);

      // Отправляем 3 сообщения подряд
      const message = `‼️ НОВАЯ ДАТА ДЛЯ ДОНАЦИИ ‼️\n\n📅 ${newDates.join(', ')}\n\n🔗 https://donor-mos.online/account/`;

      for (let i = 0; i < 3; i++) {
        await sendTelegramMessage(message);
        await new Promise(resolve => setTimeout(resolve, 500)); // Задержка между сообщениями
      }
    }

    // Обновляем сохраненное состояние
    lastDates = currentDates;

    const duration = Date.now() - startTime;
    console.log(`[CHECK] Проверка завершена за ${duration}ms\n`);

    return {
      success: true,
      dates: availableDates,
      newDates: newDates,
      duration: duration
    };

  } catch (error) {
    console.error('[ERROR] Ошибка проверки:', error.message);
    return { success: false, error: error.message };
  } finally {
    isChecking = false;
  }
}

// API endpoints
app.get('/', (req, res) => {
  res.json({
    status: 'running',
    service: 'Trombocity Donor Monitor',
    lastCheck: lastDates.size > 0 ? Array.from(lastDates) : 'No data yet'
  });
});

app.get('/check', async (req, res) => {
  console.log('[API] Получен запрос на проверку');
  const result = await checkDates();
  res.json(result);
});

app.get('/ping', (req, res) => {
  res.json({ status: 'alive', timestamp: new Date().toISOString() });
});

// Самопинговка каждые 5 минут (предотвращение засыпания)
const SELF_PING_INTERVAL = 5 * 60 * 1000; // 5 минут

async function selfPing() {
  try {
    const appUrl = process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000';
    await fetch(`${appUrl}/ping`);
    console.log('[HEARTBEAT] Self-ping успешен');
  } catch (error) {
    console.log('[HEARTBEAT] Self-ping (нормально для локальной разработки)');
  }
}

// Запуск сервера
app.listen(PORT, async () => {
  console.log(`\n🚀 Сервер запущен на порту ${PORT}`);
  console.log(`📊 Мониторинг: ${CONFIG.URL}`);
  console.log(`⏰ Heartbeat: каждые 5 минут\n`);

  // Инициализируем браузер при старте
  await initBrowser();

  // Первая проверка сразу при запуске
  console.log('[STARTUP] Выполнение первоначальной проверки...');
  await checkDates();

  // Запускаем heartbeat
  setInterval(selfPing, SELF_PING_INTERVAL);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[SHUTDOWN] Получен SIGTERM, закрытие браузера...');
  if (browser) {
    await browser.close();
  }
  process.exit(0);
});
