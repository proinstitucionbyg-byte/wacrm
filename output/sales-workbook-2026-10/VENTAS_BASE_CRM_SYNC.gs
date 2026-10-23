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
  adviserDirectorySize: 100,
  crmIdColumn: 17, // Q: hidden technical key; A stays the permanent visible sequence.
  courseDetailsColumn: 18, // R: CRM-owned detail when a lead is interested in multiple courses.
  institutionalAdviser: 'ASESOR INSTITUTO', // System attribution; never consumes a human adviser slot.
};

function onOpen() {
  SpreadsheetApp.getUi().createMenu('CRM')
    .addItem('Sincronizar contactos de ventas', 'SYNC_VENTAS_CRM')
    .addSeparator()
    .addItem('Instalar sincronización cada 10 minutos', 'INSTALAR_SYNC_VENTAS_CRM')
    .addItem('Instalar sincronización del estado comercial', 'INSTALAR_SYNC_ESTADO_VENTAS_CRM')
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

/** Installs a separate edit trigger only after a restricted sales:write key is configured. */
function INSTALAR_SYNC_ESTADO_VENTAS_CRM() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('CRM_BASE_URL') || !props.getProperty('CRM_WRITE_API_KEY')) {
    throw new Error('Configura CRM_BASE_URL y CRM_WRITE_API_KEY (llave limitada a sales:write) antes de instalar.');
  }
  const handler = 'SYNC_ESTADO_VENTA_EDITADO_CRM';
  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === handler)
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger(handler)
    .forSpreadsheet(SpreadsheetApp.getActive())
    .onEdit()
    .create();
  SpreadsheetApp.getActive().toast('El estado comercial se enviará al CRM al editar la columna H.', 'CRM', 5);
}

/** Sends only the sales-status dropdown value; all other CRM tags remain untouched. */
function SYNC_ESTADO_VENTA_EDITADO_CRM(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  if (sheet.getName() !== SALES_SYNC.sheet || e.range.getColumn() !== 8 || e.range.getRow() < SALES_SYNC.firstDataRow) return;
  if (e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1) return;

  const props = PropertiesService.getScriptProperties();
  const base = String(props.getProperty('CRM_BASE_URL') || '').replace(/\/$/, '');
  const key = props.getProperty('CRM_WRITE_API_KEY');
  if (!base || !key) {
    sheet.getParent().toast('No se sincronizó: falta configurar la llave separada sales:write.', 'CRM', 8);
    return;
  }
  const contactId = String(sheet.getRange(e.range.getRow(), SALES_SYNC.crmIdColumn).getDisplayValue() || '').trim();
  if (!contactId) {
    sheet.getParent().toast('No se sincronizó: esta fila aún no tiene ID estable del CRM en Q.', 'CRM', 8);
    return;
  }

  const status = String(e.range.getDisplayValue() || '').trim();
  const response = UrlFetchApp.fetch(base + '/api/v1/sales/leads/' + encodeURIComponent(contactId), {
    method: 'patch',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + key },
    payload: JSON.stringify({ commercial_status: status || null }),
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() !== 200) {
    const body = JSON.parse(response.getContentText() || '{}');
    sheet.getParent().toast('No se sincronizó con el CRM (' + response.getResponseCode() + '): ' + (body.error && body.error.message || 'revisa la llave o el registro.'), 'CRM', 10);
    return;
  }
  sheet.getParent().toast('Estado comercial actualizado en las etiquetas del CRM.', 'CRM', 5);
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
    const advisersSheet = ss.getSheetByName('ASESORAS');
    if (!advisersSheet) throw new Error('No existe la pestaña ASESORAS.');
    const advisers = fetchSalesAdvisers_(base, key);
    if (advisers && advisers.length > SALES_SYNC.adviserDirectorySize) {
      throw new Error('La hoja admite hasta ' + SALES_SYNC.adviserDirectorySize + ' asesoras. No se sincronizó una lista incompleta.');
    }
    if (advisers) syncSalesAdviserDirectory_(advisersSheet, advisers);
    const activeAdviserByName = new Map(advisersSheet.getRange('I3:I102').getDisplayValues().flat().filter(Boolean).map((name) => [normalizeNameKey_(name), name]));

    const leads = fetchAllSalesLeads_(base, key);
    const lastRow = Math.max(sheet.getLastRow(), SALES_SYNC.firstDataRow - 1);
    const existingRows = lastRow >= SALES_SYNC.firstDataRow
      ? sheet.getRange(SALES_SYNC.firstDataRow, 1, lastRow - SALES_SYNC.firstDataRow + 1, SALES_SYNC.crmIdColumn).getDisplayValues()
      : [];
    const rowById = new Map();
    const rowByIdentity = new Map();
    const rowByIdentifier = new Map();
    existingRows.forEach((existingRow, index) => {
      const rowNumber = SALES_SYNC.firstDataRow + index;
      const crmId = existingRow[SALES_SYNC.crmIdColumn - 1];
      const identifier = existingRow[2];
      const channel = existingRow[9];
      if (crmId) rowById.set(crmId, rowNumber);
      const identityKey = contactIdentityKey_(identifier, channel);
      if (identityKey && !rowByIdentity.has(identityKey)) rowByIdentity.set(identityKey, rowNumber);
      const identifierKey = normalizeIdentifier_(identifier);
      if (identifierKey && !rowByIdentifier.has(identifierKey)) rowByIdentifier.set(identifierKey, rowNumber);
    });

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
        normalizeCourse_(lead.course_interest),
        createdAt,
        createdAt,
        lead.institute || 'INSTICRECE',
        lead.commercial_status || '', // the initial CRM status; later edits sync back through sales:write
        normalizeAdviser_(lead, activeAdviserByName),
        normalizeChannel_(lead.channel),
        (lead.crm_tags || []).join(', '),
        lead.assigned_at ? new Date(lead.assigned_at) : '',
        lead.last_interaction_at ? new Date(lead.last_interaction_at) : '',
        '', // payment operation reference is not overwritten by contact sync
        '', // adviser notes are not overwritten
        lead.campaign_or_ad || '',
        lead.id,
        lead.course_details || (String(lead.course_interest || '').startsWith('Varios:') ? String(lead.course_interest).slice(8).trim() : ''),
      ];
      const identityKey = contactIdentityKey_(lead.phone_or_user_id, lead.channel);
      const identifierKey = normalizeIdentifier_(lead.phone_or_user_id);
      const existing = rowById.get(lead.id) || (identityKey ? rowByIdentity.get(identityKey) : null) || (identifierKey ? rowByIdentifier.get(identifierKey) : null);
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
      sheet.getRange(existing, SALES_SYNC.courseDetailsColumn).setValue(row[17]);
      sheet.getRange(existing, 5).setNumberFormat('dd/mm/yyyy');
      sheet.getRange(existing, 6).setNumberFormat('hh:mm');
      updated++;
    });

    if (newRows.length) {
      const start = Math.max(sheet.getLastRow() + 1, SALES_SYNC.firstDataRow);
      sheet.getRange(start, 1, newRows.length, 18).setValues(newRows);
      sheet.getRange(start, 5, newRows.length, 1).setNumberFormat('dd/mm/yyyy');
      sheet.getRange(start, 6, newRows.length, 1).setNumberFormat('hh:mm');
      sheet.getRange(start, 12, newRows.length, 2).setNumberFormat('dd/mm/yyyy hh:mm');
      props.setProperty('SALES_SYNC_NEXT_SEQUENCE', String(sequence));
    }
    props.setProperty('SALES_SYNC_LAST_OK', new Date().toISOString());
    props.setProperty('SALES_SYNC_LAST_COUNT', String(leads.length));
    SpreadsheetApp.flush();
    if (!advisers) ss.toast('Los contactos sí se sincronizaron. Para actualizar asesoras, agrega sales:read a CRM_API_KEY.', 'CRM', 10);
    return { received: leads.length, added: newRows.length, updated: updated };
  } finally {
    lock.releaseLock();
  }
}

function normalizeNameKey_(value) {
  return String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Replaces only CRM-owned adviser directory fields; keeps sheet links and rotation notes. */
function syncSalesAdviserDirectory_(sheet, advisers) {
  const rows = advisers.map((adviser) => [
    adviser.user_id,
    adviser.name || 'Sin nombre',
    adviser.email || '',
    'Ventas',
    adviser.cargo || 'Agente',
    adviser.active_for_sales ? 'Activo' : 'Inactivo',
  ]);
  while (rows.length < SALES_SYNC.adviserDirectorySize) rows.push(['', '', '', '', '', '']);
  sheet.getRange(3, 1, SALES_SYNC.adviserDirectorySize, 6).setValues(rows);
}

function normalizeIdentifier_(value) {
  return normalizeNameKey_(value).replace(/\s+/g, '');
}

function contactIdentityKey_(identifier, channel) {
  const normalizedIdentifier = normalizeIdentifier_(identifier);
  return normalizedIdentifier ? normalizeChannel_(channel) + '|' + normalizedIdentifier : '';
}

function normalizeAdviser_(lead, activeAdviserByName) {
  const assignedName = String(lead && lead.assigned_adviser || '').trim();
  // Keep attribution on existing leads after a person is deactivated.
  // The ASESORAS active list controls new assignment choices; it must not
  // erase who handled a historical/current lead from BASE GENERAL.
  if (lead && lead.assigned_adviser_id && assignedName) return assignedName;
  const activeAdviser = activeAdviserByName.get(normalizeNameKey_(assignedName));
  if (activeAdviser) return activeAdviser;

  // Keep attribution with the institution while AI/automation is enabled and
  // there is no human assignee. A real assigned adviser always takes priority.
  const hasHumanAssignee = !!(lead && lead.assigned_adviser_id);
  const systemIsHandling = !!(lead && (lead.ai_enabled === true || lead.automation_enabled === true));
  return !hasHumanAssignee && systemIsHandling ? SALES_SYNC.institutionalAdviser : '';
}

function normalizeChannel_(value) {
  const channel = String(value || '').trim().toLowerCase();
  if (channel === 'whatsapp') return 'WhatsApp';
  if (channel === 'instagram') return 'Instagram';
  if (channel === 'messenger' || channel === 'facebook') return 'Messenger';
  if (channel === 'tiktok' || channel === 'tik tok') return 'TikTok';
  return 'Otro';
}

function normalizeCourse_(value) {
  const course = String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (!course) return 'Otro';
  if (course.includes('varios') || course.includes(',')) return 'Varios';
  if (course.includes('nutricion') || course.includes('dietetic')) return 'Nutrición';
  if (course.includes('farmacia')) return 'Farmacia';
  if (course.includes('inicial')) return 'Inicial';
  if (course.includes('recurso humano') || course.includes('gestion humana') || course.includes('talento humano')) return 'Recursos Humanos';
  if (course.includes('administr')) return 'Administrativo';
  return 'Otro';
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

function fetchSalesAdvisers_(base, key) {
  const response = UrlFetchApp.fetch(base + '/api/v1/sales/advisers', {
    method: 'get',
    headers: { Authorization: 'Bearer ' + key },
    muteHttpExceptions: true,
  });
  const status = response.getResponseCode();
  const body = JSON.parse(response.getContentText() || '{}');
  if (status !== 200) {
    if (status === 403) return null; // Preserve contact sync until the key is granted sales:read.
    const message = body.error && body.error.message || 'revisa que la llave tenga el permiso sales:read';
    throw new Error('No se sincronizó el directorio de asesoras (' + status + '): ' + message);
  }
  if (!body.data || !Array.isArray(body.data.advisers)) {
    throw new Error('La respuesta del CRM no contiene el directorio esperado.');
  }
  return body.data.advisers;
}
