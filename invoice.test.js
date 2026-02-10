/**
 * Unit tests for invoice aggregation and pricing logic
 * Run: npm test
 */

const {
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
} = require("./lib/pricing");

const { parseCSV, parseCSVLine } = require("./lib/csv");

// Mock pricing config (matches pricing.json)
const pricing = {
  tiers: [
    { minQty: 72, label: "72+ pcs" },
    { minQty: 50, label: "50-71 pcs" },
    { minQty: 18, label: "18-49 pcs" },
    { minQty: 6, label: "6-17 pcs" },
  ],
  products: {
    "Better Sweater Jacket": { 6: 175.0, 18: 173.58, 50: 162.68, 72: 159.68 },
    "Better Sweater Vest": { 6: 132.88, 18: 131.28, 50: 123.58, 72: 119.88 },
    "Better Sweater Quarter Zip": { 6: 155.0, 18: 152.0, 50: 142.68, 72: 139.58 },
  },
  embroideryFee: 8.0,
  logoFee: 10.0,
  foldingFee: 0.75,
  currency: "usd",
};

// ─── Color Normalization Tests ───────────────────────────────────────────────

describe("normalizeColor", () => {
  it("normalizes Birch White to Gray", () => {
    expect(normalizeColor("Birch White")).toBe("Gray");
  });

  it("normalizes Stonewash to Gray", () => {
    expect(normalizeColor("Stonewash")).toBe("Gray");
  });

  it("keeps Black unchanged", () => {
    expect(normalizeColor("Black")).toBe("Black");
  });

  it("keeps New Navy unchanged", () => {
    expect(normalizeColor("New Navy")).toBe("New Navy");
  });

  it("keeps Dark Ruby unchanged", () => {
    expect(normalizeColor("Dark Ruby")).toBe("Dark Ruby");
  });
});

// ─── Aggregation Tests ───────────────────────────────────────────────────────

describe("countByProductColor", () => {
  it("counts items by product and color", () => {
    const rows = [
      { Product: "Better Sweater Jacket", Color: "Black" },
      { Product: "Better Sweater Jacket", Color: "Black" },
      { Product: "Better Sweater Jacket", Color: "New Navy" },
      { Product: "Better Sweater Vest", Color: "Black" },
    ];

    const counts = countByProductColor(rows);

    expect(counts["Better Sweater Jacket|Black"]).toBe(2);
    expect(counts["Better Sweater Jacket|New Navy"]).toBe(1);
    expect(counts["Better Sweater Vest|Black"]).toBe(1);
  });

  it("normalizes gray colors when counting", () => {
    const rows = [
      { Product: "Better Sweater Jacket", Color: "Birch White" },
      { Product: "Better Sweater Jacket", Color: "Stonewash" },
      { Product: "Better Sweater Jacket", Color: "Birch White" },
    ];

    const counts = countByProductColor(rows);

    expect(counts["Better Sweater Jacket|Gray"]).toBe(3);
    expect(counts["Better Sweater Jacket|Birch White"]).toBeUndefined();
    expect(counts["Better Sweater Jacket|Stonewash"]).toBeUndefined();
  });

  it("skips rows without product", () => {
    const rows = [
      { Product: "Better Sweater Jacket", Color: "Black" },
      { Product: "", Color: "Black" },
      { Product: null, Color: "Black" },
    ];

    const counts = countByProductColor(rows);

    expect(Object.keys(counts)).toHaveLength(1);
    expect(counts["Better Sweater Jacket|Black"]).toBe(1);
  });
});

describe("filterByMinimum", () => {
  it("separates combos by minimum threshold", () => {
    const counts = {
      "Jacket|Black": 10,
      "Jacket|Navy": 3,
      "Vest|Black": 6,
      "Vest|Gray": 5,
    };

    const { eligible, excluded } = filterByMinimum(counts, 6);

    expect(Object.keys(eligible)).toHaveLength(2);
    expect(eligible["Jacket|Black"]).toBe(10);
    expect(eligible["Vest|Black"]).toBe(6);

    expect(Object.keys(excluded)).toHaveLength(2);
    expect(excluded["Jacket|Navy"]).toBe(3);
    expect(excluded["Vest|Gray"]).toBe(5);
  });

  it("handles all eligible", () => {
    const counts = { "Jacket|Black": 10, "Vest|Black": 20 };
    const { eligible, excluded } = filterByMinimum(counts, 6);

    expect(Object.keys(eligible)).toHaveLength(2);
    expect(Object.keys(excluded)).toHaveLength(0);
  });

  it("handles all excluded", () => {
    const counts = { "Jacket|Black": 2, "Vest|Black": 3 };
    const { eligible, excluded } = filterByMinimum(counts, 6);

    expect(Object.keys(eligible)).toHaveLength(0);
    expect(Object.keys(excluded)).toHaveLength(2);
  });
});

// ─── Pricing Tier Tests ──────────────────────────────────────────────────────

describe("getPricingTier", () => {
  it("returns 72 tier for 72+ items", () => {
    expect(getPricingTier(72, pricing.tiers)).toBe("72");
    expect(getPricingTier(100, pricing.tiers)).toBe("72");
    expect(getPricingTier(500, pricing.tiers)).toBe("72");
  });

  it("returns 50 tier for 50-71 items", () => {
    expect(getPricingTier(50, pricing.tiers)).toBe("50");
    expect(getPricingTier(60, pricing.tiers)).toBe("50");
    expect(getPricingTier(71, pricing.tiers)).toBe("50");
  });

  it("returns 18 tier for 18-49 items", () => {
    expect(getPricingTier(18, pricing.tiers)).toBe("18");
    expect(getPricingTier(30, pricing.tiers)).toBe("18");
    expect(getPricingTier(49, pricing.tiers)).toBe("18");
  });

  it("returns 6 tier for 6-17 items", () => {
    expect(getPricingTier(6, pricing.tiers)).toBe("6");
    expect(getPricingTier(10, pricing.tiers)).toBe("6");
    expect(getPricingTier(17, pricing.tiers)).toBe("6");
  });

  it("returns 6 tier for items below minimum", () => {
    expect(getPricingTier(1, pricing.tiers)).toBe("6");
    expect(getPricingTier(5, pricing.tiers)).toBe("6");
  });
});

describe("getTierLabel", () => {
  it("returns correct label for each tier", () => {
    expect(getTierLabel("72", pricing.tiers)).toBe("72+ pcs");
    expect(getTierLabel("50", pricing.tiers)).toBe("50-71 pcs");
    expect(getTierLabel("18", pricing.tiers)).toBe("18-49 pcs");
    expect(getTierLabel("6", pricing.tiers)).toBe("6-17 pcs");
  });

  it("returns key as fallback for unknown tier", () => {
    expect(getTierLabel("99", pricing.tiers)).toBe("99");
  });
});

describe("buildTierMap", () => {
  it("builds tier map from product color counts", () => {
    const counts = {
      "Better Sweater Jacket|Black": 25,
      "Better Sweater Jacket|Navy": 8,
      "Better Sweater Vest|Black": 75,
    };

    const tierMap = buildTierMap(counts, pricing.tiers);

    expect(tierMap["Better Sweater Jacket|Black"]).toBe("18");
    expect(tierMap["Better Sweater Jacket|Navy"]).toBe("6");
    expect(tierMap["Better Sweater Vest|Black"]).toBe("72");
  });
});

// ─── Price Calculation Tests ─────────────────────────────────────────────────

describe("getItemPrice", () => {
  it("calculates base price from tier", () => {
    const tierMap = { "Better Sweater Jacket|Black": "18" };
    const item = { product: "Better Sweater Jacket", color: "Black", embroideredName: "" };

    const result = getItemPrice(item, tierMap, pricing);

    expect(result.price).toBe(173.58 + 10.0 + 0.75);
    expect(result.tierKey).toBe("18");
  });

  it("adds embroidery fee when name is present", () => {
    const tierMap = { "Better Sweater Jacket|Black": "18" };
    const item = { product: "Better Sweater Jacket", color: "Black", embroideredName: "Dr. Smith" };

    const result = getItemPrice(item, tierMap, pricing);

    expect(result.price).toBe(173.58 + 8.0 + 10.0 + 0.75);
    expect(result.tierKey).toBe("18");
  });

  it("normalizes color for tier lookup", () => {
    const tierMap = { "Better Sweater Jacket|Gray": "50" };
    const item = { product: "Better Sweater Jacket", color: "Birch White", embroideredName: "" };

    const result = getItemPrice(item, tierMap, pricing);

    expect(result.price).toBe(162.68 + 10.0 + 0.75);
    expect(result.tierKey).toBe("50");
  });

  it("returns null for unknown product", () => {
    const tierMap = { "Unknown Product|Black": "6" };
    const item = { product: "Unknown Product", color: "Black", embroideredName: "" };

    const result = getItemPrice(item, tierMap, pricing);

    expect(result).toBeNull();
  });

  it("defaults to tier 6 if combo not in tier map", () => {
    const tierMap = {};
    const item = { product: "Better Sweater Vest", color: "Black", embroideredName: "" };

    const result = getItemPrice(item, tierMap, pricing);

    expect(result.price).toBe(132.88 + 10.0 + 0.75);
    expect(result.tierKey).toBe("6");
  });
});

describe("calculateTax", () => {
  it("calculates tax at given rate", () => {
    expect(calculateTax(100, 0.0725)).toBeCloseTo(7.25, 2);
    expect(calculateTax(200, 0.0725)).toBeCloseTo(14.50, 2);
    expect(calculateTax(0, 0.0725)).toBeCloseTo(0, 2);
  });
});

describe("calculateStripeFee", () => {
  it("calculates 2.9% + $0.30", () => {
    expect(calculateStripeFee(100)).toBeCloseTo(3.20, 2);
    expect(calculateStripeFee(200)).toBeCloseTo(6.10, 2);
    expect(calculateStripeFee(0)).toBeCloseTo(0.30, 2);
  });
});

// ─── Customer Grouping Tests ─────────────────────────────────────────────────

describe("groupByEmail", () => {
  it("groups multiple items under same email", () => {
    const rows = [
      { Email: "john@test.com", Name: "John", Phone: "555-1234", Product: "Jacket", Style: "Mens", Size: "L", Color: "Black", Logo: "A", "Embroidered Name": "", "Thread Color": "" },
      { Email: "john@test.com", Name: "John", Phone: "555-1234", Product: "Vest", Style: "Mens", Size: "M", Color: "Navy", Logo: "B", "Embroidered Name": "John", "Thread Color": "White" },
    ];

    const grouped = groupByEmail(rows);

    expect(grouped).toHaveLength(1);
    expect(grouped[0].email).toBe("john@test.com");
    expect(grouped[0].items).toHaveLength(2);
  });

  it("separates different emails", () => {
    const rows = [
      { Email: "john@test.com", Name: "John", Phone: "555-1234", Product: "Jacket", Style: "Mens", Size: "L", Color: "Black", Logo: "A", "Embroidered Name": "", "Thread Color": "" },
      { Email: "jane@test.com", Name: "Jane", Phone: "555-5678", Product: "Vest", Style: "Womens", Size: "S", Color: "Navy", Logo: "B", "Embroidered Name": "", "Thread Color": "" },
    ];

    const grouped = groupByEmail(rows);

    expect(grouped).toHaveLength(2);
  });

  it("normalizes email to lowercase", () => {
    const rows = [
      { Email: "JOHN@TEST.COM", Name: "John", Phone: "555-1234", Product: "Jacket", Style: "Mens", Size: "L", Color: "Black", Logo: "A", "Embroidered Name": "", "Thread Color": "" },
      { Email: "john@test.com", Name: "John", Phone: "555-1234", Product: "Vest", Style: "Mens", Size: "M", Color: "Navy", Logo: "B", "Embroidered Name": "", "Thread Color": "" },
    ];

    const grouped = groupByEmail(rows);

    expect(grouped).toHaveLength(1);
    expect(grouped[0].items).toHaveLength(2);
  });

  it("skips rows without email", () => {
    const rows = [
      { Email: "john@test.com", Name: "John", Phone: "555-1234", Product: "Jacket", Style: "Mens", Size: "L", Color: "Black", Logo: "A", "Embroidered Name": "", "Thread Color": "" },
      { Email: "", Name: "NoEmail", Phone: "555-0000", Product: "Vest", Style: "Mens", Size: "M", Color: "Navy", Logo: "B", "Embroidered Name": "", "Thread Color": "" },
    ];

    const grouped = groupByEmail(rows);

    expect(grouped).toHaveLength(1);
  });
});

// ─── CSV Parser Tests ────────────────────────────────────────────────────────

describe("parseCSVLine", () => {
  it("parses simple comma-separated values", () => {
    const result = parseCSVLine("a,b,c");
    expect(result).toEqual(["a", "b", "c"]);
  });

  it("handles quoted fields with commas", () => {
    const result = parseCSVLine('a,"b,c",d');
    expect(result).toEqual(["a", "b,c", "d"]);
  });

  it("handles empty fields", () => {
    const result = parseCSVLine("a,,c");
    expect(result).toEqual(["a", "", "c"]);
  });
});

describe("parseCSV", () => {
  it("parses CSV content into objects", () => {
    const csv = "Name,Email\nJohn,john@test.com\nJane,jane@test.com";
    const result = parseCSV(csv);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ Name: "John", Email: "john@test.com" });
    expect(result[1]).toEqual({ Name: "Jane", Email: "jane@test.com" });
  });
});

// ─── Formatting Tests ────────────────────────────────────────────────────────

describe("formatItemDescription", () => {
  it("formats basic item", () => {
    const item = {
      product: "Better Sweater Jacket",
      style: "Mens",
      size: "L",
      color: "Black",
      logo: "Original CMC Logo",
      embroideredName: "",
    };

    const desc = formatItemDescription(item);

    expect(desc).toContain("Better Sweater Jacket - Mens L (Black)");
    expect(desc).toContain("Logo: Original CMC Logo");
    expect(desc).not.toContain("Embroidered");
  });

  it("includes embroidery info when present", () => {
    const item = {
      product: "Better Sweater Jacket",
      style: "Mens",
      size: "L",
      color: "Black",
      logo: "Original CMC Logo",
      embroideredName: "Dr. Smith",
      threadColor: "White",
    };

    const desc = formatItemDescription(item);

    expect(desc).toContain('Embroidered: "Dr. Smith" (White thread)');
  });
});

// ─── Integration Tests ───────────────────────────────────────────────────────

describe("integration: full pricing calculation", () => {
  it("calculates correct prices for mixed order", () => {
    const rows = [
      // 10 Black Jackets → tier 6
      ...Array(10).fill({ Product: "Better Sweater Jacket", Color: "Black" }),
      // 20 Navy Jackets → tier 18
      ...Array(20).fill({ Product: "Better Sweater Jacket", Color: "New Navy" }),
      // 55 Black Vests → tier 50
      ...Array(55).fill({ Product: "Better Sweater Vest", Color: "Black" }),
    ];

    const counts = countByProductColor(rows);
    const tierMap = buildTierMap(counts, pricing.tiers);

    expect(tierMap["Better Sweater Jacket|Black"]).toBe("6");
    expect(tierMap["Better Sweater Jacket|New Navy"]).toBe("18");
    expect(tierMap["Better Sweater Vest|Black"]).toBe("50");

    // Verify prices
    const blackJacket = getItemPrice({ product: "Better Sweater Jacket", color: "Black", embroideredName: "" }, tierMap, pricing);
    const navyJacket = getItemPrice({ product: "Better Sweater Jacket", color: "New Navy", embroideredName: "" }, tierMap, pricing);
    const blackVest = getItemPrice({ product: "Better Sweater Vest", color: "Black", embroideredName: "" }, tierMap, pricing);

    expect(blackJacket.price).toBe(175.0 + 10.0 + 0.75);  // tier 6
    expect(navyJacket.price).toBe(173.58 + 10.0 + 0.75);  // tier 18
    expect(blackVest.price).toBe(123.58 + 10.0 + 0.75);   // tier 50
  });

  it("combines gray colors for tier calculation", () => {
    const rows = [
      // 5 Birch White + 5 Stonewash = 10 Gray → tier 6
      ...Array(5).fill({ Product: "Better Sweater Jacket", Color: "Birch White" }),
      ...Array(5).fill({ Product: "Better Sweater Jacket", Color: "Stonewash" }),
    ];

    const counts = countByProductColor(rows);
    const tierMap = buildTierMap(counts, pricing.tiers);

    expect(counts["Better Sweater Jacket|Gray"]).toBe(10);
    expect(tierMap["Better Sweater Jacket|Gray"]).toBe("6");

    // Both colors should get same price
    const birchPrice = getItemPrice({ product: "Better Sweater Jacket", color: "Birch White", embroideredName: "" }, tierMap, pricing);
    const stonewashPrice = getItemPrice({ product: "Better Sweater Jacket", color: "Stonewash", embroideredName: "" }, tierMap, pricing);

    expect(birchPrice.price).toBe(175.0 + 10.0 + 0.75);
    expect(stonewashPrice.price).toBe(175.0 + 10.0 + 0.75);
  });

  it("excludes combos below minimum and prices eligible correctly", () => {
    const rows = [
      // 3 Black Jackets → excluded (below 6)
      ...Array(3).fill({ Product: "Better Sweater Jacket", Color: "Black" }),
      // 10 Navy Jackets → tier 6
      ...Array(10).fill({ Product: "Better Sweater Jacket", Color: "New Navy" }),
    ];

    const counts = countByProductColor(rows);
    const { eligible, excluded } = filterByMinimum(counts, 6);

    expect(excluded["Better Sweater Jacket|Black"]).toBe(3);
    expect(eligible["Better Sweater Jacket|New Navy"]).toBe(10);

    const tierMap = buildTierMap(eligible, pricing.tiers);

    // Navy should be priced at tier 6
    const navyJacket = getItemPrice({ product: "Better Sweater Jacket", color: "New Navy", embroideredName: "" }, tierMap, pricing);
    expect(navyJacket.price).toBe(175.0 + 10.0 + 0.75);

    // Black is not in tierMap (excluded)
    expect(tierMap["Better Sweater Jacket|Black"]).toBeUndefined();
  });
});
