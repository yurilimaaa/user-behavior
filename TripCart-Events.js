const TRIPCART_SHEET_NAME = 'TripCart-Events';
const DATA_FOLDER_ID = '1cDY3s5pK99jHkSuliIifjrI_M3Fa245b';
const ROLLING_RECALC_DAYS = 2; // Recompute the past N days each run to catch late GA4/CSV data

/** Entry for triggers: updates yesterday (UTC). */
function tripCartUpdate_yesterdayUTC() {
  // Instead of only updating yesterday, recompute a rolling window to capture late-arriving data.
  tripCartUpdate_lastNDaysUTC(ROLLING_RECALC_DAYS);
}

/**
 * Backfill from startDate → endDate (inclusive). If no args, defaults to 2025-08-01 → yesterday.
 * Example: tripCartBackfill();  or tripCartBackfill('2025-08-01','2025-08-25');
 */
function tripCartBackfill(startDateStr, endDateStr) {
  if (!startDateStr) {
    startDateStr = '2025-08-01';
    const y = new Date();
    y.setUTCDate(y.getUTCDate() - 1);
    endDateStr = Utilities.formatDate(y, 'Etc/UTC', 'yyyy-MM-dd');
    Logger.log(`TripCart backfill defaulting to ${startDateStr} → ${endDateStr}`);
  }
  const start = new Date(`${startDateStr}T00:00:00Z`);
  const end   = new Date(`${endDateStr}T00:00:00Z`);
  if (isNaN(start) || isNaN(end)) throw new Error('Invalid start/end date.');
  if (start > end) throw new Error('startDate must be <= endDate.');

  const ss = SpreadsheetApp.getActive();
  if (!ss.getSheetByName(TRIPCART_SHEET_NAME)) ss.insertSheet(TRIPCART_SHEET_NAME);

  const cur = new Date(start);
  while (cur <= end) {
    const dStr = Utilities.formatDate(cur, 'Etc/UTC', 'yyyy-MM-dd');
    try {
      tripCartDailyUpdate(dStr);
      Logger.log(`✅ TripCart updated for ${dStr}`);
    } catch (e) {
      Logger.log(`❌ TripCart failed for ${dStr}: ${e && e.message ? e.message : e}`);
    }
    Utilities.sleep(300);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
}

/**
 * Recompute the last N days (UTC): yesterday back to (yesterday - (n-1)).
 * Example: n=3 → updates yesterday, -2 days, -3 days.
 */
function tripCartUpdate_lastNDaysUTC(n) {
  if (!n || n < 1) n = 1;
  const today = new Date();
  for (let i = 1; i <= n; i++) {
    const d = new Date(today.getTime());
    d.setUTCDate(d.getUTCDate() - i);
    const dateStr = Utilities.formatDate(d, 'Etc/UTC', 'yyyy-MM-dd');
    try {
      tripCartDailyUpdate(dateStr);
      Logger.log(`✅ TripCart re-updated for ${dateStr}`);
    } catch (e) {
      Logger.log(`❌ TripCart failed for ${dateStr}: ${e && e.message ? e.message : e}`);
    }
    Utilities.sleep(300);
  }
}

/** Update the TripCart tab for a single day (UTC). */
function tripCartDailyUpdate(dateStr) {
  if (!dateStr) {
    const y = new Date(); y.setUTCDate(y.getUTCDate() - 1);
    dateStr = Utilities.formatDate(y, 'Etc/UTC', 'yyyy-MM-dd');
  }

  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(TRIPCART_SHEET_NAME) || ss.insertSheet(TRIPCART_SHEET_NAME);
  ensureTripCartHeader_(sheet);

  // Pull daily totals (no device dimension)
  const sessions            = ga4EventCount_(GA4_PROPERTY_ID, dateStr, 'session_start');
  const listingViews        = ga4EventCount_(GA4_PROPERTY_ID, dateStr, 'listing_page_view');

  const sendInquiryCart     = ga4EventCount_(GA4_PROPERTY_ID, dateStr, 'trip-cart_price-calculated', { 'customEvent:p2': 'false' });
  const inquiryStart        = ga4EventCount_(GA4_PROPERTY_ID, dateStr, 'inquiry_start');
  const inquirySubmit       = ga4EventCount_(GA4_PROPERTY_ID, dateStr, 'inquiry_submit_success');

  const completedInquiry    = readCompletedInquiryCsv_(dateStr);
  const bookNowCart         = ga4EventCount_(GA4_PROPERTY_ID, dateStr, 'trip-cart_price-calculated', { 'customEvent:p2': 'true' });
  const bookNowClick        = ga4EventCount_(GA4_PROPERTY_ID, dateStr, 'trip-cart_book-now-click');
  const proceedToPayment    = ga4EventCount_(GA4_PROPERTY_ID, dateStr, 'trip-cart_book-now-proceed-to-payment-cl');

  const confirmedIB         = readConfirmedIbCsv_(dateStr);

  upsertTripCartDailyRow_(sheet, dateStr, {
    sessions,
    listingViews,
    sendInquiryCart,
    inquiryStart,
    inquirySubmit,
    completedInquiry,
    bookNowCart,
    bookNowClick,
    proceedToPayment,
    confirmedIB
  });

  SpreadsheetApp.getActive().toast(`TripCart updated for ${dateStr}`, 'TripCart', 4);
}

/* ============================ Sheet helpers ============================ */

function ensureTripCartHeader_(sheet) {
  const header = [
    'Date',
    'Sessions','Listing Page',
    'Send Inquiry TC','Inquiry Start','% Start Inquiry',
    'Inquiry Submit','% Submit',
    'Completed Inquiry','Conversion Rate',
    'Book Now TC','BN Clicks','% Click BN',
    'Proceed to Payment','% BN',
    'Confirmed IB','Conversion Rate'
  ];
  const lastRow = sheet.getLastRow();
  if (lastRow < 1) {
    sheet.getRange(1, 1, 1, header.length).setValues([header]);
    sheet.getRange(1, 1, 1, header.length).setFontWeight('bold');
  }
}

/**
 * Upsert one row per date.
 * Columns:
 * A Date,
 * B Sessions, C Listing Page,
 * D Send Inquiry TC, E Inquiry Start, F % Start (formula),
 * G Inquiry Submit, H % Submit (formula),
 * I Completed Inquiry, J Conversion Rate (formula),
 * K Book Now TC, L BN Clicks, M % Click BN (formula),
 * N Proceed to Payment, O % BN (formula),
 * P Confirmed IB, Q Conversion Rate (formula)
 */
function upsertTripCartDailyRow_(sheet, dateStr, v) {
  let row = findRowByDate_(sheet, dateStr);
  if (!row || row < 2) {
    row = Math.max(sheet.getLastRow(), 1) + 1;
    sheet.getRange(row, 1).setValue(dateStr);
  }
  sheet.getRange(row, 1).setNumberFormat('yyyy-mm-dd');

  // Payload columns mapping (B..Q):
  // B Sessions, C Listing Page,
  // D Send Inquiry TC, E Inquiry Start, F % Start (formula),
  // G Inquiry Submit, H % Submit (formula),
  // I Completed Inquiry, J Conversion Rate (formula),
  // K Book Now TC, L BN Clicks, M % Click BN (formula),
  // N Proceed to Payment, O % BN (formula),
  // P Confirmed IB, Q Conversion Rate (formula)
  const payload = [
    v.sessions || 0,            // B
    v.listingViews || 0,        // C
    v.sendInquiryCart || 0,     // D
    v.inquiryStart || 0,        // E
    '',                         // F % Start Inquiry
    v.inquirySubmit || 0,       // G
    '',                         // H % Submit
    v.completedInquiry || 0,    // I Completed Inquiry (from CSV)
    '',                         // J Conversion Rate (Inquiry Submit / Completed Inquiry)
    v.bookNowCart || 0,         // K
    v.bookNowClick || 0,        // L
    '',                         // M % Click BN
    v.proceedToPayment || 0,    // N
    '',                         // O % BN
    v.confirmedIB || 0,         // P Confirmed IB (from CSV)
    ''                          // Q Conversion Rate (BN Clicks / Confirmed IB)
  ];
  sheet.getRange(row, 2, 1, payload.length).setValues([payload]);

  // Formulas (match requested definitions exactly)
  sheet.getRange(row, 6).setFormula(`=IFERROR(E${row}/D${row},"")`);   // % Start Inquiry
  sheet.getRange(row, 8).setFormula(`=IFERROR(G${row}/E${row},"")`);   // % Submit
  sheet.getRange(row,10).setFormula(`=IFERROR(I${row}/G${row},"")`);   // Conversion Rate (Inquiry Submit / Completed Inquiry)
  sheet.getRange(row,13).setFormula(`=IFERROR(L${row}/K${row},"")`);   // % Click BN
  sheet.getRange(row,15).setFormula(`=IFERROR(N${row}/L${row},"")`);   // % BN
  sheet.getRange(row,17).setFormula(`=IFERROR(P${row}/L${row},"")`);   // Conversion Rate (BN Clicks / Confirmed IB)

  // Percent/ratio formats
  sheet.getRangeList([`F${row}`, `H${row}`, `J${row}`, `M${row}`, `O${row}`, `Q${row}`])
       .setNumberFormat('0.00%');
}

function findRowByDate_(sheet, dateStr) {
  const last = Math.max(sheet.getLastRow(), 1);
  const values = sheet.getRange(1, 1, last, 1).getValues();
  const target = dateStr; // 'yyyy-MM-dd'
  for (let i = 0; i < values.length; i++) {
    const cell = values[i][0];
    let cellStr = '';
    if (cell instanceof Date) {
      cellStr = Utilities.formatDate(cell, 'Etc/UTC', 'yyyy-MM-dd');
    } else if (cell != null) {
      const raw = String(cell).trim();
      // try to parse strings like '2025-08-25', '2025/08/25', etc.
      const maybe = new Date(raw);
      if (!isNaN(maybe)) {
        cellStr = Utilities.formatDate(maybe, 'Etc/UTC', 'yyyy-MM-dd');
      } else {
        cellStr = raw.slice(0, 10); // fallback best-effort
      }
    }
    if (cellStr === target) return i + 1;
  }
  return null;
}

/** ================= CSV helpers for Completed Inquiry & Confirmed IB ================= */
function readCompletedInquiryCsv_(dateStr) {
  // Completed Inquiry comes from daily-bookings-non-ib-(today).csv containing yesterday's data.
  const d = new Date(`${dateStr}T00:00:00Z`);
  const next = new Date(d.getTime());
  next.setUTCDate(next.getUTCDate() + 1);
  const nextStr = Utilities.formatDate(next, 'Etc/UTC', 'yyyy-MM-dd');
  const next2 = new Date(next.getTime());
  next2.setUTCDate(next2.getUTCDate() + 1);
  const next2Str = Utilities.formatDate(next2, 'Etc/UTC', 'yyyy-MM-dd');

  const folder = DriveApp.getFolderById(DATA_FOLDER_ID);
  const tryNames = [
    `daily-bookings-non-ib-${nextStr}.csv`,
    `daily-bookings-non-ib-${dateStr}.csv`,
    `daily-bookings-non-ib-${next2Str}.csv` // rare fallback if file lands late
  ];
  const file = findFirstFileByNames_(folder, tryNames);
  if (!file) {
    Logger.log(`Completed Inquiry CSV not found for ${dateStr}: tried ${tryNames.join(', ')}`);
    return 0;
  }
  return sumSecondColumnForDate_(file, dateStr);
}

function readConfirmedIbCsv_(dateStr) {
  // The IB daily file (ib-daily-bookings-YYYY-MM-DD.csv) contains data for the *previous* day.
  // So to get metrics for dateStr, we first try the file dated (dateStr + 1).
  const d = new Date(`${dateStr}T00:00:00Z`);
  const next = new Date(d.getTime());
  next.setUTCDate(next.getUTCDate() + 1);
  const nextStr = Utilities.formatDate(next, 'Etc/UTC', 'yyyy-MM-dd');
  const next2 = new Date(next.getTime());
  next2.setUTCDate(next2.getUTCDate() + 1);
  const next2Str = Utilities.formatDate(next2, 'Etc/UTC', 'yyyy-MM-dd');

  const folder = DriveApp.getFolderById(DATA_FOLDER_ID);
  const file = findFirstFileByNames_(folder, [
    `ib-daily-bookings-${nextStr}.csv`,
    `ib-daily-bookings-${dateStr}.csv`,
    `ib-daily-bookings-${next2Str}.csv`
  ]);
  if (!file) {
    Logger.log(`Confirmed IB CSV not found for ${dateStr}: tried ${`ib-daily-bookings-${nextStr}.csv`}, ${`ib-daily-bookings-${dateStr}.csv`}`);
    return 0;
  }
  return sumSecondColumnForDate_(file, dateStr);
}

function findFirstFileByNames_(folder, names) {
  for (let i = 0; i < names.length; i++) {
    const it = folder.getFilesByName(names[i]);
    if (it.hasNext()) return it.next();
  }
  return null;
}

function sumSecondColumnForDate_(file, dateStr) {
  try {
    let text = file.getBlob().getDataAsString();
    // strip BOM
    text = text.replace(/^\uFEFF/, '');
    // normalize line endings and split
    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length === 0) return 0;

    // detect delimiter: tab, semicolon, then comma default
    const sample = lines[0];
    let delim = ',';
    if (sample.indexOf('\t') >= 0) delim = '\t';
    else if (sample.indexOf(';') >= 0) delim = ';';

    // parse rows
    const rows = lines.map(l => l.split(delim));

    // determine if first row is header by checking if second cell is numeric
    const isHeader = rows.length > 0 && isNaN(Number(String(rows[0][1] || '').replace(/,/g, '').trim()));

    let sum = 0;
    for (let i = isHeader ? 1 : 0; i < rows.length; i++) {
      const dRaw = (rows[i][0] || '').toString().trim();
      const nRaw = (rows[i][1] || '').toString().trim();
      if (!dRaw || !nRaw) continue;

      // normalize date: accept 'YYYY-MM-DD' or 'YYYY/MM/DD' etc., compare yyyy-MM-dd
      let dNorm = dRaw.slice(0, 10);
      const dParsed = new Date(dRaw);
      if (!isNaN(dParsed)) {
        dNorm = Utilities.formatDate(dParsed, 'Etc/UTC', 'yyyy-MM-dd');
      }

      let n = Number(nRaw.replace(/,/g, ''));
      if (!isFinite(n)) continue;

      if (dNorm === dateStr) sum += n;
    }
    return sum;
  } catch (e) {
    Logger.log(`CSV parse error for ${file.getName()}: ${e && e.message ? e.message : e}`);
    return 0;
  }
}

/* ============================ GA4 helpers ============================ */

function ga4EventCount_(propertyId, dateStr, eventName, paramFilters) {
  const request = {
    dateRanges: [{ startDate: dateStr, endDate: dateStr }],
    dimensions: [],
    metrics: [{ name: 'eventCount' }],
    keepEmptyRows: false,
    dimensionFilter: buildFilter_(eventName, paramFilters),
  };
  const resp = ga4RunReport_(propertyId, request);
  return readMetric_(resp, 'eventCount');
}

function buildFilter_(eventName, paramFilters) {
  const expressions = [{ filter: { fieldName: 'eventName', stringFilter: { value: eventName } } }];
  if (paramFilters) {
    Object.keys(paramFilters).forEach(k => {
      expressions.push({ filter: { fieldName: k, stringFilter: { value: String(paramFilters[k]) } } });
    });
  }
  return { andGroup: { expressions } };
}

function readMetric_(resp, metricName) {
  try {
    if (!resp || !resp.rows || !resp.rows.length) return 0;
    const idx = resp.metricHeaders.findIndex(h => h.name === metricName);
    if (idx < 0) return 0;
    const v = resp.rows[0].metricValues[idx].value;
    const n = Number(v);
    return isNaN(n) ? 0 : n;
  } catch (_) { return 0; }
}

/** Robust runReport: use Advanced Service if available, else REST v1→v1beta→v1alpha. */
function ga4RunReport_(propertyId, request) {
  const p = `properties/${propertyId}`;
  if (typeof AnalyticsData !== 'undefined' && AnalyticsData && AnalyticsData.Properties) {
    const props = AnalyticsData.Properties;
    if (typeof props.runReport === 'function') {
      try { return props.runReport(p, request); } catch (_) {}
      try { return props.runReport(request, p); } catch (_) {}
      try { return props.runReport({ property: p, resource: request }); } catch (_) {}
    }
  }
  return ga4RunReportHttpMulti_(propertyId, request);
}

function ga4RunReportHttpMulti_(propertyId, request) {
  const versions = ['v1', 'v1beta', 'v1alpha'];
  const errors = [];
  for (const ver of versions) {
    try { return ga4RunReportHttpOnce_(propertyId, request, ver); }
    catch (e) { errors.push(`${ver}: ${e && e.message ? e.message : e}`); }
  }
  throw new Error('GA4 REST runReport failed. ' + errors.join(' | '));
}

function ga4RunReportHttpOnce_(propertyId, request, version) {
  const url = `https://analyticsdata.googleapis.com/${version}/properties/${propertyId}:runReport`;
  const options = {
    method: 'post',
    muteHttpExceptions: true,
    contentType: 'application/json',
    headers: { Authorization: `Bearer ${ScriptApp.getOAuthToken()}` },
    payload: JSON.stringify(request),
  };
  const resp = UrlFetchApp.fetch(url, options);
  const code = resp.getResponseCode();
  const text = resp.getContentText();
  if (code >= 200 && code < 300) return JSON.parse(text);
  throw new Error(`GA4 ${version} HTTP ${code}: ${text.slice(0,300)}`);
}