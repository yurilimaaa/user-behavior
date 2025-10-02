// Toggle to disable ab_bucket filters if dimension not yet live
const USE_AB_BUCKET = true;

function buildFilter(baseFilter) {
  const clone = { ...baseFilter };
  if (!USE_AB_BUCKET && clone.ab_bucket) {
    delete clone.ab_bucket;
  }
  return clone;
}

/**
 * Count GA4 event occurrences where a raw event parameter equals 'true'.
 * This does NOT require registering the param as a custom dimension.
 */
function ga4CountEventWithParamTrue_(propertyId, eventName, paramName, startDate, endDate, opt) {
  // Check if paramName is active or allowed
  if (!USE_AB_BUCKET && paramName !== 'p1') {
    Logger.log(`⚠️ Skipping param-based query for ${eventName}, param=${paramName} (not active)`);
    return 0;
  }
  const expr = [];
  // eventName exact
  expr.push({
    filter: {
      fieldName: 'eventName',
      stringFilter: { value: eventName, matchType: 'EXACT' }
    }
  });
  // Using customEvent:paramName field (only works if param registered as custom dimension)
  expr.push({
    filter: {
      fieldName: `customEvent:${paramName}`,
      stringFilter: { value: 'true', matchType: 'EXACT' }
    }
  });
  // optional ab_bucket when enabled
  if (opt && opt.ab_bucket && typeof USE_AB_BUCKET !== 'undefined' && USE_AB_BUCKET) {
    expr.push({
      filter: {
        fieldName: 'ab_bucket',
        stringFilter: { value: opt.ab_bucket, matchType: 'EXACT' }
      }
    });
  }

  const request = {
    dateRanges: [{ startDate, endDate }],
    // Changed metric from eventCount to activeUsers to count distinct users instead of raw event counts
    metrics: [{ name: 'activeUsers' }],
    dimensions: [
      { name: 'eventName' },
      { name: `customEvent:${paramName}` }
    ],
    dimensionFilter: { andGroup: { expressions: expr } },
    keepEmptyRows: false
  };

  const res = ga4RunReport_(propertyId, request);
  if (res && res.rows && res.rows.length > 0) {
    const v = res.rows[0].metricValues && res.rows[0].metricValues[0] ? Number(res.rows[0].metricValues[0].value) : 0;
    return isFinite(v) ? v : 0;
  }
  return 0;
}
/**
 * AB-Test Daily Update Script
 * Target sheet: AB-Test
 * Updates yesterday’s data into the next available row.
 */

const ABTEST_SHEET_NAME = 'AB-Test-SI-RQ-Daily';
const ABTEST_FOLDER_ID = '1cDY3s5pK99jHkSuliIifjrI_M3Fa245b'; // same Drive folder as TripCart CSVs

function safeGa4EventCount_(propertyId, eventName, startDate, endDate, filter) {
  try {
    // Build dimensionFilter expressions
    const expr = [];
    expr.push({
      filter: {
        fieldName: 'eventName',
        stringFilter: { value: eventName, matchType: 'EXACT' }
      }
    });
    // Optional customEvent:p2 filter (e.g., for trip-cart_price-calculated). This works regardless of ab_bucket toggle.
    if (eventName === 'trip-cart_price-calculated' && filter && typeof filter.p2 !== 'undefined') {
      expr.push({
        filter: {
          fieldName: 'customEvent:p2',
          stringFilter: { value: String(filter.p2), matchType: 'EXACT' }
        }
      });
    }
    if (filter && filter.ab_bucket) {
      expr.push({
        filter: {
          fieldName: 'customEvent:ab_bucket',
          stringFilter: { value: filter.ab_bucket, matchType: 'EXACT' }
        }
      });
    }
    if (filter && filter.p1) {
      expr.push({
        filter: {
          fieldName: 'customEvent:p1',
          stringFilter: { value: filter.p1, matchType: 'EXACT' }
        }
      });
    }
    Logger.log(`▶️ GA4 request: event=${eventName}, date=${startDate}, filter=${JSON.stringify(filter)}`);
    const request = {
      dateRanges: [{ startDate, endDate }],
      // Changed metric from eventCount to activeUsers to count distinct users instead of raw event counts
      metrics: [{ name: 'activeUsers' }],
      dimensions: [{ name: 'eventName' }],
      dimensionFilter: { andGroup: { expressions: expr } },
      keepEmptyRows: false
    };
    const v = ga4EventCountWithRequest_(propertyId, request);
    Logger.log(`✅ GA4 response: event=${eventName}, value=${v}`);
    return v;
  } catch (err) {
    Logger.log(`❌ GA4 failed: event=${eventName}, error=${err}`);
    return 0;
  }
}

function safeGa4CountEventWithParamTrue_(propertyId, eventName, paramName, startDate, endDate, opt) {
  try {
    Logger.log(`▶️ GA4 request: event=${eventName}, param=${paramName}, date=${startDate}, opt=${JSON.stringify(opt)}`);
    // Modify expr to add customEvent:p2 = true for columns H and M
    if (eventName === 'trip-cart_price-calculated' && paramName === 'p1' && opt && opt.ab_bucket) {
      const expr = [];
      // eventName exact
      expr.push({
        filter: {
          fieldName: 'eventName',
          stringFilter: { value: eventName, matchType: 'EXACT' }
        }
      });
      // paramName p1 = true
      expr.push({
        filter: {
          fieldName: `customEvent:${paramName}`,
          stringFilter: { value: 'true', matchType: 'EXACT' }
        }
      });
      // customEvent:p2 = true
      expr.push({
        filter: {
          fieldName: 'customEvent:p2',
          stringFilter: { value: 'true', matchType: 'EXACT' }
        }
      });
      // ab_bucket if enabled
      if (typeof USE_AB_BUCKET !== 'undefined' && USE_AB_BUCKET) {
        expr.push({
          filter: {
            fieldName: 'customEvent:ab_bucket',
            stringFilter: { value: opt.ab_bucket, matchType: 'EXACT' }
          }
        });
      }
      const request = {
        dateRanges: [{ startDate, endDate }],
        metrics: [{ name: 'activeUsers' }],
        dimensions: [
          { name: 'eventName' },
          { name: `customEvent:${paramName}` },
          { name: 'customEvent:p2' }
        ],
        dimensionFilter: { andGroup: { expressions: expr } },
        keepEmptyRows: false
      };
      const res = ga4RunReport_(propertyId, request);
      let v = 0;
      if (res && res.rows && res.rows.length > 0) {
        v = res.rows[0].metricValues && res.rows[0].metricValues[0] ? Number(res.rows[0].metricValues[0].value) : 0;
        v = isFinite(v) ? v : 0;
      }
      if (v === 0) {
        Logger.log(`⚠️ Skipping param-based query with p2=true: event=${eventName}, param=${paramName}, ab_bucket=${opt.ab_bucket}`);
      } else {
        Logger.log(`✅ GA4 response: event=${eventName}, value=${v}`);
      }
      return v;
    }
    const v = ga4CountEventWithParamTrue_(propertyId, eventName, paramName, startDate, endDate, opt);
    if (v === 0) {
      Logger.log(`⚠️ Skipped or zero result for param-based query: event=${eventName}, param=${paramName}`);
    } else {
      Logger.log(`✅ GA4 response: event=${eventName}, value=${v}`);
    }
    return v;
  } catch (err) {
    Logger.log(`❌ GA4 failed: event=${eventName}, error=${err}`);
    return 0;
  }
}

function abTestDailyUpdate() {
  const today = new Date();
  today.setUTCHours(0,0,0,0);
  const yesterday = new Date(today.getTime() - 24*60*60*1000);
  const dateStr = formatDate(yesterday);
  abTestUpdateForDate(dateStr);
}

function abTestBackfill(startDateStr, endDateStr) {
  if (!startDateStr) throw new Error('Provide startDateStr as yyyy-MM-dd.');
  if (!endDateStr) throw new Error('Provide endDateStr as yyyy-MM-dd.');
  const start = new Date(`${startDateStr}T00:00:00Z`);
  const end   = new Date(`${endDateStr}T00:00:00Z`);
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate()+1)) {
    abTestUpdateForDate(formatDate(d));
  }
}

/**
 * Backfill AB-Test data for the last 3 days (excluding today).
 * Convenience wrapper.
 */
function abTestBackfillLast3Days() {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  // startDate: today - 3 days, endDate: today - 1 day
  const startDate = new Date(today.getTime() - 3 * 24 * 60 * 60 * 1000);
  const endDate = new Date(today.getTime() - 1 * 24 * 60 * 60 * 1000);
  abTestBackfill(formatDate(startDate), formatDate(endDate));
}

function fetchInquiryStartWithContactOwner_(dateStr, abBucket) {
  const propertyId = GA4_PROPERTY_ID;
  const startDate = dateStr;
  const endDate = dateStr;
  const expr = [];
  expr.push({
    filter: { fieldName: 'eventName', stringFilter: { value: 'inquiry_start', matchType: 'EXACT' } }
  });
  expr.push({
    filter: { fieldName: 'customEvent:ab_bucket', stringFilter: { value: abBucket, matchType: 'EXACT' } }
  });
  expr.push({
    filter: { fieldName: 'customEvent:p1', stringFilter: { value: 'contact-owner-button', matchType: 'EXACT' } }
  });

  const request = {
    dateRanges: [{ startDate, endDate }],
    metrics: [{ name: 'activeUsers' }],
    dimensions: [{ name: 'eventName' }],
    dimensionFilter: { andGroup: { expressions: expr } },
    keepEmptyRows: false
  };

  const res = ga4RunReport_(propertyId, request);
  if (res && res.rows && res.rows.length > 0) {
    const v = res.rows[0].metricValues && res.rows[0].metricValues[0] ? Number(res.rows[0].metricValues[0].value) : 0;
    return isFinite(v) ? v : 0;
  }
  return 0;
}

function abTestUpdateForDate(dateStr) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(ABTEST_SHEET_NAME);
  if (!sheet) throw new Error(`Sheet ${ABTEST_SHEET_NAME} not found.`);

  // Map columns
  const colMap = {
    date: 1, b:2, c:3, d:4, e:5, f:6, g:7, h:8, i:9, j:10,
    k:11, l:12, m:13, n:14, o:15, p:16, q:17
  };

  // Find row for date or next empty
  let row = findRowForDate_(sheet, dateStr, colMap.date);
  if (!row) row = sheet.getLastRow() + 1;

  // --- GA4 queries (updated mapping for Daily tab) ---
  // b: inquiry-start-trip-cart
  const b = safeGa4EventCount_(GA4_PROPERTY_ID, 'trip-cart_price-calculated', dateStr, dateStr, { ab_bucket: 'trip-cart-cta:send-inquiry', p2: false });
  // c: inquiry-start-click with p1=send-inquiry-button
  const c = safeGa4EventCount_(GA4_PROPERTY_ID, 'inquiry_start', dateStr, dateStr, { ab_bucket: 'trip-cart-cta:send-inquiry', p1: 'send-inquiry-button' });
  // e: request-quote-trip-cart with p1=send-inquiry-button
  const e = safeGa4EventCount_(GA4_PROPERTY_ID, 'trip-cart_price-calculated', dateStr, dateStr, { ab_bucket: 'trip-cart-cta:request-a-quote', p2: false});
  // f: request-start with p1=send-inquiry-button
  const f = safeGa4EventCount_(GA4_PROPERTY_ID, 'inquiry_start', dateStr, dateStr, { ab_bucket: 'trip-cart-cta:request-a-quote', p1: 'send-inquiry-button' });
  // h: bn-inquiry-start-trip-cart
  const h = safeGa4EventCount_(GA4_PROPERTY_ID, 'trip-cart_price-calculated', dateStr, dateStr, { ab_bucket: 'trip-cart-cta:send-inquiry', p2: true });
  // i: bn-click with p1=contact-owner-button
  const i = safeGa4EventCount_(GA4_PROPERTY_ID, 'trip-cart_book-now-click', dateStr, dateStr, { ab_bucket: 'trip-cart-cta:send-inquiry',});
  // k: inquiry-start-click (p1 = contact-owner-button)
  const k = safeGa4EventCount_(GA4_PROPERTY_ID, 'inquiry_start', dateStr, dateStr, { ab_bucket: 'trip-cart-cta:send-inquiry', p1: 'contact-owner-button' }); 
  // m: bn-request-trip-cart
  const m = safeGa4EventCount_(GA4_PROPERTY_ID, 'trip-cart_price-calculated', dateStr, dateStr, { ab_bucket: 'trip-cart-cta:request-a-quote', p2: true });
  // n: bn-click (request-a-quote) with p1=contact-owner-button
  const n = safeGa4EventCount_(GA4_PROPERTY_ID, 'trip-cart_book-now-click', dateStr, dateStr, { ab_bucket: 'trip-cart-cta:request-a-quote'});
  // p: request-start-click (p1 = contact-owner-button)
  const p = safeGa4EventCount_(GA4_PROPERTY_ID, 'inquiry_start', dateStr, dateStr, { ab_bucket: 'trip-cart-cta:request-a-quote', p1: 'contact-owner-button' }); 

  // --- Write values ---
  sheet.getRange(row, colMap.date).setValue(dateStr);
  sheet.getRange(row, colMap.b).setValue(b);
  sheet.getRange(row, colMap.c).setValue(c);
  sheet.getRange(row, colMap.e).setValue(e);
  sheet.getRange(row, colMap.f).setValue(f);
  sheet.getRange(row, colMap.h).setValue(h);
  sheet.getRange(row, colMap.i).setValue(i);
  sheet.getRange(row, colMap.k).setValue(k);
  sheet.getRange(row, colMap.m).setValue(m);
  sheet.getRange(row, colMap.n).setValue(n);
  sheet.getRange(row, colMap.p).setValue(p);

  // --- Formulas for % cols ---
  // d = C/B
  sheet.getRange(row, colMap.d).setFormulaR1C1(`=IFERROR(RC[-1]/RC[-2],0)`);
  // g = F/E
  sheet.getRange(row, colMap.g).setFormulaR1C1(`=IFERROR(RC[-1]/RC[-2],0)`);
  // j = I/H
  sheet.getRange(row, colMap.j).setFormulaR1C1(`=IFERROR(RC[-1]/RC[-2],0)`);
  // l = K/H
  sheet.getRange(row, colMap.l).setFormulaR1C1(`=IFERROR(RC[-1]/RC[-4],0)`);
  // o = N/M
  sheet.getRange(row, colMap.o).setFormulaR1C1(`=IFERROR(RC[-1]/RC[-2],0)`);
  // q = P/M
  sheet.getRange(row, colMap.q).setFormulaR1C1(`=IFERROR(RC[-1]/RC[-4],0)`);

  Logger.log(`✅ AB-Test updated for ${dateStr}`);
}

function findRowForDate_(sheet, dateStr, col) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return null; // no data rows yet
  }
  const values = sheet.getRange(2, col, lastRow - 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (values[i][0] == dateStr) return i + 2;
  }
  return null;
}

function ga4EventCountWithRequest_(propertyId, request) {
  const res = ga4RunReport_(propertyId, request);
  if (res && res.rows && res.rows.length > 0) {
    const v = res.rows[0].metricValues && res.rows[0].metricValues[0]
      ? Number(res.rows[0].metricValues[0].value)
      : 0;
    return isFinite(v) ? v : 0;
  }
  return 0;
}

// Backfill dates *uncomment — update dates and run abTestDailyUpdate function
// AB was launched on 2025-09-16
//abTestBackfill("2025-09-16", "2025-09-26");