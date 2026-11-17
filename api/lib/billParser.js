/**
 * Advanced Electricity Bill Parser for OCR output
 * Handles single-line key-values AND multi-line column alignments (common in OCR)
 * Supports UGVCL, DGVCL, MGVCL, PGVCL, Torrent Power, APDCL, BESCOM, TNEB, MSEDCL, BSES, Tata Power, etc.
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
    charges: [],              // [{ name: 'Fixed Charge', amt: 552.33 }]
    adjustments: [],          // [{ name: 'Tariff Subsidy', amt: -455.0 }]
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

  // ── 1. BILLING MONTH & DATES ──
  // Look for Bill Date / Bill To / Bill Month
  // Patterns like "Bill Date : 2025-10-03" or "2025-10-01" or "12/03/2026"
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
    // Check YYYY-MM-DD
    const ymd = rawD.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
    if (ymd) {
      setMonthFromYearAndMonth(parseInt(ymd[1], 10), parseInt(ymd[2], 10));
      result.confidence.push(`Found Bill Date: ${rawD} -> ${result.billingMonth}`);
    } else {
      // Check DD/MM/YYYY
      const dmy = rawD.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})$/);
      if (dmy) {
        let y = parseInt(dmy[3], 10);
        if (y < 100) y += 2000;
        setMonthFromYearAndMonth(y, parseInt(dmy[2], 10));
        result.confidence.push(`Found Bill Date: ${rawD} -> ${result.billingMonth}`);
      }
    }
  }

  // Fallback date scan if not found
  if (!result.billingMonth) {
    // Look for any YYYY-MM-DD or DD-MM-YYYY in the document
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
  // Check direct line matches first: e.g. "Current Reading = 34459.0" or "Units Billed = 671.0"
  lines.forEach(line => {
    const mCurr = line.match(/\b(?:curr(?:ent)?\s*(?:reading|rdg|read)?|present\s*reading)\s*[:：=\-]?\s*([0-9]+(?:\.[0-9]+)?)\b/i);
    if (mCurr && result.meter.currentReading == null) {
      result.meter.currentReading = parseFloat(mCurr[1]);
    }

    const mPrev = line.match(/\b(?:prev(?:ious)?\s*(?:reading|rdg|read)?|past\s*reading)\s*[:：=\-]?\s*([0-9]+(?:\.[0-9]+)?)\b/i);
    if (mPrev && result.meter.previousReading == null) {
      result.meter.previousReading = parseFloat(mPrev[1]);
    }

    const mUnits = line.match(/\b(?:units?\s*(?:consumed|billed|total)|consumed\s*units?|total\s*units?|billed\s*units?)\s*[:：=\-]?\s*([0-9]+(?:\.[0-9]+)?)\b/i);
    if (mUnits && result.meter.unitsConsumed == null) {
      result.meter.unitsConsumed = parseFloat(mUnits[1]);
    }
  });

  // Handle OCR Column Split Block:
  // Label lines: "Current Reading", "Previous Reading", "Units Consumed"
  // Followed by value lines: "= 34459.0", "= 33788.0", "= 671.0"
  if (result.meter.currentReading == null || result.meter.previousReading == null) {
    for (let i = 0; i < lines.length - 2; i++) {
      if (/current\s*reading/i.test(lines[i]) && /previous\s*reading/i.test(lines[i + 1])) {
        // Look ahead for the values block (starting with = or numbers)
        for (let j = i + 2; j < Math.min(i + 10, lines.length - 1); j++) {
          const val1 = lines[j].match(/^[=:：\s]*([0-9]{3,8}(?:\.[0-9]+)?)$/);
          const val2 = lines[j + 1].match(/^[=:：\s]*([0-9]{3,8}(?:\.[0-9]+)?)$/);
          if (val1 && val2) {
            result.meter.currentReading = parseFloat(val1[1]);
            result.meter.previousReading = parseFloat(val2[1]);
            if (lines[j + 2]) {
              const val3 = lines[j + 2].match(/^[=:：\s]*([0-9]+(?:\.[0-9]+)?)$/);
              if (val3) result.meter.unitsConsumed = parseFloat(val3[1]);
            }
            break;
          }
        }
        break;
      }
    }
  }

  if (result.meter.unitsConsumed == null && result.meter.currentReading != null && result.meter.previousReading != null) {
    result.meter.unitsConsumed = Math.max(0, Math.round((result.meter.currentReading - result.meter.previousReading) * 100) / 100);
  }

  if (result.meter.currentReading != null) result.confidence.push('Found Current Reading: ' + result.meter.currentReading);
  if (result.meter.previousReading != null) result.confidence.push('Found Previous Reading: ' + result.meter.previousReading);
  if (result.meter.unitsConsumed != null) result.confidence.push('Found Units Consumed: ' + result.meter.unitsConsumed);

  // ── 3. SLABS (Units & Rates) ──
  // Format 1: "300.0 X 7.74" or "200.0 X 7.74 = 1548.0"
  // Format 2: "1-50 units @ 3.05 = 152.50"
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

  // ── 4. CHARGES (Fixed Charge, Duty, FPPPA, Meter Rent) ──
  const chargeKeywords = [
    { name: 'Fixed Charge', regex: /\bfixed\s*(?:charges?|fee|amt)|demand\s*charges?\b/i },
    { name: 'Electricity Duty', regex: /\belectricity\s*duty|govt\.?\s*duty|\bed\s*duty\b/i },
    { name: 'FPPPA Charge', regex: /\bfpppa(?:\s*charges?)?|fuel\s*(?:surcharge|adjustment)\b/i },
    { name: 'Meter Rent', regex: /\bmeter\s*(?:rent|charges?)\b/i },
    { name: 'Current Surcharge', regex: /\bcurrent\s*surcharge\b/i }
  ];

  // Try direct line match first: "Fixed Charge = 552.33"
  lines.forEach(line => {
    chargeKeywords.forEach(ck => {
      const directMatch = line.match(new RegExp(`(?:${ck.regex.source})\\s*[:：=\\-]?\\s*(?:₹|rs\\.?)?\\s*([0-9]+(?:\\.[0-9]{1,2})?)`, 'i'));
      if (directMatch) {
        const amt = parseFloat(directMatch[1]);
        if (!isNaN(amt) && amt > 0 && !result.charges.some(c => c.name === ck.name)) {
          result.charges.push({ name: ck.name, amt });
          result.confidence.push(`Found ${ck.name}: ₹${amt}`);
        }
      }
    });
  });

  // If charges not found via direct line, look for tabular column blocks:
  // Labels block followed by values block with =
  if (result.charges.length === 0) {
    for (let i = 0; i < lines.length - 3; i++) {
      if (/energy\s*amount|fixed\s*charge/i.test(lines[i])) {
        // Collect labels
        const labelList = [];
        let j = i;
        while (j < lines.length && !lines[j].startsWith('=') && !/^[0-9]/.test(lines[j]) && labelList.length < 12) {
          labelList.push({ lineIndex: j, text: lines[j] });
          j++;
        }

        // Collect corresponding values
        const valueList = [];
        while (j < lines.length && (lines[j].startsWith('=') || lines[j].startsWith('：') || /^[0-9]/.test(lines[j])) && valueList.length < labelList.length) {
          const valMatch = lines[j].match(/[=：:\s]*(-?[0-9]+(?:\.[0-9]+)?)/);
          if (valMatch) {
            valueList.push(parseFloat(valMatch[1]));
          }
          j++;
        }

        // Map label to value
        labelList.forEach((lbl, idx) => {
          if (idx < valueList.length) {
            const val = valueList[idx];
            chargeKeywords.forEach(ck => {
              if (ck.regex.test(lbl.text) && val > 0 && !result.charges.some(c => c.name === ck.name)) {
                result.charges.push({ name: ck.name, amt: val });
                result.confidence.push(`Found ${ck.name}: ₹${val}`);
              }
            });

            // Check if subsidy / adjustment
            if (/subsidy|rebate|discount/i.test(lbl.text) && Math.abs(val) > 0) {
              const adjAmt = -Math.abs(val);
              result.adjustments.push({ name: lbl.text.trim(), amt: adjAmt });
              result.confidence.push(`Found Adjustment ${lbl.text}: ₹${adjAmt}`);
            }
          }
        });
        break;
      }
    }
  }

  // Ensure default charges structure
  if (result.charges.length === 0) {
    result.charges = [
      { name: 'Fixed Charge', amt: 0 },
      { name: 'Electricity Duty', amt: 0 },
      { name: 'FPPPA Charge', amt: 0 }
    ];
  }

  // ── 5. ADJUSTMENTS / SUBSIDIES ──
  const adjKeywords = [
    { name: 'Tariff Subsidy', regex: /\btariff\s*subsidy|govt\.?\s*subsidy|subsidy\b/i, isDeduction: true },
    { name: 'Rebate', regex: /\bprompt\s*payment\s*rebate|rebate|discount\b/i, isDeduction: true },
    { name: 'Arrear', regex: /\bprincipal\s*arrear|arrears?|past\s*dues?\b/i, isDeduction: false }
  ];

  lines.forEach(line => {
    adjKeywords.forEach(ak => {
      const m = line.match(new RegExp(`(?:${ak.regex.source})\\s*[:：=\\-]?\\s*(?:₹|rs\\.?)?\\s*(-?[0-9]+(?:\\.[0-9]{1,2})?)`, 'i'));
      if (m) {
        const amt = parseFloat(m[1]);
        if (!isNaN(amt) && Math.abs(amt) > 0 && !result.adjustments.some(a => a.name === ak.name)) {
          const finalAmt = ak.isDeduction ? -Math.abs(amt) : Math.abs(amt);
          result.adjustments.push({ name: ak.name, amt: finalAmt });
          result.confidence.push(`Found Adjustment ${ak.name}: ${finalAmt < 0 ? '-' : '+'}₹${Math.abs(finalAmt)}`);
        }
      }
    });
  });

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
