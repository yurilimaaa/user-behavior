const ABTEST_SUMMARY_SHEET = 'AB-Test-SI-RQ-Summary';
const SUMMARY_START_DATE = '2025-09-26';

/**
 * Daily update entry point
 */
function abTestSiRqSummaryDailyUpdate() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const summarySheet = ss.getSheetByName(ABTEST_SUMMARY_SHEET);
  if (!summarySheet) throw new Error(`Sheet ${ABTEST_SUMMARY_SHEET} not found.`);

  // Totals for rows 2–5, columns B (Users), C (Start), D (Submit), E (Purchase)
  // Each row: [Users, Start, Submit, Purchase]
  const totals = [
    [0, 0, 0, 0], // row 2
    [0, 0, 0, 0], // row 3
    [0, 0, 0, 0], // row 4
    [0, 0, 0, 0], // row 5
  ];

  // Row 2: Send Inquiry, p2=false
  // Row 3: Request a Quote, p2=false
  // Row 4: Send Inquiry, p2=true
  // Row 5: Request a Quote, p2=true
  const abByRow = [
    'trip-cart-cta:send-inquiry',     // row 2
    'trip-cart-cta:request-a-quote',  // row 3
    'trip-cart-cta:send-inquiry',     // row 4
    'trip-cart-cta:request-a-quote',  // row 5
  ];
  const p2ByRow = [false, false, true, true];

  // Date range
  const today = new Date();
  today.setUTCHours(0,0,0,0);
  const yesterday = new Date(today.getTime() - 24*60*60*1000);
  const startDate = parseUTC_(SUMMARY_START_DATE);

  for (let d = new Date(startDate); d <= yesterday; d.setUTCDate(d.getUTCDate()+1)) {
    const dateStr = toYYYYMMDD_(d);

    for (let i = 0; i < 4; i++) {
      // Users (B)
      const usersResp = safeGa4CountEventWithParamTrue_(
        GA4_PROPERTY_ID,
        'trip-cart_price-calculated',
        dateStr,
        dateStr,
        abByRow[i],
        p2ByRow[i]
      );
      const users = (usersResp && usersResp.rows && usersResp.rows.length > 0)
        ? Number(usersResp.rows[0].metricValues[0].value) || 0
        : 0;
      totals[i][0] += users;

      // Start (C) - inquiry_start with proper p1 filter
      const startP1 = (i < 2) ? 'send-inquiry-button' : 'contact-owner-button';
      const start = safeGa4CountEventWithParamEventCount_(
        GA4_PROPERTY_ID,
        'inquiry_start',
        dateStr,
        dateStr,
        abByRow[i],
        p2ByRow[i],
        startP1
      );
      totals[i][1] += start;

      // Submit (D) - inquiry_submit_success with ab_bucket only
      const submit = safeGa4CountEventWithParamEventCountGeneric_(
        GA4_PROPERTY_ID,
        'inquiry_submit_success',
        dateStr,
        dateStr,
        abByRow[i]
      );
      totals[i][2] += submit;

      // Purchase (E) - purchase with ab_bucket only
      const purchase = safeGa4CountEventWithParamEventCountGeneric_(
        GA4_PROPERTY_ID,
        'purchase',
        dateStr,
        dateStr,
        abByRow[i]
      );
      totals[i][3] += purchase;
    }
  }

  // Logging for each row and column
  for (let i = 0; i < 4; i++) {
    Logger.log(
      `Row ${i+2}: Users (B${i+2}) = ${totals[i][0]}, Start (C${i+2}) = ${totals[i][1]}, Submit (D${i+2}) = ${totals[i][2]}, Purchase (E${i+2}) = ${totals[i][3]}`
    );
  }

  // Write B2:E5 (columns B–E, rows 2–5)
  summarySheet.getRange(2, 2, 4, 4).setValues(totals);

  // Last updated
  summarySheet.getRange('A8').setValue(new Date());
  Logger.log(`✅ Summary updated through ${toYYYYMMDD_(yesterday)}`);
}


/**
 * Wrapper to safely count events with ab_bucket and p2 filters, returning activeUsers metric.
 */
function safeGa4CountEventWithParamTrue_(propertyId, eventName, startDate, endDate, ab_bucket, p2) {
  try {
    // Build a single AND group filter compatible with GA4 Data API
    const expressions = [
      { filter: { fieldName: "eventName", stringFilter: { matchType: "EXACT", value: eventName } } },
      { filter: { fieldName: "customEvent:ab_bucket", stringFilter: { matchType: "EXACT", value: ab_bucket } } }
    ];
    // Only `trip-cart_price-calculated` carries `p2`; do NOT filter by p2 on other events
    if (eventName === 'trip-cart_price-calculated') {
      expressions.push({ filter: { fieldName: 'customEvent:p2', stringFilter: { matchType: 'EXACT', value: String(p2) } } });
    }

    const request = {
      dateRanges: [{ startDate: startDate, endDate: endDate }],
      metrics: [{ name: "activeUsers" }],
      // No dimensions needed; we only want the aggregate activeUsers for the filtered slice
      dimensionFilter: { andGroup: { expressions } },
      keepEmptyRows: false
    };

    //Logger.log(`▶️ GA4 runReport request: ${JSON.stringify(request)}`);
    const response = AnalyticsData.Properties.runReport(request, `properties/${propertyId}`);
    //Logger.log(`✅ GA4 runReport response: ${JSON.stringify(response)}`);
    return response;
  } catch (err) {
    Logger.log(`❌ Error in safeGa4CountEventWithParamTrue_: ${err}`);
    return null;
  }
}

/**
 * Helper to get event count for Start (trip-cart_price-calculated) with ab_bucket and p2 filters.
 * Accepts optional p1 filter.
 */
function safeGa4CountEventWithParamEventCount_(propertyId, eventName, startDate, endDate, ab_bucket, p2, p1) {
  try {
    // Build a single AND group filter compatible with GA4 Data API
    const expressions = [
      { filter: { fieldName: "eventName", stringFilter: { matchType: "EXACT", value: eventName } } },
      { filter: { fieldName: "customEvent:ab_bucket", stringFilter: { matchType: "EXACT", value: ab_bucket } } }
    ];
    // Only trip-cart_price-calculated carries p2; do not filter p2 for other events
    if (eventName === "trip-cart_price-calculated") {
      expressions.push({ filter: { fieldName: "customEvent:p2", stringFilter: { matchType: "EXACT", value: String(p2) } } });
    }
    // If p1 is provided, add filter
    if (p1 !== undefined && p1 !== null) {
      expressions.push({ filter: { fieldName: "customEvent:p1", stringFilter: { matchType: "EXACT", value: p1 } } });
    }

    const request = {
      dateRanges: [{ startDate: startDate, endDate: endDate }],
      metrics: [{ name: "eventCount" }],
      // No dimensions needed; we only want the aggregate eventCount for the filtered slice
      dimensionFilter: { andGroup: { expressions } },
      keepEmptyRows: false
    };

    //Logger.log(`▶️ GA4 runReport request (eventCount): ${JSON.stringify(request)}`);
    const response = AnalyticsData.Properties.runReport(request, `properties/${propertyId}`);
    //Logger.log(`✅ GA4 runReport response (eventCount): ${JSON.stringify(response)}`);
    if (response && response.rows && response.rows.length > 0) {
      return Number(response.rows[0].metricValues[0].value) || 0;
    }
    return 0;
  } catch (err) {
    Logger.log(`❌ Error in safeGa4CountEventWithParamEventCount_: ${err}`);
    return 0;
  }
}

/**
 * Helper to get event count for events inquiry_submit_success and purchase with ab_bucket filter only (no p2).
 */
function safeGa4CountEventWithParamEventCountGeneric_(propertyId, eventName, startDate, endDate, ab_bucket) {
  try {
    // Build a single AND group filter compatible with GA4 Data API
    const expressions = [
      { filter: { fieldName: "eventName", stringFilter: { matchType: "EXACT", value: eventName } } },
      { filter: { fieldName: "customEvent:ab_bucket", stringFilter: { matchType: "EXACT", value: ab_bucket } } }
    ];

    const request = {
      dateRanges: [{ startDate: startDate, endDate: endDate }],
      metrics: [{ name: "eventCount" }],
      // No dimensions needed; we only want the aggregate eventCount for the filtered slice
      dimensionFilter: { andGroup: { expressions } },
      keepEmptyRows: false
    };

    //Logger.log(`▶️ GA4 runReport request (eventCount generic): ${JSON.stringify(request)}`);
    const response = AnalyticsData.Properties.runReport(request, `properties/${propertyId}`); 
    //Logger.log(`✅ GA4 runReport response (eventCount generic): ${JSON.stringify(response)}`);
    if (response && response.rows && response.rows.length > 0) {
      return Number(response.rows[0].metricValues[0].value) || 0;
    }
    return 0;
  } catch (err) {
    Logger.log(`❌ Error in safeGa4CountEventWithParamEventCountGeneric_: ${err}`);
    return 0;
  }
}