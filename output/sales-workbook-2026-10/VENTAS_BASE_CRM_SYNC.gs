/**
 * Synchronizes CRM-owned columns from WACRM into BASE GENERAL.
 * Commercial status is synchronized both ways through a restricted key.
 * Notes and manually entered operation references stay under the team's control.
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
  props.setProperty('SALES_MAIN_EDIT_AT:' + contactId, String(Date.now()));
  props.setProperty('SALES_PENDING_STATE:' + contactId, status);
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
  props.setProperty('SALES_MAIN_STATUS:' + contactId, status);
  if (props.getProperty('SALES_PENDING_STATE:' + contactId) === status) props.deleteProperty('SALES_PENDING_STATE:' + contactId);
  sheet.getParent().toast('Estado comercial actualizado en las etiquetas del CRM.', 'CRM', 5);
}

function SYNC_VENTAS_CRM() {
  const startedAt = Date.now();
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(1000)) return { skipped: 'Otra sincronización sigue en curso' };
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
    const lastRow = salesLastDataRow_(sheet);
    const existingRows = lastRow >= SALES_SYNC.firstDataRow
      ? sheet.getRange(SALES_SYNC.firstDataRow, 1, lastRow - SALES_SYNC.firstDataRow + 1, SALES_SYNC.crmIdColumn).getDisplayValues()
      : [];
    const rowById = new Map();
    existingRows.forEach((existingRow, index) => {
      const rowNumber = SALES_SYNC.firstDataRow + index;
      const crmId = existingRow[SALES_SYNC.crmIdColumn - 1];
      if (crmId) rowById.set(crmId, rowNumber);
    });

    const newRows = [];
    const refreshes = [];
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
        salesDay_(createdAt, ss.getSpreadsheetTimeZone()),
        createdAt,
        lead.institute || 'INSTICRECE',
        lead.commercial_status || '', // the initial CRM status; later edits sync back through sales:write
        normalizeAdviser_(lead, activeAdviserByName),
        normalizeChannel_(lead.channel),
        (lead.crm_tags || []).join(', '),
        lead.assigned_at ? new Date(lead.assigned_at) : '',
        lead.last_interaction_at ? new Date(lead.last_interaction_at) : '',
        lead.operation_reference || '',
        '', // adviser notes are not overwritten
        lead.campaign_or_ad || '',
        lead.id,
        lead.course_details || (String(lead.course_interest || '').startsWith('Varios:') ? String(lead.course_interest).slice(8).trim() : ''),
        lead.sale_validated ? 'SI' : '',
        institutionalName_(lead.sales_adviser),
        lead.sale_validated_at ? new Date(lead.sale_validated_at) : '',
        lead.student_folder_url || '',
        lead.sale_monthly_price == null ? '' : lead.sale_monthly_price,
      ];
      // The CRM ID is the only safe deduplication key. Phone numbers and external
      // usernames can be shared or change, so matching by them can merge students.
      const existing = rowById.get(String(lead.id || '')) || null;
      if (!existing) {
        row[0] = ++sequence;
        newRows.push(row);
        props.setProperty('SALES_MAIN_STATUS:' + lead.id, String(row[7] || ''));
        return;
      }
      // Reconcile status without losing a pending edit or overwriting a newer UI change.
      const localStatus = String(existingRows[existing - SALES_SYNC.firstDataRow][7] || '').trim();
      const status = reconcileSalesMainStatus_(lead.id, row[7], localStatus, props, base, startedAt);
      if (status !== localStatus && String(sheet.getRange(existing, 8).getDisplayValue() || '').trim() === localStatus &&
          Number(props.getProperty('SALES_MAIN_EDIT_AT:' + lead.id) || 0) <= startedAt) sheet.getRange(existing, 8).setValue(status);
      // Keep sequence, payment operation, and notes.
      if (!existingRows[existing - SALES_SYNC.firstDataRow][13] && row[13]) sheet.getRange(existing, 14).setValue(row[13]);
      refreshes.push({ number: existing, row, statusAt: lead.commercial_status_at ? new Date(lead.commercial_status_at) : '', history: salesHistoryCells_(lead) });
      updated++;
    });
    refreshSalesRows_(sheet, refreshes);

    if (newRows.length) {
      const start = Math.max(lastRow + 1, SALES_SYNC.firstDataRow);
      sheet.getRange(start, 1, newRows.length, 23).setValues(newRows);
      sheet.getRange(start, 5, newRows.length, 1).setNumberFormat('dd/mm/yyyy');
      sheet.getRange(start, 6, newRows.length, 1).setNumberFormat('hh:mm');
      sheet.getRange(start, 12, newRows.length, 2).setNumberFormat('dd/mm/yyyy hh:mm');
      sheet.getRange(start, 21, newRows.length, 1).setNumberFormat('dd/mm/yyyy hh:mm');
      const leadById = new Map(leads.map(lead => [lead.id, lead]));
      sheet.getRange(start, 26, newRows.length, 1).setValues(newRows.map(row => [leadById.get(row[16]).commercial_status_at ? new Date(leadById.get(row[16]).commercial_status_at) : ''])).setNumberFormat('dd/mm/yyyy hh:mm');
      sheet.getRange(start, 27, newRows.length, 4).setValues(newRows.map(row => salesHistoryCells_(leadById.get(row[16]))));
      sheet.getRange(start, 29, newRows.length, 1).setNumberFormat('dd/mm/yyyy hh:mm');
      props.setProperty('SALES_SYNC_NEXT_SEQUENCE', String(sequence));
    }
    sortSalesChronologically_(sheet);
    SpreadsheetApp.flush();
    if (advisers) syncSalesPersonalBases_(ss, advisersSheet, advisers, leads, props);
    const completedAt = new Date();
    const panel = ss.getSheetByName('PANEL');
    if (panel) {
      panel.getRange('A2').setValue('Última actualización CRM');
      panel.getRange('B2').setValue(completedAt).setNumberFormat('dd/mm/yyyy hh:mm:ss');
      panel.getRange('D2').setValue('Automática cada 10 min · Hora de Lima');
    }
    SpreadsheetApp.flush();
    props.setProperty('SALES_SYNC_LAST_OK', completedAt.toISOString());
    props.setProperty('SALES_SYNC_LAST_COUNT', String(leads.length));
    if (!advisers) ss.toast('Los contactos sí se sincronizaron. Para actualizar asesoras, agrega sales:read a CRM_API_KEY.', 'CRM', 10);
    return { received: leads.length, added: newRows.length, updated: updated };
  } finally {
    lock.releaseLock();
  }
}

// One write per contiguous block and owned range, rather than per contact/cell.
// H, N and O are deliberately excluded so human edits are never batch-overwritten.
function refreshSalesRows_(sheet, updates) {
  const sorted = updates.slice().sort((a, b) => a.number - b.number);
  for (let offset = 0; offset < sorted.length;) {
    let end = offset + 1;
    while (end < sorted.length && sorted[end].number === sorted[end - 1].number + 1) end++;
    const group = sorted.slice(offset, end), start = group[0].number, count = group.length;
    sheet.getRange(start, 2, count, 6).setValues(group.map(item => item.row.slice(1, 7)));
    sheet.getRange(start, 9, count, 5).setValues(group.map(item => item.row.slice(8, 13)));
    sheet.getRange(start, 16, count, 8).setValues(group.map(item => item.row.slice(15, 23)));
    sheet.getRange(start, 26, count, 1).setValues(group.map(item => [item.statusAt])).setNumberFormat('dd/mm/yyyy hh:mm');
    sheet.getRange(start, 27, count, 4).setValues(group.map(item => item.history || ['', '', '', '']));
    sheet.getRange(start, 29, count, 1).setNumberFormat('dd/mm/yyyy hh:mm');
    sheet.getRange(start, 21, count, 1).setNumberFormat('dd/mm/yyyy hh:mm');
    sheet.getRange(start, 5, count, 1).setNumberFormat('dd/mm/yyyy');
    sheet.getRange(start, 6, count, 1).setNumberFormat('hh:mm');
    offset = end;
  }
}

/** Sort complete records: the stable ID, human notes and status travel together. */
function sortSalesChronologically_(sheet) {
  const count = salesLastDataRow_(sheet) - SALES_SYNC.firstDataRow + 1;
  if (count < 2) return;
  sheet.getRange(SALES_SYNC.firstDataRow, 1, count, 30).sort([
    { column: 5, ascending: true },
    { column: 6, ascending: true },
    { column: 17, ascending: true },
  ]);
}

function salesHistoryCells_(lead) {
  return [lead.commercial_sale_countable ? 'SI' : 'NO', institutionalName_(lead.sale_owner_name),
    lead.sale_commercial_at ? new Date(lead.sale_commercial_at) : '', lead.sale_owner_id || ''];
}

function reconcileSalesMainStatus_(id, remote, local, props, base, startedAt) {
  if (Number(props.getProperty('SALES_MAIN_EDIT_AT:' + id) || 0) > startedAt) return local;
  const last = props.getProperty('SALES_MAIN_STATUS:' + id);
  const pending = props.getProperty('SALES_PENDING_STATE:' + id);
  if (pending !== null || (last !== null && local !== last) || (last === null && local)) {
    try {
      sendSalesPersonalStatus_(base, props.getProperty('CRM_WRITE_API_KEY'), id, local);
      props.deleteProperty('SALES_PENDING_STATE:' + id);
      props.setProperty('SALES_MAIN_STATUS:' + id, local);
      return local;
    } catch (error) {
      props.setProperty('SALES_PENDING_STATE:' + id, local);
      console.warn('Estado pendiente de sincronizar para ' + id + ': ' + error.message);
      return local;
    }
  }
  props.setProperty('SALES_MAIN_STATUS:' + id, String(remote || ''));
  return String(remote || '');
}

// Formula-only commission rows are not contacts. Keep appends beside real data.
function salesLastDataRow_(sheet) {
  const end = sheet.getLastRow();
  if (end < SALES_SYNC.firstDataRow) return SALES_SYNC.firstDataRow - 1;
  const rows = sheet.getRange(SALES_SYNC.firstDataRow, 1, end - SALES_SYNC.firstDataRow + 1, SALES_SYNC.crmIdColumn).getDisplayValues();
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].some((value) => String(value || '').trim())) return SALES_SYNC.firstDataRow + i;
  }
  return SALES_SYNC.firstDataRow - 1;
}

function normalizeNameKey_(value) {
  return String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function salesDay_(value, timeZone) {
  if (!value) return '';
  const date = Utilities.formatDate(value, timeZone || 'America/Lima', 'yyyy-MM-dd');
  // Sheets receives midnight in Lima, not the time fraction of the message.
  return new Date(date + 'T00:00:00-05:00');
}
function institutionalName_(name) {
  return /^(INSTITUCION|ASESOR INSTITUTO)$/i.test(String(name || '').trim()) ? SALES_SYNC.institutionalAdviser : String(name || '').trim();
}

/** Stable CRM IDs prevent namesakes or roster reordering from mixing personal bases. */
function salesLeadsForAdviser_(adviser, leads) {
  if (!adviser.active_for_sales) return [];
  return leads.filter(lead => lead.assigned_adviser_id === adviser.user_id || lead.sale_owner_id === adviser.user_id);
}

function sendSalesPersonalStatus_(base, key, contactId, status) {
  if (!key) throw new Error('Falta CRM_WRITE_API_KEY para guardar el estado de una base personal.');
  const response = UrlFetchApp.fetch(base + '/api/v1/sales/leads/' + encodeURIComponent(contactId), {
    method: 'patch', contentType: 'application/json', headers: { Authorization: 'Bearer ' + key },
    payload: JSON.stringify({ commercial_status: status || null }), muteHttpExceptions: true,
  });
  if (response.getResponseCode() !== 200) throw new Error('No se guardó el estado personal en CRM (' + response.getResponseCode() + '). Se conserva la edición para reintentar.');
}

/** No personal data is shared automatically: the owner chooses Drive access. */
function syncSalesPersonalBases_(ss, directory, advisers, leads, props) {
  const main = ss.getSheetByName(SALES_SYNC.sheet);
  const count = Math.max(0, salesLastDataRow_(main) - 2);
  const masterRows = count ? main.getRange(3, 1, count, 30).getValues() : [];
  const masterById = new Map(masterRows.map((row, index) => [String(row[16] || ''), { row, number: index + 3 }]).filter(pair => pair[0]));
  const headers = main.getRange(2, 1, 1, 30).getValues();
  const directoryRows = directory.getRange(3, 1, SALES_SYNC.adviserDirectorySize, 8).getDisplayValues();
  const base = String(props.getProperty('CRM_BASE_URL') || '').replace(/\/$/, '');
  advisers.filter(adviser => adviser.active_for_sales).forEach(adviser => {
    const directoryIndex = directoryRows.findIndex(row => row[0] === adviser.user_id);
    if (directoryIndex < 0) throw new Error('Asesora activa sin ID en el directorio.');
    const property = 'SALES_PERSONAL_BOOK:' + adviser.user_id;
    const link = directoryRows[directoryIndex][7];
    const linkedId = /\/spreadsheets\/d\/([\w-]+)/.exec(link);
    let bookId = props.getProperty(property) || (linkedId && linkedId[1]);
    let book;
    if (bookId) book = SpreadsheetApp.openById(bookId);
    else {
      book = SpreadsheetApp.create('BASE COMERCIAL · ' + String(adviser.name).slice(0, 70));
      bookId = book.getId();
      // Save the ID before any later setup can fail, preventing duplicate files.
      props.setProperty(property, bookId);
      book.getSheets()[0].setName(SALES_SYNC.sheet);
    }
    props.setProperty(property, bookId);
    if (bookId === ss.getId()) throw new Error('Una base personal no puede ser la base general.');
    directory.getRange(directoryIndex + 3, 8).setValue(book.getUrl());
    const sheet = book.getSheetByName(SALES_SYNC.sheet);
    if (!sheet) throw new Error('La base personal no contiene BASE GENERAL; revisar sin reemplazarla.');
    if (sheet.getMaxColumns() < 30) sheet.insertColumnsAfter(sheet.getMaxColumns(), 30 - sheet.getMaxColumns());
    const ownerMarker = sheet.getRange(1, 17).getDisplayValue();
    if (ownerMarker !== 'ASESORA CRM:' + adviser.user_id && (ownerMarker || sheet.getLastRow() > 1)) throw new Error('El archivo no está identificado como base de esta asesora. No se sobrescribió.');
    sheet.getRange(1, 17).setValue('ASESORA CRM:' + adviser.user_id);
    const oldCount = Math.max(0, sheet.getLastRow() - 2);
    const previous = oldCount ? sheet.getRange(3, 1, oldCount, 30).getValues() : [];
    const previousById = new Map(previous.filter(row => row[16]).map(row => [String(row[16]), row]));
    const rows = salesLeadsForAdviser_(adviser, leads).map(lead => {
      const master = masterById.get(String(lead.id));
      if (!master) throw new Error('Contacto asignado sin fila en BASE GENERAL.');
      const row = master.row.slice();
      const old = previousById.get(String(lead.id));
      const marker = 'SALES_PERSONAL_STATUS:' + adviser.user_id + ':' + lead.id;
      const lastPublished = props.getProperty(marker);
      if (old && lastPublished !== null && String(old[7] || '') !== lastPublished) {
        sendSalesPersonalStatus_(base, props.getProperty('CRM_WRITE_API_KEY'), lead.id, String(old[7] || '').trim());
        row[7] = old[7] || '';
        main.getRange(master.number, 8).setValue(row[7]);
        props.setProperty('SALES_MAIN_STATUS:' + lead.id, String(row[7] || ''));
      }
      if (old && old[14]) row[14] = old[14]; // Preserve the adviser's notes.
      props.setProperty(marker, String(row[7] || ''));
      return row;
    });
    sheet.getRange(1, 1).setValue('BASE DE ' + adviser.name + ' · Edita estado H y observaciones O. Sincronización cada 10 min. Acceso: compartir desde Drive solo con esta asesora.');
    sheet.getRange(2, 1, 1, 30).setValues(headers).setFontWeight('bold').setBackground('#14283f').setFontColor('#ffffff');
    if (rows.length) {
      sheet.getRange(3, 1, rows.length, 30).setValues(rows);
      sheet.getRange(3, 8, rows.length, 1).setDataValidation(main.getRange(3, 8).getDataValidation());
      sheet.getRange(3, 5, rows.length, 1).setNumberFormat('dd/mm/yyyy');
      sheet.getRange(3, 6, rows.length, 1).setNumberFormat('hh:mm');
      sheet.getRange(3, 12, rows.length, 2).setNumberFormat('dd/mm/yyyy hh:mm');
      sheet.getRange(3, 21, rows.length, 1).setNumberFormat('dd/mm/yyyy hh:mm');
    }
    if (oldCount > rows.length) sheet.getRange(rows.length + 3, 1, oldCount - rows.length, 30).clearContent();
    sheet.setFrozenRows(2); sheet.hideColumns(17); sheet.hideColumns(30); sheet.setHiddenGridlines(true);
    sheet.setColumnWidth(2, 210); sheet.setColumnWidth(3, 160); sheet.setColumnWidth(8, 190);
    syncSalesSharedRanking_(ss, book);
  });
}

/** Share aggregate performance only; never copy the general contact ledger. */
function syncSalesSharedRanking_(ss, book) {
  const source = ss.getSheetByName('RANKING');
  if (!source) return;
  let target = book.getSheetByName('RANKING');
  // Never copy the CEO sheet: even hidden columns would disclose commissions,
  // contact totals and conversion ratios to an editor of the personal file.
  if (!target) target = book.insertSheet('RANKING');
  if (target.getMaxRows() < 160) target.insertRowsAfter(target.getMaxRows(), 160 - target.getMaxRows());
  target.getDataRange().breakApart().clearContent();
  target.getRange(1, 1, 1, 6).merge().setValue('RANKING DEL EQUIPO · VENTAS Y METAS');
  target.getRange(2, 1, 1, 6).merge().setValue('Solo resultados del equipo. Los contactos, ratios y comisiones de otras asesoras son privados.');
  target.getRange(3, 1, 1, 6).setValues([['Mes', source.getRange('B3').getValue(), 'Ventas del grupo', source.getRange('B4').getValue(), 'Meta del grupo', source.getRange('E4').getValue()]]);
  target.getRange(3, 2).setNumberFormat('mmmm yyyy');
  target.getRange(6, 1, 103, 6).setValues(source.getRange(6, 1, 103, 6).getValues());
  target.getRange(1, 1, 1, 6).setBackground('#14283f').setFontColor('#ffffff').setFontWeight('bold');
  target.getRange(2, 1, 1, 6).setWrap(true);
  target.getRange(6, 1, 1, 6).setBackground('#d9eaf7').setFontWeight('bold');
  target.getRange(7, 5, 102, 1).setNumberFormat('0%');
  target.setColumnWidth(2, 230);
  target.setFrozenRows(6); target.setHiddenGridlines(true);
  target.getCharts().forEach(chart => target.removeChart(chart));
  target.insertChart(target.newChart().setChartType(Charts.ChartType.BAR)
    .addRange(target.getRange('B6:D16')).setNumHeaders(1)
    .setOption('title', 'Ventas y meta mensual').setPosition(111, 1, 0, 0).build());
  target.insertChart(target.newChart().setChartType(Charts.ChartType.PIE)
    .addRange(target.getRange('B6:C16')).setNumHeaders(1)
    .setOption('title', 'Participación en ventas').setPosition(132, 1, 0, 0).build());
}

/** Replaces only CRM-owned adviser directory fields; keeps sheet links and rotation notes. */
function syncSalesAdviserDirectory_(sheet, advisers) {
  const previous = sheet.getRange(3, 1, SALES_SYNC.adviserDirectorySize, 8).getDisplayValues();
  const settingsById = new Map(previous.filter(row => row[0]).map(row => [row[0], row.slice(6, 8)]));
  const rows = advisers.map((adviser) => [
    adviser.user_id,
    adviser.name || 'Sin nombre',
    adviser.email || '',
    'Ventas',
    adviser.cargo || 'Agente',
    adviser.active_for_sales ? 'Activo' : 'Inactivo',
    ...(settingsById.get(adviser.user_id) || ['', '']),
  ]);
  while (rows.length < SALES_SYNC.adviserDirectorySize) rows.push(['', '', '', '', '', '', '', '']);
  sheet.getRange(3, 1, SALES_SYNC.adviserDirectorySize, 8).setValues(rows);
}

function normalizeAdviser_(lead, activeAdviserByName) {
  const assignedName = String(lead && lead.assigned_adviser || '').trim();
  const activeAdviser = activeAdviserByName.get(normalizeNameKey_(assignedName));
  if (activeAdviser) return activeAdviser;

  // The sheet's adviser dropdown contains only sales-active advisers. If the
  // CRM still has a historical assignment to a deactivated/non-sales profile,
  // do not write a value the sheet rejects or show that person as currently active.
  const systemIsHandling = !!(lead && (lead.ai_enabled === true || lead.automation_enabled === true));
  return systemIsHandling ? SALES_SYNC.institutionalAdviser : '';
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
