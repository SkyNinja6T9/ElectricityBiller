/**
 * Electricity Bill Splitter - Core Application Logic
 * Supports dynamic N parties, OCR Space API auto-extraction,
 * receipt image generation, and WhatsApp text summary.
 */

// ── Global State ──
const PARTIES_STORAGE_KEY = 'electricity_biller_saved_parties';

function loadInitialParties() {
  try {
    const saved = localStorage.getItem(PARTIES_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Could not load saved parties:', e);
  }
  return [
    { id: 1, name: 'M.T', prev: 0, curr: 0, units: 0 },
    { id: 2, name: 'U.G', prev: 0, curr: 0, units: 0 }
  ];
}

let parties = loadInitialParties();
let nextPartyId = parties.reduce((max, p) => Math.max(max, p.id), 0) + 1;
let calculatedBillData = null;
let currentUploadedBase64 = null;

function savePartiesState() {
  try {
    localStorage.setItem(PARTIES_STORAGE_KEY, JSON.stringify(parties));
  } catch (e) {
    console.warn('Could not save parties:', e);
  }
}

// ── DOM References ──
const monthPicker = document.getElementById('currentMonthPicker');
const prevMonthDisplay = document.getElementById('prevMonthDisplay');
const partiesContainer = document.getElementById('partiesContainer');
const slabsContainer = document.getElementById('slabsContainer');
const chargesContainer = document.getElementById('chargesContainer');
const adjustmentsContainer = document.getElementById('adjustmentsContainer');
const adjColHdr = document.getElementById('adjColHdr');
const resultCard = document.getElementById('resultCard');
const resultMonthTag = document.getElementById('resultMonthTag');
const resultBody = document.getElementById('resultBody');
const ocrStatus = document.getElementById('ocrStatus');
const rawTextContainer = document.getElementById('rawTextContainer');
const rawTextContent = document.getElementById('rawTextContent');

// ── Month Formatting ──
function formatMonth(date) {
  return date.toLocaleString('default', { month: 'long', year: 'numeric' });
}

function updatePrevMonth() {
  const val = monthPicker.value;
  if (!val) {
    prevMonthDisplay.textContent = '—';
    return;
  }
  const parts = val.split('-');
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  prevMonthDisplay.textContent = formatMonth(new Date(y, m - 2));
}

// Initialize Month to Current
const now = new Date();
monthPicker.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
updatePrevMonth();
monthPicker.addEventListener('change', updatePrevMonth);

// ── Party Management ──
function renderParties() {
  partiesContainer.innerHTML = '';

  parties.forEach((party, index) => {
    const card = document.createElement('div');
    card.className = 'party-card';
    card.id = `party-row-${party.id}`;

    const canDelete = parties.length > 1;

    card.innerHTML = `
      <div class="party-card-hdr">
        <div class="party-badge">Party #${index + 1}</div>
        <input type="text" class="party-name-input" value="${escapeHtml(party.name)}" placeholder="Party Name" 
               onchange="updatePartyName(${party.id}, this.value)" aria-label="Party Name">
        ${canDelete ? `<button type="button" class="btn-del-party" title="Remove party" onclick="removeParty(${party.id})">×</button>` : ''}
      </div>
      <div class="grid-3 party-readings">
        <div class="form-group">
          <label>Prev Reading</label>
          <input type="number" min="0" placeholder="0" value="${party.prev || ''}" 
                 oninput="updatePartyReading(${party.id}, 'prev', this.value)">
        </div>
        <div class="form-group">
          <label>Curr Reading</label>
          <input type="number" min="0" placeholder="0" value="${party.curr || ''}" 
                 oninput="updatePartyReading(${party.id}, 'curr', this.value)">
        </div>
        <div class="form-group">
          <label>Units Used</label>
          <div class="units-display" id="party-units-${party.id}">${party.units} units</div>
        </div>
      </div>
    `;

    partiesContainer.appendChild(card);
  });

  const countBadge = document.getElementById('partyCountBadge');
  if (countBadge) {
    countBadge.textContent = `${parties.length} Part${parties.length === 1 ? 'y' : 'ies'}`;
  }
}

function addParty(name = null, prev = 0, curr = 0) {
  const partyNum = parties.length + 1;
  const newName = name || `Party ${partyNum}`;
  const newId = nextPartyId++;
  const units = Math.max(0, curr - prev);

  parties.push({ id: newId, name: newName, prev, curr, units });
  savePartiesState();
  renderParties();
}

function removeParty(partyId) {
  if (parties.length <= 1) {
    alert('At least one party is required.');
    return;
  }
  parties = parties.filter(p => p.id !== partyId);
  savePartiesState();
  renderParties();
}

function updatePartyName(partyId, name) {
  const party = parties.find(p => p.id === partyId);
  if (party) {
    party.name = name.trim() || `Party`;
    savePartiesState();
  }
}

function updatePartyReading(partyId, field, val) {
  const party = parties.find(p => p.id === partyId);
  if (!party) return;

  const numVal = parseInt(val, 10) || 0;
  party[field] = numVal;

  party.units = Math.max(0, (party.curr || 0) - (party.prev || 0));
  savePartiesState();
  const unitsEl = document.getElementById(`party-units-${partyId}`);
  if (unitsEl) {
    unitsEl.textContent = `${party.units} units`;
  }
}

// Rollover readings for new billing cycle: copies Current reading to Previous reading
function rolloverReadings() {
  if (!confirm('This will copy all Current readings into Previous readings and reset Current readings to 0 for a new month. Continue?')) {
    return;
  }
  parties.forEach(p => {
    p.prev = p.curr || p.prev || 0;
    p.curr = 0;
    p.units = 0;
  });
  savePartiesState();
  renderParties();
}

// ── Slab Dynamic Rows ──
function addSlab(units = '', rate = '') {
  const div = document.createElement('div');
  div.className = 'dyn-row';
  div.innerHTML = `
    <input type="number" name="unitsConsumed" placeholder="0" min="0" step="1" value="${units}">
    <input type="number" name="unitRate" placeholder="0.00000" min="0" step="0.00001" value="${rate}">
    <button type="button" class="btn-del" onclick="removeRow(this)" title="Delete slab">×</button>
  `;
  slabsContainer.appendChild(div);
}

// ── Charge Dynamic Rows ──
function addCharge(name = '', amt = '') {
  const div = document.createElement('div');
  div.className = 'dyn-row';
  div.innerHTML = `
    <input type="text" name="chargeName" placeholder="Charge Name" value="${escapeHtml(name)}">
    <input type="number" name="chargeAmount" placeholder="0.00" step="0.01" value="${amt}">
    <button type="button" class="btn-del" onclick="removeRow(this)" title="Delete charge">×</button>
  `;
  chargesContainer.appendChild(div);
}

// ── Adjustment Dynamic Rows ──
function addAdjustment(name = '', amt = '') {
  adjColHdr.style.display = '';
  const div = document.createElement('div');
  div.className = 'dyn-row';
  div.innerHTML = `
    <input type="text" name="adjustmentName" placeholder="Adjustment Name" value="${escapeHtml(name)}">
    <input type="text" name="adjustmentAmount" placeholder="-500 or +300" value="${amt}">
    <button type="button" class="btn-del" onclick="removeAdjRow(this)" title="Delete adjustment">×</button>
  `;
  adjustmentsContainer.appendChild(div);
}

function removeRow(btn) {
  btn.parentElement.remove();
}

function removeAdjRow(btn) {
  btn.parentElement.remove();
  if (adjustmentsContainer.children.length === 0) {
    adjColHdr.style.display = 'none';
  }
}

// Helper: Escape HTML strings
function escapeHtml(text) {
  if (!text) return '';
  return text.toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ── OCR Space Integration & File Upload ──
const billFileInput = document.getElementById('billFileInput');
const cameraInput = document.getElementById('cameraInput');
const dropZone = document.getElementById('dropZone');
const previewThumb = document.getElementById('previewThumb');
const scanBtn = document.getElementById('scanBtn');

function handleFileSelection(file) {
  if (!file) return;

  const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  if (!validTypes.includes(file.type)) {
    alert('Please upload a valid JPG, PNG, or PDF electricity bill.');
    return;
  }

  // Show local preview thumbnail
  if (file.type.startsWith('image/')) {
    const reader = new FileReader();
    reader.onload = (e) => {
      previewThumb.src = e.target.result;
      previewThumb.style.display = 'block';
    };
    reader.readAsDataURL(file);
  } else {
    previewThumb.style.display = 'none';
  }

  // Compress & prepare base64
  ocrStatus.className = 'ocr-status visible processing';
  ocrStatus.innerHTML = `<span>⏳ Preparing & optimizing bill image...</span>`;

  OCRClient.compressImage(file)
    .then(base64Data => {
      currentUploadedBase64 = base64Data;
      scanBtn.disabled = false;
      ocrStatus.className = 'ocr-status visible ready';
      ocrStatus.innerHTML = `<span>✅ Bill ready to scan. Click <strong>Scan with OCR</strong> below.</span>`;
    })
    .catch(err => {
      ocrStatus.className = 'ocr-status visible error';
      ocrStatus.innerHTML = `<span>❌ Error reading image: ${escapeHtml(err.message)}</span>`;
    });
}

// Drag & drop handlers
if (dropZone) {
  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add('dragover');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('dragover');
    }, false);
  });

  dropZone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const file = dt.files[0];
    handleFileSelection(file);
  });
}

if (billFileInput) {
  billFileInput.addEventListener('change', (e) => {
    handleFileSelection(e.target.files[0]);
  });
}

if (cameraInput) {
  cameraInput.addEventListener('change', (e) => {
    handleFileSelection(e.target.files[0]);
  });
}

// ── Trigger Scan with OCR Space API ──
if (scanBtn) {
  scanBtn.addEventListener('click', async () => {
    if (!currentUploadedBase64) {
      alert('Please select or capture a bill image first.');
      return;
    }

    scanBtn.disabled = true;
    ocrStatus.className = 'ocr-status visible processing';

    try {
      const passcode = AuthClient.getPasscode();
      const result = await OCRClient.scanBill(currentUploadedBase64, passcode, (msg) => {
        ocrStatus.innerHTML = `<span>⚡ ${escapeHtml(msg)}</span>`;
      });

      if (!result.success || !result.extracted) {
        throw new Error(result.message || 'OCR parsing failed to extract data');
      }

      applyOcrExtractedData(result.extracted, result.rawText);

      const ext = result.extracted;
      let summaryPills = '';
      if (ext.billingMonth) summaryPills += `📅 Month: <strong>${ext.billingMonth}</strong> &nbsp;•&nbsp; `;
      if (ext.meter && ext.meter.unitsConsumed) summaryPills += `⚡ Units: <strong>${ext.meter.unitsConsumed}</strong> (${ext.meter.previousReading || 0} → ${ext.meter.currentReading || 0}) &nbsp;•&nbsp; `;
      if (ext.slabs && ext.slabs.length > 0) summaryPills += `📊 Slabs: <strong>${ext.slabs.length}</strong> &nbsp;•&nbsp; `;
      if (ext.adjustments && ext.adjustments.length > 0) summaryPills += `🎁 Adjustments: <strong>${ext.adjustments.length}</strong> &nbsp;•&nbsp; `;
      if (ext.totalAmount) summaryPills += `💰 Net Bill: <strong>₹${ext.totalAmount}</strong>`;

      ocrStatus.className = 'ocr-status visible success';
      ocrStatus.innerHTML = `
        <div style="font-weight:700;margin-bottom:4px;">✨ Bill Scanned Successfully!</div>
        <div style="font-size:0.78rem;opacity:0.95;margin-bottom:4px;">${summaryPills}</div>
        <div style="font-size:0.74rem;color:#15803d;">Fields below have been auto-populated. Adjust party sub-meters & click Calculate.</div>
      `;

    } catch (err) {
      console.error('Scan error:', err);
      ocrStatus.className = 'ocr-status visible error';
      ocrStatus.innerHTML = `<span>❌ Scan failed: ${escapeHtml(err.message)}</span>`;
    } finally {
      scanBtn.disabled = false;
    }
  });
}

// Apply extracted values to form
function applyOcrExtractedData(data, rawText) {
  // 1. Month
  if (data.billingMonth) {
    monthPicker.value = data.billingMonth;
    updatePrevMonth();
  }

  // 2. Slabs
  if (data.slabs && data.slabs.length > 0) {
    slabsContainer.innerHTML = '';
    data.slabs.forEach(slab => {
      addSlab(slab.units, slab.rate);
    });
  } else if (data.meter && data.meter.unitsConsumed) {
    // If no slabs found, add 1 row with total units
    slabsContainer.innerHTML = '';
    addSlab(data.meter.unitsConsumed, '');
  }

  // 3. Charges
  if (data.charges && data.charges.length > 0) {
    chargesContainer.innerHTML = '';
    data.charges.forEach(ch => {
      addCharge(ch.name, ch.amt > 0 ? ch.amt : '');
    });
  }

  // 4. Adjustments
  if (data.adjustments && data.adjustments.length > 0) {
    adjustmentsContainer.innerHTML = '';
    data.adjustments.forEach(adj => {
      addAdjustment(adj.name, adj.amt);
    });
  }

  // 5. Raw Text Drawer
  if (rawText) {
    rawTextContent.textContent = rawText;
    rawTextContainer.style.display = 'block';
  }

  // 6. Highlight auto-filled fields
  const fields = document.querySelectorAll('#electricityForm input');
  fields.forEach(f => {
    f.classList.add('auto-highlight');
    setTimeout(() => f.classList.remove('auto-highlight'), 1800);
  });
}

// ── Calculation Logic (Multi-Party Split) ──
document.getElementById('electricityForm').addEventListener('submit', function(e) {
  e.preventDefault();

  const val = monthPicker.value;
  const parts = val.split('-');
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const currentMonth = formatMonth(new Date(y, m - 1));
  const previousMonth = formatMonth(new Date(y, m - 2));

  // 1. Collect Parties and Consumed Units
  let totalMetered = 0;
  parties.forEach(p => {
    totalMetered += p.units;
  });

  const numParties = parties.length;
  if (numParties < 1) {
    alert('Please add at least one party to split the bill.');
    return;
  }

  // 2. Slabs Calculation
  let totalUnitsBill = 0;
  let totalUnits = 0;
  const slabData = [];
  const uInputs = document.getElementsByName('unitsConsumed');
  const rInputs = document.getElementsByName('unitRate');

  for (let i = 0; i < uInputs.length; i++) {
    const u = parseFloat(uInputs[i].value) || 0;
    const r = parseFloat(rInputs[i].value) || 0;
    const amt = u * r;
    totalUnitsBill += amt;
    totalUnits += u;
    if (u > 0 || r > 0) {
      slabData.push({ units: u, rate: r, amt });
    }
  }

  // 3. Charges Calculation
  let totalCharges = 0;
  const chargeData = [];
  const cnInputs = document.getElementsByName('chargeName');
  const caInputs = document.getElementsByName('chargeAmount');

  for (let i = 0; i < cnInputs.length; i++) {
    const name = cnInputs[i].value.trim() || 'Charge';
    const a = parseFloat(caInputs[i].value) || 0;
    chargeData.push({ name, amt: a });
    totalCharges += a;
  }

  // 4. Adjustments Calculation
  let totalDed = 0;
  let totalExtra = 0;
  const adjData = [];
  const anInputs = document.getElementsByName('adjustmentName');
  const aaInputs = document.getElementsByName('adjustmentAmount');

  for (let i = 0; i < anInputs.length; i++) {
    const raw = (aaInputs[i].value || '').trim();
    const aAmt = parseFloat(raw) || 0;
    const name = anInputs[i].value.trim() || 'Adjustment';

    if (raw.startsWith('-')) {
      adjData.push({ name, amt: -Math.abs(aAmt) });
      totalDed += Math.abs(aAmt);
    } else {
      adjData.push({ name, amt: Math.abs(aAmt) });
      totalExtra += Math.abs(aAmt);
    }
  }

  // 5. Splitting Mathematics
  const effectiveRate = totalUnits > 0 ? (totalUnitsBill / totalUnits) : 0;
  const otherUnits = totalUnits - totalMetered;
  const otherUnitsCost = otherUnits * effectiveRate;
  
  // Equal shares among N parties
  const splitOther = otherUnitsCost / numParties;
  const splitCharges = totalCharges / numParties;
  const netAdj = totalExtra - totalDed;
  const splitAdj = netAdj / numParties;

  // Compute breakdown for each party
  const partyResults = parties.map(party => {
    const unitsCost = party.units * effectiveRate;
    const totalPayable = unitsCost + splitOther + splitCharges + splitAdj;
    return {
      id: party.id,
      name: party.name,
      prev: party.prev,
      curr: party.curr,
      units: party.units,
      unitsCost: unitsCost,
      splitOther: splitOther,
      splitCharges: splitCharges,
      splitAdj: splitAdj,
      totalPayable: totalPayable
    };
  });

  const grandTotalPayable = partyResults.reduce((acc, p) => acc + p.totalPayable, 0);

  // Store globally for Plain Receipt Export & WhatsApp
  calculatedBillData = {
    currentMonth,
    previousMonth,
    monthPickerValue: val,
    numParties,
    partyResults,
    totalMetered,
    totalUnits,
    totalUnitsBill,
    effectiveRate,
    slabData,
    chargeData,
    totalCharges,
    splitCharges,
    adjData,
    netAdj,
    splitAdj,
    otherUnits,
    otherUnitsCost,
    splitOther,
    grandTotalPayable
  };

  // Render HTML Output
  renderCalculationResults(calculatedBillData);
});

function renderCalculationResults(d) {
  resultMonthTag.textContent = `${d.currentMonth} (${d.numParties} Parties)`;

  let html = '';

  // Warning banner if metered units exceed total bill units
  if (d.otherUnits < 0) {
    html += `
      <div style="background:#fef2f2;border:1.5px solid #fca5a5;color:#991b1b;padding:10px 14px;border-radius:10px;margin-bottom:14px;font-size:0.84rem;line-height:1.4;">
        ⚠️ <strong>Note:</strong> Total party sub-meters (<strong>${d.totalMetered} units</strong>) exceed total billed units (<strong>${d.totalUnits} units</strong>). Please double-check your meter readings.
      </div>
    `;
  }

  // 1. Parties Overview Cards
  html += `<p class="rs-title">Party Consumption Breakdown</p>`;
  d.partyResults.forEach(p => {
    html += `
      <div class="result-party-box">
        <div class="result-party-title">
          <span>👤 ${escapeHtml(p.name)}</span>
          <span class="badge-units">${p.units} units</span>
        </div>
        ${row('Sub-meter Readings', `Prev: ${p.prev} → Curr: ${p.curr}`)}
        ${row(`Units Cost (${p.units} × ₹${d.effectiveRate.toFixed(5)})`, `₹${p.unitsCost.toFixed(2)}`)}
        ${row(`Common/Other Share (÷ ${d.numParties})`, `₹${p.splitOther.toFixed(2)}`)}
        ${row(`Fixed Charges Share (÷ ${d.numParties})`, `₹${p.splitCharges.toFixed(2)}`)}
        ${d.adjData.length > 0 ? row(`Adjustment Share (÷ ${d.numParties})`, `${d.splitAdj >= 0 ? '+' : '−'}₹${Math.abs(p.splitAdj).toFixed(2)}`) : ''}
        <div class="result-party-total">
          <span>${escapeHtml(p.name)} Total Payable</span>
          <span>₹${p.totalPayable.toFixed(2)}</span>
        </div>
      </div>
    `;
  });

  // 2. Units & Slabs
  html += `<p class="rs-title" style="margin-top:22px;">Billed Units & Slab Rates</p>`;
  d.slabData.forEach(s => {
    html += row(`${s.units} units × ₹${s.rate}`, `₹${s.amt.toFixed(2)}`);
  });
  html += row('Total Billed Units', `${d.totalUnits} units`);
  html += row('Total Units Cost', `₹${d.totalUnitsBill.toFixed(2)}`);
  html += row('Effective Unit Rate', `₹${d.effectiveRate.toFixed(5)}/unit`);

  // 3. Other/Common Units Split
  html += `<p class="rs-title">Common / Other Units Split</p>`;
  html += row(`Total Parties Metered Units`, `${d.totalMetered} units`);
  html += row(`Total Billed Units`, `${d.totalUnits} units`);
  html += row(`Other / Common Units`, `${d.otherUnits} units`);
  html += row(`Other Cost (${d.otherUnits} × ₹${d.effectiveRate.toFixed(5)})`, `₹${d.otherUnitsCost.toFixed(2)}`);
  html += row(`Each Party Share (÷ ${d.numParties})`, `₹${d.splitOther.toFixed(2)}`);

  // 4. Charges Split
  if (d.chargeData.length > 0) {
    html += `<p class="rs-title">Charges Split</p>`;
    d.chargeData.forEach(c => {
      const cSign = c.amt < 0 ? '-₹' : '₹';
      html += row(c.name, cSign + Math.abs(c.amt).toFixed(2));
    });
    html += row('Total Charges', (d.totalCharges < 0 ? '-₹' : '₹') + Math.abs(d.totalCharges).toFixed(2));
    html += row(`Each Party Share (÷ ${d.numParties})`, (d.splitCharges < 0 ? '-₹' : '₹') + Math.abs(d.splitCharges).toFixed(2));
  }

  // 5. Adjustments Split
  if (d.adjData.length > 0) {
    html += `<p class="rs-title">Adjustments</p>`;
    d.adjData.forEach(a => {
      const sign = a.amt < 0 ? '-₹' : '+₹';
      html += row(a.name, sign + Math.abs(a.amt).toFixed(2));
    });
    html += row(`Net Adjustment Each Share (÷ ${d.numParties})`, (d.netAdj >= 0 ? '+₹' : '-₹') + Math.abs(d.splitAdj).toFixed(2));
  }

  // 6. Summary Comparison Table
  html += `
    <p class="rs-title" style="margin-top:24px;">Summary Comparison Table</p>
    <div class="summary-table-wrap">
      <table class="summary-table">
        <thead>
          <tr>
            <th>Party</th>
            <th>Units</th>
            <th>Units Cost</th>
            <th>Other</th>
            <th>Charges</th>
            <th>Net Payable</th>
          </tr>
        </thead>
        <tbody>
          ${d.partyResults.map(p => `
            <tr>
              <td><strong>${escapeHtml(p.name)}</strong></td>
              <td>${p.units}</td>
              <td>₹${p.unitsCost.toFixed(2)}</td>
              <td>₹${p.splitOther.toFixed(2)}</td>
              <td>₹${p.splitCharges.toFixed(2)}</td>
              <td class="td-total">₹${p.totalPayable.toFixed(2)}</td>
            </tr>
          `).join('')}
          <tr class="tr-grand-total">
            <td><strong>TOTAL</strong></td>
            <td><strong>${d.totalMetered}</strong></td>
            <td colspan="3"><strong>All Inclusive</strong></td>
            <td class="td-total"><strong>₹${d.grandTotalPayable.toFixed(2)}</strong></td>
          </tr>
        </tbody>
      </table>
    </div>
  `;

  resultBody.innerHTML = html;
  resultCard.classList.add('visible');
  resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function row(lbl, val) {
  return `<div class="result-row"><span class="lbl">${lbl}</span><span class="val">${val}</span></div>`;
}

// ── WhatsApp Summary Generator ──
const copyWhatsappBtn = document.getElementById('copyWhatsappBtn');
if (copyWhatsappBtn) {
  copyWhatsappBtn.addEventListener('click', () => {
    if (!calculatedBillData) return;
    const d = calculatedBillData;

    let text = `⚡ *ELECTRICITY BILL SPLIT — ${d.currentMonth.toUpperCase()}* ⚡\n`;
    text += `📅 Period: ${d.previousMonth} → ${d.currentMonth}\n`;
    text += `💡 Total Billed Units: ${d.totalUnits} units\n`;
    text += `📈 Effective Unit Rate: ₹${d.effectiveRate.toFixed(5)}/unit\n`;
    text += `🔌 Common/Other Units: ${d.otherUnits} units (₹${d.otherUnitsCost.toFixed(2)} ÷ ${d.numParties})\n`;
    text += `\n*📊 SUMMARY BY PARTY:*\n`;
    text += `━━━━━━━━━━━━━━━━━━━━━\n`;

    d.partyResults.forEach(p => {
      text += `👤 *${p.name.toUpperCase()}*:\n`;
      text += `  • Sub-Meter: ${p.units} units (${p.prev} → ${p.curr})\n`;
      text += `  • Units Amount: ₹${p.unitsCost.toFixed(2)}\n`;
      text += `  • Common Share: ₹${p.splitOther.toFixed(2)}\n`;
      text += `  • Fixed Charges Share: ₹${p.splitCharges.toFixed(2)}\n`;
      if (d.adjData.length > 0) {
        text += `  • Adjustment Share: ${p.splitAdj >= 0 ? '+' : '-'}₹${Math.abs(p.splitAdj).toFixed(2)}\n`;
      }
      text += `  👉 *TOTAL PAYABLE: ₹${p.totalPayable.toFixed(2)}*\n\n`;
    });

    text += `━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `💰 *Grand Total Payable: ₹${d.grandTotalPayable.toFixed(2)}*\n`;

    navigator.clipboard.writeText(text).then(() => {
      const originalText = copyWhatsappBtn.innerHTML;
      copyWhatsappBtn.innerHTML = `<span>✅ Copied to Clipboard!</span>`;
      setTimeout(() => {
        copyWhatsappBtn.innerHTML = originalText;
      }, 2500);
    }).catch(err => {
      alert('Could not copy text to clipboard: ' + err);
    });
  });
}

// ── Save PNG (Plain Black & White Bill) ──
const saveBtn = document.getElementById('saveBtn');
if (saveBtn) {
  saveBtn.addEventListener('click', function() {
    if (!calculatedBillData) return;
    const d = calculatedBillData;
    const today = new Date().toLocaleDateString('en-GB');

    const tbl = (head, body) => `
      <table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:12px;">
        <tr>${head.map(h => `<th style="border:1px solid #000;padding:5px;background:#f0f0f0;text-align:left;">${h}</th>`).join('')}</tr>
        ${body}
      </table>
    `;

    const tr = (cells, bold) => `
      <tr>${cells.map(c => `<td style="border:1px solid #000;padding:5px;${bold ? 'font-weight:bold;' : ''}">${c}</td>`).join('')}</tr>
    `;

    const sec = (title) => `<p style="font-weight:bold;margin:12px 0 4px;font-size:13px;border-bottom:1px solid #000;padding-bottom:3px;">${title}</p>`;

    let html = `<div style="font-family:Arial,monospace;color:#000;background:#fff;padding:24px;width:500px;">`;
    html += `<div style="text-align:center;font-size:18px;font-weight:bold;text-decoration:underline;margin-bottom:6px;">ELECTRICITY BILL SPLIT</div>`;
    html += `<p style="font-size:12px;margin:2px 0;">Date: ${today}</p>`;
    html += `<p style="font-size:12px;margin:2px 0 10px;">Billing Period: ${d.previousMonth} → ${d.currentMonth}</p>`;

    // Parties Meter Readings
    html += sec(`Meter Readings (${d.numParties} Parties)`);
    const partyReadingRows = d.partyResults.map(p => tr([p.name, p.prev, p.curr, `${p.units} units`])).join('');
    html += tbl(['Party', 'Prev', 'Curr', 'Consumed'], partyReadingRows);

    // Slabs
    html += sec('Units & Slab Rates');
    let slabRows = d.slabData.map(s => tr([`${s.units} units`, `₹${s.rate}`, `₹${s.amt.toFixed(2)}`])).join('');
    slabRows += tr([`Total: ${d.totalUnits} units`, `Eff. Rate: ₹${d.effectiveRate.toFixed(5)}`, `₹${d.totalUnitsBill.toFixed(2)}`], true);
    html += tbl(['Units', 'Rate', 'Amount'], slabRows);

    // Common/Other units
    html += sec('Common / Other Units Split');
    html += tbl(['Description', 'Value'],
      tr(['Parties metered total', `${d.totalMetered} units`]) +
      tr(['Total billed units', `${d.totalUnits} units`]) +
      tr(['Other units', `${d.otherUnits} units`]) +
      tr([`Other cost (${d.otherUnits} × ₹${d.effectiveRate.toFixed(5)})`, `₹${d.otherUnitsCost.toFixed(2)}`]) +
      tr([`Each party share (÷ ${d.numParties})`, `₹${d.splitOther.toFixed(2)}`], true)
    );

    // Charges
    if (d.chargeData.length > 0) {
      html += sec('Charges');
      let chRows = d.chargeData.map(c => {
        const sign = c.amt < 0 ? '-₹' : '₹';
        return tr([c.name, sign + Math.abs(c.amt).toFixed(2)]);
      }).join('');
      const tcSign = d.totalCharges < 0 ? '-₹' : '₹';
      chRows += tr(['Total Charges', tcSign + Math.abs(d.totalCharges).toFixed(2)], true);
      chRows += tr([`Each share (÷ ${d.numParties})`, (d.splitCharges < 0 ? '-₹' : '₹') + Math.abs(d.splitCharges).toFixed(2)], true);
      html += tbl(['Charge', 'Amount'], chRows);
    }

    // Adjustments
    if (d.adjData.length > 0) {
      html += sec('Adjustments');
      let adjRows = d.adjData.map(a => {
        return tr([a.name, (a.amt < 0 ? '-₹' : '+₹') + Math.abs(a.amt).toFixed(2)]);
      }).join('');
      adjRows += tr([`Net adjustment each share (÷ ${d.numParties})`, (d.netAdj >= 0 ? '+₹' : '-₹') + Math.abs(d.splitAdj).toFixed(2)], true);
      html += tbl(['Adjustment', 'Amount'], adjRows);
    }

    // Final Split
    html += sec('Final Payable Summary');
    const finalHeaders = ['Party', 'Units Cost', 'Other Share', 'Charges Share', 'Total Payable'];
    const finalRows = d.partyResults.map(p => tr([
      p.name,
      `₹${p.unitsCost.toFixed(2)}`,
      `₹${p.splitOther.toFixed(2)}`,
      `₹${p.splitCharges.toFixed(2)}`,
      `₹${p.totalPayable.toFixed(2)}`
    ], true)).join('');
    html += tbl(finalHeaders, finalRows);

    html += `</div>`;

    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;left:-9999px;top:0;';
    wrap.innerHTML = html;
    document.body.appendChild(wrap);

    html2canvas(wrap, { scale: 2, backgroundColor: '#ffffff', useCORS: true }).then(function(canvas) {
      document.body.removeChild(wrap);
      const link = document.createElement('a');
      link.download = `electricity-bill-split-${d.monthPickerValue}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    }).catch(function(err) {
      document.body.removeChild(wrap);
      console.error(err);
      alert('Error generating image');
    });
  });
}

// ── Passcode Gate Handling ──
function initAccessGate() {
  const gateModal = document.getElementById('accessGateModal');
  const gateInput = document.getElementById('passcodeInput');
  const gateBtn = document.getElementById('unlockBtn');
  const gateErr = document.getElementById('gateError');
  const userStatusBadge = document.getElementById('userStatusBadge');

  if (AuthClient.isAuthenticated()) {
    if (gateModal) gateModal.style.display = 'none';
    if (userStatusBadge) userStatusBadge.style.display = 'flex';
  } else {
    if (gateModal) gateModal.style.display = 'flex';
    if (userStatusBadge) userStatusBadge.style.display = 'none';
  }

  if (gateBtn) {
    gateBtn.addEventListener('click', async () => {
      const code = gateInput.value;
      gateBtn.disabled = true;
      gateBtn.textContent = 'Verifying...';
      gateErr.textContent = '';

      const res = await AuthClient.verifyPasscode(code);
      if (res.success) {
        gateModal.style.display = 'none';
        if (userStatusBadge) userStatusBadge.style.display = 'flex';
      } else {
        gateErr.textContent = res.message || 'Invalid passcode';
      }
      gateBtn.disabled = false;
      gateBtn.textContent = 'Unlock Webapp';
    });
  }

  if (gateInput) {
    gateInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        gateBtn.click();
      }
    });
  }

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      if (confirm('Lock this session?')) {
        AuthClient.logout();
      }
    });
  }
}

// Initial Render
document.addEventListener('DOMContentLoaded', () => {
  renderParties();
  initAccessGate();
});
