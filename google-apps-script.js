// ============================================
// GOOGLE APPS SCRIPT - ТРАМБОЦИТЫ МОНИТОР
// ============================================

// Конфигурация
const RENDER_URL = 'https://YOUR-APP-NAME.onrender.com'; // ⚠️ ЗАМЕНИТЕ НА ВАШ URL

// Основная функция проверки
function checkDonorDates() {
  const url = `${RENDER_URL}/check`;

  try {
    console.log('Отправка запроса на проверку...');

    const response = UrlFetchApp.fetch(url, {
      method: 'GET',
      muteHttpExceptions: true,
      timeout: 60 // Увеличиваем таймаут до 60 секунд (Puppeteer может быть медленным)
    });

    const statusCode = response.getResponseCode();
    const result = JSON.parse(response.getContentText());

    if (statusCode === 200 && result.success) {
      console.log(`✅ Проверка успешна. Дат: ${result.dates ? result.dates.length : 0}`);

      if (result.newDates && result.newDates.length > 0) {
        console.log(`🚨 НОВЫЕ ДАТЫ: ${result.newDates.join(', ')}`);
      }
    } else {
      console.error('❌ Ошибка проверки:', result.error || 'Unknown error');
    }

  } catch (error) {
    console.error('❌ Исключение при запросе:', error.toString());
  }
}

// Функция для создания минутного триггера
function setupMinuteTrigger() {
  // Удаляем все существующие триггеры для этой функции
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'checkDonorDates') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // Создаем новый триггер на каждую минуту
  ScriptApp.newTrigger('checkDonorDates')
    .timeBased()
    .everyMinutes(1)
    .create();

  console.log('✅ Триггер создан: проверка каждую минуту');
}

// Функция для удаления всех триггеров
function removeAllTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'checkDonorDates') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  console.log('✅ Все триггеры удалены');
}

// Тестовая функция (вызовите вручную для проверки)
function testConnection() {
  console.log('🧪 Тестирование соединения с Render...');

  try {
    const response = UrlFetchApp.fetch(`${RENDER_URL}/ping`, {
      method: 'GET',
      muteHttpExceptions: true
    });

    const statusCode = response.getResponseCode();
    const result = JSON.parse(response.getContentText());

    if (statusCode === 200) {
      console.log('✅ Сервер доступен:', result);
    } else {
      console.error('❌ Сервер недоступен. Код:', statusCode);
    }

  } catch (error) {
    console.error('❌ Ошибка соединения:', error.toString());
  }
}

// ============================================
// ИНСТРУКЦИЯ ПО НАСТРОЙКЕ:
// ============================================
//
// 1. Замените RENDER_URL на URL вашего деплоя на Render
//    (например: https://trombocity-monitor.onrender.com)
//
// 2. Сохраните скрипт в Google Apps Script
//
// 3. Запустите функцию testConnection() вручную,
//    чтобы проверить доступность сервера
//
// 4. Запустите setupMinuteTrigger() один раз,
//    чтобы создать автоматический триггер
//
// 5. Проверьте в меню "Триггеры" (слева),
//    что триггер создан корректно
//
// ⚠️ ВАЖНО: Google Apps Script имеет лимиты:
// - Максимум 90 минут выполнения скрипта в день (бесплатный аккаунт)
// - Максимум 6 минут выполнения на один запуск
// - 20,000 запросов UrlFetch в день
//
// ============================================
