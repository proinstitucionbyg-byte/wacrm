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

assert.equal(resolve({ assigned_adviser: 'Ana Pérez', assigned_adviser_id: 'human-1', ai_enabled: true }, active), 'Ana Pérez');
assert.equal(resolve({ assigned_adviser: 'Ana Pérez', assigned_adviser_id: 'inactive-human', ai_enabled: true }, new Map()), 'Ana Pérez');
assert.equal(resolve({ assigned_adviser: '', assigned_adviser_id: null, ai_enabled: true }, active), 'ASESOR INSTITUTO');
assert.equal(resolve({ assigned_adviser: '', assigned_adviser_id: null, automation_enabled: true }, active), 'ASESOR INSTITUTO');
assert.equal(resolve({ assigned_adviser: '', assigned_adviser_id: null, ai_enabled: false, automation_enabled: false }, active), '');
assert.equal(resolve({ assigned_adviser: '', assigned_adviser_id: 'inactive-human', ai_enabled: true }, active), '');

let writtenRange = null;
let writtenValues = null;
const directory = {
  getRange(row, column, rows, columns) {
    writtenRange = { row, column, rows, columns };
    return { setValues(values) { writtenValues = values; } };
  },
};
context.syncSalesAdviserDirectory_(directory, [{ user_id: 'human-1', name: 'Ana Perez', email: '', cargo: 'Agente', active_for_sales: true }]);
assert.deepEqual(writtenRange, { row: 3, column: 1, rows: 100, columns: 6 });
assert.equal(writtenValues.length, 100);
assert.equal(JSON.stringify(writtenValues[0]), JSON.stringify(['human-1', 'Ana Perez', '', 'Ventas', 'Agente', 'Activo']));
assert.equal(JSON.stringify(writtenValues[1]), JSON.stringify(['', '', '', '', '', '']));

console.log('OK: Asesor Instituto solo se usa como fallback automático y no desplaza a una asesora humana.');
