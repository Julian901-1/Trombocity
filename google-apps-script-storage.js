// ============================================
// GOOGLE APPS SCRIPT - ХРАНИЛИЩЕ ДАТ И COOKIES
// ============================================
// Этот скрипт хранит последние найденные даты донации и cookies для авторизации
// Деплой: Развернуть > Новое развертывание > Веб-приложение

// Названия листов
const SHEET_NAME = 'TrombocityDates';
const COOKIES_SHEET_NAME = 'TrombocityCookies';

// Получить или создать лист
function getSheet(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    if (sheetName === SHEET_NAME) {
      sheet.appendRow(['Дата обновления', 'Доступные даты (JSON)']);
    } else if (sheetName === COOKIES_SHEET_NAME) {
      sheet.appendRow(['Дата обновления', 'Cookies (JSON)']);
    }
  }

  return sheet;
}

// GET запрос
function doGet(e) {
  const action = e.parameter.action;

  if (action === 'getDates') {
    const sheet = getSheet(SHEET_NAME);
    const lastRow = sheet.getLastRow();

    if (lastRow < 2) {
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

  if (action === 'getCookies') {
    const sheet = getSheet(COOKIES_SHEET_NAME);
    const lastRow = sheet.getLastRow();

    if (lastRow < 2) {
      return ContentService.createTextOutput(JSON.stringify({
        cookies: [],
        timestamp: null
      })).setMimeType(ContentService.MimeType.JSON);
    }

    const cookiesString = sheet.getRange(lastRow, 2).getValue();
    const timestamp = sheet.getRange(lastRow, 1).getValue();

    let cookies = [];
    try {
      cookies = JSON.parse(cookiesString);
    } catch (e) {
      cookies = [];
    }

    return ContentService.createTextOutput(JSON.stringify({
      cookies: cookies,
      timestamp: timestamp
    })).setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService.createTextOutput(JSON.stringify({
    error: 'Unknown action'
  })).setMimeType(ContentService.MimeType.JSON);
}

// POST запрос
function doPost(e) {
  const action = e.parameter.action;

  if (action === 'saveDates') {
    const data = JSON.parse(e.postData.contents);
    const dates = data.dates || [];

    const sheet = getSheet(SHEET_NAME);
    const timestamp = new Date();

    sheet.appendRow([
      timestamp,
      JSON.stringify(dates)
    ]);

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

  if (action === 'saveCookies') {
    const data = JSON.parse(e.postData.contents);
    const cookies = data.cookies || [];

    const sheet = getSheet(COOKIES_SHEET_NAME);
    const timestamp = new Date();

    sheet.appendRow([
      timestamp,
      JSON.stringify(cookies)
    ]);

    // Оставляем только последнюю запись cookies
    const lastRow = sheet.getLastRow();
    if (lastRow > 2) {
      sheet.deleteRows(2, lastRow - 2);
    }

    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      saved: cookies.length,
      timestamp: timestamp
    })).setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService.createTextOutput(JSON.stringify({
    error: 'Unknown action'
  })).setMimeType(ContentService.MimeType.JSON);
}
