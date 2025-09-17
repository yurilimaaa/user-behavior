/**
 * TripCart-Users.js
 * Sheet updater for TripCart unique user counts (GA4 metric: totalUsers)
 * Columns (A→Q):
 * A Date | B Total Users | C Listing Page | D Send Inquiry TC | E Inquiry Start | F % Start Inquiry (E/D)
 * G Inquiry Submit | H % Submit (G/E) | I Completed Inquiry (CSV/manual) | J Conversion Rate (I/G)
 * K Book Now TC | L BN Clicks | M % Click BN (L/K) | N Proceed to Payment | O % BN (N/L)
 * P Confirmed IB (CSV) | Q Conversion Rate (P/L)
 */



// --- Sheet constants ---
const TRIPCART_USERS_SHEET_NAME = 'TripCart-Users';

// ---------- Helpers ----------
/**
 * Find row by ISO date (yyyy-MM-dd) in column A. Returns 1-based row or -1.
 */
function findRowByDate_(sheet, dateString) {
  const last = sheet.getLastRow();
  if (last < 2) return -1;
  const values = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (values[i][0] === dateString) return i + 2;
  }
  return -1;
}

/**
 * CSV lookup (stub). If you have CSVs, implement here.
 */
function getCsvValue_(dateString, fieldName) {
  // TODO: implement if/when CSVs are ready. For now, keep existing cell value.
  return null;
}

/**
 * GA4: totalUsers for an event (optionally with event parameter).
 * Uses dimension 'eventName' and (when provided) 'customEvent:<param>'.
 */
function ga4UserCount_(propertyId, dateString, eventName, paramName, paramValue) {
  const request = {
    dateRanges: [{ startDate: dateString, endDate: dateString }],
    metrics: [{ name: 'totalUsers' }],
    dimensions: [{ name: 'eventName' }],
  };

  const filters = [{
    filter: {
      fieldName: 'eventName',
      stringFilter: { value: eventName, matchType: 'EXACT' },
    },
  }];

  if (paramName) {
    // Add the customEvent:<param> dimension and filter
    request.dimensions.push({ name: `customEvent:${paramName}` });
    filters.push({
      filter: {
        fieldName: `customEvent:${paramName}`,
        stringFilter: { value: paramValue, matchType: 'EXACT' },
      },
    });
  }

  request.dimensionFilter = { andGroup: { expressions: filters } };

  try {
    const resp = AnalyticsData.Properties.runReport('properties/' + propertyId, request);
    if (resp && resp.rows && resp.rows.length) {
      const v = Number(resp.rows[0].metricValues[0].value);
      return isNaN(v) ? 0 : v;
    }
  } catch (e) {
    Logger.log(`❌ GA4 runReport failed for event=${eventName}, param=${paramName || '-'}: ${e}`);
  }
  return 0;
}

/**
 * GA4: property totalUsers for the day (no event filter).
 */
function ga4TotalUsers_(propertyId, dateString) {
  const request = {
    dateRanges: [{ startDate: dateString, endDate: dateString }],
    metrics: [{ name: 'totalUsers' }],
  };
  try {
    const resp = AnalyticsData.Properties.runReport('properties/' + propertyId, request);
    if (resp && resp.rows && resp.rows.length) {
      const v = Number(resp.rows[0].metricValues[0].value);
      return isNaN(v) ? 0 : v;
    }
  } catch (e) {
    Logger.log(`❌ GA4 totalUsers failed: ${e}`);
  }
  return 0;
}

// ---------- Row writer ----------
/**
 * Upsert a row and place formulas in F, H, M, O, Q.
 */
function upsertTripCartUsersDailyRow_(dateString, counts) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(TRIPCART_USERS_SHEET_NAME);
  if (!sheet) throw new Error(`Sheet "${TRIPCART_USERS_SHEET_NAME}" not found.`);

  let row = findRowByDate_(sheet, dateString);
  if (row === -1) row = Math.max(2, sheet.getLastRow() + 1);

  // Preserve I and P if already typed/loaded
  const existingI = sheet.getRange(row, 9).getValue();  // I
  const existingP = sheet.getRange(row, 16).getValue(); // P

  const completedInquiry = (getCsvValue_(dateString, 'completedInquiry') ?? existingI) || 0;
  const confirmedIB      = (getCsvValue_(dateString, 'confirmedIB') ?? existingP) || 0;

  // Base numbers
  const rowValues = [];
  rowValues[1-1]  = dateString;                 // A
  rowValues[2-1]  = counts.totalUsers;          // B
  rowValues[3-1]  = counts.listingPage;         // C
  rowValues[4-1]  = counts.sendInquiryTC;       // D
  rowValues[5-1]  = counts.inquiryStart;        // E
  rowValues[6-1]  = '';                         // F (formula later)
  rowValues[7-1]  = counts.inquirySubmit;       // G
  rowValues[8-1]  = '';                         // H (formula later)
  rowValues[9-1]  = completedInquiry;           // I
  rowValues[10-1] = '';                         // J (we leave empty; optional to add formula I/G)
  rowValues[11-1] = counts.bookNowTC;           // K
  rowValues[12-1] = counts.bnClicks;            // L
  rowValues[13-1] = '';                         // M (formula later)
  rowValues[14-1] = counts.proceedToPayment;    // N
  rowValues[15-1] = '';                         // O (formula later)
  rowValues[16-1] = confirmedIB;                // P
  rowValues[17-1] = '';                         // Q (formula later)

  // Write base values
  sheet.getRange(row, 1, 1, 17).setValues([rowValues]);

  // Formulas
  sheet.getRange(row, 6).setFormula(`=IFERROR(E${row}/D${row},0)`);
  sheet.getRange(row, 8).setFormula(`=IFERROR(G${row}/E${row},0)`);
  sheet.getRange(row, 13).setFormula(`=IFERROR(L${row}/K${row},0)`);
  sheet.getRange(row, 15).setFormula(`=IFERROR(N${row}/L${row},0)`);
  sheet.getRange(row, 17).setFormula(`=IFERROR(P${row}/L${row},0)`);
  sheet.getRange(row, 10).setFormula(`=IFERROR(I${row}/G${row},0)`);
}

/**
 * Fetch one day and upsert.
 */
function tripCartUsersDailyUpdate(dateString, propertyId) {
  const pid = propertyId || GA4_PROPERTY_ID;

  const totalUsers      = ga4TotalUsers_(pid, dateString); // B
  const listingPage     = ga4UserCount_(pid, dateString, 'listing_page_view'); // C
  const sendInquiryTC   = ga4UserCount_(pid, dateString, 'trip-cart_price-calculated', 'p2', 'false'); // D
  const inquiryStart    = ga4UserCount_(pid, dateString, 'inquiry_start'); // E
  const inquirySubmit   = ga4UserCount_(pid, dateString, 'inquiry_submit_success'); // G
  const bookNowTC       = ga4UserCount_(pid, dateString, 'trip-cart_price-calculated', 'p2', 'true'); // K
  const bnClicks        = ga4UserCount_(pid, dateString, 'trip-cart_book-now-click'); // L
  const proceedToPay    = ga4UserCount_(pid, dateString, 'trip-cart_book-now-proceed-to-payment-cl'); // N

  upsertTripCartUsersDailyRow_(dateString, {
    totalUsers,
    listingPage,
    sendInquiryTC,
    inquiryStart,
    inquirySubmit,
    bookNowTC,
    bnClicks,
    proceedToPayment: proceedToPay,
  });
}

// ---------- Schedules ----------
/** Update yesterday (UTC). */
function tripCartUsersUpdate_yesterdayUTC() {
  const y = Utilities.formatDate(new Date(Date.now() - 86400000), 'UTC', 'yyyy-MM-dd');
  tripCartUsersDailyUpdate(y, GA4_PROPERTY_ID);
}

/** Update last N days (UTC). */
function tripCartUsersUpdate_lastNDaysUTC(n) {
  const days = Math.max(1, Number(n) || 1);
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i - 1); // walk back from yesterday
    const s = Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
    tripCartUsersDailyUpdate(s, GA4_PROPERTY_ID);
  }
}

/** Backfill from 2025-07-01 to yesterday. */
function tripCartUsersBackfill(startDate, endDate) {
  const start = startDate || '2025-07-01';
  const end = endDate || Utilities.formatDate(new Date(Date.now() - 86400000), 'UTC', 'yyyy-MM-dd');

  const d0 = new Date(start + 'T00:00:00Z');
  const d1 = new Date(end + 'T00:00:00Z');
  for (let d = new Date(d0); d <= d1; d.setUTCDate(d.getUTCDate() + 1)) {
    const s = Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
    tripCartUsersDailyUpdate(s, GA4_PROPERTY_ID);
  }
}