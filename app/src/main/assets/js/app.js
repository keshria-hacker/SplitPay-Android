/* ═══════════════════════════════════════════════════════════════════
   SplitPay — app.js
   All UI logic. Extracted from index.html; loaded after the bundled
   QR engines (jsQR.min.js, qrcode.min.js).

   Sections:
     1. State                        6. Payments (auto + turbo)
     2. Theme, haptics & utils       7. Manual mode runner
     3. Navigation & modals          8. Finish, receipt, share, reset
     4. UPI entry & amount           9. Camera + QR scan pipeline
     5. Split algorithms            10. Android bridge patches (IIFE)

   Global contract with MainActivity.kt (keep these names):
     onVisReturn() · onAppBack() · onAppDialogResult(a, b)
   ═══════════════════════════════════════════════════════════════════ */
// ─── STATE ───
const S = {
  total:0, upi:'', name:'', note:'', splits:[], splitMode:'equal', customParts:null,
  paid:[], failed:[], refs:[], mode:'auto', turbo:true, cur:0, running:false, awaiting:false,
  confirmFor:'auto', cdTimer:null, mPendingIdx:-1
};

// ─── THEME & UTILS ───
function toggleTheme(){
  haptic('light');
  const r = document.documentElement;
  const current = r.getAttribute('data-theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  r.setAttribute('data-theme', current === 'dark' ? 'light' : 'dark');
}

function haptic(t='light'){if(navigator.vibrate){const p={light:15,medium:30,heavy:[40,30,40],error:[50,50,50]};navigator.vibrate(p[t]||15);}}

let toastTimer;
function toast(msg, err=false){
  haptic(err?'error':'light');
  const t=document.getElementById('toast');
  clearTimeout(toastTimer);
  document.getElementById('toast-msg').textContent = msg;
  const icn = t.querySelector('.icn use');
  icn.setAttribute('href', err ? '#ic-x' : '#ic-check');
  t.style.background = err ? 'var(--surf2)' : 'var(--ink)';
  t.style.color = err ? 'var(--ink)' : 'var(--bg)';
  t.style.borderColor = err ? 'var(--err)' : 'var(--bdr)';
  t.classList.add('show');
  toastTimer=setTimeout(()=>t.classList.remove('show'),3200);
}

function shakeEl(id){const el=document.getElementById(id);if(!el)return;el.classList.remove('shake');void el.offsetWidth;el.classList.add('shake');haptic('error');}
function validateUPI(v){return/^[a-zA-Z0-9.\-_+]+@[a-zA-Z0-9]+$/.test(v.trim());}
/* HTML-escape user-controlled strings (payee name/UPI from QR scans) before
   they touch innerHTML — blocks script injection via malicious QR codes. */
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function makeRef(p){return'LGR'+Date.now().toString(36).slice(-4).toUpperCase()+'P'+p;}

// ─── SCREEN NAV & MODALS ───
// Track the last step so goTo() can pick a direction-aware transition:
// forward steps slide in from the right, going back slides from the left.
let _lastStep = 1;
function goTo(n){
  const nStr=String(n);
  const stepNum={'1':1,'2':2,'3':3,'4a':4,'4b':4,'5':5}[nStr]||+n;
  const fwd=stepNum>=_lastStep;                 // 4a↔4b swaps are lateral
  _lastStep=stepNum;
  document.querySelectorAll('.screen').forEach(s=>{s.classList.remove('active','slide-fwd','slide-back');});
  const el=document.getElementById('sc'+n);if(!el)return;
  el.classList.add('active',fwd?'slide-fwd':'slide-back');
  var appMain=document.getElementById('app-main');
  if(appMain){var w=appMain.querySelector('.screen.active .wrap');if(w)w.scrollTop=0;}
  // Stepbar: earlier steps are done; on the receipt screen step 4 counts as done.
  [1,2,3,4].forEach(i=>{
    const d=document.getElementById('sd'+i);if(!d)return;
    d.classList.remove('act','done');
    if(i<stepNum||(stepNum===5&&i===4))d.classList.add('done');
    else if(i===stepNum)d.classList.add('act');
    const l=document.getElementById('sl'+i+(i+1));if(l)l.classList.toggle('done',i<stepNum||(stepNum===5));
  });
}

function closeModal(id){document.getElementById(id).classList.add('hide');}
// Backdrop click closes the sheet. Accepts the event explicitly; falls back
// to window.event for older call sites (Chromium keeps it working).
function bgClickModal(id, ev){var t=ev||window.event;if(t&&t.target&&t.target.id===id)closeModal(id);}
// Re-showing a hidden sheet re-triggers its slide-up animation by forcing a
// reflow between .hide and the next show — without this the sheet pops in
// with no motion the second time around.
function openModal(id){
  const m=document.getElementById(id);if(!m)return;
  m.classList.remove('hide');
  const sheet=m.querySelector('.msheet');
  if(sheet){sheet.style.animation='none';void sheet.offsetWidth;sheet.style.animation='';}
}
function showConfirmSheet(title,sub,forMode){
  S.confirmFor=forMode;
  document.getElementById('sh-title').textContent=title;
  document.getElementById('sh-sub').textContent=sub;
  openModal('confirm-modal');
  haptic('medium');
}
function onConfirm(ok){
  closeModal('confirm-modal');
  if(S.confirmFor==='manual')doManualConfirm(ok);
  else doAutoConfirm(ok);
}

// ─── UPI LOGIC ───
function upiTab(t){
  haptic('light');
  ['scan','type'].forEach(x=>{
    document.getElementById('t-'+x).classList.toggle('on',x===t);
    document.getElementById('tp-'+x).classList.toggle('on',x===t);
  });
}
async function pasteUPI(){
  haptic('light');
  let text='';
  try{
    if(navigator.clipboard&&navigator.clipboard.readText){text=await navigator.clipboard.readText();}
    else{text=prompt('Paste UPI ID or link:');}
  }catch(e){text=prompt('Paste your UPI ID:');}
  if(text&&text.trim()){
    if(text.includes('pa=')||text.startsWith('upi://')){handleScan(text);}
    else{document.getElementById('iupi').value=text.trim();}
  }
}

function toStep2(){
  S.upi=document.getElementById('iupi').value.trim();
  S.name=document.getElementById('iname').value.trim();
  if(!S.upi){shakeEl('iupi');toast('Enter or scan a UPI ID',true);return;}
  if(!validateUPI(S.upi)){shakeEl('iupi');toast('Invalid UPI format',true);return;}
  const dName=S.name||(S.upi.split('@')[0].charAt(0).toUpperCase()+S.upi.split('@')[0].slice(1));
  document.getElementById('pb-name').textContent=dName;
  document.getElementById('pb-upi-val').textContent=S.upi;
  document.getElementById('pb-av').textContent=dName.charAt(0).toUpperCase();
  goTo(2);haptic('medium');
}

// ─── CHIPS / AMOUNT ───
// App cap: ₹10,000 per transaction (product decision — keeps installment
// sequences short). Split math itself still respects the ₹1,999 MDR limit.
const AMT_MAX=10000;
function sanitizeAmount(el){
  let v=parseFloat(el.value);
  if(!isFinite(v)||v<0){el.value='';syncChips();return;}
  if(v>AMT_MAX){el.value=AMT_MAX;toast('Max amount ₹'+AMT_MAX.toLocaleString('en-IN'),true);}
  syncChips();
}
function sa(v){haptic('light');document.getElementById('iamt').value=v;syncChips();}
function syncChips(){
  const v=parseFloat(document.getElementById('iamt').value)||0;
  const map=[2500,5000,10000];
  document.querySelectorAll('.chip').forEach((c,i)=>c.classList.toggle('on',map[i]===v));
}

// ─── SPLIT ALGOS ───
function toStep3(){
  // Integer rupees only — keeps every split mathematically exact (no float dust)
  let total=Math.floor(parseFloat(document.getElementById('iamt').value)||0);
  if(!total||total<=0){shakeEl('iamt');toast('Enter a valid amount',true);return;}
  if(total>AMT_MAX){total=AMT_MAX;document.getElementById('iamt').value=AMT_MAX;toast('Capped at ₹'+AMT_MAX.toLocaleString('en-IN'),true);}
  S.total=total;S.note=document.getElementById('inote').value.trim();
  S.customParts=getMin(total);S.splitMode='equal';
  S.splits=equalSplit(total,S.customParts);
  S.paid=S.splits.map(()=>false);S.failed=S.splits.map(()=>false);S.refs=S.splits.map((_,i)=>makeRef(i+1));
  document.getElementById('sc-val').textContent=S.customParts;
  document.getElementById('st-eq').classList.add('on');document.getElementById('st-rnd').classList.remove('on');
  document.getElementById('reshuffle-btn').style.display='none';
  renderPreview();goTo(3);haptic('medium');
}

const MAX_PART = 1999;
function getMin(total){return Math.max(1,Math.ceil(total/MAX_PART));}
function getMaxParts(total){return Math.max(1,Math.min(200,Math.floor(total)));}
function clampPartCount(total,n){
  const min=getMin(total), max=getMaxParts(total);
  n=Math.floor(Number(n)||min);
  return Math.max(min,Math.min(max,n));
}

/* Split `rem` into k parts of equal base with the leftover ₹1s spread over
   the first parts (e.g. 100/3 → [34,33,33] instead of [33,33,34]). */
function evenParts(rem,k){
  const base=Math.floor(rem/k);let left=rem-base*k;
  return Array.from({length:k},()=>{const v=base+(left>0?1:0);if(left>0)left--;return v;});
}
function equalSplit(total,n){
  n=clampPartCount(total,n);if(n<=1)return[total];
  return evenParts(total,n);
}

/* ── Distinct random split ──────────────────────────────────────────────
   Rule: NO two parts may share the same amount.

   Construction (always valid, O(n), no retries, no dead ends):
     part_i = i + x_i  where x is a NON-DECREASING random composition of
       E = total − n(n+1)/2   with every x_i ≤ C = 1999 − n.
     Non-decreasing x ⇒ strictly increasing parts ⇒ all amounts UNIQUE.
     x_n ≤ 1999−n ⇒ part_n ≤ 1999; part_1 ≥ 1. Σ parts = total exactly.

   Feasibility of n distinct parts in [1,1999]:
     min possible sum = 1+2+…+n            → n(n+1)/2 ≤ total
     max possible sum = 1999+1998+…        → total ≤ n(3999−n)/2
   e.g. ₹10,000 needs ≥ 6 parts (5 parts cap out at ₹9,985).
   distinctBounds() returns the feasible part-count band; callers clamp
   into it so the slider/plan never produces an impossible request. */
function distinctBounds(total){
  let nMin=1;while(nMin<1999&&nMin*(3999-nMin)/2<total)nMin++;
  let nMax=Math.min(200,1999,Math.floor((Math.sqrt(8*total+1)-1)/2));
  if(nMax<nMin)nMax=nMin;
  return[nMin,nMax];
}
function clampPartsForMode(total,n,mode){
  if(mode==='random'){
    const[a,b]=distinctBounds(total);
    return Math.max(a,Math.min(b,Math.floor(Number(n)||a)));
  }
  return clampPartCount(total,n);
}
function randomSplit(total,n){
  const[loN,hiN]=distinctBounds(total);
  n=Math.max(loN,Math.min(hiN,Math.floor(Number(n)||loN)));
  if(n<=1)return[total];
  const E=total-n*(n+1)/2;      // ≥ 0 and ≤ n·(1999−n) by feasibility
  const C=1999-n;               // cap for every x slot (x_n binds the rest)
  const xs=new Array(n);let rem=E;
  for(let i=0;i<n;i++){
    const left=n-i;
    const lo=Math.max(0,rem-(left-1)*C);   // leave enough for remaining slots
    const hi=Math.min(C,rem);               // never exceed the slot cap
    xs[i]=Math.round(lo+Math.random()*(hi-lo));
    rem-=xs[i];
  }
  xs.sort((a,b)=>a-b);          // non-decreasing ⇒ strictly increasing parts
  return xs.map((x,i)=>i+1+x);
}
function adjParts(d){
  haptic('light');
  const min=getMin(S.total);
  let max=getMaxParts(S.total);
  if(S.splitMode==='random'){
    const[a,b]=distinctBounds(S.total);
    max=Math.max(min,b);
  }
  let cur=(S.customParts||min)+d;
  if(cur<min){toast(`Minimum ${min} parts required`,true);cur=min;}
  if(cur>max){toast(`Maximum ${max} parts for ₹${S.total.toLocaleString('en-IN')}`,true);cur=max;}
  S.customParts=cur;document.getElementById('sc-val').textContent=cur;
  S.splits=S.splitMode==='random'?randomSplit(S.total,cur):equalSplit(S.total,cur);
  S.refs=S.splits.map((_,i)=>makeRef(i+1));
  renderPreview();
}
function setSplitMode(m){
  haptic('light');S.splitMode=m;
  S.customParts=clampPartsForMode(S.total,S.customParts||getMin(S.total),m);
  document.getElementById('sc-val').textContent=S.customParts;
  document.getElementById('st-eq').classList.toggle('on',m==='equal');
  document.getElementById('st-rnd').classList.toggle('on',m==='random');
  document.getElementById('reshuffle-btn').style.display=m==='random'?'':'none';
  S.splits=m==='equal'?equalSplit(S.total,S.customParts):randomSplit(S.total,S.customParts);
  renderPreview();
}
function reshuffle(){haptic('medium');S.customParts=clampPartsForMode(S.total,S.customParts||getMin(S.total),'random');S.splits=randomSplit(S.total,S.customParts);document.getElementById('sc-val').textContent=S.customParts;renderPreview();toast('Amounts reshuffled');}
function renderPreview(){
  const max=Math.max(...S.splits);
  document.getElementById('split-preview').innerHTML=S.splits.map((a,i)=>`
    <div class="spi">
      <div class="spi-n">${i+1}</div>
      <div class="spi-amt"><input type="tel" inputmode="numeric" value="${a}" onchange="editPart(${i},this.value)" style="border-color:${a>1999?'var(--err)':a<1?'var(--err)':'var(--bdr)'}"></div>
      <div class="spi-bar-wrap"><div class="spi-bar" style="width:${(a/max*100).toFixed(1)}%"></div></div>
    </div>`).join('');
  const sum=S.splits.reduce((a,v)=>a+v,0);
  const dup=S.splitMode==='random'&&new Set(S.splits).size!==S.splits.length;
  const ok=sum===S.total&&S.splits.every(p=>p>=1&&p<=MAX_PART)&&!dup;
  const el=document.getElementById('sum-check');
  el.className='sum-check '+(ok?'ok':'err');
  el.innerHTML=ok?`<svg class="icn icn-sm" style="display:inline-block;"><use href="#ic-check"></use></svg> ₹${S.total.toLocaleString('en-IN')} via ${S.splits.length} parts`:(dup?`<svg class="icn icn-sm" style="display:inline-block;"><use href="#ic-x"></use></svg> Duplicate amounts — every part must be unique`:`<svg class="icn icn-sm" style="display:inline-block;"><use href="#ic-x"></use></svg> Sum Mismatch: ₹${sum.toLocaleString('en-IN')}`);
}
function editPart(idx,raw){
  const v=Math.max(1,parseInt(raw)||0);S.splits[idx]=v;
  if(idx!==S.splits.length-1){
    const others=S.splits.reduce((a,x,i)=>i===S.splits.length-1?a:a+x,0);
    // Exact remainder — even if <1, so the sum-check (not silent rounding)
    // tells the user to fix the imbalance. startPay() blocks invalid plans.
    S.splits[S.splits.length-1]=S.total-others;
    const inputs=document.getElementById('split-preview').querySelectorAll('input');
    if(inputs[S.splits.length-1])inputs[S.splits.length-1].value=S.splits[S.splits.length-1];
  }
  renderPreview();
}

// ─── PAYMENTS ───
function mkLink(amt,part,ref){
  const qs=new URLSearchParams({pa:S.upi,pn:S.name||'Merchant',am:amt.toFixed(2),cu:'INR',tn:(S.note||'Ledger')+' P'+part+'/'+S.splits.length,tr:ref}).toString();
  return'upi://pay?'+qs;
}

function pickMode(k){
  haptic('light');S.mode=k;
  document.getElementById('mc-auto').classList.toggle('on',k==='auto');
  document.getElementById('mc-man').classList.toggle('on',k==='manual');
  document.getElementById('turbo-row').style.display=k==='auto'?'flex':'none';
}

function startPay(){
  if(S.splits.some(p=>p>MAX_PART)){toast('Fix parts over ₹'+MAX_PART+' first',true);return;}
  if(S.splits.some(p=>p<1)){toast('Every part must be at least ₹1',true);return;}
  if(S.splits.reduce((a,v)=>a+v,0)!==S.total){toast('Parts do not match total',true);return;}
  if(S.splitMode==='random'&&new Set(S.splits).size!==S.splits.length){toast('Random plan: every part needs a different amount',true);return;}
  haptic('heavy');
  S.turbo=document.getElementById('turbo-chk').checked;
  S.cur=0;S.running=true;S.awaiting=false;
  S.paid=S.splits.map(()=>false);S.failed=S.splits.map(()=>false);S.refs=S.splits.map((_,i)=>makeRef(i+1));
  
  document.getElementById('a-lbl').textContent=S.turbo?'Turbo Sequence':'Auto Progress';
  if(S.mode==='auto'){goTo('4a');buildDots('a-dots');runPart(0);}
  else{goTo('4b');buildDots('m-dots');buildManualList();document.getElementById('m-count').textContent='0/'+S.splits.length;}
}

function buildDots(id){
  const c=document.getElementById(id);c.innerHTML='';
  S.splits.forEach((_,i)=>{const d=document.createElement('div');d.className='dot'+(i===0?' cur':'');d.id=id+'-d'+i;c.appendChild(d);});
}
function refreshDots(id){
  S.splits.forEach((_,i)=>{
    const d=document.getElementById(id+'-d'+i);if(!d)return;
    d.className='dot';
    if(S.paid[i])d.classList.add('ok');
    else if(S.failed[i])d.classList.add('fail');
    else if(i===S.cur)d.classList.add('cur');
  });
}

// ─── DYNAMIC QR CODE INJECTOR ───
function drawQR(link) {
  const box = document.getElementById('qr-box');
  box.innerHTML = '';
  new QRCode(box, {
    text: link,
    width: 200,
    height: 200,
    colorDark : "#000000",
    colorLight : "#ffffff",
    correctLevel : QRCode.CorrectLevel.M
  });
  openModal('qr-modal');
}
function openCurQR() { haptic('light'); drawQR(mkLink(S.splits[S.cur], S.cur+1, S.refs[S.cur])); }
function showManualQR(i) { haptic('light'); drawQR(mkLink(S.splits[i], i+1, S.refs[i])); }

// EXPLICIT DONE ACTIONS
function markCurDone() { haptic('medium'); doAutoConfirm(true); }
function mDone(i) { haptic('medium'); S.mPendingIdx = i; doManualConfirm(true); }

// ─── AUTO MODE RUNNER ───
function runPart(i){
  if(i>=S.splits.length){finish();return;}
  S.cur=i;
  const amt=S.splits[i],ref=S.refs[i];
  document.getElementById('a-count').textContent=(i+1)+'/'+S.splits.length;
  document.getElementById('a-ppart').textContent='Part '+(i+1)+' of '+S.splits.length;
  document.getElementById('a-pamt').textContent='₹'+amt.toLocaleString('en-IN');
  document.getElementById('a-psub').textContent='of ₹'+S.total.toLocaleString('en-IN')+' total';
  
  const btn=document.getElementById('a-link');
  btn.href=mkLink(amt,i+1,ref);
  
  document.getElementById('a-retry').style.display='none';
  document.getElementById('a-paybig').style.display='block';
  document.getElementById('a-cd').style.display='none';
  document.getElementById('a-ts').style.display='none';
  
  refreshDots('a-dots');
  S.awaiting=true;
}

function onOpen(){haptic('light');S.awaiting=true;}

function retryCur(){
  haptic('light');
  const link = mkLink(S.splits[S.cur], S.cur+1, S.refs[S.cur]);
  const a = document.createElement('a');
  a.href = link;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  S.awaiting=true;
  document.getElementById('a-retry').style.display='flex';
}

function onVisReturn(){
  if(!S.awaiting||!S.running)return;
  S.awaiting=false;clearInterval(S.cdTimer);
  if(S.mode==='auto'){
    document.getElementById('a-cd').style.display='none';
    document.getElementById('a-ts').style.display='none';
    document.getElementById('a-paybig').style.display='block';
    if(S.turbo&&S.cur>0){
        setTimeout(()=>{
            S.paid[S.cur]=true;refreshDots('a-dots');
            const n=S.cur+1;
            if(n>=S.splits.length){finish();}else{launchTurbo(n);}
        },350);
    }
    else{setTimeout(()=>showConfirmSheet('Part '+(S.cur+1)+' done?','Did ₹'+S.splits[S.cur].toLocaleString('en-IN')+' process successfully?','auto'),450);}
  }else{
    if(S.mPendingIdx>=0){
      const idx=S.mPendingIdx;S.mPendingIdx=-1;
      setTimeout(()=>showConfirmSheet('Part '+(idx+1)+' done?','Did ₹'+S.splits[idx].toLocaleString('en-IN')+' process successfully?','manual'),450);
    }
  }
}
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible'){
    onVisReturn();
  } else {
    closeCam();
  }
});
window.addEventListener('focus',onVisReturn);

function doAutoConfirm(ok){
  const i=S.cur;S.paid[i]=ok;S.failed[i]=!ok;
  if(!ok){document.getElementById('a-retry').style.display='flex';toast('Marked as failed',true);haptic('error');return;}
  haptic('medium');
  const n=i+1;refreshDots('a-dots');
  if(n>=S.splits.length){finish();return;}
  if(S.turbo){launchTurbo(n);}else{startCountdown(n);}
}

// ─── AUTO-LAUNCH FIX ───
function launchTurbo(nextI){
  document.getElementById('a-paybig').style.display='none';
  const ts=document.getElementById('a-ts');ts.style.display='block';
  document.getElementById('ts-ttl').textContent='Part '+(nextI+1)+' launching';
  const f=document.getElementById('ts-fill');f.style.animation='none';f.offsetHeight;f.style.animation='';
  
  setTimeout(() => {
    runPart(nextI);
    // Simulating DOM Anchor Click for high reliability on mobile
    const link = mkLink(S.splits[nextI], nextI+1, S.refs[nextI]);
    const a = document.createElement('a');
    a.href = link;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, 850);
}

function startCountdown(nextI){
  document.getElementById('a-paybig').style.display='none';
  document.getElementById('a-cd').style.display='block';
  let v=3;document.getElementById('a-cdnum').textContent=v;
  S.cdTimer=setInterval(()=>{v--;document.getElementById('a-cdnum').textContent=v;if(v<=0){clearInterval(S.cdTimer);runPart(nextI);}},1000);
}

function pauseAuto(){haptic('light');clearInterval(S.cdTimer);document.getElementById('a-cd').style.display='none';document.getElementById('a-paybig').style.display='block';S.awaiting=true;toast('Sequence Paused');}

// ─── MANUAL MODE RUNNER ───
function buildManualList(){
  const list=document.getElementById('mlist');list.innerHTML='';
  S.splits.forEach((amt,i)=>{
    const div=document.createElement('div');div.className='mi'+(i===0?' cur':'');div.id='mi'+i;
    // Stagger index for the entry animation (CSS caps the delay at 10 rows).
    div.style.setProperty('--i', Math.min(i,10));
    const link=mkLink(amt,i+1,S.refs[i]);
    div.innerHTML=`
      <div class="mi-num" id="mn${i}">${i+1}</div>
      <div class="mi-body">
        <div class="mi-amt">₹${amt.toLocaleString('en-IN')}</div>
        <div class="mi-ref">Ref: ${S.refs[i]}</div>
      </div>
      <div id="mia${i}" style="display:flex; gap:8px;">
        ${i===0
          ? `<button class="btn btn-ghost btn-sm" style="padding:12px; border-radius:6px;" onclick="showManualQR(${i})"><svg class="icn icn-sm" style="display:inline-block;"><use href="#ic-qr"></use></svg></button>
             <a href="${link}" class="btn btn-pri btn-sm" style="padding:12px 16px; border-radius:6px;" onclick="mPay(${i})">Pay</a>
             <button class="btn btn-ghost btn-sm" style="padding:12px; border-radius:6px; color:var(--ok); border-color:var(--ok);" onclick="mDone(${i})"><svg class="icn icn-sm" style="display:inline-block;"><use href="#ic-check"></use></svg></button>`
          : '<span class="btn btn-ghost btn-sm" style="opacity:0.3;pointer-events:none; padding:12px 16px;">Wait</span>'}
      </div>`;
    list.appendChild(div);
  });
}
function mPay(i){haptic('light');S.mPendingIdx=i;S.awaiting=true;}

function doManualConfirm(ok){
  const i=S.mPendingIdx>=0?S.mPendingIdx:S.cur;
  S.mPendingIdx=-1;
  S.paid[i]=ok;S.failed[i]=!ok;haptic(ok?'medium':'error');
  const num=document.getElementById('mn'+i);const item=document.getElementById('mi'+i);
  item.classList.remove('cur');item.classList.add(ok?'ok':'fail');
  num.innerHTML=ok?'<svg class="icn icn-sm" style="display:inline-block;"><use href="#ic-check"></use></svg>':'<svg class="icn icn-sm" style="display:inline-block;"><use href="#ic-x"></use></svg>';
  const done=S.paid.filter(Boolean).length;
  document.getElementById('m-count').textContent=done+'/'+S.splits.length;
  refreshDots('m-dots');
  const next=i+1;
  if(next>=S.splits.length){setTimeout(finish,350);return;}
  const ni=document.getElementById('mi'+next);ni.classList.add('cur');
  ni.scrollIntoView({behavior:'smooth',block:'nearest'});
  const nl=mkLink(S.splits[next],next+1,S.refs[next]);
  document.getElementById('mia'+next).innerHTML=`
    <button class="btn btn-ghost btn-sm" style="padding:12px; border-radius:6px;" onclick="showManualQR(${next})"><svg class="icn icn-sm" style="display:inline-block;"><use href="#ic-qr"></use></svg></button>
    <a href="${nl}" class="btn btn-pri btn-sm" style="padding:12px 16px; border-radius:6px;" onclick="mPay(${next})">Pay</a>
    <button class="btn btn-ghost btn-sm" style="padding:12px; border-radius:6px; color:var(--ok); border-color:var(--ok);" onclick="mDone(${next})"><svg class="icn icn-sm" style="display:inline-block;"><use href="#ic-check"></use></svg></button>`;
  toast(ok?'Next unlocked':'Marked failed',!ok);
}

async function skipCur(){
  const ok=window.appConfirm?await window.appConfirm('Skip Part','Skip part '+(S.cur+1)+' of '+S.splits.length+'?','Skip','Keep'):confirm('Skip part '+(S.cur+1)+'?');
  if(!ok)return;S.failed[S.cur]=true;S.awaiting=false;clearInterval(S.cdTimer);const n=S.cur+1;if(n>=S.splits.length){finish();return;}if(S.turbo)launchTurbo(n);else runPart(n);}
async function cancelAll(){
  const ok=window.appConfirm?await window.appConfirm('Cancel Sequence','Cancel the entire payment sequence?','Cancel','Keep Going'):confirm('Cancel entire sequence?');
  if(!ok)return;S.running=false;S.awaiting=false;clearInterval(S.cdTimer);goTo(1);}
// Hardware back during execution → route through the same confirmations
// instead of instantly killing the sequence (or triggering native exit).
function onAppBack(){
  try{
  // 1. Close the top-most overlay first (camera scanner, QR sheet, confirm sheet)
  var cam=document.getElementById('cam-modal');
  if(cam&&!cam.classList.contains('hide')){closeCam();return true;}
  var qrm=document.getElementById('qr-modal');
  if(qrm&&!qrm.classList.contains('hide')){closeModal('qr-modal');return true;}
  var cfm=document.getElementById('confirm-modal');
  if(cfm&&!cfm.classList.contains('hide')){closeModal('confirm-modal');return true;}
  // 2. While a sequence runs, ask before killing it
  if(S.running){
    if(S.mode==='manual'||S.awaiting){cancelAll();return true;}
    return false;                              // countdown/turbo flight → native exit popup
  }
  return false;                                // not running → native exit popup
  }catch(e){return false;}                     // any JS error → native exit popup
}

// ─── MDR SAVINGS ALGORITHM (SEPTEMBER 2026 NPCI RULES) ───
function calcMdrSavings(totalAmount) {
  // Free up to 2000. Above 2000 attracts 0.4% MDR capped at 300 INR.
  if (totalAmount <= 2000) return 0;
  let fee = totalAmount * 0.004;
  return Math.min(fee, 300);
}

// ─── FINISH ───
function finish(){
  haptic('heavy');S.running=false;S.awaiting=false;clearInterval(S.cdTimer);
  const pn=S.paid.filter(Boolean).length;
  const pa=S.splits.filter((_,i)=>S.paid[i]).reduce((a,v)=>a+v,0);
  document.getElementById('d-total').textContent='₹'+pa.toLocaleString('en-IN');
  document.getElementById('d-parts').textContent=pn+'/'+S.splits.length;
  document.getElementById('d-title').textContent=pn===S.splits.length?'Payment Complete':'Partial Payment';
  document.getElementById('d-sub').textContent=pn===S.splits.length?'Sequence finished successfully.':'Some parts were skipped or failed.';
  
  // Inject Savings Logic
  const savingsAmount = calcMdrSavings(S.total);
  if(savingsAmount > 0) {
      document.getElementById('d-savings-card').style.display = 'block';
      document.getElementById('d-savings-val').textContent = '₹' + savingsAmount.toFixed(2);
  } else {
      document.getElementById('d-savings-card').style.display = 'none';
  }

  const rec=document.getElementById('d-receipt');
  rec.innerHTML=`
    <div class="receipt-row"><span class="label">Payee</span><span class="val">${esc(S.name||S.upi)}</span></div>
    <div class="receipt-row"><span class="label">Total</span><span class="val">₹${S.total.toLocaleString('en-IN')}</span></div>
    ${S.splits.map((a,i)=>`<div class="receipt-row"><span class="label">Part ${i+1}</span><span class="val">₹${a.toLocaleString('en-IN')}${S.paid[i]?'✓':S.failed[i]?'✕':''}</span></div>`).join('')}`;
  goTo(5);
}

// ─── SHARE & RESET ───
function buildReceipt(){
  const pn=S.paid.filter(Boolean).length;
  return`SplitPay Ledger\n───────────────\nPayee: ${S.name||S.upi}\nUPI ID: ${S.upi}\nTotal: ₹${S.total.toLocaleString('en-IN')}\nParts: ${pn}/${S.splits.length} Complete\n${S.splits.map((a,i)=>` [${i+1}] ₹${a.toLocaleString('en-IN')}${S.paid[i]?'✓':S.failed[i]?'✕':'-'}`).join('\n')}\n───────────────`;
}
function shareWA(){
  const txt=S.total>0?buildReceipt():`SplitPay Ledger — Smart Installments`;
  window.open('https://wa.me/?text='+encodeURIComponent(txt),'_blank');
}
function copyReceipt(){navigator.clipboard?.writeText(buildReceipt()).then(()=>toast('Record Copied')).catch(()=>toast('Copy Failed',true));}

function reset(){
  Object.assign(S,{total:0,upi:'',name:'',note:'',splits:[],splitMode:'equal',customParts:null,paid:[],failed:[],refs:[],mode:'auto',turbo:true,cur:0,running:false,awaiting:false,confirmFor:'auto',cdTimer:null,mPendingIdx:-1});
  ['iamt','iupi','iname','inote'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  pickMode('auto');
  document.getElementById('turbo-chk').checked=true;
  syncChips();upiTab('scan');goTo(1);haptic('medium');
}

// ─── CAMERA LOGIC ───
let camStream=null,camRunning=false,camTorchOn=false;
function openCam(){
  haptic('medium');
  if(!window.isSecureContext){toast('Camera requires HTTPS',true);return;}
  if(!navigator.mediaDevices?.getUserMedia){toast('Camera blocked. Use File Upload.',true);return;}
  document.getElementById('cam-modal').classList.remove('hide');
  const tries=[{video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}},{video:{facingMode:'environment'}},{video:true}];
  async function attempt(n){
    if(n>=tries.length){toast('Camera access denied',true);closeCam();return;}
    try{const s=await navigator.mediaDevices.getUserMedia(tries[n]);camStream=s;camRunning=true;camTorchOn=false;const v=document.getElementById('scan-video');v.srcObject=s;await v.play().catch(()=>{});setupTorch();requestAnimationFrame(scanFrame);}
    catch(e){attempt(n+1);}
  }
  // WebChromeClient handles Android CAMERA permission for getUserMedia().
  attempt(0);
}
/* Lightweight scan loop: decodes a DOWNSCALED frame ~8 times per second via
   setTimeout (not per animation frame). This keeps the UI at full frame-rate
   while using only a fraction of the CPU. */
function scanFrame(){
  if(!camRunning)return;
  if(document.getElementById('cam-modal').classList.contains('hide')){setTimeout(scanFrame,300);return;}
  const v=document.getElementById('scan-video');
  if(v.readyState<v.HAVE_ENOUGH_DATA){setTimeout(scanFrame,120);return;}
  const c=document.getElementById('scan-canvas');
  const scale=Math.min(1,480/(v.videoWidth||480));
  const w=Math.max(1,Math.round((v.videoWidth||480)*scale));
  const h=Math.max(1,Math.round((v.videoHeight||360)*scale));
  c.width=w;c.height=h;
  const ctx=c.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(v,0,0,w,h);
  const d=ctx.getImageData(0,0,w,h);
  if(typeof jsQR!=='undefined'){
    const code=jsQR(d.data,w,h);
    if(code&&code.data){haptic('heavy');handleScan(code.data);return;}
  }
  setTimeout(scanFrame,120);
}
function closeCam(){camRunning=false;if(camStream){camStream.getTracks().forEach(t=>t.stop());camStream=null;}camTorchOn=false;const tb=document.getElementById('torch-btn');if(tb)tb.style.display='none';document.getElementById('cam-modal').classList.add('hide');}
function toggleTorch(){
  if(!camStream)return;
  camTorchOn=!camTorchOn;
  const track=camStream.getVideoTracks()[0];
  if(track&&typeof track.applyConstraints==='function'){
    track.applyConstraints({advanced:[{torch:camTorchOn}]}).catch(()=>{});
  }
  const b=document.getElementById('torch-btn');if(b)b.classList.toggle('on',camTorchOn);
}
function setupTorch(){
  try{
    const track=camStream&&camStream.getVideoTracks()[0];
    const caps=track&&track.getCapabilities?track.getCapabilities():null;
    const b=document.getElementById('torch-btn');
    if(caps&&caps.torch&&b){b.style.display='flex';}
  }catch(e){}
}
function scanUpload(input){
  if(!input.files?.[0])return;
  const reader=new FileReader();
  reader.onload=e=>{const img=new Image();img.onload=()=>{const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);const d=ctx.getImageData(0,0,c.width,c.height);if(typeof jsQR!=='undefined'){const code=jsQR(d.data,d.width,d.height);if(code?.data){handleScan(code.data);}else{toast('No QR found in image',true);}}};img.src=e.target.result;};
  reader.readAsDataURL(input.files[0]);
}
function handleScan(data){
  closeCam();if(!data?.trim())return;
  data=data.trim();
  try{
    let pa='',pn='',am='';
    if(data.includes('pa=')||data.startsWith('upi://')){
      const qs=data.includes('?')?data.split('?')[1]:data;
      const p=new URLSearchParams(qs);
      pa=p.get('pa')||'';pn=p.get('pn')||'';am=p.get('am')||'';
    }else if(validateUPI(data)){pa=data;}
    else{const m=data.match(/[a-zA-Z0-9.\-_+]+@[a-zA-Z0-9]+/);if(m)pa=m[0];}
    if(pa){
      document.getElementById('iupi').value=pa;
      if(pn)document.getElementById('iname').value=String(pn).slice(0,50);
      if(am){document.getElementById('iamt').value=am;syncChips();}
      upiTab('type');
      toast('QR Scanned Successfully');
      haptic('medium');
    }else{toast('No UPI ID found',true);}
  }catch(e){toast('Could not decode QR',true);}
}


// ═══════════════════════════════════════════════════════════
// ANDROID NATIVE BRIDGE INTEGRATION
// Patches run-time behaviour when inside the Android app.
// ═══════════════════════════════════════════════════════════
(function() {
  // Wait until DOM is ready
  function applyPatches() {
    if (!window.AndroidBridge) return; // Not in Android app — skip

    // ── 1. Clipboard paste via native Android clipboard ──────────────
    var _pasteUPIWeb = window.pasteUPI;
    window.pasteUPI = async function() {
      haptic('light');
      var text = '';
      try { text = window.AndroidBridge.getClipboardText() || ''; } catch(e) {}
      if (!text) {
        // Fallback to web clipboard API or prompt
        try { text = await navigator.clipboard.readText(); } catch(e) {}
      }
      if (text && text.trim()) {
        text = text.trim();
        if (text.includes('pa=') || text.startsWith('upi://')) {
          handleScan(text);
        } else {
          document.getElementById('iupi').value = text;
          upiTab('type');
        }
      } else if (_pasteUPIWeb) {
        _pasteUPIWeb();
      }
    };

    // ── 2. Native Share sheet instead of window.open WhatsApp ─────────
    var _shareWAWeb = window.shareWA;
    window.shareWA = function() {
      var txt = S.total > 0 ? buildReceipt() : 'SplitPay — Smart UPI Installment Splitter';
      try {
        window.AndroidBridge.shareText(txt);
      } catch(e) {
        if (_shareWAWeb) _shareWAWeb();
      }
    };

    // ── 3. Patch copyReceipt to use native Android clipboard ─────────
    var _copyReceiptWeb = window.copyReceipt;
    window.copyReceipt = function() {
      var text = buildReceipt();
      var copied = false;
      // Try native bridge first (works on all Android versions)
      try {
        if (window.AndroidBridge.copyToClipboard) {
          window.AndroidBridge.copyToClipboard(text);
          toast('Record Copied');
          copied = true;
        }
      } catch(e) {}
      // Fallback to web clipboard API
      if (!copied) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text)
            .then(function() { toast('Record Copied'); })
            .catch(function() { toast('Copy Failed', true); });
        } else if (_copyReceiptWeb) {
          _copyReceiptWeb();
        }
      }
    };

    // ── 4. Log successful UPI app detection ─────────────────────────────────────────────
    try {
      var hasUpi = window.AndroidBridge.hasUpiApp();
      if (!hasUpi) {
        // No UPI app installed — the UI already shows "no UPI app" dialog on tap
      }
    } catch(e) {}

    // ── 5. Native popup helpers (custom pen & paper style dialogs) ─────
    // Popup:   AndroidBridge.showPopup(title, msg, btn, icon)
    // Confirm: appConfirm(title, msg, ok, cancel) → Promise<boolean>
    // Input:   appPrompt(title, msg, prefill)     → Promise<string|null>
    // Icons:   info | warn | question | exit | upi | rate
    window.appPopup = function(title, msg, btn, icon) {
      try { window.AndroidBridge.showPopup(title || 'SplitPay', msg || '', btn || 'OK', icon || 'info'); } catch(e) {}
    };

    window.appConfirm = function(title, msg, ok, cancel) {
      return new Promise(function(resolve) {
        if (!window.AndroidBridge || !window.AndroidBridge.showConfirmDialog) { resolve(confirm(msg || '')); return; }
        var cb = 'cb' + Date.now() + Math.floor(Math.random() * 1e6);
        var settled = false;
        window['onAppDialogResult_' + cb] = function(val) {
          if (settled) return;
          settled = true;
          clearTimeout(guard);
          resolve(!!val);
          delete window['onAppDialogResult_' + cb];
        };
        // Fail-safe: if the native popup never answers (activity rebuilding,
        // dialog failure), resolve false after 30s so buttons never freeze.
        var guard = setTimeout(function() { window['onAppDialogResult_' + cb] && window['onAppDialogResult_' + cb](false); }, 30000);
        window.AndroidBridge.showConfirmDialog(title || 'Confirm', msg || '', ok || 'Yes', cancel || 'No', cb);
      });
    };

    window.appPrompt = function(title, msg, prefill) {
      return new Promise(function(resolve) {
        if (!window.AndroidBridge || !window.AndroidBridge.showInputDialog) { resolve(prompt(msg || '', prefill || '')); return; }
        var cb = 'cb' + Date.now() + Math.floor(Math.random() * 1e6);
        var settled = false;
        window['onAppDialogResult_' + cb] = function(val) {
          if (settled) return;
          settled = true;
          clearTimeout(guard);
          resolve(val ? String(val.value) : null);
          delete window['onAppDialogResult_' + cb];
        };
        var guard = setTimeout(function() { window['onAppDialogResult_' + cb] && window['onAppDialogResult_' + cb](false); }, 30000);
        window.AndroidBridge.showInputDialog(title || 'SplitPay', msg || '', prefill || '', cb);
      });
    };

    // Global result dispatcher called by native code:
    // Confirm: onAppDialogResult(callbackId, true/false)
    // Input:   onAppDialogResult({id: callbackId, value: '...'})
    window.onAppDialogResult = function(a, b) {
      var id, val;
      if (b === undefined && a && typeof a === 'object') { id = a.id; val = a; }
      else { id = a; val = b; }
      var fn = window['onAppDialogResult_' + id];
      if (fn) fn(typeof val === 'object' && val !== null ? val : !!val);
    };
  }

  // Apply immediately if AndroidBridge is already injected
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyPatches);
  } else {
    applyPatches();
  }
})();

