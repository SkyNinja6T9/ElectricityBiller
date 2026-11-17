/**
 * Advanced Electricity Bill Parser for OCR output
 * Extracts dates, units, meter readings, slabs, charges, and ALL adjustments (including end-of-bill adjustments)
 * Supports APDCL, UGVCL, DGVCL, MGVCL, PGVCL, Torrent Power, BESCOM, TNEB, MSEDCL, BSES, Tata Power, etc.
 */

function parseElectricityBill(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return {
      success: false,
      message: 'No text provided for parsing',
      data: null
    };
  }

  const cleanText = rawText.replace(/\r/g, '');
  const lines = cleanText.split('\n').map(l => l.trim()).filter(Boolean);

  const result = {
    billingMonth: null,       // 'YYYY-MM'
    previousMonth: null,      // 'YYYY-MM'
    meter: {
      previousReading: null,
      currentReading: null,
      unitsConsumed: null,
    },
    slabs: [],                // [{ units: 300, rate: 7.74, amt: 2322 }]
    charges: [],              // [{ name: 'Fixed Charge', amt: 552.33 }, ...]
    adjustments: [],          // [{ name: 'Total Tariff Subsidy', amt: -455 }, { name: 'Adjustment', amt: -1297.92 }]
    totalAmount: null,
    confidence: [],
    rawText: rawText
  };

  const parseNum = (str) => {
    if (!str) return null;
    const clean = str.replace(/[₹Rs\.,\s=：:]/gi, match => match === '.' ? '.' : '').trim();
    const val = parseFloat(clean);
    return isNaN(val) ? null : val;
  };

  // Helper to extract key-value pairs (handles both same-line and two-line OCR formats)
  const extractAllKeyValuePairs = () => {
    const pairs = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Format 1: "Adjustment = -1297.92" or "Fixed Charge: 552.33"
      const sameLine = line.match(/^([^=：:0-9][^=：:]*?)[=：:]\s*(-?[0-9,]+(?:\.[0-9]+)?)$/);
      if (sameLine && isNaN(sameLine[1].trim())) {
        const valStr = sameLine[2].trim();
        pairs.push({
          key: sameLine[1].trim(),
          valStr: valStr,
          val: parseFloat(valStr.replace(/,/g, ''))
        });
        continue;
      }

      // Format 2: Line i is label, Line i+1 is "= -1297.92" or "-1297.92"
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        const nextMatch = nextLine.match(/^[=：:\s]*(-?[0-9,]+(?:\.[0-9]+)?)$/);
        if (nextMatch && !/^[=：:\s0-9]/.test(line)) {
          const valStr = nextMatch[1].trim();
          pairs.push({
            key: line.trim(),
            valStr: valStr,
            val: parseFloat(valStr.replace(/,/g, ''))
          });
          i++; // skip next line
        }
      }
    }
    return pairs;
  };

  const kvPairs = extractAllKeyValuePairs();

  // ── 1. BILLING MONTH & DATES ──
  const dateRegex = /\b(?:bill\s*(?:date|month|to|period)|date)\s*[:：=\-]?\s*(\d{4}[-\/]\d{1,2}[-\/]\d{1,2}|\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}|[a-zA-Z]{3,9}\s*\d{4})\b/i;
  const matchDate = cleanText.match(dateRegex);

  function setMonthFromYearAndMonth(y, m) {
    if (m >= 1 && m <= 12 && y >= 2000 && y <= 2099) {
      result.billingMonth = `${y}-${String(m).padStart(2, '0')}`;
      const prevM = m === 1 ? 12 : m - 1;
      const prevY = m === 1 ? y - 1 : y;
      result.previousMonth = `${prevY}-${String(prevM).padStart(2, '0')}`;
      return true;
    }
    return false;
  }

  if (matchDate) {
    const rawD = matchDate[1];
    const ymd = rawD.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
    if (ymd) {
      setMonthFromYearAndMonth(parseInt(ymd[1], 10), parseInt(ymd[2], 10));
      result.confidence.push(`Found Bill Date: ${rawD} -> ${result.billingMonth}`);
    } else {
      const dmy = rawD.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})$/);
      if (dmy) {
        let y = parseInt(dmy[3], 10);
        if (y < 100) y += 2000;
        setMonthFromYearAndMonth(y, parseInt(dmy[2], 10));
        result.confidence.push(`Found Bill Date: ${rawD} -> ${result.billingMonth}`);
      }
    }
  }

  if (!result.billingMonth) {
    const anyDateRegex = /\b(\d{4})[-\/](\d{2})[-\/](\d{2})\b/g;
    let anyMatch;
    while ((anyMatch = anyDateRegex.exec(cleanText)) !== null) {
      if (setMonthFromYearAndMonth(parseInt(anyMatch[1], 10), parseInt(anyMatch[2], 10))) {
        result.confidence.push(`Inferred Month from date: ${anyMatch[0]} -> ${result.billingMonth}`);
        break;
      }
    }
  }

  // ── 2. METER READINGS & UNITS ──
  kvPairs.forEach(p => {
    if (result.meter.currentReading == null && /curr(?:ent)?\s*(?:reading|rdg|read)?|present\s*reading/i.test(p.key)) {
      result.meter.currentReading = p.val;
    }
    if (result.meter.previousReading == null && /prev(?:ious)?\s*(?:reading|rdg|read)?|past\s*reading/i.test(p.key)) {
      result.meter.previousReading = p.val;
    }
    if (result.meter.unitsConsumed == null && /units?\s*(?:consumed|billed|total)|consumed\s*units?|billed\s*units?/i.test(p.key)) {
      result.meter.unitsConsumed = p.val;
    }
  });

  // Direct line regex fallback for meter readings
  lines.forEach(line => {
    const mCurr = line.match(/\b(?:curr(?:ent)?\s*(?:reading|rdg|read)?|present\s*reading)\s*[:：=\-]?\s*([0-9]+(?:\.[0-9]+)?)\b/i);
    if (mCurr && result.meter.currentReading == null) result.meter.currentReading = parseFloat(mCurr[1]);

    const mPrev = line.match(/\b(?:prev(?:ious)?\s*(?:reading|rdg|read)?|past\s*reading)\s*[:：=\-]?\s*([0-9]+(?:\.[0-9]+)?)\b/i);
    if (mPrev && result.meter.previousReading == null) result.meter.previousReading = parseFloat(mPrev[1]);

    const mUnits = line.match(/\b(?:units?\s*(?:consumed|billed|total)|consumed\s*units?|total\s*units?|billed\s*units?)\s*[:：=\-]?\s*([0-9]+(?:\.[0-9]+)?)\b/i);
    if (mUnits && result.meter.unitsConsumed == null) result.meter.unitsConsumed = parseFloat(mUnits[1]);
  });

  if (result.meter.unitsConsumed == null && result.meter.currentReading != null && result.meter.previousReading != null) {
    result.meter.unitsConsumed = Math.max(0, Math.round((result.meter.currentReading - result.meter.previousReading) * 100) / 100);
  }

  if (result.meter.currentReading != null) result.confidence.push('Found Current Reading: ' + result.meter.currentReading);
  if (result.meter.previousReading != null) result.confidence.push('Found Previous Reading: ' + result.meter.previousReading);
  if (result.meter.unitsConsumed != null) result.confidence.push('Found Units Consumed: ' + result.meter.unitsConsumed);

  // ── 3. SLABS (Units & Rates) ──
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/\b(?:date|due|phone|consumer|bill\s*no|meter\s*no|connected|kva)\b/i.test(line)) {
      continue;
    }

    const slabMatch = line.match(/(?:(?:\d+\s*-\s*)?(\d+(?:\.\d+)?)|above\s*(\d+))\s*(?:units?|kwh)?\s*(?:[@xX*]|at)\s*(?:₹|rs\.?)?\s*([0-9]+(?:\.[0-9]{1,4})?)(?:\s*(?:=|:)\s*(?:₹|rs\.?)?\s*([0-9]+(?:\.[0-9]{1,2})?))?/i);
    if (slabMatch) {
      const unitsRaw = slabMatch[1] || slabMatch[2];
      const rateRaw = slabMatch[3];
      const amtRaw = slabMatch[4];
      const units = parseFloat(unitsRaw);
      const rate = parseFloat(rateRaw);
      if (units > 0 && rate > 0 && rate < 100) {
        const amt = amtRaw ? parseFloat(amtRaw) : Math.round(units * rate * 100) / 100;
        result.slabs.push({ units, rate, amt });
      }
    }
  }

  if (result.slabs.length > 0) {
    result.confidence.push(`Found ${result.slabs.length} rate slab(s)`);
  }

  // ── 4. CHARGES (Fixed Charge, Duty, FPPPA, Surcharges) ──
  const chargeDefs = [
    { name: 'Fixed Charge', regex: /\bfixed\s*(?:charges?|fee|amt)|demand\s*charges?\b/i },
    { name: 'Electricity Duty', regex: /\belectricity\s*duty|govt\.?\s*duty|\bed\s*duty\b/i },
    { name: 'FPPPA Charge', regex: /\bfpppa(?:\s*charges?)?|fuel\s*(?:surcharge|adjustment)\b/i },
    { name: 'Current Surcharge', regex: /\bcurrent\s*surcharge|surcharge\b/i },
    { name: 'Meter Rent', regex: /\bmeter\s*(?:rent|charges?)\b/i }
  ];

  kvPairs.forEach(p => {
    chargeDefs.forEach(cd => {
      if (cd.regex.test(p.key) && p.val > 0 && !result.charges.some(c => c.name === cd.name)) {
        result.charges.push({ name: cd.name, amt: p.val });
        result.confidence.push(`Found ${cd.name}: ₹${p.val}`);
      }
    });
  });

  // Ensure default charges exist if none found
  if (result.charges.length === 0) {
    result.charges = [
      { name: 'Fixed Charge', amt: 0 },
      { name: 'Electricity Duty', amt: 0 },
      { name: 'FPPPA Charge', amt: 0 }
    ];
  }

  // ── 5. ADJUSTMENTS (All Adjustments, End-of-Bill Adjustments, Subsidies & Arrears) ──
  // Check kvPairs for adjustments
  kvPairs.forEach(p => {
    const key = p.key.trim();
    const val = p.val;
    const valStr = p.valStr || '';

    // A. End-of-Bill Adjustment (e.g. "Adjustment = -1297.92" or "Adjustment = 300")
    if (/^adjustment(?:s)?$/i.test(key) || /^bill\s*adjustment(?:s)?$/i.test(key)) {
      if (Math.abs(val) > 0 && !result.adjustments.some(a => a.name.toLowerCase() === key.toLowerCase())) {
        result.adjustments.push({ name: 'Bill Adjustment', amt: val });
        result.confidence.push(`Found Bill Adjustment: ${val < 0 ? '-' : '+'}₹${Math.abs(val)}`);
      }
      return;
    }

    // B. Tariff / Govt Subsidies (e.g. "Total Tariff Subsidy = -455.0")
    if (/subsidy/i.test(key)) {
      if (Math.abs(val) > 0 && !result.adjustments.some(a => a.name.toLowerCase() === key.toLowerCase())) {
        const finalVal = -Math.abs(val); // Subsidies are always deductions
        result.adjustments.push({ name: key, amt: finalVal });
        result.confidence.push(`Found Subsidy ${key}: -₹${Math.abs(finalVal)}`);
      }
      return;
    }

    // C. Rebates / Discounts (e.g. "Prompt Payment Rebate = -25.0")
    if (/rebate|discount/i.test(key)) {
      if (Math.abs(val) > 0 && !result.adjustments.some(a => a.name.toLowerCase() === key.toLowerCase())) {
        const finalVal = -Math.abs(val);
        result.adjustments.push({ name: key, amt: finalVal });
        result.confidence.push(`Found Rebate ${key}: -₹${Math.abs(finalVal)}`);
      }
      return;
    }

    // D. Solar Credits / Net Metering Credit
    if (/solar|net\s*metering/i.test(key)) {
      if (Math.abs(val) > 0 && !result.adjustments.some(a => a.name.toLowerCase() === key.toLowerCase())) {
        const finalVal = -Math.abs(val);
        result.adjustments.push({ name: key, amt: finalVal });
        result.confidence.push(`Found Solar Credit ${key}: -₹${Math.abs(finalVal)}`);
      }
      return;
    }

    // E. Arrears & Past Dues (e.g. "Principal Arrear = 500.0")
    if (/principal\s*arrear|arrears?|past\s*dues?|previous\s*dues?/i.test(key)) {
      if (val > 0 && !result.adjustments.some(a => a.name.toLowerCase() === key.toLowerCase())) {
        result.adjustments.push({ name: key, amt: val });
        result.confidence.push(`Found Arrears ${key}: +₹${val}`);
      }
      return;
    }

    // F. Outstanding Surcharge / Interest / Penalty
    if (/o\/?s\s*surcharge|outstanding\s*surcharge|penalty|interest/i.test(key)) {
      if (val > 0 && !result.adjustments.some(a => a.name.toLowerCase() === key.toLowerCase())) {
        result.adjustments.push({ name: key, amt: val });
        result.confidence.push(`Found Surcharge/Penalty ${key}: +₹${val}`);
      }
      return;
    }

    // G. Misc Payable
    if (/misc\s*(?:payable|charges?)|miscellaneous/i.test(key)) {
      if (val > 0 && !result.adjustments.some(a => a.name.toLowerCase() === key.toLowerCase())) {
        result.adjustments.push({ name: key, amt: val });
        result.confidence.push(`Found Misc Payable: +₹${val}`);
      }
      return;
    }
  });

  // Direct line regex check for adjustments in case not captured by kvPairs
  const directAdjRegex = /\b(adjustment|tariff\s*subsidy|govt\.?\s*subsidy|prompt\s*payment\s*rebate|principal\s*arrear)\b\s*[:：=\-]?\s*(?:₹|rs\.?)?\s*(-?[0-9]+(?:\.[0-9]{1,2})?)/gi;
  let dAdjMatch;
  while ((dAdjMatch = directAdjRegex.exec(cleanText)) !== null) {
    const adjName = dAdjMatch[1].trim();
    const adjAmt = parseFloat(dAdjMatch[2]);
    if (!isNaN(adjAmt) && Math.abs(adjAmt) > 0) {
      if (!result.adjustments.some(a => a.name.toLowerCase().includes(adjName.toLowerCase()))) {
        result.adjustments.push({ name: adjName, amt: adjAmt });
        result.confidence.push(`Found Adjustment ${adjName}: ${adjAmt < 0 ? '-' : '+'}₹${Math.abs(adjAmt)}`);
      }
    }
  }

  // ── 6. NET TOTAL AMOUNT ──
  lines.forEach(line => {
    const totalMatch = line.match(/\b(?:net\s*(?:bill|amount\s*payable)|total\s*(?:bill\s*)?(?:amount|payable|due)|amount\s*(?:payable|due)|bill\s*amount)\s*[:：=\-]?\s*(?:₹|rs\.?)?\s*([0-9,]+(?:\.[0-9]{1,2})?)\b/i);
    if (totalMatch && result.totalAmount == null) {
      const val = parseNum(totalMatch[1]);
      if (val && val > 0) {
        result.totalAmount = val;
        result.confidence.push('Found Net Total Amount: ₹' + val);
      }
    }
  });

  return {
    success: true,
    data: result
  };
}

module.exports = {
  parseElectricityBill
};
