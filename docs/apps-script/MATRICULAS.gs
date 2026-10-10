/**
 * PRIMERA ETAPA: EDICION MANUAL DE MATRICULAS.
 * Pegar en el proyecto de Apps Script vinculado a la hoja de Google.
 * Ejecutar CONFIGURAR_MATRICULAS una vez. onEdit se ejecuta al editar celdas.
 * n8n/API deben llamar PROCESAR_REGISTRO_AUTOMATICO(fila) despues de escribir
 * una fila nueva, dejando FECHA DE HOY y HORA vacias. No activan onEdit.
 */
const MATRICULAS_CONFIG = {
  spreadsheetId: '16jhqgiYLh_GCkuxPL2fpljf04-Pj2HAqNY_0ePT0z7w',
  sheetName: 'MATRICULAS',
  timeZone: 'America/Lima',
  institute: 'INSTICRECE',
  columns: 26,
  uppercaseColumns: [4, 5, 6, 7, 13, 14, 15, 18, 20, 21, 22, 23, 24, 25, 26],
  identifierColumns: [8, 11, 12],
};

function NORMALIZAR_TEXTO_(value) {
  return String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
}

function NORMALIZAR_CABECERA_(value) {
  return NORMALIZAR_TEXTO_(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
}

function SIGUIENTE_NUMERO_(values) {
  return values.reduce(function (highest, row) {
    const value = Number(row[0]);
    return Number.isSafeInteger(value) && value > highest ? value : highest;
  }, 0) + 1;
}

function VERIFICAR_HOJA_(spreadsheet, sheet) {
  if (!spreadsheet || spreadsheet.getId() !== MATRICULAS_CONFIG.spreadsheetId) {
    throw new Error('Este codigo corresponde a MATRICULAS Y CONTROL DE INGRESOS.');
  }
  if (!sheet || sheet.getName() !== MATRICULAS_CONFIG.sheetName) {
    throw new Error('No se encontro la pestaña MATRICULAS.');
  }
  const headers = sheet.getRange(1, 1, 1, MATRICULAS_CONFIG.columns).getValues()[0].map(NORMALIZAR_CABECERA_);
  const required = {
    1: 'N°', 2: 'FECHA DE HOY', 4: 'INSTITUTO', 7: 'NOMBRE COMPLETO',
    8: 'DNI', 9: 'F. NACIMIENTO', 10: 'EDAD', 11: 'CELULAR 1', 12: 'CELULAR 2',
    16: 'CORREO ELECTRONICO', 17: 'LINK DE CARPETA DEL ESTUDIANTE', 18: 'CURSO', 19: 'FECHA DE INICIO',
  };
  if (headers[2] !== 'HORA' && headers[2] !== 'HOY') {
    throw new Error('La columna C debe ser HORA.');
  }
  Object.keys(required).forEach(function (column) {
    if (headers[Number(column) - 1] !== required[column]) {
      throw new Error('La columna ' + column + ' debe ser ' + required[column] + '. Revisa la estructura antes de continuar.');
    }
  });
}

function CONFIGURAR_MATRICULAS() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(MATRICULAS_CONFIG.sheetName);
  VERIFICAR_HOJA_(spreadsheet, sheet);
  spreadsheet.setSpreadsheetTimeZone(MATRICULAS_CONFIG.timeZone);
  const headers = sheet.getRange(1, 1, 1, MATRICULAS_CONFIG.columns);
  const normalizedHeaders = headers.getValues()[0].map(NORMALIZAR_CABECERA_);
  normalizedHeaders[2] = 'HORA';
  headers.setValues([normalizedHeaders]);
  sheet.setFrozenRows(1);
  const rows = sheet.getMaxRows() - 1;
  if (rows > 0) {
    sheet.getRange(2, 1, rows, MATRICULAS_CONFIG.columns).setFontFamily('Arial').setFontSize(10);
    MATRICULAS_CONFIG.identifierColumns.forEach(function (column) {
      sheet.getRange(2, column, rows, 1).setNumberFormat('@').setHorizontalAlignment('center');
    });
    [2, 9, 19].forEach(function (column) {
      sheet.getRange(2, column, rows, 1).setNumberFormat('dd/MM/yyyy');
    });
    sheet.getRange(2, 3, rows, 1).setNumberFormat('HH:mm:ss');
  }
  spreadsheet.toast('Configuracion lista. Escribe un nombre nuevo en la columna G para comprobar numero, fecha y hora de Lima.', 'MATRICULAS', 8);
}

function onEdit(event) {
  if (!event || !event.range || !event.source) return;
  const sheet = event.range.getSheet();
  if (sheet.getName() !== MATRICULAS_CONFIG.sheetName || event.range.getLastRow() < 2) return;
  const registeredAt = new Date();
  // Same script lock for manual and automatic callers, including web apps.
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
    const firstRow = Math.max(2, event.range.getRow());
    const lastRow = event.range.getLastRow();
    const firstColumn = event.range.getColumn();
    const lastColumn = Math.min(MATRICULAS_CONFIG.columns, event.range.getLastColumn());
    if (firstColumn > lastColumn) return;
    PROCESAR_REGISTROS_(event.source, sheet, firstRow, lastRow - firstRow + 1, firstColumn, lastColumn, registeredAt);
    SpreadsheetApp.flush();
  } catch (error) {
    event.source.toast(String(error.message || error), 'REVISAR MATRICULAS', 10);
    throw error;
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

/**
 * Entry point for a future authenticated integration. Does not append a row
 * or expose a public endpoint. Reprocessing the same row keeps its timestamp.
 * The integration must prevent duplicate row creation on retries.
 */
function PROCESAR_REGISTRO_AUTOMATICO(fila) {
  if (!Number.isSafeInteger(fila) || fila < 2) throw new Error('Indica una fila valida, desde la fila 2.');
  const registeredAt = new Date();
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
    const spreadsheet = SpreadsheetApp.openById(MATRICULAS_CONFIG.spreadsheetId);
    const sheet = spreadsheet.getSheetByName(MATRICULAS_CONFIG.sheetName);
    VERIFICAR_HOJA_(spreadsheet, sheet);
    if (fila > sheet.getLastRow()) throw new Error('La fila automatica debe existir antes de procesarla.');
    if (!NORMALIZAR_TEXTO_(sheet.getRange(fila, 7).getValues()[0][0])) throw new Error('La fila automatica necesita NOMBRE COMPLETO.');
    PROCESAR_REGISTROS_(spreadsheet, sheet, fila, 1, 1, MATRICULAS_CONFIG.columns, registeredAt);
    SpreadsheetApp.flush();
    return sheet.getRange(fila, 1, 1, 3).getValues()[0];
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

/** Both entry paths share the same timestamp and normalization rules. */
function PROCESAR_REGISTROS_(spreadsheet, sheet, firstRow, rowCount, firstColumn, lastColumn, registeredAt) {
    VERIFICAR_HOJA_(spreadsheet, sheet);
    if (spreadsheet.getSpreadsheetTimeZone() !== MATRICULAS_CONFIG.timeZone) {
      throw new Error('Ejecuta CONFIGURAR_MATRICULAS para establecer la hora de Lima.');
    }
    const values = sheet.getRange(firstRow, 1, rowCount, MATRICULAS_CONFIG.columns).getValues();
    const formulas = sheet.getRange(firstRow, 1, rowCount, MATRICULAS_CONFIG.columns).getFormulas();
    const allNumbers = sheet.getLastRow() >= 2 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues() : [];
    let nextNumber = SIGUIENTE_NUMERO_(allNumbers);
    values.forEach(function (row, offset) {
      const rowNumber = firstRow + offset;
      // Normalize only edited cells; preserve formulas, notes, validation and links.
      for (let column = firstColumn; column <= lastColumn; column++) {
        if (formulas[offset][column - 1]) continue;
        const original = row[column - 1];
        let normalized = original;
        if (MATRICULAS_CONFIG.uppercaseColumns.indexOf(column) !== -1 && typeof original === 'string') {
          normalized = NORMALIZAR_TEXTO_(original).toUpperCase();
        } else if (MATRICULAS_CONFIG.identifierColumns.indexOf(column) !== -1 && original !== '') {
          normalized = String(original).replace(/\s+/g, '').toUpperCase();
          sheet.getRange(rowNumber, column).setNumberFormat('@').setHorizontalAlignment('center');
        } else if (column === 16 && typeof original === 'string') {
          normalized = original.trim().toLowerCase();
        }
        if (normalized !== original) sheet.getRange(rowNumber, column).setValue(normalized);
      }
      // Name starts registration. Existing IDs and dates remain unchanged.
      if (!NORMALIZAR_TEXTO_(row[6])) return;
      if (row[0] === '' && !formulas[offset][0]) sheet.getRange(rowNumber, 1).setValue(nextNumber++);
      const newRegistration = row[1] === '' && !formulas[offset][1];
      if (newRegistration) sheet.getRange(rowNumber, 2).setValue(registeredAt).setNumberFormat('dd/MM/yyyy');
      // Never fabricate the missing historical hour of an old registration.
      if (newRegistration && row[2] === '' && !formulas[offset][2]) sheet.getRange(rowNumber, 3).setValue(registeredAt).setNumberFormat('HH:mm:ss');
      if (row[3] === '' && !formulas[offset][3]) sheet.getRange(rowNumber, 4).setValue(MATRICULAS_CONFIG.institute);
    });
}
