/**
 * TripCart-Users
 *
 * Populates the "TripCart-Users" sheet with UNIQUE USERS per event
 * and enriches with Completed Inquiry (non‑IB) and Confirmed IB from CSVs.
 *
 * Assumptions:
 *  - GA4_PROPERTY_ID is defined elsewhere in the project (do NOT redeclare here).
 *  - Advanced service scopes allow UrlFetchApp (analytics.readonly is already in appsscript.json).
 *  - Helper tabs/other scripts may also exist; this file is self‑contained and does not rely
 *    on project-specific wrappers.
 */

// === CONFIG ===
const TC_USERS_SHEET = 'TripCart-Users';
const DRIVE_FOLDER_ID = '1cDY3s5pK99jHkSuliIifjrI_M3Fa245b';

// === PUBLIC ENTRY POINTS ===
function tripCartUsersBackfill(startDateStr, endDateStr) {
  const start = startDateStr ? parseUTC_(startDateStr) : parseUTC_('2025-09-19');
  const end = endDateStr ? parseUTC_(endDateStr) : yesterdayUTC_();
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const ds = toYYYYMMDD_(d);
    tripCartUsersUpdateForDate(ds);
  }
}

function tripCartUsersDailyUpdate(dateInput) {
  const ds = coerceDateStr_(dateInput);
  Logger.log('Processing tripCartUsersDailyUpdate for date: %s (inputType=%s)', ds, typeof dateInput);
  tripCartUsersUpdateForDate(ds);
}
/**
 * Coerces a variety of inputs into a YYYY-MM-DD string.
 * Accepts Date, ISO-like strings, or undefined (defaults to yesterday UTC).
 * If a trigger event object was passed, it will be ignored and default used.
 */
function coerceDateStr_(input) {
  try {
    if (!input) {
      return toYYYYMMDD_(yesterdayUTC_());
    }
    // If an Apps Script trigger event object was passed, ignore it.
    if (typeof input === 'object' && !(input instanceof Date)) {
      return toYYYYMMDD_(yesterdayUTC_());
    }
    if (input instanceof Date && !isNaN(input)) {
      return toYYYYMMDD_(input);
    }
    if (typeof input === 'string') {
      var s = String(input).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      var d = new Date(s);
      if (!isNaN(d)) return toYYYYMMDD_(d);
    }
  } catch (e) {
    Logger.log('coerceDateStr_ fallback due to error: %s', e && e.message ? e.message : e);
  }
  return toYYYYMMDD_(yesterdayUTC_());
}

// === CORE ===
function tripCartUsersUpdateForDate(dateStr) {
  const sh = getSheet_(TC_USERS_SHEET);
  const row = findOrCreateRowByDate_(sh, dateStr);

  // GA4 unique users per event/metric
  const totalUsers = ga4ActiveUsersTotal_(dateStr);
  const listingPage = ga4ActiveUsersForEvent_(dateStr, 'listing_page_view');

  // CTA split
  const sendInquiryTC = ga4ActiveUsersForEvent_(dateStr, 'trip-cart_price-calculated', { key: 'p2', value: 'false' });
  const bookNowTC     = ga4ActiveUsersForEvent_(dateStr, 'trip-cart_price-calculated', { key: 'p2', value: 'true'  });

  const inquiryStart  = ga4ActiveUsersForEvent_(dateStr, 'inquiry_start');
  const inquirySubmit = ga4ActiveUsersForEvent_(dateStr, 'inquiry_submit_success');

  const bnClicks      = ga4ActiveUsersForEvent_(dateStr, 'trip-cart_book-now-click');
  const proceedPay    = ga4ActiveUsersForEvent_(dateStr, 'trip-cart_book-now-proceed-to-payment-cl');

  // CSVs (file name has TODAY, content has YESTERDAY -> pass dateStr and search file with dateStr+1)
  const completedInquiry = readCompletedInquiryCsv_(dateStr) || 0; // Column I
  const confirmedIB      = readConfirmedIbCsv_(dateStr) || 0;      // Column P

  // Write numeric values
  const values = [
    [ // A..Q for a single row (we only write numeric cells; A already has date)
      null,
      totalUsers,               // B
      listingPage,              // C
      sendInquiryTC,            // D
      inquiryStart,             // E
      null,                     // F formula
      inquirySubmit,            // G
      null,                     // H formula
      completedInquiry,         // I (from CSV non-IB)
      null,                     // J formula
      bookNowTC,                // K
      bnClicks,                 // L
      null,                     // M formula
      proceedPay,               // N
      null,                     // O formula
      confirmedIB,              // P (from CSV IB)
      null                      // Q formula
    ]
  ];
  sh.getRange(row, 1, 1, values[0].length).offset(0, 0).setValues(values);

  // Ensure date in A
  sh.getRange(row, 1).setValue(dateStr);

  // Put formulas (percent/ratio)
  setFormulasForRow_(sh, row);
  applyFormats_(sh, row);
}

// === FORMATTING ===
function setFormulasForRow_(sh, row) {
  sh.getRange(row, 6).setFormula(`=IFERROR(E${row}/D${row},0)`); // F % Start Inquiry
  sh.getRange(row, 8).setFormula(`=IFERROR(G${row}/E${row},0)`); // H % Submit
  sh.getRange(row,10).setFormula(`=IFERROR(I${row}/G${row},0)`); // J Conversion Rate
  sh.getRange(row,13).setFormula(`=IFERROR(L${row}/K${row},0)`); // M % Click BN
  sh.getRange(row,15).setFormula(`=IFERROR(N${row}/L${row},0)`); // O % BN
  sh.getRange(row,17).setFormula(`=IFERROR(P${row}/L${row},0)`); // Q Conversion Rate
}

function applyFormats_(sh, row) {
  // Thousands for counts
  const countCols = [2,3,4,5,7,9,11,12,14,16];
  countCols.forEach(c => sh.getRange(row, c).setNumberFormat('#,##0'));
  // Percent for ratios
  const pctCols = [6,8,10,13,15,17];
  pctCols.forEach(c => sh.getRange(row, c).setNumberFormat('0.00%'));
}

// === GA4 HELPERS (HTTP v1beta) ===
function ga4ActiveUsersTotal_(dateStr) {
  const req = {
    dateRanges: [{ startDate: dateStr, endDate: dateStr }],
    metrics: [{ name: 'activeUsers' }]
  };
  const res = ga4RunReportHttp_(req);
  return (res.rows && res.rows[0] && res.rows[0].metricValues && Number(res.rows[0].metricValues[0].value)) || 0;
}

function ga4ActiveUsersForEvent_(dateStr, eventName, param) {
  const dimensions = [{ name: 'eventName' }];
  const filters = [{
    filter: {
      fieldName: 'eventName',
      stringFilter: { value: eventName, matchType: 'EXACT' }
    }
  }];
  if (param && param.key) {
    // GA4 custom event parameter, e.g. customEvent:p2 == 'true' / 'false'
    dimensions.push({ name: `customEvent:${param.key}` });
    filters.push({
      filter: {
        fieldName: `customEvent:${param.key}`,
        stringFilter: { value: String(param.value), matchType: 'EXACT' }
      }
    });
  }
  const req = {
    dateRanges: [{ startDate: dateStr, endDate: dateStr }],
    metrics: [{ name: 'activeUsers' }],
    dimensions,
    dimensionFilter: { andGroup: { expressions: filters } }
  };
  const res = ga4RunReportHttp_(req);
  let total = 0;
  if (res.rows) {
    for (const r of res.rows) {
      total += Number(r.metricValues[0].value || 0);
    }
  }
  return total;
}

function ga4RunReportHttp_(requestBody) {
  if (typeof GA4_PROPERTY_ID === 'undefined' || !GA4_PROPERTY_ID) {
    throw new Error('GA4_PROPERTY_ID is not defined in the project.');
  }
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${GA4_PROPERTY_ID}:runReport`;
  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(requestBody),
    headers: { Authorization: `Bearer ${ScriptApp.getOAuthToken()}` },
    muteHttpExceptions: true
  });
  const code = resp.getResponseCode();
  const body = resp.getContentText();
  if (code < 200 || code >= 300) throw new Error(`GA4 HTTP ${code}: ${body.substring(0, 500)}`);
  return JSON.parse(body);
}

// === SHEET HELPERS ===
function getSheet_(name) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}

function findOrCreateRowByDate_(sh, dateStr) {
  const lastRow = sh.getLastRow();
  if (lastRow < 2) {
    // assume headers already present; create first data row
    sh.getRange(2, 1).setValue(dateStr);
    return 2;
  }
  const dates = sh.getRange(2, 1, lastRow - 1, 1).getValues().map(r => String(r[0]));
  const idx = dates.findIndex(v => v === dateStr);
  if (idx >= 0) return 2 + idx;
  // append
  const newRow = lastRow + 1;
  sh.getRange(newRow, 1).setValue(dateStr);
  return newRow;
}

// === CSV HELPERS ===
function readCompletedInquiryCsv_(dateStr) {
  const file = findFirstFileByNames_(plusDays_(dateStr, 1), ['daily-bookings-non-ib']);
  if (!file) return 0;
  return sumSecondColumnForDate_(file, dateStr);
}

function readConfirmedIbCsv_(dateStr) {
  const file = findFirstFileByNames_(plusDays_(dateStr, 1), ['ib-daily-bookings']);
  if (!file) return 0;
  return sumSecondColumnForDate_(file, dateStr);
}

function findFirstFileByNames_(fileDateStr, prefixes) {
  const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  for (const p of prefixes) {
    const exact = `${p}-${fileDateStr}.csv`;
    const it = folder.getFilesByName(exact);
    if (it.hasNext()) return it.next();
  }
  // Fallback: scan by contains (safety)
  const itAll = DriveApp.getFolderById(DRIVE_FOLDER_ID).getFiles();
  while (itAll.hasNext()) {
    const f = itAll.next();
    const name = f.getName();
    if (name.endsWith('.csv') && prefixes.some(p => name.indexOf(p) === 0) && name.indexOf(fileDateStr) !== -1) {
      return f;
    }
  }
  return null;
}

function sumSecondColumnForDate_(file, wantedDate) {
  const csv = Utilities.parseCsv(file.getBlob().getDataAsString());
  if (!csv || csv.length < 2) return 0;
  // Find header indices
  const header = csv[0].map(h => String(h).trim());
  const idxDate = header.findIndex(h => /date/i.test(h));
  const idxVal = header.findIndex(h => /^n$/i.test(h)) >= 0 ? header.findIndex(h => /^n$/i.test(h)) : 1;
  for (let r = 1; r < csv.length; r++) {
    const row = csv[r];
    const d = String(row[idxDate >= 0 ? idxDate : 0]).trim();
    if (d === wantedDate) {
      const v = Number(String(row[idxVal]).replace(/,/g, ''));
      return isFinite(v) ? v : 0;
    }
  }
  return 0;
}

// === DATE HELPERS ===
function toYYYYMMDD_(d) {
  return [d.getUTCFullYear(), pad2_(d.getUTCMonth()+1), pad2_(d.getUTCDate())].join('-');
}
function pad2_(n) { return (`0${n}`).slice(-2); }
function parseUTC_(s) { const [y,m,d] = s.split('-').map(Number); return new Date(Date.UTC(y, m-1, d)); }
function yesterdayUTC_() { const d = new Date(); d.setUTCHours(0,0,0,0); d.setUTCDate(d.getUTCDate()-1); return d; }
function plusDays_(dateStr, n) { const d = parseUTC_(dateStr); d.setUTCDate(d.getUTCDate()+n); return toYYYYMMDD_(d); }

// === DEBUGGING ===
/**
 * Debug: Log total active users from GA4 for two dates to verify column B matches GA4.
 */
function testTotalUsersLog() {
  var date1 = '2025-09-11';
  var date2 = '2025-09-17';
  var total1 = ga4ActiveUsersTotal_(date1);
  var total2 = ga4ActiveUsersTotal_(date2);
  Logger.log('GA4 activeUsers for %s: %s', date1, total1);
  Logger.log('GA4 activeUsers for %s: %s', date2, total2);
}

function overrideTotalUsersColumnB() {
  const sh = getSheet_(TC_USERS_SHEET);
  const lastRow = sh.getLastRow();
  if (lastRow < 2) {
    Logger.log('No data rows found in sheet %s.', TC_USERS_SHEET);
    return;
  }
  const dateValues = sh.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < dateValues.length; i++) {
    const row = i + 2;
    let cellValue = dateValues[i][0];
    let dateStr = '';
    if (cellValue instanceof Date && !isNaN(cellValue)) {
      dateStr = toYYYYMMDD_(cellValue);
    } else if (typeof cellValue === 'string') {
      const trimmed = cellValue.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        dateStr = trimmed;
      }
    }
    if (!dateStr) {
      Logger.log('Row %d has invalid or empty date in column A; skipping.', row);
      continue;
    }
    try {
      const totalUsers = ga4ActiveUsersTotal_(dateStr);
      sh.getRange(row, 2).setValue(totalUsers);
      Logger.log('Updated row %d date %s with totalUsers %d in column B.', row, dateStr, totalUsers);
    } catch (e) {
      Logger.log('Error updating row %d date %s: %s', row, dateStr, e.message);
    }
  }
}

