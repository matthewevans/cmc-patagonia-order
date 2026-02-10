/**
 * Google Apps Script — deploy as a Web App to receive form submissions.
 *
 * Setup:
 * 1. Create a new Google Sheet
 * 2. Go to Extensions > Apps Script
 * 3. Paste this entire file into Code.gs (replace any existing code)
 * 4. Click Deploy > New Deployment
 * 5. Select "Web app"
 * 6. Set "Execute as" = Me, "Who has access" = Anyone
 * 7. Copy the deployment URL and paste it into index.html (APPS_SCRIPT_URL)
 */

// ─── PRICING CONFIG ───────────────────────────────────────────────────────────
// Matches pricing.json — update here if prices change
const PRICING = {
  "Better Sweater Jacket": { 6: 175.00, 18: 173.58, 50: 162.68, 72: 159.68 },
  "Better Sweater Vest": { 6: 132.88, 18: 131.28, 50: 123.58, 72: 119.88 },
  "Better Sweater Quarter Zip": { 6: 155.00, 18: 152.00, 50: 142.68, 72: 139.58 },
};
const EMBROIDERY_FEE = 8.00;
const LOGO_FEE = 10.00;
const TAX_RATE = 0.0725;

// Colors that count as "Gray" for grouping purposes
const GRAY_COLORS = ["Birch White", "Stonewash"];

// ──────────────────────────────────────────────────────────────────────────────

/**
 * Normalizes color for grouping: Birch White and Stonewash → "Gray"
 */
function normalizeColor(color) {
  if (GRAY_COLORS.indexOf(color) !== -1) {
    return "Gray";
  }
  return color;
}

/**
 * Get the price tier based on total quantity of a product
 */
function getPriceTier(qty) {
  if (qty >= 72) return 72;
  if (qty >= 50) return 50;
  if (qty >= 18) return 18;
  return 6;
}

/**
 * Creates or updates the Summary tab with item counts, pricing, and totals.
 * Pricing tier is determined per product+color combination.
 * Can be run manually from the Apps Script editor or via custom menu.
 */
function updateSummary() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ordersSheet = ss.getSheetByName("Orders") || ss.getSheets()[0];

  // Get or create Summary sheet
  let summarySheet = ss.getSheetByName("Summary");
  if (!summarySheet) {
    summarySheet = ss.insertSheet("Summary");
  } else {
    summarySheet.clear();
    summarySheet.clearFormats();
  }

  // Read order data
  const data = ordersSheet.getDataRange().getValues();
  if (data.length <= 1) {
    summarySheet.getRange("A1").setValue("No orders yet.");
    return;
  }

  const headers = data[0];
  const productIdx = headers.indexOf("Product");
  const colorIdx = headers.indexOf("Color");
  const embroideredNameIdx = headers.indexOf("Embroidered Name");

  // Count items by product+color (this is the key unit for pricing tiers)
  const productColorData = {}; // { "Better Sweater Jacket|Black": { count: 5, embroideryCount: 2 } }

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var product = row[productIdx];
    var color = normalizeColor(row[colorIdx]);
    var embName = row[embroideredNameIdx];

    if (!product) continue;

    var key = product + "|" + color;
    if (!productColorData[key]) {
      productColorData[key] = { product: product, color: color, count: 0, embroideryCount: 0 };
    }
    productColorData[key].count++;
    if (embName && embName.toString().trim()) {
      productColorData[key].embroideryCount++;
    }
  }

  // Calculate totals
  var grandTotalItems = 0;
  var grandTotalCost = 0;
  var grandTotalEmbroidery = 0;
  var grandTotalLogoFees = 0;
  var hasUnfulfilled = false;

  // Process each product+color combo
  var comboKeys = Object.keys(productColorData).sort();
  var comboRows = [];

  for (var k = 0; k < comboKeys.length; k++) {
    var combo = productColorData[comboKeys[k]];
    var tier = getPriceTier(combo.count);
    var unitPrice = PRICING[combo.product] ? PRICING[combo.product][tier] : 0;
    var subtotal = combo.count * unitPrice;
    var logoFees = combo.count * LOGO_FEE;
    var embFees = combo.embroideryCount * EMBROIDERY_FEE;

    var status = "";
    if (combo.count < 6) {
      status = "⚠️ NOT FULFILLED";
      hasUnfulfilled = true;
    } else {
      status = "✓ OK";
      grandTotalItems += combo.count;
      grandTotalCost += subtotal;
      grandTotalLogoFees += logoFees;
      grandTotalEmbroidery += embFees;
    }

    comboRows.push({
      product: combo.product,
      color: combo.color,
      count: combo.count,
      tier: tier,
      unitPrice: unitPrice,
      subtotal: subtotal,
      embroideryCount: combo.embroideryCount,
      embFees: embFees,
      status: status
    });
  }

  // Build summary output
  var output = [];
  var rowTracker = {}; // Track special rows for formatting

  // Header section
  output.push(["ORDER SUMMARY", "", "", "", "", "", ""]);
  rowTracker.title = output.length;

  output.push(["", "", "", "", "", "", ""]);

  // Main breakdown table
  output.push(["PRODUCT + COLOR BREAKDOWN (Tier is per combo)", "", "", "", "", "", ""]);
  rowTracker.tableTitle = output.length;

  output.push(["Product", "Color", "Qty", "Tier", "Unit Price", "Subtotal", "Status"]);
  rowTracker.tableHeader = output.length;

  var currentProduct = "";
  for (var j = 0; j < comboRows.length; j++) {
    var cr = comboRows[j];

    // Add blank row between products for readability
    if (cr.product !== currentProduct && currentProduct !== "") {
      output.push(["", "", "", "", "", "", ""]);
    }
    currentProduct = cr.product;

    output.push([
      cr.product,
      cr.color,
      String(cr.count),
      cr.count < 6 ? "N/A" : cr.tier + "+",
      cr.count < 6 ? "-" : "$" + cr.unitPrice.toFixed(2),
      cr.count < 6 ? "-" : "$" + cr.subtotal.toFixed(2),
      cr.status
    ]);
  }

  output.push(["", "", "", "", "", "", ""]);

  // Totals (only for fulfilled items)
  output.push(["TOTALS (fulfilled items only)", "", "", "", "", "", ""]);
  rowTracker.totalsTitle = output.length;

  var subtotal = grandTotalCost + grandTotalLogoFees + grandTotalEmbroidery;
  var taxAmount = subtotal * TAX_RATE;

  output.push(["Total Items:", String(grandTotalItems), "", "Product Cost:", "$" + grandTotalCost.toFixed(2), "", ""]);
  output.push(["", "", "", "Logo Embroidery:", "$" + grandTotalLogoFees.toFixed(2), "", ""]);
  output.push(["", "", "", "Name Embroidery:", "$" + grandTotalEmbroidery.toFixed(2), "", ""]);
  output.push(["", "", "", "Sales Tax (" + (TAX_RATE * 100).toFixed(2) + "%):", "$" + taxAmount.toFixed(2), "", ""]);
  output.push(["", "", "", "GRAND TOTAL:", "$" + (subtotal + taxAmount).toFixed(2), "", ""]);
  rowTracker.grandTotal = output.length;

  // Warning if any unfulfilled
  if (hasUnfulfilled) {
    output.push(["", "", "", "", "", "", ""]);
    output.push(["⚠️ WARNING: Combos marked 'NOT FULFILLED' are below the 6-item minimum and will not be ordered.", "", "", "", "", "", ""]);
    rowTracker.warning = output.length;
  }

  // Write to sheet
  summarySheet.getRange(1, 1, output.length, 7).setValues(output);

  // Apply formatting
  summarySheet.getRange(rowTracker.title, 1).setFontWeight("bold").setFontSize(14);
  summarySheet.getRange(rowTracker.tableTitle, 1).setFontWeight("bold").setFontSize(11);
  summarySheet.getRange(rowTracker.tableHeader, 1, 1, 7).setFontWeight("bold").setBackground("#e8e2da");
  summarySheet.getRange(rowTracker.totalsTitle, 1).setFontWeight("bold").setFontSize(11);
  summarySheet.getRange(rowTracker.grandTotal, 4, 1, 2).setFontWeight("bold").setBackground("#d4f5d4");

  if (rowTracker.warning) {
    summarySheet.getRange(rowTracker.warning, 1).setFontWeight("bold").setFontColor("#b5403a");
  }

  // Auto-resize columns
  summarySheet.autoResizeColumns(1, 7);

  SpreadsheetApp.getActiveSpreadsheet().toast("Summary updated!", "Success");
}

/**
 * Adds a custom menu to easily refresh the summary
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Order Tools")
    .addItem("Update Summary", "updateSummary")
    .addSeparator()
    .addItem("Set Stripe API Key", "setStripeApiKey")
    .addItem("Sync Payments from Stripe", "syncStripePayments")
    .addToUi();
}

// ─── STRIPE PAYMENT SYNC ─────────────────────────────────────────────────────

/**
 * Prompts for and saves the Stripe API key in Script Properties.
 * Run this once before using payment sync.
 */
function setStripeApiKey() {
  var ui = SpreadsheetApp.getUi();
  var result = ui.prompt(
    "Stripe API Key",
    "Enter your Stripe Secret Key (sk_live_... or sk_test_...):",
    ui.ButtonSet.OK_CANCEL
  );

  if (result.getSelectedButton() === ui.Button.OK) {
    var key = result.getResponseText().trim();
    if (key.indexOf("sk_") !== 0) {
      ui.alert("Invalid key format. Should start with sk_live_ or sk_test_");
      return;
    }
    PropertiesService.getScriptProperties().setProperty("STRIPE_API_KEY", key);
    ui.alert("API key saved securely!");
  }
}

/**
 * Syncs payment status from Stripe invoices.
 * Matches by Invoice ID column if present, otherwise by email.
 * Adds "Invoice ID" and "Paid" columns if they don't exist.
 */
function syncStripePayments() {
  var props = PropertiesService.getScriptProperties();
  var stripeKey = props.getProperty("STRIPE_API_KEY");

  if (!stripeKey) {
    SpreadsheetApp.getUi().alert(
      "No Stripe API key found.\n\nGo to Order Tools → Set Stripe API Key first."
    );
    return;
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Orders") || ss.getSheets()[0];
  var data = sheet.getDataRange().getValues();
  var headers = data[0];

  // Find required columns
  var emailIdx = headers.indexOf("Email");
  if (emailIdx === -1) {
    SpreadsheetApp.getUi().alert("Email column not found!");
    return;
  }

  // Find or create Invoice ID column
  var invoiceIdIdx = headers.indexOf("Invoice ID");
  if (invoiceIdIdx === -1) {
    invoiceIdIdx = headers.length;
    sheet.getRange(1, invoiceIdIdx + 1).setValue("Invoice ID");
    headers.push("Invoice ID");
  }

  // Find or create Paid column
  var paidIdx = headers.indexOf("Paid");
  if (paidIdx === -1) {
    paidIdx = headers.length;
    sheet.getRange(1, paidIdx + 1).setValue("Paid");
    headers.push("Paid");
  }

  // Fetch all paid invoices from Stripe
  var paidInvoices = fetchPaidInvoices(stripeKey);

  // Build lookup maps
  var paidByInvoiceId = {}; // { "in_xxx": true }
  var paidByEmail = {}; // { "email@example.com": "in_xxx" }

  for (var i = 0; i < paidInvoices.length; i++) {
    var inv = paidInvoices[i];
    paidByInvoiceId[inv.id] = true;
    if (inv.customer_email) {
      paidByEmail[inv.customer_email.toLowerCase()] = inv.id;
    }
  }

  // Update rows
  var updatedCount = 0;
  var matchedByIdCount = 0;
  var matchedByEmailCount = 0;

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var invoiceId = row[invoiceIdIdx] ? row[invoiceIdIdx].toString().trim() : "";
    var email = row[emailIdx] ? row[emailIdx].toString().trim().toLowerCase() : "";
    var currentPaidStatus = row[paidIdx] ? row[paidIdx].toString().trim() : "";

    // Skip if already marked paid
    if (currentPaidStatus === "✓") {
      continue;
    }

    var isPaid = false;
    var matchedInvoiceId = "";

    // First try to match by Invoice ID if present
    if (invoiceId && paidByInvoiceId[invoiceId]) {
      isPaid = true;
      matchedInvoiceId = invoiceId;
      matchedByIdCount++;
    }
    // Fall back to email matching
    else if (email && paidByEmail[email]) {
      isPaid = true;
      matchedInvoiceId = paidByEmail[email];
      matchedByEmailCount++;
    }

    if (isPaid) {
      // Update Invoice ID if it was matched by email and column is empty
      if (!invoiceId && matchedInvoiceId) {
        sheet.getRange(r + 1, invoiceIdIdx + 1).setValue(matchedInvoiceId);
      }
      // Mark as paid
      sheet.getRange(r + 1, paidIdx + 1).setValue("✓");
      updatedCount++;
    }
  }

  var message =
    "Sync complete!\n\n" +
    "• " + paidInvoices.length + " paid invoices found in Stripe\n" +
    "• " + updatedCount + " rows marked as paid\n" +
    "  - " + matchedByIdCount + " matched by Invoice ID\n" +
    "  - " + matchedByEmailCount + " matched by email";

  SpreadsheetApp.getUi().alert(message);
}

/**
 * Fetches all paid invoices from Stripe, handling pagination.
 * Returns array of invoice objects with id and customer_email.
 */
function fetchPaidInvoices(apiKey) {
  var invoices = [];
  var hasMore = true;
  var startingAfter = null;

  while (hasMore) {
    var url = "https://api.stripe.com/v1/invoices?status=paid&limit=100";
    if (startingAfter) {
      url += "&starting_after=" + startingAfter;
    }

    var response = UrlFetchApp.fetch(url, {
      headers: { Authorization: "Bearer " + apiKey },
      muteHttpExceptions: true,
    });

    var statusCode = response.getResponseCode();
    if (statusCode !== 200) {
      var errorBody = response.getContentText();
      throw new Error("Stripe API error (" + statusCode + "): " + errorBody);
    }

    var result = JSON.parse(response.getContentText());

    for (var i = 0; i < result.data.length; i++) {
      var inv = result.data[i];
      invoices.push({
        id: inv.id,
        customer_email: inv.customer_email,
      });
    }

    hasMore = result.has_more;
    if (result.data.length > 0) {
      startingAfter = result.data[result.data.length - 1].id;
    }
  }

  return invoices;
}

// ─── AUTO-UPDATE ON CHANGE ───────────────────────────────────────────────────

const DEBOUNCE_MS = 5000; // 5 second cooldown between auto-updates

/**
 * onChange trigger handler — updates summary when rows are added/removed.
 * Debounced to avoid excessive updates during rapid changes.
 */
function onSheetChange(e) {
  // Only react to row changes (not formatting, etc.)
  if (e.changeType !== 'INSERT_ROW' && e.changeType !== 'REMOVE_ROW') {
    return;
  }

  // Debounce: skip if we updated recently
  const props = PropertiesService.getScriptProperties();
  const lastRun = parseInt(props.getProperty('lastSummaryUpdate') || '0', 10);
  const now = Date.now();

  if (now - lastRun < DEBOUNCE_MS) {
    return; // Too soon, skip this update
  }

  // Record this run and update
  props.setProperty('lastSummaryUpdate', String(now));
  updateSummary();
}

/**
 * Run this ONCE to install the onChange trigger.
 * Go to Apps Script editor > Run > setupChangeTrigger
 */
function setupChangeTrigger() {
  // Remove any existing onChange triggers to avoid duplicates
  const triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'onSheetChange') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  // Create the new trigger
  ScriptApp.newTrigger('onSheetChange')
    .forSpreadsheet(SpreadsheetApp.getActive())
    .onChange()
    .create();

  SpreadsheetApp.getActiveSpreadsheet().toast('Auto-update trigger installed!', 'Success');
}

/**
 * GET endpoint — returns all orders as JSON for the invoice script.
 * Usage: fetch(APPS_SCRIPT_URL) returns { orders: [...] }
 */
function doGet(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Orders") || ss.getSheets()[0];
    const data = sheet.getDataRange().getValues();

    if (data.length <= 1) {
      return ContentService.createTextOutput(
        JSON.stringify({ orders: [] })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    const headers = data[0];
    const orders = data.slice(1).map(function(row) {
      const order = {};
      headers.forEach(function(header, i) {
        order[header] = row[i];
      });
      return order;
    });

    return ContentService.createTextOutput(
      JSON.stringify({ orders: orders })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(
      JSON.stringify({ status: "error", message: err.toString() })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // Route based on action type
    if (data.action === "updateInvoiceId") {
      return handleInvoiceIdUpdate(ss, data);
    }

    // Default: handle order submission
    return handleOrderSubmission(ss, data);
  } catch (err) {
    return ContentService.createTextOutput(
      JSON.stringify({ status: "error", message: err.toString() })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Handles updating Invoice ID for rows matching an email address.
 * POST body: { action: "updateInvoiceId", email: "...", invoiceId: "in_xxx" }
 */
function handleInvoiceIdUpdate(ss, data) {
  const sheet = ss.getSheetByName("Orders") || ss.getSheets()[0];
  const allData = sheet.getDataRange().getValues();
  const headers = allData[0];

  const emailIdx = headers.indexOf("Email");
  if (emailIdx === -1) {
    return ContentService.createTextOutput(
      JSON.stringify({ status: "error", message: "Email column not found" })
    ).setMimeType(ContentService.MimeType.JSON);
  }

  // Find or create Invoice ID column
  var invoiceIdIdx = headers.indexOf("Invoice ID");
  if (invoiceIdIdx === -1) {
    invoiceIdIdx = headers.length;
    sheet.getRange(1, invoiceIdIdx + 1).setValue("Invoice ID");
  }

  // Update all rows matching the email
  var updatedCount = 0;
  var targetEmail = data.email.toLowerCase().trim();

  for (var i = 1; i < allData.length; i++) {
    var rowEmail = allData[i][emailIdx];
    if (rowEmail && rowEmail.toString().toLowerCase().trim() === targetEmail) {
      sheet.getRange(i + 1, invoiceIdIdx + 1).setValue(data.invoiceId);
      updatedCount++;
    }
  }

  return ContentService.createTextOutput(
    JSON.stringify({ status: "ok", updatedRows: updatedCount })
  ).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Handles new order submissions from the order form.
 * POST body: { name, phone, email, position, items: [...] }
 */
function handleOrderSubmission(ss, data) {
  // Get or create Orders sheet
  let sheet = ss.getSheetByName("Orders");
  if (!sheet) {
    // Rename first sheet to "Orders" if it exists, otherwise create it
    sheet = ss.getSheets()[0];
    if (sheet) {
      sheet.setName("Orders");
    } else {
      sheet = ss.insertSheet("Orders");
    }
  }

  // Write header row if sheet is empty
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      "Timestamp",
      "Name",
      "Phone",
      "Email",
      "Position",
      "Product",
      "Style",
      "Size",
      "Color",
      "Logo",
      "Embroidered Name",
      "Thread Color",
    ]);
  }

  const timestamp = new Date().toISOString();

  // One row per line item, person info repeated
  data.items.forEach(function (item) {
    sheet.appendRow([
      timestamp,
      data.name,
      data.phone,
      data.email,
      data.position,
      item.product,
      item.style,
      item.size,
      item.color,
      item.logo,
      item.embroideredName || "",
      item.threadColor || "",
    ]);
  });

  return ContentService.createTextOutput(
    JSON.stringify({ status: "ok" })
  ).setMimeType(ContentService.MimeType.JSON);
}
