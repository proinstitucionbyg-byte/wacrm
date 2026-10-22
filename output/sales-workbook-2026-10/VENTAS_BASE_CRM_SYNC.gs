/**
 * Synchronizes CRM-owned columns from WACRM into BASE GENERAL.
 * It is deliberately read-only toward WACRM: statuses, notes, operation
 * references, and adviser selection remain under the team's control.
 * Configure CRM_BASE_URL and CRM_API_KEY in Script Properties first.
 */
const SALES_SYNC = {
  sheet: 'BASE GENERAL',
  firstDataRow: 3,
  batchSize: 100,
  crmIdColumn: 17, // Q: hidden technical key; A stays the permanent visible sequence.
};

function onOpen() {
  SpreadsheetApp.getUi().createMenu('CRM')
    .addItem('Sincronizar contactos de ventas', 'SYNC_VENTAS_CRM')
    .addSeparator()
    .addItem('Instalar sincronización cada 10 minutos', 'INSTALAR_SYNC_VENTAS_CRM')
    .addToUi();
}

function INSTALAR_SYNC_VENTAS_CRM() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('CRM_BASE_URL') || !props.getProperty('CRM_API_KEY')) {
    throw new Error('Primero guarda CRM_BASE_URL y CRM_API_KEY en las propiedades del proyecto.');
  }
  const handler = 'SYNC_VENTAS_CRM';
  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === handler)
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger(handler).timeBased().everyMinutes(10).create();
  SYNC_VENTAS_CRM();
}

function SYNC_VENTAS_CRM() {
  const lock = LockService.getDocumentLock();
  lock.waitLock(20000);
  try {
    const props = PropertiesService.getScriptProperties();
    const base = String(props.getProperty('CRM_BASE_URL') || '').replace(/\/$/, '');
    const key = props.getProperty('CRM_API_KEY');
    if (!base || !key) throw new Error('Falta configurar CRM_BASE_URL o CRM_API_KEY.');

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SALES_SYNC.sheet);
    if (!sheet) throw new Error('No existe la pestaña BASE GENERAL.');

    const leads = fetchAllSalesLeads_(base, key);
    const lastRow = Math.max(sheet.getLastRow(), SALES_SYNC.firstDataRow - 1);
    const ids = lastRow >= SALES_SYNC.firstDataRow
      ? sheet.getRange(SALES_SYNC.firstDataRow, SALES_SYNC.crmIdColumn, lastRow - SALES_SYNC.firstDataRow + 1, 1).getDisplayValues().flat()
      : [];
    const rowById = new Map(ids.map((id, index) => [id, SALES_SYNC.firstDataRow + index]).filter(([id]) => id));

    const newRows = [];
    let updated = 0;
    const nextSequence = Math.max(
      Number(props.getProperty('SALES_SYNC_NEXT_SEQUENCE')) || 0,
      0,
      ...sheet.getRange(SALES_SYNC.firstDataRow, 1, Math.max(1, lastRow - SALES_SYNC.firstDataRow + 1), 1)
        .getValues().flat().map((value) => Number(value) || 0),
    );
    let sequence = nextSequence;
    leads.sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || ''))).forEach((lead) => {
      const createdAt = lead.created_at ? new Date(lead.created_at) : '';
      const row = [
        0, // sequence number filled only for new contacts below
        lead.name || 'Sin nombre',
        lead.phone_or_user_id || '',
        lead.course_interest || '',
        createdAt,
        createdAt,
        lead.institute || 'INSTICRECE',
        '', // commercial status remains under adviser control
        lead.assigned_adviser || '',
        lead.channel || '',
        (lead.crm_tags || []).join(', '),
        lead.assigned_at ? new Date(lead.assigned_at) : '',
        lead.last_interaction_at ? new Date(lead.last_interaction_at) : '',
        '', // payment operation reference is not overwritten by contact sync
        '', // adviser notes are not overwritten
        lead.campaign_or_ad || '',
        lead.id,
      ];
      const existing = rowById.get(lead.id);
      if (!existing) {
        row[0] = ++sequence;
        newRows.push(row);
        return;
      }
      // Refresh CRM-owned fields only. Keep sequence, status, payment operation, and notes.
      sheet.getRange(existing, 2, 1, 6).setValues([row.slice(1, 7)]);
      sheet.getRange(existing, 9).setValue(row[8]);
      sheet.getRange(existing, 10, 1, 4).setValues([row.slice(9, 13)]);
      sheet.getRange(existing, 16, 1, 2).setValues([[row[15], row[16]]]);
      sheet.getRange(existing, 5).setNumberFormat('dd/mm/yyyy');
      sheet.getRange(existing, 6).setNumberFormat('hh:mm');
      updated++;
    });

    if (newRows.length) {
      const start = Math.max(sheet.getLastRow() + 1, SALES_SYNC.firstDataRow);
      sheet.getRange(start, 1, newRows.length, 17).setValues(newRows);
      sheet.getRange(start, 5, newRows.length, 1).setNumberFormat('dd/mm/yyyy');
      sheet.getRange(start, 6, newRows.length, 1).setNumberFormat('hh:mm');
      sheet.getRange(start, 12, newRows.length, 2).setNumberFormat('dd/mm/yyyy hh:mm');
      props.setProperty('SALES_SYNC_NEXT_SEQUENCE', String(sequence));
    }
    props.setProperty('SALES_SYNC_LAST_OK', new Date().toISOString());
    props.setProperty('SALES_SYNC_LAST_COUNT', String(leads.length));
    SpreadsheetApp.flush();
    return { received: leads.length, added: newRows.length, updated: updated };
  } finally {
    lock.releaseLock();
  }
}

function fetchAllSalesLeads_(base, key) {
  let cursor = '';
  const all = [];
  for (let page = 0; page < 100; page++) {
    const query = '?limit=' + SALES_SYNC.batchSize + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
    const response = UrlFetchApp.fetch(base + '/api/v1/sales/leads' + query, {
      method: 'get',
      headers: { Authorization: 'Bearer ' + key },
      muteHttpExceptions: true,
    });
    const status = response.getResponseCode();
    const body = JSON.parse(response.getContentText() || '{}');
    if (status !== 200) throw new Error('CRM respondió ' + status + ': ' + (body.error && body.error.message || 'error sin detalle'));
    if (!Array.isArray(body.data)) throw new Error('La respuesta del CRM no contiene la lista esperada.');
    all.push.apply(all, body.data);
    cursor = body.meta && body.meta.next_cursor || '';
    if (!cursor) return all;
  }
  throw new Error('La consulta superó 100 páginas; se detuvo para no importar una lista incompleta.');
}
