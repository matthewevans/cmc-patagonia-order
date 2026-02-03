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

/**
 * GET endpoint — returns all orders as JSON for the invoice script.
 * Usage: fetch(APPS_SCRIPT_URL) returns { orders: [...] }
 */
function doGet(e) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
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
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

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
  } catch (err) {
    return ContentService.createTextOutput(
      JSON.stringify({ status: "error", message: err.toString() })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}
