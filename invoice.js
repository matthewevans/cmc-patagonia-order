#!/usr/bin/env node
/**
 * Stripe Invoice Generator for CMC EM Patagonia Orders
 *
 * Pricing is based on product+color combination quantities.
 * Each combo must independently meet tier thresholds (6, 18, 50, 72).
 *
 * Usage:
 *   node invoice.js                         # Fetch from Google Sheet, create drafts
 *   node invoice.js --send                  # Fetch from Google Sheet, send invoices
 *   node invoice.js --dry-run               # Fetch from Google Sheet, preview only
 *   node invoice.js --no-min                # Include items below 6-qty minimum (testing)
 *   node invoice.js orders.csv              # Use local CSV file instead
 *
 * Requires:
 *   - .env file with STRIPE_SECRET_KEY and APPS_SCRIPT_URL
 *   - pricing.json with tiered product prices
 */

const fs = require("fs");
const path = require("path");

// Load environment variables
require("dotenv").config();

// Local modules
const { parseCSV } = require("./lib/csv");
const {
  normalizeColor,
  countByProductColor,
  getTierLabel,
  buildTierMap,
  getItemPrice,
  groupByEmail,
  filterByMinimum,
  calculateTax,
  calculateStripeFee,
  formatItemDescription,
} = require("./lib/pricing");

// ─── CLI Arguments ───────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const csvFile = args.find((a) => !a.startsWith("--") && a.endsWith(".csv"));
const dryRun = args.includes("--dry-run");
const autoSend = args.includes("--send");
const ignoreMinimum = args.includes("--no-min");

// ─── Validation ──────────────────────────────────────────────────────────────

if (!process.env.STRIPE_SECRET_KEY && !dryRun) {
  console.error("Error: STRIPE_SECRET_KEY not found in environment");
  console.error("Create a .env file with your Stripe secret key (see .env.example)");
  process.exit(1);
}

if (!csvFile && !process.env.APPS_SCRIPT_URL) {
  console.error("Error: No data source specified");
  console.error("");
  console.error("Either provide a CSV file:");
  console.error("  node invoice.js orders.csv [--dry-run] [--send]");
  console.error("");
  console.error("Or set APPS_SCRIPT_URL in .env to fetch directly from Google Sheets");
  process.exit(1);
}

// ─── Config ──────────────────────────────────────────────────────────────────

const pricingPath = path.join(__dirname, "pricing.json");
if (!fs.existsSync(pricingPath)) {
  console.error("Error: pricing.json not found");
  process.exit(1);
}
const pricing = JSON.parse(fs.readFileSync(pricingPath, "utf-8"));

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const MIN_QUANTITY = 6;

// ─── Data Fetching ───────────────────────────────────────────────────────────

async function fetchFromSheet() {
  const url = process.env.APPS_SCRIPT_URL;
  console.log("Fetching orders from Google Sheet...");

  const response = await fetch(url);
  const data = await response.json();

  if (data.status === "error") {
    throw new Error(data.message);
  }

  return data.orders;
}

async function saveInvoiceIdToSheet(email, invoiceId) {
  const url = process.env.APPS_SCRIPT_URL;
  if (!url) return; // Skip if using CSV mode

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "updateInvoiceId",
        email: email,
        invoiceId: invoiceId,
      }),
    });
    const result = await response.json();
    if (result.status === "ok") {
      console.log(`  Saved invoice ID to sheet (${result.updatedRows} rows)`);
    } else {
      console.log(`  Warning: Could not save invoice ID to sheet: ${result.message}`);
    }
  } catch (err) {
    console.log(`  Warning: Could not save invoice ID to sheet: ${err.message}`);
  }
}

async function loadOrders() {
  if (csvFile) {
    const csvContent = fs.readFileSync(csvFile, "utf-8");
    const rows = parseCSV(csvContent);
    console.log(`Loaded ${rows.length} line items from CSV`);
    return rows;
  } else {
    const rows = await fetchFromSheet();
    console.log(`Fetched ${rows.length} line items from Google Sheet`);
    return rows;
  }
}

// ─── Tax Rate ────────────────────────────────────────────────────────────────

async function getOrCreateTaxRate(taxRate) {
  // Look for an existing active tax rate we created
  const existing = await stripe.taxRates.list({ active: true, limit: 100 });
  const match = existing.data.find(
    (tr) => tr.metadata?.source === "cmc-patagonia-order" && tr.percentage === taxRate * 100
  );

  if (match) {
    console.log(`Using existing Stripe tax rate: ${match.id} (${match.percentage}%)`);
    return match.id;
  }

  const created = await stripe.taxRates.create({
    display_name: "NC Sales Tax",
    percentage: taxRate * 100,
    inclusive: false,
    jurisdiction: "NC",
    metadata: { source: "cmc-patagonia-order" },
  });

  console.log(`Created Stripe tax rate: ${created.id} (${created.percentage}%)`);
  return created.id;
}

// ─── Invoice Creation ────────────────────────────────────────────────────────

async function createInvoice(customer, lineItems, taxRateId) {
  // Find or create Stripe customer
  const existingCustomers = await stripe.customers.list({ email: customer.email, limit: 1 });
  let stripeCustomer;

  if (existingCustomers.data.length > 0) {
    stripeCustomer = existingCustomers.data[0];
    console.log(`  Using existing Stripe customer: ${stripeCustomer.id}`);
  } else {
    stripeCustomer = await stripe.customers.create({
      email: customer.email,
      name: customer.name,
      phone: customer.phone,
      metadata: { source: "cmc-patagonia-order" },
    });
    console.log(`  Created Stripe customer: ${stripeCustomer.id}`);
  }

  // Create invoice
  const invoice = await stripe.invoices.create({
    customer: stripeCustomer.id,
    collection_method: "send_invoice",
    days_until_due: 14,
    metadata: { source: "cmc-patagonia-order" },
  });

  // Add line items
  for (const item of lineItems) {
    const params = {
      customer: stripeCustomer.id,
      invoice: invoice.id,
      description: item.description,
      amount: item.amount,
      currency: item.currency,
    };
    if (item.taxable) {
      params.tax_rates = [taxRateId];
    }
    await stripe.invoiceItems.create(params);
  }

  // Finalize invoice
  const finalizedInvoice = await stripe.invoices.finalizeInvoice(invoice.id);

  if (autoSend) {
    await stripe.invoices.sendInvoice(invoice.id);
    console.log(`  Invoice sent: ${finalizedInvoice.hosted_invoice_url}`);
  } else {
    console.log(`  Draft invoice created: ${finalizedInvoice.hosted_invoice_url}`);
  }

  return finalizedInvoice;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(dryRun ? "=== DRY RUN MODE ===" : "=== INVOICE GENERATION ===");
  console.log(`Mode: ${autoSend ? "Create and SEND" : "Create as DRAFTS"}`);
  console.log("");

  // Load orders
  const rows = await loadOrders();
  const customers = groupByEmail(rows);
  console.log(`Found ${customers.length} unique customers`);

  // Count by product+color and filter by minimum
  const productColorCounts = countByProductColor(rows);
  const { eligible: eligibleCombos, excluded: excludedCombos } = ignoreMinimum
    ? { eligible: productColorCounts, excluded: {} }
    : filterByMinimum(productColorCounts, MIN_QUANTITY);

  const tierMap = buildTierMap(eligibleCombos, pricing.tiers);

  console.log("");

  if (ignoreMinimum) {
    console.log("=== --no-min: Ignoring minimum quantity requirement ===");
    console.log("");
  }

  // Show excluded combos
  if (Object.keys(excludedCombos).length > 0) {
    console.log("=== EXCLUDED (below minimum of 6) ===");
    for (const key of Object.keys(excludedCombos).sort()) {
      const [product, color] = key.split("|");
      const count = excludedCombos[key];
      console.log(`  ${product} (${color}): ${count} pcs — NOT INVOICED`);
    }
    console.log("");
  }

  // Show eligible pricing
  console.log("=== PRICING BY PRODUCT + COLOR ===");
  const sortedKeys = Object.keys(eligibleCombos).sort();
  if (sortedKeys.length === 0) {
    console.log("  No product+color combos meet the minimum quantity of 6.");
    console.log("");
    return;
  }
  for (const key of sortedKeys) {
    const [product, color] = key.split("|");
    const count = eligibleCombos[key];
    const tier = tierMap[key];
    const unitPrice = pricing.products[product]?.[tier] || 0;
    console.log(`  ${product} (${color}): ${count} pcs @ $${unitPrice.toFixed(2)} [${getTierLabel(tier, pricing.tiers)}]`);
  }
  console.log(`  Embroidery fee: $${pricing.embroideryFee.toFixed(2)} per item`);
  console.log(`  Folding fee: $${pricing.foldingFee.toFixed(2)} per item`);
  console.log(`  Sales tax: ${(pricing.taxRate * 100).toFixed(2)}%`);
  console.log("");

  // Get or create Stripe tax rate
  let taxRateId = null;
  if (!dryRun) {
    taxRateId = await getOrCreateTaxRate(pricing.taxRate);
    console.log("");
  }

  // Process each customer
  let totalRevenue = 0;
  let invoiceCount = 0;

  for (const customer of customers) {
    console.log(`--- ${customer.name} (${customer.email}) ---`);

    const lineItems = [];
    let customerTotal = 0;
    let excludedCount = 0;

    for (const item of customer.items) {
      // Check eligibility
      const color = normalizeColor(item.color);
      const comboKey = `${item.product}|${color}`;
      if (!eligibleCombos[comboKey]) {
        excludedCount++;
        continue;
      }

      const result = getItemPrice(item, tierMap, pricing);
      if (result === null) continue;

      const { price } = result;
      customerTotal += price;
      lineItems.push({
        description: formatItemDescription(item),
        amount: Math.round(price * 100),
        currency: pricing.currency,
        taxable: true,
      });

      const embNote = item.embroideredName ? ` + $${pricing.embroideryFee} embroidery` : "";
      console.log(`  ${item.product} ${item.color} (${item.size}): $${price.toFixed(2)}${embNote} (incl. $${pricing.foldingFee} folding)`);
    }

    if (excludedCount > 0) {
      console.log(`  (${excludedCount} item(s) excluded — below minimum quantity)`);
    }

    // Skip if no eligible items
    if (lineItems.length === 0) {
      console.log("  No eligible items — skipping invoice");
      console.log("");
      continue;
    }

    // Tax is handled by Stripe via tax_rates on line items
    const tax = calculateTax(customerTotal, pricing.taxRate);
    console.log(`  Sales tax (${(pricing.taxRate * 100).toFixed(2)}%): $${tax.toFixed(2)} (applied by Stripe)`);

    // Add Stripe processing fee (on subtotal + tax)
    const stripeFee = calculateStripeFee(customerTotal + tax);
    const orderTotal = customerTotal + tax + stripeFee;

    lineItems.push({
      description: "Payment processing fee (2.9% + $0.30)",
      amount: Math.round(stripeFee * 100),
      currency: pricing.currency,
      taxable: false,
    });

    console.log(`  Processing fee (2.9% + $0.30): $${stripeFee.toFixed(2)}`);
    console.log(`  TOTAL: $${orderTotal.toFixed(2)}`);
    totalRevenue += orderTotal;

    if (dryRun) {
      console.log("  [DRY RUN] Would create invoice");
      invoiceCount++;
      console.log("");
      continue;
    }

    try {
      const invoice = await createInvoice(customer, lineItems, taxRateId);
      invoiceCount++;

      // Save invoice ID back to the Google Sheet
      await saveInvoiceIdToSheet(customer.email, invoice.id);
    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
    }

    console.log("");
  }

  // Summary
  console.log("=== SUMMARY ===");
  console.log(`Product+color combos: ${Object.keys(eligibleCombos).length} eligible, ${Object.keys(excludedCombos).length} excluded`);
  console.log(`Total items: ${rows.length}`);
  console.log(`Invoices ${dryRun ? "to create" : "created"}: ${invoiceCount}`);
  console.log(`Total revenue: $${totalRevenue.toFixed(2)}`);

  if (!dryRun && !autoSend) {
    console.log("");
    console.log("Invoices created as drafts. Review them in the Stripe dashboard,");
    console.log("then send manually or re-run with --send to auto-send.");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
