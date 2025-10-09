const express = require('express');
const puppeteer = require('puppeteer');
const fetch = require('node-fetch');
const TwoCaptcha = require('2captcha');

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

// Инициализация 2Captcha (если указан ключ)
const solver = CONFIG.TWOCAPTCHA_API_KEY ? new TwoCaptcha.Solver(CONFIG.TWOCAPTCHA_API_KEY) : null;

let browser = null;
let page = null;
let isChecking = false;
let isLoggedIn = false; // Флаг успешной авторизации

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
        '--disable-renderer-backgrounding',
        '--js-flags=--max-old-space-size=256' // Ограничение памяти JS до 256MB
      ]
    });
    console.log('[INIT] Браузер запущен');
  }

  // Создаем одну переиспользуемую страницу
  if (!page || page.isClosed()) {
    console.log('[INIT] Создание новой страницы...');
    page = await browser.newPage();

    // Устанавливаем User-Agent реального браузера (обход детекции headless)
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Загружаем cookies из Google Sheets (если есть)
    try {
      const savedCookiesResponse = await fetch(`${CONFIG.SHEETS_URL}?action=getCookies`, {
        method: 'GET',
        timeout: 5000
      });
      const cookiesData = await savedCookiesResponse.json();

      if (cookiesData.cookies && cookiesData.cookies.length > 0) {
        await page.setCookie(...cookiesData.cookies);
        console.log(`[INIT] ✅ Загружено ${cookiesData.cookies.length} cookies из хранилища`);
      }
    } catch (e) {
      console.log('[INIT] Cookies не найдены или ошибка загрузки (норма для первого запуска)');
    }

    // Оптимизация: отключаем загрузку изображений, CSS, шрифтов, НО РАЗРЕШАЕМ СКРИПТЫ
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const resourceType = req.resourceType();

      // Блокируем изображения, CSS, шрифты, медиа (но НЕ SmartCaptcha)
      if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    console.log('[INIT] Страница готова');
  }

  return { browser, page };
}

// Сохранить cookies в Google Sheets
async function saveCookies(pageInstance) {
  try {
    const cookies = await pageInstance.cookies();
    await fetch(`${CONFIG.SHEETS_URL}?action=saveCookies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookies })
    });
    console.log(`[COOKIES] Сохранено ${cookies.length} cookies`);
  } catch (error) {
    console.error('[COOKIES] Ошибка сохранения:', error.message);
  }
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

// Решение CAPTCHA через 2Captcha API (reCAPTCHA + Yandex SmartCaptcha)
async function solveCaptcha(pageInstance) {
  if (!solver) {
    console.log('[CAPTCHA] 2Captcha API ключ не настроен, пропускаем решение');
    return false;
  }

  try {
    console.log('[CAPTCHA] Поиск капчи на странице...');

    // Логируем HTML для отладки
    const pageHtml = await pageInstance.evaluate(() => document.documentElement.outerHTML);
    console.log('[DEBUG] ========== HTML страницы (фрагмент для поиска капчи) ==========');
    const captchaFragment = pageHtml.substring(
      Math.max(0, pageHtml.indexOf('smartcaptcha') - 500),
      pageHtml.indexOf('smartcaptcha') + 1000
    );
    console.log(captchaFragment || 'smartcaptcha не найден в HTML');
    console.log('[DEBUG] ===============================================================');

    // Получаем информацию о капче
    const captchaInfo = await pageInstance.evaluate(() => {
      // Yandex SmartCaptcha - более агрессивный поиск
      if (document.querySelector('script[src*="smartcaptcha.yandexcloud.net"]') ||
          document.documentElement.outerHTML.includes('smartcaptcha')) {

        // Пробуем найти sitekey в разных местах
        let siteKey = null;

        // 1. Проверяем data-sitekey в любом элементе
        const elementWithSitekey = document.querySelector('[data-sitekey]');
        if (elementWithSitekey) {
          siteKey = elementWithSitekey.getAttribute('data-sitekey');
        }

        // 2. Ищем в скриптах и inline JavaScript
        if (!siteKey) {
          const scripts = Array.from(document.querySelectorAll('script'));
          for (const script of scripts) {
            const content = script.textContent || '';
            const match = content.match(/sitekey['":\s]+['"]([^'"]+)['"]/i) ||
                         content.match(/data-sitekey['":\s]+['"]([^'"]+)['"]/i);
            if (match) {
              siteKey = match[1];
              break;
            }
          }
        }

        // 3. Ищем в window объекте
        if (!siteKey && window.smartCaptchaConfig) {
          siteKey = window.smartCaptchaConfig.sitekey || window.smartCaptchaConfig.siteKey;
        }

        return { siteKey, type: 'yandex' };
      }

      // reCAPTCHA v2
      const iframe = document.querySelector('iframe[src*="recaptcha"]');
      if (iframe) {
        const src = iframe.getAttribute('src');
        const match = src.match(/k=([^&]+)/);
        return { siteKey: match ? match[1] : null, type: 'recaptcha_v2' };
      }

      const recaptchaDiv = document.querySelector('.g-recaptcha');
      if (recaptchaDiv) {
        return {
          siteKey: recaptchaDiv.getAttribute('data-sitekey'),
          type: 'recaptcha_v2'
        };
      }

      return null;
    });

    if (!captchaInfo) {
      console.log('[CAPTCHA] Капча не обнаружена');
      return false;
    }

    console.log(`[CAPTCHA] Тип капчи: ${captchaInfo.type}`);

    if (!captchaInfo.siteKey) {
      console.log('[CAPTCHA] Site-key не найден');
      return false;
    }

    console.log(`[CAPTCHA] Site-key найден: ${captchaInfo.siteKey}`);
    console.log('[CAPTCHA] Отправка задачи на решение через 2Captcha (может занять 15-60 секунд)...');

    let result;

    if (captchaInfo.type === 'yandex') {
      console.log('[CAPTCHA] Решение Yandex SmartCaptcha через 2Captcha API (HTTP)...');

      // Отправляем задачу на решение через HTTP API
      const inUrl = `https://2captcha.com/in.php?key=${CONFIG.TWOCAPTCHA_API_KEY}&method=yandex&sitekey=${captchaInfo.siteKey}&pageurl=${encodeURIComponent(pageInstance.url())}&json=1`;
      const inResponse = await fetch(inUrl);
      const inData = await inResponse.json();

      if (inData.status !== 1) {
        console.log('[CAPTCHA] Ошибка отправки задачи:', inData);
        return false;
      }

      const taskId = inData.request;
      console.log(`[CAPTCHA] Задача отправлена, ID: ${taskId}. Ожидание решения (до 60 секунд)...`);

      // Ждём решения (polling)
      let token = null;
      for (let i = 0; i < 20; i++) {
        await new Promise(resolve => setTimeout(resolve, 5000)); // Ждём 5 секунд

        const resUrl = `https://2captcha.com/res.php?key=${CONFIG.TWOCAPTCHA_API_KEY}&action=get&id=${taskId}&json=1`;
        const resResponse = await fetch(resUrl);
        const resData = await resResponse.json();

        if (resData.status === 1) {
          token = resData.request;
          console.log(`[CAPTCHA] ✅ Yandex SmartCaptcha решена! Токен получен.`);
          break;
        } else if (resData.request !== 'CAPCHA_NOT_READY') {
          console.log('[CAPTCHA] Ошибка решения:', resData);
          return false;
        }

        console.log(`[CAPTCHA] Ожидание решения... (попытка ${i + 1}/20)`);
      }

      if (!token) {
        console.log('[CAPTCHA] Timeout - капча не решена за 100 секунд');
        return false;
      }

      // Вставляем токен в hidden input для SmartCaptcha
      await pageInstance.evaluate((token) => {
        // Пробуем найти input с data-testid='smart-token'
        let tokenInput = document.querySelector("input[data-testid='smart-token']");

        // Если не найден, ищем любой hidden input рядом с captcha-container
        if (!tokenInput) {
          const container = document.querySelector('#captcha-container') || document.querySelector('[data-sitekey]');
          if (container) {
            tokenInput = container.querySelector('input[type="hidden"]') ||
                        container.parentElement.querySelector('input[type="hidden"]');
          }
        }

        // Если всё ещё не найден, создаём его
        if (!tokenInput) {
          tokenInput = document.createElement('input');
          tokenInput.type = 'hidden';
          tokenInput.name = 'smart-token';
          tokenInput.setAttribute('data-testid', 'smart-token');
          const form = document.querySelector('form');
          if (form) {
            form.appendChild(tokenInput);
          }
        }

        if (tokenInput) {
          tokenInput.value = token;
          console.log('Токен Yandex SmartCaptcha вставлен');
        }

        // Также пробуем вызвать callback, если есть
        if (window.smartCaptcha && typeof window.smartCaptcha.success === 'function') {
          window.smartCaptcha.success(token);
        }
      }, token);

      result = { data: token, id: taskId };

    } else {
      // reCAPTCHA v2
      console.log('[CAPTCHA] Решение reCAPTCHA v2 через 2Captcha API...');

      result = await solver.recaptcha({
        pageurl: pageInstance.url(),
        googlekey: captchaInfo.siteKey
      });

      console.log(`[CAPTCHA] ✅ reCAPTCHA решена! ID: ${result.id}`);

      await pageInstance.evaluate((token) => {
        const textarea = document.querySelector('#g-recaptcha-response');
        if (textarea) {
          textarea.innerHTML = token;
        }

        if (window.grecaptcha && typeof window.grecaptcha.getResponse === 'function') {
          window.___grecaptcha_cfg.clients[0].callback(token);
        }
      }, result.data);
    }

    console.log('[CAPTCHA] Токен вставлен на страницу');
    await new Promise(resolve => setTimeout(resolve, 3000));

    return true;

  } catch (error) {
    console.error('[CAPTCHA] Ошибка решения капчи:', error.message);
    return false;
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

    // Если уже залогинены - просто обновляем страницу
    if (isLoggedIn) {
      console.log('[CHECK] Уже авторизованы, обновление страницы...');
      await pageInstance.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
      console.log('[CHECK] Страница обновлена');
    } else {
      // Первая авторизация
      console.log('[CHECK] Переход на страницу авторизации...');
      await pageInstance.goto(CONFIG.URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

      const currentUrl = pageInstance.url();
      console.log(`[DEBUG] Текущий URL после загрузки: ${currentUrl}`);

      // Проверяем наличие формы авторизации и других элементов
      const pageInfo = await pageInstance.evaluate(() => {
        return {
          hasAccountInfo: document.querySelector('.account-info') !== null,
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

      // Если уже авторизованы (есть account-info) - пропускаем логин
      if (pageInfo.hasAccountInfo) {
        console.log('[AUTH] ✅ Уже авторизованы (найден блок account-info), пропускаем логин');
        isLoggedIn = true;
      }

      else if (pageInfo.hasCaptcha) {
        console.log('[ERROR] 🚨 ОБНАРУЖЕНА CAPTCHA!');

        // Стратегия 1: Попытка обновить страницу
        console.log('[CAPTCHA] Стратегия 1: Обновление страницы...');
        await pageInstance.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });

        const pageInfoAfterReload = await pageInstance.evaluate(() => {
          return {
            hasCaptcha: document.querySelector('iframe[src*="recaptcha"]') !== null ||
                        document.querySelector('.g-recaptcha') !== null ||
                        document.querySelector('[class*="captcha"]') !== null,
            hasTable: document.querySelector('tr.dates-table__item') !== null
          };
        });

        if (pageInfoAfterReload.hasCaptcha) {
          console.log('[CAPTCHA] Капча осталась после обновления.');

          // Стратегия 2: Решение через 2Captcha API
          console.log('[CAPTCHA] Стратегия 2: Попытка решения через 2Captcha API...');
          const solved = await solveCaptcha(pageInstance);

          if (solved) {
            console.log('[CAPTCHA] ✅ Капча успешно решена через API!');

            // Проверяем, что таблица теперь доступна
            await new Promise(resolve => setTimeout(resolve, 2000));
            const finalCheck = await pageInstance.evaluate(() => {
              return document.querySelector('tr.dates-table__item') !== null;
            });

            if (finalCheck) {
              console.log('[SUCCESS] Таблица доступна после решения капчи');
              isLoggedIn = true;
            } else {
              console.log('[ERROR] Таблица всё ещё недоступна');
              isLoggedIn = false;
              throw new Error('CAPTCHA решена, но таблица недоступна');
            }
          } else {
            // Если 2Captcha не настроена или не сработала
            console.log('[ERROR] Не удалось решить капчу. Сбрасываем флаг авторизации.');
            isLoggedIn = false;
            throw new Error('CAPTCHA detected - требуется ручная авторизация или настройка 2Captcha API');
          }
        } else if (pageInfoAfterReload.hasTable) {
          console.log('[SUCCESS] После обновления капча исчезла, таблица доступна');
          isLoggedIn = true;
        }
      } else if (pageInfo.hasLoginForm) {
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

        // НОВЫЙ ПОДХОД: Сначала отправляем форму, ПОТОМ капча появится
        console.log('[AUTH] Отправка формы (капча появится после отправки)...');

        // Кликаем по кнопке (не submit, чтобы сработали обработчики)
        await pageInstance.click('button#wp-submit');

        console.log('[AUTH] Форма отправлена, ожидание появления капчи (до 15 секунд)...');

        // Ждём появления sitekey в HTML (проверяем каждые 2 секунды)
        let htmlAfterSubmit;
        let sitekeyMatches = null;
        for (let i = 0; i < 8; i++) {
          await new Promise(resolve => setTimeout(resolve, 2000));

          htmlAfterSubmit = await pageInstance.evaluate(() => document.documentElement.outerHTML);
          sitekeyMatches = htmlAfterSubmit.match(/sitekey['":\s=]+['"]?([a-zA-Z0-9_-]+)['"]?/gi);

          if (sitekeyMatches && sitekeyMatches.length > 0) {
            console.log(`[AUTH] ✅ Sitekey найден после ${(i + 1) * 2} секунд ожидания`);
            break;
          }

          console.log(`[AUTH] Sitekey не найден, ожидание... (${(i + 1) * 2}/16 секунд)`);
        }

        // Логируем HTML после клика - теперь капча должна быть
        console.log('[DEBUG] ========== HTML ПОСЛЕ ОТПРАВКИ (поиск капчи, 3000 символов) ==========');
        const captchaFragment = htmlAfterSubmit.substring(
          Math.max(0, htmlAfterSubmit.indexOf('smartcaptcha') - 500),
          htmlAfterSubmit.indexOf('smartcaptcha') + 2500
        );
        console.log(captchaFragment || htmlAfterSubmit.substring(0, 3000));
        console.log('[DEBUG] ===============================================================');

        // Ищем sitekey в HTML после отправки
        console.log('[DEBUG] Найденные упоминания sitekey после отправки:', sitekeyMatches);

        // Проверяем, появилась ли капча
        if (!sitekeyMatches || sitekeyMatches.length === 0) {
          console.log('[AUTH] ⚠️ Капча не появилась. Возможно, авторизация прошла без капчи или используются cookies.');
          console.log('[AUTH] Проверка наличия account-info блока...');

          // Проверяем, может авторизация уже прошла
          const hasAccountInfo = await pageInstance.evaluate(() => {
            return document.querySelector('.account-info') !== null;
          });

          if (hasAccountInfo) {
            console.log('[AUTH] ✅ Авторизация успешна без капчи (используются cookies)');
            isLoggedIn = true;
            // Переходим к проверке таблицы (пропускаем решение капчи)
          } else {
            console.log('[ERROR] Авторизация не удалась - капча не появилась, account-info не найден');
            isLoggedIn = false;
            throw new Error('Captcha not loaded and authentication failed');
          }
        } else {
          // Капча появилась, решаем её
          console.log('[AUTH] Решение Yandex SmartCaptcha через 2Captcha API...');
          const captchaSolved = await solveCaptcha(pageInstance);

          if (!captchaSolved) {
            console.log('[ERROR] Не удалось решить капчу');
            isLoggedIn = false;
            throw new Error('Failed to solve captcha');
          }

          console.log('[CAPTCHA] ✅ Капча успешно решена, повторная отправка формы...');

          // Отправляем форму снова с токеном капчи
          await pageInstance.click('button#wp-submit');
        }

        console.log('[AUTH] Ожидание загрузки личного кабинета (5 секунд)...');
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Логируем полный HTML страницы после клика
        const htmlAfterClick = await pageInstance.evaluate(() => document.documentElement.outerHTML);
        console.log('[DEBUG] ========== HTML ПОСЛЕ КЛИКА (первые 2000 символов) ==========');
        console.log(htmlAfterClick.substring(0, 2000));
        console.log('[DEBUG] ===============================================================');

        try {
          // Ждем появления блока с информацией об аккаунте (признак успешной авторизации)
          await pageInstance.waitForSelector('.account-info', { timeout: 30000 });
          console.log('[AUTH] ✅ Успешная авторизация - найден блок account-info');

          // Проверяем наличие текста группы крови
          const accountInfo = await pageInstance.evaluate(() => {
            const accountBlock = document.querySelector('.account-info');
            return accountBlock ? accountBlock.innerText : '';
          });

          console.log(`[AUTH] Информация об аккаунте: ${accountInfo.substring(0, 100)}`);
          isLoggedIn = true;

          // Сохраняем cookies после успешной авторизации
          await saveCookies(pageInstance);

        } catch (authError) {
          console.log('[AUTH] Не удалось дождаться загрузки личного кабинета');

          // Логируем HTML при ошибке
          const htmlOnError = await pageInstance.evaluate(() => {
            return {
              html: document.documentElement.outerHTML.substring(0, 3000),
              hasAccountInfo: document.querySelector('.account-info') !== null,
              hasTable: document.querySelector('tr.dates-table__item') !== null,
              allClasses: Array.from(document.querySelectorAll('[class]')).slice(0, 20).map(el => el.className)
            };
          });

          console.log('[DEBUG] ========== HTML ПРИ ОШИБКЕ АВТОРИЗАЦИИ ==========');
          console.log(JSON.stringify(htmlOnError, null, 2));
          console.log('[DEBUG] ===================================================');

          if (htmlOnError.hasAccountInfo) {
            console.log('[AUTH] Account-info найден при повторной проверке');
            isLoggedIn = true;
          } else {
            console.log('[AUTH] Авторизация не удалась');
            isLoggedIn = false;
            throw new Error('Authentication failed - account-info block not found');
          }
        }
      } else if (pageInfo.hasTable) {
        console.log('[AUTH] Уже на странице с таблицей дат, авторизация не требуется');
        isLoggedIn = true;
      } else {
        console.log('[AUTH] Неизвестное состояние страницы');
      }
    }

    console.log('[PARSE] Проверка авторизации перед извлечением дат...');

    // Сначала проверяем, что мы действительно авторизованы
    const isAuthorized = await pageInstance.evaluate(() => {
      return document.querySelector('.account-info') !== null;
    });

    if (!isAuthorized) {
      console.log('[ERROR] Не авторизованы (отсутствует .account-info). Сброс флага.');
      isLoggedIn = false;
      throw new Error('Not authorized - account-info block missing');
    }

    console.log('[PARSE] ✅ Авторизация подтверждена, извлечение дат из таблицы...');

    // Ждем появления таблицы с повторными попытками
    let tableFound = false;
    let attempts = 0;
    const maxAttempts = 3;

    while (!tableFound && attempts < maxAttempts) {
      try {
        await pageInstance.waitForSelector('tr.dates-table__item', { timeout: 15000 });
        tableFound = true;
        console.log('[PARSE] ✅ Таблица найдена');
      } catch (error) {
        attempts++;
        console.log(`[PARSE] Таблица не найдена (попытка ${attempts}/${maxAttempts})`);

        if (attempts < maxAttempts) {
          console.log('[PARSE] Ожидание 3 секунды перед повторной проверкой...');
          await new Promise(resolve => setTimeout(resolve, 3000));
        } else {
          console.log('[ERROR] Таблица не найдена после всех попыток. Сброс авторизации.');
          isLoggedIn = false;
          throw new Error('Table not found after multiple attempts');
        }
      }
    }

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

    // Принудительная сборка мусора после успешной проверки
    if (global.gc) {
      global.gc();
      console.log('[MEMORY] Принудительная сборка мусора выполнена');
    }

    return {
      success: true,
      dates: availableDates,
      newDates: newDates,
      duration: duration
    };

  } catch (error) {
    console.error('[ERROR] Ошибка проверки:', error.message);

    // Если капча или критическая ошибка - сбрасываем флаг авторизации
    if (error.message.includes('CAPTCHA') || error.message.includes('Navigation timeout')) {
      console.log('[RESET] Сброс флага авторизации из-за ошибки');
      isLoggedIn = false;
    }

    return { success: false, error: error.message };
  } finally {
    isChecking = false;
  }
}

// Периодический сброс сессии каждые 6 часов (для свежести cookies)
async function resetSession() {
  console.log('[RESET] Плановый сброс сессии (каждые 6 часов)...');
  isLoggedIn = false;

  if (page && !page.isClosed()) {
    try {
      await page.close();
      console.log('[RESET] Страница закрыта');
    } catch (e) {
      console.log('[RESET] Ошибка при закрытии страницы:', e.message);
    }
  }

  page = null;
  console.log('[RESET] Сессия сброшена, при следующей проверке будет выполнен релогин');
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

  // Сброс сессии каждые 6 часов
  setInterval(resetSession, 6 * 60 * 60 * 1000);
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
