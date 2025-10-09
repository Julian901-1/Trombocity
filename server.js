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
  CHAT_ID: '487525838',
  SHEETS_URL: 'https://script.google.com/macros/s/AKfycbyMKh6Prt9Rf4nd6xmf5n-jqWxlkNg_OE6-9Zp20UUmAZqte0crFpVvonWedCYnXLTA/exec'
};

let browser = null;
let page = null;
let isChecking = false;

// Инициализация браузера (одна сессия на весь процесс)
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
        '--single-process',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-extensions',
        '--disable-sync',
        '--metrics-recording-only',
        '--mute-audio',
        '--no-default-browser-check',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding'
      ]
    });
    console.log('[INIT] Браузер запущен');
  }

  // Создаем одну переиспользуемую страницу
  if (!page || page.isClosed()) {
    console.log('[INIT] Создание новой страницы...');
    page = await browser.newPage();

    // Оптимизация: отключаем загрузку изображений, CSS, шрифтов
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    console.log('[INIT] Страница готова');
  }

  return { browser, page };
}

// Получить сохраненные даты из Google Sheets
async function getSavedDates() {
  try {
    const response = await fetch(`${CONFIG.SHEETS_URL}?action=getDates`, {
      method: 'GET',
      timeout: 10000
    });
    const data = await response.json();
    console.log('[SHEETS] Загружены даты:', data.dates || []);
    return new Set(data.dates || []);
  } catch (error) {
    console.error('[SHEETS] Ошибка загрузки дат:', error.message);
    return new Set();
  }
}

// Сохранить даты в Google Sheets
async function saveDates(dates) {
  try {
    await fetch(`${CONFIG.SHEETS_URL}?action=saveDates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dates: Array.from(dates) })
    });
    console.log('[SHEETS] Даты сохранены:', Array.from(dates));
  } catch (error) {
    console.error('[SHEETS] Ошибка сохранения дат:', error.message);
  }
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
    // Используем одну переиспользуемую страницу
    const { browser: browserInstance, page: pageInstance } = await initBrowser();

    console.log('[CHECK] Переход на страницу авторизации...');
    await pageInstance.goto(CONFIG.URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const currentUrl = pageInstance.url();
    console.log(`[DEBUG] Текущий URL после загрузки: ${currentUrl}`);

    // Проверяем наличие формы авторизации и других элементов
    const pageInfo = await pageInstance.evaluate(() => {
      return {
        hasLoginForm: document.querySelector('input[name="log"]') !== null,
        hasPasswordField: document.querySelector('input[name="pwd"]') !== null,
        hasSubmitButton: document.querySelector('button#wp-submit') !== null,
        hasCaptcha: document.querySelector('iframe[src*="recaptcha"]') !== null ||
                    document.querySelector('.g-recaptcha') !== null ||
                    document.querySelector('[class*="captcha"]') !== null,
        hasTable: document.querySelector('tr.dates-table__item') !== null,
        title: document.title,
        bodyText: document.body.innerText.substring(0, 200)
      };
    });

    console.log('[DEBUG] Информация о странице:', JSON.stringify(pageInfo, null, 2));

    if (pageInfo.hasCaptcha) {
      console.log('[ERROR] 🚨 ОБНАРУЖЕНА CAPTCHA! Автоматическая авторизация невозможна.');
      throw new Error('CAPTCHA detected on page');
    }

    if (pageInfo.hasLoginForm) {
      // Авторизация
      console.log('[AUTH] Форма авторизации найдена, ввод логина и пароля...');
      await pageInstance.waitForSelector('input[name="log"]', { timeout: 5000 });

      // Очищаем поля перед вводом
      await pageInstance.click('input[name="log"]', { clickCount: 3 });
      await pageInstance.type('input[name="log"]', CONFIG.EMAIL, { delay: 50 });

      await pageInstance.click('input[name="pwd"]', { clickCount: 3 });
      await pageInstance.type('input[name="pwd"]', CONFIG.PASSWORD, { delay: 50 });

      console.log('[AUTH] Данные введены, проверка кнопки...');
      const buttonInfo = await pageInstance.evaluate(() => {
        const btn = document.querySelector('button#wp-submit');
        return {
          exists: btn !== null,
          disabled: btn?.disabled,
          text: btn?.textContent,
          visible: btn ? window.getComputedStyle(btn).display !== 'none' : false
        };
      });
      console.log('[AUTH] Информация о кнопке:', JSON.stringify(buttonInfo));

      console.log('[AUTH] Клик по кнопке авторизации...');

      try {
        // Используем race чтобы не зависнуть
        await Promise.race([
          pageInstance.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }),
          pageInstance.click('button#wp-submit').then(() => new Promise(resolve => setTimeout(resolve, 1000)))
        ]);

        const newUrl = pageInstance.url();
        console.log(`[AUTH] Редирект успешен, новый URL: ${newUrl}`);
      } catch (navError) {
        console.log(`[AUTH] Navigation timeout, но проверяем текущее состояние...`);
        const fallbackUrl = pageInstance.url();
        console.log(`[AUTH] URL после таймаута: ${fallbackUrl}`);

        // Проверяем, возможно редирект всё же произошёл
        if (fallbackUrl !== currentUrl) {
          console.log('[AUTH] Редирект произошёл несмотря на таймаут');
        } else {
          throw navError;
        }
      }
    } else if (pageInfo.hasTable) {
      console.log('[AUTH] Уже на странице с таблицей дат, авторизация не требуется');
    } else {
      console.log('[AUTH] Неизвестное состояние страницы');
    }

    console.log('[PARSE] Извлечение дат из таблицы...');

    // Ждем появления таблицы
    await pageInstance.waitForSelector('tr.dates-table__item', { timeout: 10000 });

    // Извлекаем даты с кнопками "Забронировать время"
    const availableDates = await pageInstance.evaluate(() => {
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

    // НЕ закрываем страницу - переиспользуем её!

    const currentDates = new Set(availableDates);
    console.log(`[RESULT] Найдено доступных дат: ${availableDates.length} - ${availableDates.join(', ')}`);

    // Загружаем последние сохраненные даты из Google Sheets
    const lastDates = await getSavedDates();

    // Сравнение с предыдущим состоянием
    const newDates = [...currentDates].filter(date => !lastDates.has(date));

    if (newDates.length > 0 && lastDates.size > 0) {
      console.log(`[ALERT] 🚨 Новые даты обнаружены: ${newDates.join(', ')}`);

      // Отправляем 3 сообщения подряд
      const message = `‼️ НОВАЯ ДАТА ДЛЯ ДОНАЦИИ ‼️\n\n📅 ${newDates.join(', ')}\n\n🔗 https://donor-mos.online/account/`;

      for (let i = 0; i < 3; i++) {
        await sendTelegramMessage(message);
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } else if (lastDates.size === 0) {
      console.log('[INIT] Первая проверка после запуска, уведомление не отправляется');
    }

    // Сохраняем текущие даты в Google Sheets
    await saveDates(currentDates);

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
    service: 'Trombocity Donor Monitor'
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
  if (page && !page.isClosed()) {
    await page.close();
  }
  if (browser) {
    await browser.close();
  }
  process.exit(0);
});

// Мониторинг памяти каждые 10 минут
setInterval(() => {
  const memUsage = process.memoryUsage();
  console.log(`[MEMORY] RSS: ${Math.round(memUsage.rss / 1024 / 1024)}MB, Heap: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);
}, 10 * 60 * 1000);
