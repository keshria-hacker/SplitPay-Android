/* ════════════════════════════════════════════════════════════════════
   about.js — SplitPay v3.0
   About modal: open/close, tab switching, MDR savings calculator,
   keyboard trap, and swipe-to-close.
   ════════════════════════════════════════════════════════════════════ */

'use strict';

/* ── open / close ──────────────────────────────────────────────────── */

function openAbout() {
  const modal = document.getElementById('about-modal');
  if (!modal) return;

  modal.classList.remove('hide');
  modal.classList.add('show');
  document.body.style.overflow = 'hidden';

  // Default to "about" tab
  aboutTab('about');
  updateSavingsCalc();

  // Focus first tab button for keyboard nav
  requestAnimationFrame(() => {
    const firstTab = modal.querySelector('.at');
    if (firstTab) firstTab.focus();
  });

  // Keyboard trap
  modal.addEventListener('keydown', _aboutKeydown);
}

function closeAbout() {
  const modal = document.getElementById('about-modal');
  if (!modal) return;

  modal.classList.remove('show');
  modal.classList.add('hide');
  document.body.style.overflow = '';
  modal.removeEventListener('keydown', _aboutKeydown);

  // Return focus to the about button
  const btn = document.getElementById('about-btn');
  if (btn) btn.focus();
}

function _aboutKeydown(e) {
  if (e.key === 'Escape') { closeAbout(); return; }

  // Tab trap — keep focus inside modal
  const focusable = document.getElementById('about-modal')
    .querySelectorAll('button, a, input, select, textarea, [tabindex]:not([tabindex="-1"]), details, summary');
  const first = focusable[0];
  const last  = focusable[focusable.length - 1];
  if (e.key === 'Tab') {
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last)  { e.preventDefault(); first.focus(); }
    }
  }
}

/* ── tab switching ─────────────────────────────────────────────────── */

const _TABS = ['about', 'how', 'faq', 'privacy'];

function aboutTab(name) {
  if (!_TABS.includes(name)) return;

  _TABS.forEach(t => {
    const btn   = document.getElementById('at-' + t);
    const panel = document.getElementById('ap-' + t);
    const active = t === name;
    if (btn)   { btn.classList.toggle('on', active); btn.setAttribute('aria-selected', active); }
    if (panel) { panel.style.display = active ? 'block' : 'none'; }
  });

  // Run calculator when about tab activates
  if (name === 'about') updateSavingsCalc();
}

/* ── MDR savings calculator ────────────────────────────────────────── */

const MDR_RATE       = 0.004;   // 0.4 % on amounts ≥ ₹2,000
const MDR_THRESHOLD  = 2000;
const PART_MAX       = 1999;

function updateSavingsCalc() {
  const input  = document.getElementById('asb-amt');
  const result = document.getElementById('asb-result');
  if (!input || !result) return;

  const raw = parseFloat(input.value);
  if (!raw || isNaN(raw) || raw <= 0) {
    result.innerHTML = '';
    return;
  }
  const amount = Math.round(raw);

  const parts   = Math.ceil(amount / PART_MAX);
  const mdrFee  = amount >= MDR_THRESHOLD ? (amount * MDR_RATE).toFixed(2) : '0.00';
  const saved   = parseFloat(mdrFee);

  if (amount < MDR_THRESHOLD) {
    result.innerHTML = `
      <div class="asb-no-mdr">
        <svg class="icn icn-sm" style="display:inline-block;" aria-hidden="true"><use href="#ic-check"/></svg>
        ₹${fmt(amount)} is under ₹2,000 — no MDR applies. No split needed!
      </div>`;
    return;
  }

  result.innerHTML = `
    <div class="asb-row asb-result-row">
      <span>MDR without SplitPay</span>
      <span class="asb-bad">₹${mdrFee} <small>(0.4%)</small></span>
    </div>
    <div class="asb-row asb-result-row">
      <span>MDR with SplitPay</span>
      <span class="asb-good">₹0.00</span>
    </div>
    <div class="asb-row asb-result-row">
      <span>Parts needed</span>
      <span class="asb-neutral">${parts} × ₹${PART_MAX}</span>
    </div>
    <div class="asb-row asb-save-row">
      <span>You save</span>
      <strong class="asb-save-amt">₹${mdrFee}</strong>
    </div>
    <div class="asb-note">Actual savings go to the <em>merchant</em> — they keep 100% of the amount.</div>`;
}

/* ── Inline MDR hint on amount screen ──────────────────────────────── */
// Called from events.js / input listener — updates the hint below the chips

function updateMdrHint(rawAmount) {
  const hint = document.getElementById('mdr-hint');
  if (!hint) return;

  const amount = parseFloat(rawAmount);
  if (!amount || isNaN(amount) || amount <= 0) {
    hint.style.display = 'none';
    return;
  }

  hint.style.display = 'flex';

  if (amount < MDR_THRESHOLD) {
    hint.className = 'mdr-hint mdr-ok';
    hint.innerHTML = `
      <svg class="icn icn-sm" style="display:inline-block;flex-shrink:0;" aria-hidden="true"><use href="#ic-check"/></svg>
      Under ₹2,000 — no MDR fee applies`;
    return;
  }

  const parts  = Math.ceil(amount / PART_MAX);
  const mdrFee = (amount * MDR_RATE).toFixed(2);

  hint.className = 'mdr-hint mdr-split';
  hint.innerHTML = `
    <svg class="icn icn-sm" style="display:inline-block;flex-shrink:0;" aria-hidden="true"><use href="#ic-bolt"/></svg>
    Splits into <strong>${parts} parts</strong> — saves merchant ₹${mdrFee} MDR fee`;
}

/* ── helper ────────────────────────────────────────────────────────── */

function fmt(n) {
  return Number(n).toLocaleString('en-IN');
}
