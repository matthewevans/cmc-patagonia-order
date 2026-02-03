#!/usr/bin/env node
/**
 * Stripe Invoice Generator for CMC EM Patagonia Orders
 *
 * Pricing is based on TOTAL order volume across all customers.
 * The script calculates the tier first, then applies that pricing to all invoices.
 *
 * Usage:
 *   node invoice.js                         # Fetch from Google Sheet, create drafts
 *   node invoice.js --send                  # Fetch from Google Sheet, send invoices
 *   node invoice.js --dry-run               # Fetch from Google Sheet, preview only
 *   node invoice.js orders.csv              # Use local CSV file instead
 *
 * Requires:
 *   - .env file with STRIPE_SECRET_KEY and APPS_SCRIPT_URL
 *   - pricing.json with tiered product prices
 */

const fs = require("fs");
const path = require("path");

// Load environment variables from .env
require("dotenv").config();

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// Parse CLI arguments
const args = process.argv.slice(2);
const csvFile = args.find((a) => !a.startsWith("--") && a.endsWith(".csv"));
const dryRun = args.includes("--dry-run");
const autoSend = args.includes("--send");

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

// Load pricing config
const pricingPath = path.join(__dirname, "pricing.json");
if (!fs.existsSync(pricingPath)) {
  console.error("Error: pricing.json not found");
  process.exit(1);
}
const pricing = JSON.parse(fs.readFileSync(pricingPath, "utf-8"));

// Parse CSV (simple parser for Google Sheets export)
function parseCSV(content) {
  const lines = content.trim().split("\n");
  const headers = parseCSVLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCSVLine(line);
    const row = {};
    headers.forEach((h, i) => (row[h.trim()] = values[i]?.trim() || ""));
    return row;
  });
}

function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

// Fetch orders from Google Apps Script
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

// Group orders by email
function groupByEmail(rows) {
  const grouped = {};
  for (const row of rows) {
    const email = row.Email?.toLowerCase();
    if (!email) continue;
    if (!grouped[email]) {
      grouped[email] = {
        name: row.Name,
        phone: row.Phone,
        email: email,
        items: [],
      };
    }
    grouped[email].items.push({
      product: row.Product,
      style: row.Style,
      size: row.Size,
      color: row.Color,
      logo: row.Logo,
      embroideredName: row["Embroidered Name"] || "",
      threadColor: row["Thread Color"] || "",
    });
  }
  return Object.values(grouped);
}

// Determine pricing tier based on total quantity
function getPricingTier(totalItems) {
  for (const tier of pricing.tiers) {
    if (totalItems >= tier.minQty) {
      return tier.minQty.toString();
    }
  }
  // Default to lowest tier if under minimum
  return pricing.tiers[pricing.tiers.length - 1].minQty.toString();
}

function getTierLabel(tierKey) {
  const tier = pricing.tiers.find((t) => t.minQty.toString() === tierKey);
  return tier ? tier.label : tierKey;
}

// Calculate line item price using the determined tier
function getItemPrice(item, tierKey) {
  const productPricing = pricing.products[item.product];
  if (!productPricing) {
    console.warn(`Warning: Unknown product "${item.product}", skipping`);
    return null;
  }
  const basePrice = productPricing[tierKey];
  const embroideryFee = item.embroideredName ? pricing.embroideryFee : 0;
  return basePrice + embroideryFee;
}

// Format item description
function getItemDescription(item) {
  let desc = `${item.product} - ${item.style} ${item.size} (${item.color})`;
  desc += `\nLogo: ${item.logo}`;
  if (item.embroideredName) {
    desc += `\nEmbroidered: "${item.embroideredName}" (${item.threadColor} thread)`;
  }
  return desc;
}

// Main invoice generation
async function main() {
  console.log(dryRun ? "=== DRY RUN MODE ===" : "=== INVOICE GENERATION ===");
  console.log(`Mode: ${autoSend ? "Create and SEND" : "Create as DRAFTS"}`);
  console.log("");

  // Get orders from CSV or Google Sheet
  let rows;
  if (csvFile) {
    const csvContent = fs.readFileSync(csvFile, "utf-8");
    rows = parseCSV(csvContent);
    console.log(`Loaded ${rows.length} line items from CSV`);
  } else {
    rows = await fetchFromSheet();
    console.log(`Fetched ${rows.length} line items from Google Sheet`);
  }

  // Group by customer
  const customers = groupByEmail(rows);
  console.log(`Found ${customers.length} unique customers`);

  // Count total items to determine pricing tier
  const totalItems = rows.length;
  const tierKey = getPricingTier(totalItems);
  console.log("");
  console.log(`=== PRICING TIER: ${getTierLabel(tierKey)} (${totalItems} total items) ===`);
  console.log("Per-item pricing at this tier:");
  for (const [product, tiers] of Object.entries(pricing.products)) {
    console.log(`  ${product}: $${tiers[tierKey].toFixed(2)}`);
  }
  console.log(`  Embroidery fee: $${pricing.embroideryFee.toFixed(2)} per item`);
  console.log("");

  // Process each customer
  let totalRevenue = 0;
  let invoiceCount = 0;

  for (const customer of customers) {
    console.log(`--- ${customer.name} (${customer.email}) ---`);

    // Calculate items and total
    const lineItems = [];
    let customerTotal = 0;

    for (const item of customer.items) {
      const price = getItemPrice(item, tierKey);
      if (price === null) continue;

      customerTotal += price;
      lineItems.push({
        description: getItemDescription(item),
        amount: Math.round(price * 100), // Stripe uses cents
        currency: pricing.currency,
        quantity: 1,
      });

      const embNote = item.embroideredName ? ` + $${pricing.embroideryFee} embroidery` : "";
      console.log(`  ${item.product} (${item.size}): $${price.toFixed(2)}${embNote}`);
    }

    console.log(`  TOTAL: $${customerTotal.toFixed(2)}`);
    totalRevenue += customerTotal;

    if (dryRun) {
      console.log("  [DRY RUN] Would create invoice");
      invoiceCount++;
      console.log("");
      continue;
    }

    try {
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
        await stripe.invoiceItems.create({
          customer: stripeCustomer.id,
          invoice: invoice.id,
          description: item.description,
          amount: item.amount,
          currency: item.currency,
        });
      }

      // Finalize invoice
      const finalizedInvoice = await stripe.invoices.finalizeInvoice(invoice.id);

      if (autoSend) {
        await stripe.invoices.sendInvoice(invoice.id);
        console.log(`  Invoice sent: ${finalizedInvoice.hosted_invoice_url}`);
      } else {
        console.log(`  Draft invoice created: ${finalizedInvoice.hosted_invoice_url}`);
      }

      invoiceCount++;
    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
    }

    console.log("");
  }

  // Summary
  console.log("=== SUMMARY ===");
  console.log(`Pricing tier: ${getTierLabel(tierKey)}`);
  console.log(`Total items: ${totalItems}`);
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
