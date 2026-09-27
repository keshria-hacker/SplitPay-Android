/* ═══════════════════════════════════════════════════════════════════
   SplitPay — dom.js
   Micro DOM utility layer.

   Why this exists:
     • Before: every module called document.getElementById repeatedly,
       creating hundreds of identical selector strings scattered across
       six files — a maintenance and typo trap.
     • After: one call site per helper. If an element id changes, fix
       it once here.

   All helpers are null-safe — they silently no-op when the element
   does not exist so callers never need to guard.
   ═══════════════════════════════════════════════════════════════════ */

// ─── QUERY ────────────────────────────────────────────────────────

/** getElementById shorthand — the most-called function in the whole app. */
const $ = id => document.getElementById(id);

/** querySelectorAll shorthand. Returns a static NodeList. */
const $$ = sel => document.querySelectorAll(sel);

// ─── TEXT & HTML ──────────────────────────────────────────────────

function setText(id, val) {
  const el = $(id);
  if (el) el.textContent = val;
}

/**
 * Set innerHTML.
 * WARNING: only call with trusted/escaped content.
 * For user-controlled strings, escape via esc() in utils.js first.
 */
function setHtml(id, html) {
  const el = $(id);
  if (el) el.innerHTML = html;
}

// ─── VISIBILITY ───────────────────────────────────────────────────

/**
 * Show an element.
 * @param {string}  id
 * @param {string}  [display='']   CSS display value ('' restores stylesheet default).
 */
function show(id, display = '') {
  const el = $(id);
  if (el) el.style.display = display;
}

/** Hide an element (display:none). */
function hide(id) {
  const el = $(id);
  if (el) el.style.display = 'none';
}

/** Toggle display between none and its default value. */
function toggleVis(id, visible, display = '') {
  visible ? show(id, display) : hide(id);
}

// ─── CLASS NAMES ──────────────────────────────────────────────────

function addClass(id, ...classes) {
  const el = $(id);
  if (el) el.classList.add(...classes);
}

function removeClass(id, ...classes) {
  const el = $(id);
  if (el) el.classList.remove(...classes);
}

/**
 * Toggle a class on/off.
 * @param {boolean|undefined} [force]  If given, works like classList.toggle(cls, force).
 */
function toggleClass(id, cls, force) {
  const el = $(id);
  if (el) el.classList.toggle(cls, force);
}

/** True if the element currently has the class. */
function hasClass(id, cls) {
  const el = $(id);
  return el ? el.classList.contains(cls) : false;
}

// ─── STYLE ────────────────────────────────────────────────────────

function setStyle(id, prop, val) {
  const el = $(id);
  if (el) el.style[prop] = val;
}

function setCssProp(id, prop, val) {
  const el = $(id);
  if (el) el.style.setProperty(prop, val);
}

// ─── ATTRIBUTES ───────────────────────────────────────────────────

function setAttr(id, attr, val) {
  const el = $(id);
  if (el) el.setAttribute(attr, val);
}

function setHref(id, href) {
  const el = $(id);
  if (el) el.href = href;
}

// ─── INPUT VALUES ─────────────────────────────────────────────────

function getValue(id) {
  const el = $(id);
  return el ? el.value : '';
}

function setValue(id, val) {
  const el = $(id);
  if (el) el.value = val;
}

// ─── BATCH ────────────────────────────────────────────────────────

/**
 * Apply a dict of {id: textContent} pairs in one call.
 * Useful for the runner screen where multiple fields update together.
 *
 *   setTexts({ 'a-count': '2/5', 'a-pamt': '₹1,800', 'a-psub': 'of ₹8,500' });
 */
function setTexts(map) {
  for (const [id, val] of Object.entries(map)) setText(id, val);
}

/**
 * requestAnimationFrame-batched DOM write.
 * Prevents forced reflow by deferring writes to the next paint cycle.
 *
 *   rafWrite(() => { setHtml('split-preview', html); setText('sum-check', '...'); });
 */
function rafWrite(fn) {
  requestAnimationFrame(fn);
}
