/**
 * Pricing and order aggregation logic for CMC Patagonia orders
 */

// Colors that normalize to "Gray" for pricing purposes
const GRAY_COLORS = ["Birch White", "Stonewash"];

/**
 * Normalizes color names - combines gray variants
 * @param {string} color - Original color name
 * @returns {string} Normalized color
 */
function normalizeColor(color) {
  if (GRAY_COLORS.includes(color)) return "Gray";
  return color;
}

/**
 * Counts items grouped by product+color combination
 * @param {Array<{Product: string, Color: string}>} rows - Order rows
 * @returns {Object<string, number>} Counts keyed by "Product|Color"
 */
function countByProductColor(rows) {
  const counts = {};
  for (const row of rows) {
    const product = row.Product;
    const color = normalizeColor(row.Color);
    if (!product) continue;
    const key = `${product}|${color}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

/**
 * Determines pricing tier based on quantity
 * @param {number} qty - Item count
 * @param {Array<{minQty: number}>} tiers - Tier definitions (sorted descending by minQty)
 * @returns {string} Tier key (e.g., "72", "50", "18", "6")
 */
function getPricingTier(qty, tiers) {
  for (const tier of tiers) {
    if (qty >= tier.minQty) {
      return tier.minQty.toString();
    }
  }
  return tiers[tiers.length - 1].minQty.toString();
}

/**
 * Gets human-readable tier label
 * @param {string} tierKey - Tier key (e.g., "18")
 * @param {Array<{minQty: number, label: string}>} tiers - Tier definitions
 * @returns {string} Label (e.g., "18-49 pcs")
 */
function getTierLabel(tierKey, tiers) {
  const tier = tiers.find((t) => t.minQty.toString() === tierKey);
  return tier ? tier.label : tierKey;
}

/**
 * Builds tier map from product+color counts
 * @param {Object<string, number>} productColorCounts - Counts by product|color
 * @param {Array<{minQty: number}>} tiers - Tier definitions
 * @returns {Object<string, string>} Tier key by product|color
 */
function buildTierMap(productColorCounts, tiers) {
  const tierMap = {};
  for (const [key, count] of Object.entries(productColorCounts)) {
    tierMap[key] = getPricingTier(count, tiers);
  }
  return tierMap;
}

/**
 * Calculates price for a single item based on its product+color tier
 * @param {Object} item - Order item
 * @param {Object} tierMap - Tier map from buildTierMap
 * @param {Object} pricing - Pricing config
 * @returns {{price: number, tierKey: string}|null} Price info or null if unknown product
 */
function getItemPrice(item, tierMap, pricing) {
  const productPricing = pricing.products[item.product];
  if (!productPricing) {
    return null;
  }
  const color = normalizeColor(item.color);
  const key = `${item.product}|${color}`;
  const tierKey = tierMap[key] || "6";
  const basePrice = productPricing[tierKey];
  const embroideryFee = item.embroideredName ? pricing.embroideryFee : 0;
  const logoFee = pricing.logoFee || 0;
  const foldingFee = pricing.foldingFee || 0;
  return { price: basePrice + embroideryFee + logoFee + foldingFee, tierKey };
}

/**
 * Groups order rows by customer email
 * @param {Array<Object>} rows - Order rows from sheet
 * @returns {Array<{name: string, phone: string, email: string, items: Array}>} Grouped customers
 */
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

/**
 * Separates product+color combos by minimum quantity threshold
 * @param {Object<string, number>} productColorCounts - Counts by product|color
 * @param {number} minQuantity - Minimum quantity threshold
 * @returns {{eligible: Object, excluded: Object}} Separated counts
 */
function filterByMinimum(productColorCounts, minQuantity) {
  const eligible = {};
  const excluded = {};

  for (const [key, count] of Object.entries(productColorCounts)) {
    if (count >= minQuantity) {
      eligible[key] = count;
    } else {
      excluded[key] = count;
    }
  }

  return { eligible, excluded };
}

/**
 * Calculates sales tax
 * @param {number} subtotal - Taxable subtotal
 * @param {number} taxRate - Tax rate (e.g., 0.0725 for 7.25%)
 * @returns {number} Tax amount
 */
function calculateTax(subtotal, taxRate) {
  return subtotal * taxRate;
}

/**
 * Calculates Stripe processing fee (2.9% + $0.30)
 * @param {number} subtotal - Order subtotal
 * @returns {number} Fee amount
 */
function calculateStripeFee(subtotal) {
  return (subtotal * 0.029) + 0.30;
}

/**
 * Formats item description for invoice line item
 * @param {Object} item - Order item
 * @returns {string} Formatted description
 */
function formatItemDescription(item) {
  let desc = `${item.product} - ${item.style} ${item.size} (${item.color})`;
  desc += `\nLogo: ${item.logo}`;
  if (item.embroideredName) {
    desc += `\nEmbroidered: "${item.embroideredName}" (${item.threadColor} thread)`;
  }
  return desc;
}

module.exports = {
  GRAY_COLORS,
  normalizeColor,
  countByProductColor,
  getPricingTier,
  getTierLabel,
  buildTierMap,
  getItemPrice,
  groupByEmail,
  filterByMinimum,
  calculateTax,
  calculateStripeFee,
  formatItemDescription,
};
