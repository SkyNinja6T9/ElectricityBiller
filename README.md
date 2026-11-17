# ⚡ Electricity Bill Splitter WebApp

A modern, lightweight web application designed for **closed user groups** (e.g. shared apartments, joint families, multi-tenant properties, or commercial sub-tenants) to upload an electricity bill, auto-extract the readings and slab rates via **OCR.space Free API**, and split the cost dynamically based on the exact **number of parties**.

---

## 🌟 Key Features

1. **🔒 Closed-User Access Gate**
   - Password/PIN protected so only authorized party members can access the webapp and make API calls.
   - Configurable passcode via environment variable `APP_PASSCODE` (default: `1234`).
   - Secure persistent login stored locally in the browser with 1-click session lock.

2. **📸 OCR Electricity Bill Auto-Extraction**
   - Drag & drop or upload electricity bills in **JPG, PNG, WebP, or PDF**.
   - Direct camera photo capture on smartphones (`capture="environment"`).
   - Automatic client-side image compression (downscaled to ~250KB) to ensure lightning-fast uploads and stay safely under OCR.space's 1MB free tier limit.
   - Powered by **OCR.space Free API** (`https://api.ocr.space/parse/image`). API key configured securely via environment variable.
   - Heuristic parser detects:
     - Billing Month & Year (e.g. `2026-03` and previous month `2026-02`)
     - Main meter readings & Total Consumed Units
     - Tariff Slabs & Slab Rates (e.g. `1-50 @ ₹3.05`, `51-150 @ ₹3.50`, etc.)
     - Fixed Charges, Electricity Duty, FPPPA / Fuel Surcharge, and Meter Rent
     - Adjustments (arrears, solar generation credits, prompt payment rebates)
     - Net bill amount payable

3. **👥 Dynamic Multi-Party Splitting ($N$ Parties)**
   - Flexible number of parties: Split equally or by sub-meter readings across **2, 3, 4, 5, or more parties**.
   - Custom party names (e.g., `M.T`, `U.G`, `First Floor`, `Second Floor`, `Shop A`, etc.).
   - Sub-meter tracking: Enter Previous & Current readings for each party; consumed units are calculated automatically.
   - **🔄 New Month Rollover**: 1-click button to rollover all Current readings into Previous readings when starting a new billing cycle!
   - Party settings and names persist automatically in `localStorage`.

4. **📐 Accurate Mathematical Split Model**
   - **Effective Unit Rate** = $\frac{\text{Total Slabs Cost}}{\text{Total Billed Units}}$
   - **Common / Other Units** = $\text{Total Billed Units} - \sum \text{Parties Consumed Units}$
   - **Other Units Cost** = $\text{Other Units} \times \text{Effective Rate}$
   - **Each Party Share of Common Units** = $\frac{\text{Other Units Cost}}{N}$
   - **Each Party Share of Fixed Charges** = $\frac{\text{Total Charges}}{N}$
   - **Each Party Share of Adjustments** = $\frac{\text{Net Adjustments}}{N}$
   - **Party $k$ Payable** = $(\text{Units}_k \times \text{Effective Rate}) + \text{Other Share} + \text{Charges Share} + \text{Adjustment Share}$
   - Exact reconciliation check ensures the sum of all parties' payables matches the total bill!

5. **📲 Sharing & Export**
   - **WhatsApp Text Summary**: Formatted summary message with emojis and clear breakdown, ready to paste in WhatsApp group.
   - **Save as Image**: High-resolution, clean black & white receipt image generated with `html2canvas` for printing or sharing.

---

## ⚡ Framework & Architecture: Why It's Lightweight

This application is built with an **ultra-lightweight, zero-bloat architecture**:
- **Frontend**: Pure modern Vanilla ES modules + responsive CSS (Mobile First). No massive client bundle, no heavy React/Next.js overhead (~30KB total size, loads in < 20ms).
- **Backend API**: Native **Vercel Serverless Functions** (`/api/ocr.js` and `/api/auth.js`) using Node.js standard built-ins (`fetch`, `FormData`). Zero npm dependencies required!
- **Local Dev Server**: A built-in zero-dependency runner (`server.js`) that emulates Vercel's serverless environment locally.

---

## 🚀 Getting Started Locally

### 1. Prerequisites
- [Node.js](https://nodejs.org/) (v18+ recommended, works with v20/v24).

### 2. Setup
Clone or navigate to the directory:
```bash
cd ElectricityBiller
```

Inspect or configure `.env` (already created with your keys):
```ini
OCR_SPACE_API_KEY=your_ocr_space_api_key_here
APP_PASSCODE=1234
PORT=3000
```

### 3. Run Development Server
```bash
npm run dev
# or: node server.js
```

Open your browser at:
```
http://localhost:3000
```
Enter passcode `1234` (or whatever you configured in `APP_PASSCODE`) to unlock.

---

## ☁️ Deploying to Vercel

Deploying to Vercel takes less than 1 minute:

### Option A: Via GitHub (Recommended)
1. Push this project to a GitHub repository:
   ```bash
   git init
   git add .
   git commit -m "Initial commit of Electricity Bill Splitter WebApp"
   git remote add origin https://github.com/your-username/electricity-biller.git
   git push -u origin main
   ```
2. Go to [Vercel Dashboard](https://vercel.com/dashboard) and click **Add New > Project**.
3. Import your GitHub repository.
4. In **Environment Variables**, add:
   - `OCR_SPACE_API_KEY`: `your_ocr_space_api_key_here`
   - `APP_PASSCODE`: `your_custom_passcode` (e.g. `2026` or any secret PIN)
5. Click **Deploy**. Vercel will automatically detect the static frontend and map `/api/ocr.js` and `/api/auth.js` to serverless Lambdas!

### Option B: Via Vercel CLI
```bash
npm i -g vercel
vercel
```

---

## 📁 Project Structure

```
ElectricityBiller/
├── api/
│   ├── ocr.js             # Vercel Serverless Function: OCR Space call + bill parser
│   ├── auth.js            # Vercel Serverless Function: Closed-user passcode verification
│   └── lib/
│       └── billParser.js  # Heuristic parser for electricity bill OCR text
├── css/
│   └── style.css          # Mobile-first responsive styling
├── js/
│   ├── app.js             # Dynamic parties, calculation engine, WhatsApp & image export
│   ├── ocr-client.js      # Client-side image compression & OCR API caller
│   └── auth-client.js     # Passcode gate & local storage session manager
├── index.html             # Main WebApp interface
├── server.js              # Lightweight local server (emulates Vercel /api locally)
├── vercel.json            # Vercel deployment configuration
├── package.json           # Scripts & project metadata
├── .env.example           # Example environment variables
└── README.md              # Project documentation
```

---

## 🔑 Security & Quota Protection

- **OCR Space API Key Protection**: The OCR Space API key is stored server-side in the `/api/ocr.js` serverless function. It is never exposed in client-side HTML or JS bundles.
- **Passcode Authentication**: Requests to `/api/ocr` are gated behind `APP_PASSCODE`. Unauthorized users cannot call your serverless function to exhaust your OCR quota.
