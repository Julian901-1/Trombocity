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
  SHEETS_URL: 'https://script.google.com/macros/s/AKfycbyMKh6Prt9Rf4nd6xmf5n-jqWxlkNg_OE6-9Zp20UUmAZqte0crFpVvonWedCYnXLTA/exec',
  TWOCAPTCHA_API_KEY: '60441485da02e2db24facdcd5c6ef9d9'
};

let browser = null;
let page = null;
let isLoggedIn = false;
let lastDates = new Set();

// ===========================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ===========================

// Решение Yandex SmartCaptcha через 2Captcha HTTP API
async function solveYandexCaptcha(pageUrl, siteKey) {
  console.log('[CAPTCHA] Отправка капчи на решение...');

  try {
    // Отправка задачи
    const inUrl = `https://2captcha.com/in.php?key=${CONFIG.TWOCAPTCHA_API_KEY}&method=yandex&sitekey=${siteKey}&pageurl=${encodeURIComponent(pageUrl)}&json=1`;
    const inResponse = await fetch(inUrl);
    const inData = await inResponse.json();

    if (inData.status !== 1) {
      console.log('[CAPTCHA] Ошибка отправки:', inData);
      return null;
    }

    const taskId = inData.request;
    console.log(`[CAPTCHA] ID задачи: ${taskId}`);

    // Polling решения (до 60 секунд)
    for (let i = 0; i < 12; i++) {
      await new Promise(resolve => setTimeout(resolve, 5000));

      const resUrl = `https://2captcha.com/res.php?key=${CONFIG.TWOCAPTCHA_API_KEY}&action=get&id=${taskId}&json=1`;
      const resResponse = await fetch(resUrl);
      const resData = await resResponse.json();

      if (resData.status === 1) {
        console.log('[CAPTCHA] ✅ Решена');
        return resData.request;
      } else if (resData.request !== 'CAPCHA_NOT_READY') {
        console.log('[CAPTCHA] Ошибка:', resData);
        return null;
      }
    }

    console.log('[CAPTCHA] Timeout');
    return null;
  } catch (err) {
    console.log('[CAPTCHA] Ошибка:', err.message);
    return null;
  }
}

// Отправка уведомления в Telegram
async function sendTelegramNotification(dates) {
  const message = `🚨 Новые даты: ${dates.join(', ')}`;

  for (let i = 0; i < 3; i++) {
    try {
      await fetch(`https://api.telegram.org/bot${CONFIG.BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: CONFIG.CHAT_ID,
          text: message
        })
      });
    } catch (err) {
      console.log('[TELEGRAM] Ошибка отправки');
    }
  }
}

// Сохранение дат в Google Sheets
async function saveDatesToSheets(dates) {
  try {
    await fetch(`${CONFIG.SHEETS_URL}?action=saveDates`, {
      method: 'POST',
      body: JSON.stringify({ dates: Array.from(dates) })
    });
  } catch (err) {
    console.log('[SHEETS] Ошибка сохранения дат');
  }
}

// Загрузка дат из Google Sheets
async function loadDatesFromSheets() {
  try {
    const response = await fetch(`${CONFIG.SHEETS_URL}?action=getDates`);
    const data = await response.json();
    return new Set(data.dates || []);
  } catch (err) {
    console.log('[SHEETS] Ошибка загрузки дат');
    return new Set();
  }
}

// Сохранение cookies
async function saveCookies(cookies) {
  try {
    await fetch(`${CONFIG.SHEETS_URL}?action=saveCookies`, {
      method: 'POST',
      body: JSON.stringify({ cookies })
    });
  } catch (err) {
    console.log('[COOKIES] Ошибка сохранения');
  }
}

// Загрузка cookies
async function loadCookies() {
  try {
    const response = await fetch(`${CONFIG.SHEETS_URL}?action=getCookies`);
    const data = await response.json();
    return data.cookies || [];
  } catch (err) {
    console.log('[COOKIES] Ошибка загрузки');
    return [];
  }
}

// ===========================
// ОСНОВНАЯ ЛОГИКА
// ===========================

// Инициализация браузера
async function initBrowser() {
  if (browser) return;

  console.log('[INIT] Запуск браузера...');

  browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath(),
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process',
      '--js-flags=--max-old-space-size=256'
    ]
  });

  page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  // Блокировка только тяжёлых ресурсов (не блокируем скрипты и XHR)
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const resourceType = req.resourceType();
    if (['image', 'font', 'media'].includes(resourceType)) {
      req.abort();
    } else {
      req.continue();
    }
  });

  // Загрузка cookies
  const cookies = await loadCookies();
  if (cookies.length > 0) {
    await page.setCookie(...cookies);
    console.log(`[INIT] Загружено ${cookies.length} cookies`);
  }

  await page.goto(CONFIG.URL, { waitUntil: 'networkidle2', timeout: 30000 });
  console.log('[INIT] Готово');
}

// Авторизация с обработкой капчи
async function login() {
  console.log('[AUTH] Начало авторизации');

  // Проверяем текущий URL - если не на account, переходим
  if (!page.url().includes('/account')) {
    await page.goto(CONFIG.URL, { waitUntil: 'networkidle2' });
  }

  // Проверка: уже залогинены?
  const hasAccountInfo = await page.$('.account-info');
  if (hasAccountInfo) {
    console.log('[AUTH] ✅ Уже авторизованы');
    isLoggedIn = true;
    return true;
  }

  // Проверка наличия формы логина
  const hasLoginForm = await page.$('input[name="log"]');
  if (!hasLoginForm) {
    console.log('[AUTH] Форма логина не найдена, перезагрузка страницы');
    await page.reload({ waitUntil: 'networkidle2' });
  }

  // Ввод логина и пароля
  await page.waitForSelector('input[name="log"]', { timeout: 5000 });

  // Очищаем поля перед вводом
  await page.evaluate(() => {
    document.querySelector('input[name="log"]').value = '';
    document.querySelector('input[name="pwd"]').value = '';
  });

  await page.type('input[name="log"]', CONFIG.EMAIL);
  await page.type('input[name="pwd"]', CONFIG.PASSWORD);

  console.log('[AUTH] Клик по кнопке авторизации');

  // Проверяем наличие кнопки
  const hasButton = await page.$('button#wp-submit');
  if (!hasButton) {
    console.log('[AUTH] ❌ Кнопка не найдена');
    return false;
  }

  await page.click('button#wp-submit');

  // Ждём ответа сервера
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Проверяем: появилась ли капча в HTML?
  const pageHtml = await page.content();
  const sitekeyMatch = pageHtml.match(/sitekey['":\s=]+['"]?([a-zA-Z0-9_-]{30,})['"]?/i);

  if (sitekeyMatch) {
    const sitekey = sitekeyMatch[1];
    console.log(`[AUTH] Обнаружена капча: ${sitekey}`);

    // Решаем капчу
    const token = await solveYandexCaptcha(page.url(), sitekey);
    if (!token) {
      console.log('[AUTH] ❌ Не удалось решить капчу');
      return false;
    }

    // Вставляем токен и отправляем форму напрямую
    console.log('[AUTH] Вставка токена и отправка формы');
    await page.evaluate((token) => {
      let input = document.querySelector('input[name="smart-token"]');
      if (!input) {
        input = document.createElement('input');
        input.type = 'hidden';
        input.name = 'smart-token';
        document.querySelector('form').appendChild(input);
      }
      input.value = token;

      // Отправляем форму напрямую через submit() вместо клика по кнопке
      const form = document.querySelector('form');
      if (form) {
        form.submit();
      }
    }, token);

    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  // Проверка успешной авторизации
  const accountInfo = await page.$('.account-info');
  if (accountInfo) {
    console.log('[AUTH] ✅ Успешно');
    isLoggedIn = true;

    // Сохраняем cookies
    const cookies = await page.cookies();
    await saveCookies(cookies);

    return true;
  }

  console.log('[AUTH] ❌ Не удалось');
  isLoggedIn = false;
  return false;
}

// Проверка дат
async function checkDates() {
  console.log('[CHECK] Проверка дат');

  if (!isLoggedIn) {
    const success = await login();
    if (!success) {
      throw new Error('Не удалось авторизоваться');
    }
  }

  // Используем reload вместо goto для сохранения сессии
  console.log('[CHECK] Обновление страницы');
  await page.reload({ waitUntil: 'networkidle2' });

  // Проверяем авторизацию перед извлечением дат
  const stillLoggedIn = await page.$('.account-info');
  if (!stillLoggedIn) {
    console.log('[CHECK] Сессия истекла, переавторизация...');
    isLoggedIn = false;
    const success = await login();
    if (!success) {
      throw new Error('Не удалось переавторизоваться');
    }
    // После авторизации уже на нужной странице, не нужен goto
  }

  // Извлечение дат (ВСЕ даты, не только с кнопками)
  const dates = await page.evaluate(() => {
    const rows = document.querySelectorAll('tr.dates-table__item');
    return Array.from(rows).map(row => {
      const dateCell = row.querySelector('td.table-item__date');
      if (!dateCell) return null;

      const dateText = dateCell.innerText.trim();
      // Проверяем, есть ли кнопка "Забронировать" (доступная дата)
      const hasBookButton = row.querySelector('button.btn-primary') !== null;

      return { date: dateText, available: hasBookButton };
    }).filter(d => d && d.date);
  });

  if (dates.length === 0) {
    console.log('[CHECK] Таблица дат не найдена');
    return { newDates: [], allDates: [] };
  }

  // Фильтруем только доступные даты (с кнопкой "Забронировать")
  const availableDates = dates.filter(d => d.available).map(d => d.date);
  const allDatesStr = dates.map(d => `${d.date}${d.available ? '✅' : '❌'}`);

  console.log(`[CHECK] Найдено дат: ${dates.length} (доступных: ${availableDates.length})`);
  console.log(`[CHECK] Даты: ${allDatesStr.join(', ')}`);

  // Проверка новых доступных дат
  const currentDates = new Set(availableDates);
  const newDates = [...currentDates].filter(d => !lastDates.has(d));

  if (newDates.length > 0 && lastDates.size > 0) {
    console.log(`[CHECK] 🚨 Новые даты: ${newDates.join(', ')}`);
    await sendTelegramNotification(newDates);
  }

  lastDates = currentDates;
  await saveDatesToSheets(currentDates);

  return { newDates, allDates: availableDates };
}

// ===========================
// API ENDPOINTS
// ===========================

app.get('/check', async (req, res) => {
  console.log('[API] Запрос на проверку');

  try {
    await initBrowser();
    const result = await checkDates();

    // Garbage collection
    if (global.gc) global.gc();

    res.json({
      success: true,
      newDates: result.newDates,
      allDates: result.allDates,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.log('[ERROR]', err.message);
    isLoggedIn = false;
    res.json({
      success: false,
      error: err.message
    });
  }
});

app.get('/ping', (req, res) => {
  res.send('OK');
});

app.get('/', (req, res) => {
  res.send('Trombocity Monitor Running');
});

// ===========================
// ЗАПУСК СЕРВЕРА
// ===========================

app.listen(PORT, async () => {
  console.log(`[SERVER] Запущен на порту ${PORT}`);

  // Загрузка сохранённых дат
  lastDates = await loadDatesFromSheets();
  console.log(`[INIT] Загружено ${lastDates.size} дат из хранилища`);

  // Первая проверка
  try {
    await initBrowser();
    await checkDates();
  } catch (err) {
    console.log('[STARTUP] Ошибка первой проверки:', err.message);
  }

  // Self-ping каждые 5 минут
  setInterval(async () => {
    try {
      await fetch(`http://localhost:${PORT}/ping`);
    } catch (e) {}
  }, 5 * 60 * 1000);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[SHUTDOWN] Закрытие браузера');
  if (browser) await browser.close();
  process.exit(0);
});
