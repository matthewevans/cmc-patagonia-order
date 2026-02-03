# CMC EM Patagonia Order Form

Static order form → Google Sheet → Stripe invoicing pipeline.

## Setup

### 1. Google Sheet + Apps Script

1. Create a new Google Sheet (this will store all orders).
2. Go to **Extensions → Apps Script**.
3. Paste the contents of `google-apps-script.js` into `Code.gs` (replace any existing code).
4. Click **Deploy → New Deployment**.
5. Set **Type** = Web app, **Execute as** = Me, **Who has access** = Anyone.
6. Click **Deploy** and copy the URL.

### 2. Connect the form

1. Open `index.html`.
2. Find the line near the top of the `<script>` block:
   ```js
   const APPS_SCRIPT_URL = "";
   ```
3. Paste your Apps Script URL between the quotes.

### 3. Deploy to GitHub Pages

1. Create a new GitHub repo (e.g. `cmc-patagonia-order`).
2. Push `index.html` to the `main` branch.
3. Go to **Settings → Pages → Source** = "Deploy from a branch", branch = `main`, folder = `/ (root)`.
4. Your form will be live at `https://<your-username>.github.io/cmc-patagonia-order/`.

### 4. After orders close — Stripe invoicing

Once orders are collected, generate invoices using the included script:

#### Setup (one time)

```bash
npm install
cp .env.example .env
# Edit .env and add your Stripe secret key + Apps Script URL
```

#### Generate invoices

```bash
# Preview what will be invoiced (fetches directly from Google Sheet)
node invoice.js --dry-run

# Create draft invoices (review in Stripe dashboard before sending)
node invoice.js

# Create and send invoices immediately
node invoice.js --send
```

You can also use a local CSV export if preferred:
```bash
node invoice.js orders.csv --dry-run
```

Pricing is automatically determined by total order volume:
- 72+ items: Best pricing tier
- 50-71 items: Second tier
- 18-49 items: Third tier
- 6-17 items: Base tier

Edit `pricing.json` to adjust prices or embroidery fee.

## Sheet format

Each row in the sheet is one line item:

| Timestamp | Name | Phone | Email | Position | Product | Style | Size | Color | Logo | Embroidered Name | Thread Color |
|-----------|------|-------|-------|----------|---------|-------|------|-------|------|------------------|--------------|

A person who orders 3 items will have 3 rows (with their info repeated). This makes it easy to aggregate by email later.
