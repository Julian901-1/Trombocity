// ============================================
// GOOGLE APPS SCRIPT - ХРАНИЛИЩЕ ДАТ
// ============================================
// Этот скрипт хранит последние найденные даты донации
// Деплой: Развернуть > Новое развертывание > Веб-приложение

// Название листа для хранения дат
const SHEET_NAME = 'TrombocityDates';

// Получить или создать лист
function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(['Дата обновления', 'Доступные даты (JSON)']);
  }

  return sheet;
}

// GET запрос - получить сохраненные даты
function doGet(e) {
  const action = e.parameter.action;

  if (action === 'getDates') {
    const sheet = getSheet();
    const lastRow = sheet.getLastRow();

    if (lastRow < 2) {
      // Нет данных
      return ContentService.createTextOutput(JSON.stringify({
        dates: [],
        timestamp: null
      })).setMimeType(ContentService.MimeType.JSON);
    }

    const dateString = sheet.getRange(lastRow, 2).getValue();
    const timestamp = sheet.getRange(lastRow, 1).getValue();

    let dates = [];
    try {
      dates = JSON.parse(dateString);
    } catch (e) {
      dates = [];
    }

    return ContentService.createTextOutput(JSON.stringify({
      dates: dates,
      timestamp: timestamp
    })).setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService.createTextOutput(JSON.stringify({
    error: 'Unknown action'
  })).setMimeType(ContentService.MimeType.JSON);
}

// POST запрос - сохранить новые даты
function doPost(e) {
  const action = e.parameter.action;

  if (action === 'saveDates') {
    const data = JSON.parse(e.postData.contents);
    const dates = data.dates || [];

    const sheet = getSheet();
    const timestamp = new Date();

    // Добавляем новую строку с датами
    sheet.appendRow([
      timestamp,
      JSON.stringify(dates)
    ]);

    // Удаляем старые записи, оставляем последние 10
    const lastRow = sheet.getLastRow();
    if (lastRow > 11) {
      sheet.deleteRows(2, lastRow - 11);
    }

    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      saved: dates.length,
      timestamp: timestamp
    })).setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService.createTextOutput(JSON.stringify({
    error: 'Unknown action'
  })).setMimeType(ContentService.MimeType.JSON);
}

// ============================================
// ИНСТРУКЦИЯ ПО НАСТРОЙКЕ:
// ============================================
//
// 1. Создайте новую Google Таблицу
//
// 2. Расширения > Apps Script
//
// 3. Вставьте этот код
//
// 4. Развернуть > Новое развертывание
//    - Тип: Веб-приложение
//    - Выполнять как: Я
//    - У кого есть доступ: Все
//
// 5. Скопируйте URL развертывания
//    Пример: https://script.google.com/macros/s/AKfycby.../exec
//
// 6. Замените SHEETS_URL в server.js на этот URL
//
// ============================================
