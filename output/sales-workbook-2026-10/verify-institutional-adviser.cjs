const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, 'VENTAS_BASE_CRM_SYNC.gs'),
  'utf8',
);
const context = vm.createContext({ console, Map, String, Boolean });
vm.runInContext(source, context, { filename: 'VENTAS_BASE_CRM_SYNC.gs' });

const active = new Map([['ana perez', 'ANA PEREZ']]);
const resolve = context.normalizeAdviser_;

assert.equal(resolve({ assigned_adviser: 'Ana Pérez', assigned_adviser_id: 'human-1', ai_enabled: true }, active), 'ANA PEREZ');
assert.equal(resolve({ assigned_adviser: 'Ana Pérez', assigned_adviser_id: 'inactive-human', ai_enabled: true }, new Map()), 'ASESOR INSTITUTO');
assert.equal(resolve({ assigned_adviser: '', assigned_adviser_id: null, ai_enabled: true }, active), 'ASESOR INSTITUTO');
assert.equal(resolve({ assigned_adviser: '', assigned_adviser_id: null, automation_enabled: true }, active), 'ASESOR INSTITUTO');
assert.equal(resolve({ assigned_adviser: '', assigned_adviser_id: null, ai_enabled: false, automation_enabled: false }, active), '');
assert.equal(resolve({ assigned_adviser: '', assigned_adviser_id: 'inactive-human', ai_enabled: true }, active), 'ASESOR INSTITUTO');

let writtenRange = null;
let writtenValues = null;
const directory = {
  getRange(row, column, rows, columns) {
    writtenRange = { row, column, rows, columns };
    return { getDisplayValues() { return []; }, setValues(values) { writtenValues = values; } };
  },
};
context.syncSalesAdviserDirectory_(directory, [{ user_id: 'human-1', name: 'Ana Perez', email: '', cargo: 'Agente', active_for_sales: true }]);
assert.deepEqual(writtenRange, { row: 3, column: 1, rows: 100, columns: 8 });
assert.equal(writtenValues.length, 100);
assert.equal(JSON.stringify(writtenValues[0]), JSON.stringify(['human-1', 'Ana Perez', '', 'Ventas', 'Agente', 'Activo', '', '']));
assert.equal(JSON.stringify(writtenValues[1]), JSON.stringify(['', '', '', '', '', '', '', '']));

let apiRequest = null;
context.PropertiesService = {
  getScriptProperties() {
    return { getProperty(name) {
      return { CRM_BASE_URL: 'https://crm.example', CRM_WRITE_API_KEY: 'test-key' }[name] || '';
    } };
  },
};
context.UrlFetchApp = {
  fetch(url, options) {
    apiRequest = { url, options };
    return { getResponseCode: () => 200, getContentText: () => '{}' };
  },
};
let toast = '';
const editedSheet = {
  getName: () => 'BASE GENERAL',
  getParent: () => ({ toast(message) { toast = message; } }),
  getRange(row, column) {
    if (row === 3 && column === 17) {
      return { getDisplayValue: () => '27033286-42d8-414e-b1b5-ebf0fe0f23ad' };
    }
    return { getDisplayValue: () => 'VENTA' };
  },
};
context.SYNC_ESTADO_VENTA_EDITADO_CRM({ range: {
  getSheet: () => editedSheet,
  getColumn: () => 8,
  getRow: () => 3,
  getNumRows: () => 1,
  getNumColumns: () => 1,
  getDisplayValue: () => 'VENTA',
} });
assert.equal(apiRequest.url, 'https://crm.example/api/v1/sales/leads/27033286-42d8-414e-b1b5-ebf0fe0f23ad');
assert.equal(apiRequest.options.method, 'patch');
assert.equal(apiRequest.options.headers.Authorization, 'Bearer test-key');
assert.deepEqual(JSON.parse(apiRequest.options.payload), { commercial_status: 'VENTA' });
assert.equal(toast, 'Estado comercial actualizado en las etiquetas del CRM.');

apiRequest = null;
context.SYNC_ESTADO_VENTA_EDITADO_CRM({ range: {
  getSheet: () => editedSheet,
  getColumn: () => 9,
  getRow: () => 3,
  getNumRows: () => 1,
  getNumColumns: () => 1,
  getDisplayValue: () => 'ANA PEREZ',
} });
assert.equal(apiRequest, null, 'Editing the adviser column must not call the sales-status endpoint.');

console.log('OK: atribución de asesor institucional y edición aislada de Estado verificados con CRM simulado.');
