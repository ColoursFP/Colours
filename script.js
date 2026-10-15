const RATES={
  "3x2": 250,
  "3x2 above four copies": 200,
  "3x3": 350,
  "3x12": 800,
  "3x15": 1000,
  "3x20": 1350,
  "4x2": 350,
  "4x3": 400,
  "4x4": 450,
  "4x12": 1050,
  "4x15": 1250,
  "4x20": 1550,
  "5x2": 350,
  "5x3": 450,
  "5x4": 550,
  "6x2": 450,
  "6x3": 550,
  "6x4": 650,
  "6x5": 800,
  "6x6": 700,
  "6x12": 1200,
  "6x15": 1400,
  "6x20": 1900,
  "8x2": 450,
  "8x3": 500,
  "8x4": 650,
  "8x5": 800,
  "8x6": 900,
  "8x8": 1250,
  "8x10": 1450,
  "8x12": 1850,
  "8x16": 2000,
  "8x20": 2400,
  "10x2": 500,
  "10x3": 600,
  "10x4": 800,
  "10x5": 950,
  "10x6": 1100,
  "10x8": 1350,
  "10x10": 1750,
  "10x12": 2100,
  "10x15": 2550,
  "10x20": 3400,
  "10x30": 4800
};
const FLEX_TYPES=["Bond","Normal Flex","Vinyl","Backout Flex","Backout Star Flex","Backlit Flex","Backlit Star Flex","Backlit Board","Foam Sheet 3MM","Foam Sheet 5MM","Oneway Vision","Iron Frame"];
function readMaterialRates(){try{return JSON.parse(localStorage.getItem('cfp_material_rates')||'{}')||{};}catch(e){return {};}}
let materialRates=readMaterialRates();
function materialRateKey(type,size){return String(type||FLEX_TYPES[0])+'|'+norm(size);}
function rateFor(s,type=$('flexTypeInput')?.value||FLEX_TYPES[0]){const key=materialRateKey(type,s);return Object.prototype.hasOwnProperty.call(materialRates,key)?Number(materialRates[key]):(RATES[norm(s)]??null);}
let items=[];
function readSavedInvoices(){
  try { const parsed=JSON.parse(localStorage.getItem('cfp_invoices')||'[]'); return Array.isArray(parsed)?parsed:[]; }
  catch(e){ console.error('Could not read local invoices',e); return []; }
}
let history=readSavedInvoices();
let publicHistory=[];
let publicHistoryLoaded=false;
let publicHistoryLoading=false;
let publicHistoryError='';
let supabaseClient=null;
let currentUser=null;
let cloudReady=false;
let pendingPageAfterLogin=null;
function configIsReady(){
  return !!(window.COLOURS_SUPABASE_URL && window.COLOURS_SUPABASE_ANON_KEY &&
    window.COLOURS_SUPABASE_URL.startsWith('https://') &&
    !window.COLOURS_SUPABASE_URL.includes('PASTE_') &&
    !window.COLOURS_SUPABASE_ANON_KEY.includes('PASTE_'));
}
function compareInvoiceCreationNewestFirst(a,b){
  const aCreated=Date.parse(a.createdAt||a.created_at||'')||0;
  const bCreated=Date.parse(b.createdAt||b.created_at||'')||0;
  if(aCreated!==bCreated)return bCreated-aCreated;
  const dateOrder=String(b.date||'').localeCompare(String(a.date||''));
  if(dateOrder)return dateOrder;
  // Deterministic fallback for older invoices without a creation timestamp.
  return String(b.id||'').localeCompare(String(a.id||''));
}
function localPersist(){
  try { localStorage.setItem('cfp_invoices',JSON.stringify(history)); return true; }
  catch(e){ console.error(e); alert('Could not save locally in this browser.'); return false; }
}
async function persistInvoices(){
  localPersist();
  if(supabaseClient && !currentUser){
    try{
      const publicRows=history.filter(inv=>!inv.hiddenFromHistory).map(inv=>({invoice_number:String(inv.id),invoice_date:inv.date||new Date().toISOString().slice(0,10),total:Number(inv.total)||0,created_at:inv.createdAt||new Date().toISOString()}));
      if(publicRows.length){const {error}=await supabaseClient.from('public_invoice_summaries').upsert(publicRows,{onConflict:'invoice_number'});if(error)throw error;}
      await loadPublicInvoiceHistory(true);
    }catch(e){console.warn('Public summary sync failed',e);}
    return true;
  }
  if(!supabaseClient || !currentUser || !cloudReady) return true;
  try{
    const rows=history.map(inv=>({
      id:String(inv.id),
      invoice_date:inv.date||new Date().toISOString().slice(0,10),
      customer_name:inv.name||'Walk-in Customer',
      customer_phone:inv.phone||'',
      total:Number(inv.total)||0,
      collected:Number(inv.advance)||0,
      pending:Math.max(0,(Number(inv.total)||0)-(Number(inv.advance)||0)),
      invoice_data:inv,
      updated_at:new Date().toISOString(),
      created_by:currentUser.id
    }));
    if(rows.length){
      const {error}=await supabaseClient.from('invoices').upsert(rows,{onConflict:'id'});
      if(error) throw error;
    }
    return true;
  }catch(e){
    console.error('Supabase invoice sync failed',e);
    alert('Invoice saved in this browser, but cloud sync failed: '+e.message);
    return false;
  }
}
async function loadCloudInvoices(){
  if(!supabaseClient || !currentUser) return;
  const {data,error}=await supabaseClient.from('invoices').select('invoice_data').order('invoice_date',{ascending:false});
  if(error) throw error;
  const cloud=(data||[]).map(row=>row.invoice_data).filter(Boolean);
  // Merge by invoice ID so this browser's existing invoices are not silently discarded.
  const map=new Map();
  cloud.forEach(inv=>map.set(String(inv.id),inv));
  history.forEach(inv=>{if(!map.has(String(inv.id)))map.set(String(inv.id),inv);});
  history=[...map.values()].sort(compareInvoiceCreationNewestFirst);
  localPersist();
  cloudReady=true;
  // Upload any browser-only invoices into the cloud after merging, so they are not left local-only.
  await persistInvoices();
  renderHistory(); refreshPeriodYears(); renderBalance();
}
async function loadPublicInvoiceHistory(force=false){
  if(!supabaseClient || publicHistoryLoading || (publicHistoryLoaded && !force)) return;
  publicHistoryLoading=true;
  publicHistoryError='';
  try{
    // This view exposes only invoice number, date, and total; it never returns customer names, phone numbers, line items, or payment records.
    const {data,error}=await supabaseClient.from('public_invoice_history').select('invoice_number,invoice_date,total,created_at').order('created_at',{ascending:false,nullsFirst:false}).order('invoice_date',{ascending:false}).order('invoice_number',{ascending:false});
    if(error) throw error;
    publicHistory=Array.isArray(data)?data:[];
    publicHistoryLoaded=true;
  }catch(e){
    console.error('Public invoice history load failed',e);
    publicHistoryError=e.message||'Could not load shared invoice history.';
    publicHistoryLoaded=false;
  }finally{
    publicHistoryLoading=false;
    if(!currentUser) renderHistory();
  }
}
function renderPublicHistory(){
  const q=norm($('historySearch')?.value||'');
  const head=document.querySelector('#history table thead');
  if(head)head.innerHTML='<tr><th>Invoice</th><th>Date</th><th>Total</th><th>Access</th></tr>';
  if(!publicHistoryLoaded){
    $('historyBody').innerHTML=`<tr><td colspan="4" style="text-align:center;color:#7a8794">${publicHistoryLoading?'Loading shared invoice history…':(publicHistoryError?`Could not load shared invoices: ${escapeHtml(publicHistoryError)}. Ask the site administrator to apply the public history SQL setup.`:'Loading shared invoice history…')}</td></tr>`;
    return;
  }
  const rows=publicHistory.filter(x=>norm(String(x.invoice_number||'')+' '+String(x.invoice_date||'')).includes(q));
  $('historyBody').innerHTML=rows.length?rows.map(x=>`<tr><td>${escapeHtml(String(x.invoice_number||''))}</td><td>${escapeHtml(String(x.invoice_date||''))}</td><td>${money(Number(x.total)||0)}</td><td><span class="muted">Public summary</span> <button class="btn whatsapp-btn" onclick="sharePublicInvoice('${escapeHtml(String(x.invoice_number||''))}','${escapeHtml(String(x.invoice_date||''))}',${Number(x.total)||0})">Share via WhatsApp</button></td></tr>`).join(''):'<tr><td colspan="4" style="text-align:center;color:#7a8794">No shared invoices found.</td></tr>';
}
function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
function initSupabase(){
  if(supabaseClient) return;
  if(!configIsReady()){ $('loginMessage').textContent='Supabase setup required: add your Project URL and anon/publishable key to supabase-config.js.'; return; }
  if(!window.supabase?.createClient){ $('loginMessage').textContent='Could not load the Supabase client. Check your internet connection.'; return; }
  supabaseClient=window.supabase.createClient(window.COLOURS_SUPABASE_URL,window.COLOURS_SUPABASE_ANON_KEY);
  supabaseClient.auth.getSession().then(({data})=>{
    if(data?.session) activateSession(data.session);
  });
  supabaseClient.auth.onAuthStateChange((_event,session)=>{
    if(session) activateSession(session);
    else {
      currentUser=null; cloudReady=false;
      if($('logoutButton')) $('logoutButton').hidden=true;
      if($('loginNavButton')) $('loginNavButton').textContent='Login';
      if($('balanceNav')) $('balanceNav').classList.remove('active');
      if(typeof showPage==='function' && $('invoice')) showPage('invoice');
    }
  });
}
function showLogin(message=''){
  $('mainApp').hidden=true;
  $('loginScreen').hidden=false;
  $('loginScreen').style.display='grid';
  $('loginMessage').textContent=message || 'Sign in to sync invoices securely to the cloud.';
  $('loginEmail').focus();
}
function hideLogin(){
  $('loginScreen').hidden=true;
  $('loginScreen').style.display='none';
  if(!currentUser) $('mainApp').hidden=false;
}
async function activateSession(session){
  currentUser=session.user;
  hideLogin(); $('mainApp').hidden=false;
  $('logoutButton').hidden=false; $('loginNavButton').textContent='Logged In';
  $('loginMessage').textContent='';
  try{ await loadCloudInvoices(); setupPeriodFilters(); renderBalance(); }
  catch(e){ console.error(e); $('loginMessage').textContent='Signed in, but could not load cloud invoices: '+e.message; }
  const destination=pendingPageAfterLogin;
  pendingPageAfterLogin=null;
  if(destination==='balance') showPage('balance');
}

const $=id=>document.getElementById(id);
const money=n=>'Rs. '+new Intl.NumberFormat('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(n)||0);
const norm=s=>String(s||'').toLowerCase().replace(/\\s+/g,'').replace(/[×*]/g,'x');

function invoiceNo(){return 'CFP-'+new Date().toISOString().slice(0,10).replaceAll('-','')+'-'+String(Date.now()).slice(-5)}
function setup(){ $('invoiceDate').value=new Date().toISOString().slice(0,10);$('invoiceNo').value=invoiceNo();$('sizes').innerHTML=Object.keys(RATES).filter(x=>!x.includes('above')).map(x=>`<option value="${x}">`).join('');$('flexTypeInput').innerHTML=FLEX_TYPES.map(x=>`<option value="${x}">${x}</option>`).join('');renderItems();renderTotals();renderHistory();setupPeriodFilters();renderBalance();}
function updateItemRate(){ $('sizeMessage').textContent='Enter the size and rate manually. Existing rates remain available in Rate Card.'; }
$('sizeInput').addEventListener('input',()=>{});
$('flexTypeInput').addEventListener('change',()=>{});
$('addBtn').onclick=()=>{let rawSize=$('sizeInput').value.trim(),type=$('flexTypeInput').value||FLEX_TYPES[0],r=Number($('rateInput').value),q=Math.max(1,Number($('qtyInput').value)||1);if(type!=='Bond'&&!rawSize)return alert('Please enter a size.');if($('rateInput').value.trim()===''||!Number.isFinite(r)||r<0)return alert('Please enter a valid rate.');items.push({size:rawSize,flexType:type,rate:r,qty:q});$('sizeInput').value='';$('rateInput').value='';$('qtyInput').value=1;$('sizeMessage').textContent='';renderItems();renderTotals()};
$('clearItems').onclick=()=>{items=[];renderItems();renderTotals()};
$('qtyInput').addEventListener('focus',()=>{if($('qtyInput').value==='1'||$('qtyInput').value==='0')$('qtyInput').value='';});
$('qtyInput').addEventListener('blur',()=>{if(!$('qtyInput').value.trim()||Number($('qtyInput').value)<1)$('qtyInput').value='1';});
$('discountInput').oninput=renderTotals;
$('advanceInput').oninput=renderTotals;

$('advanceInput').addEventListener('focus',()=>{ if($('advanceInput').value==='0') $('advanceInput').value=''; });
$('advanceInput').addEventListener('blur',()=>{ if($('advanceInput').value.trim()==='') $('advanceInput').value='0'; renderTotals(); });
function renderItems(){$('itemsBody').innerHTML=items.length?items.map((x,i)=>`<tr><td>${i+1}</td><td>${x.size}</td><td>${x.flexType||'Normal Flex'}</td><td>${money(x.rate)}</td><td>${x.qty}</td><td>${money(x.rate*x.qty)}</td><td><button class="danger" onclick="removeItem(${i})">Delete</button></td></tr>`).join(''):'<tr><td colspan="7" style="text-align:center;color:#7a8794">No items added.</td></tr>'}
function removeItem(i){items.splice(i,1);renderItems();renderTotals()}
function totals(){
  const sub=items.reduce((s,x)=>s+x.rate*x.qty,0);
  const enteredDiscount=Math.max(0,Number($('discountInput').value)||0);
  const d=Math.min(sub,enteredDiscount);
  const p=sub>0?(d/sub)*100:0;
  const total=Math.max(0,sub-d);
  const advance=Math.min(Math.max(0,Number($('advanceInput').value)||0),total);
  const balance=total-advance;
  return{sub,p,d,total,advance,balance}
}
function renderTotals(){
  let t=totals();
  $('subtotal').textContent=money(t.sub);
  $('discountDisplay').textContent=money(t.d);
  $('discountAmount').textContent=money(t.d);
  $('discountPercentDisplay').textContent=t.p.toFixed(2).replace(/\.?0+$/,'')+'%';
  $('finalPrice').textContent=money(t.balance);
  $('grandTotal').textContent=money(t.balance);
  $('advanceDisplay').textContent=money(t.advance);
  $('summaryAdvance').textContent=money(t.advance);
  $('balanceDue').textContent=money(t.balance);
  $('itemCount').textContent=items.length+' item'+(items.length===1?'':'s')
}
function currentInvoice(){let t=totals();return{id:$('invoiceNo').value||invoiceNo(),date:$('invoiceDate').value,name:$('customerName').value.trim()||'Walk-in Customer',phone:$('customerPhone').value.trim(),items:items.map(x=>({...x})),discount:t.p,discountPercent:t.p,subtotal:t.sub,discountAmount:t.d,total:t.total,advance:t.advance,balance:t.balance,paymentMethod:$('paymentMethod').value||'Cash'}}
async function saveInvoiceRecord(inv){
  // A recorded invoice is immutable. Never overwrite invoice details under an existing ID.
  const existing=history.find(x=>String(x.id)===String(inv.id));
  if(existing){
    alert('This invoice has already been recorded and is locked. Start a New Invoice for any changes.');
    return existing;
  }
  const now=new Date().toISOString();
  inv={...inv,items:(inv.items||[]).map(item=>({...item})),payments:[],createdAt:now,hiddenFromHistory:false,locked:true};
  if(Number(inv.advance)>0) inv.payments.push({amount:Number(inv.advance),method:inv.paymentMethod||'Cash',datetime:now,note:'Advance at invoice creation'});
  history.unshift(inv);
  await persistInvoices();
  renderHistory();refreshPeriodYears();renderBalance();
  return inv;
}
function loadInvoice(id){
  const x=history.find(v=>String(v.id)===String(id));
  if(!x)return;
  alert('Recorded invoices cannot be edited. You can review this invoice in Balance & Transactions.');
}
async function deleteInvoice(id){
  if(!currentUser){alert('Please sign in to archive invoices.');return;}
  if(!confirm('Hide this invoice from Invoice History? It will remain in Balance & Transactions for record keeping.'))return;
  const inv=history.find(x=>String(x.id)===String(id));
  if(!inv)return;
  inv.hiddenFromHistory=true;
  inv.hiddenFromHistoryAt=new Date().toISOString();
  await persistInvoices();
  renderHistory();refreshPeriodYears();renderBalance();
}
function renderHistory(){if(!currentUser){renderPublicHistory();return;}const head=document.querySelector('#history table thead');if(head)head.innerHTML='<tr><th>Invoice</th><th>Date</th><th>Customer</th><th>Phone</th><th>Total</th><th>Action</th></tr>';let q=norm($('historySearch')?.value||'');let rows=history.filter(x=>!x.hiddenFromHistory&&norm(x.id+' '+x.name+' '+x.phone).includes(q)).sort(compareInvoiceCreationNewestFirst);$('historyBody').innerHTML=rows.length?rows.map(x=>{let bal=Math.max(0,Number(x.balance??(Number(x.total||0)-Number(x.advance||0))));return `<tr><td>${escapeHtml(x.id)}</td><td>${escapeHtml(x.date)}</td><td>${escapeHtml(x.name)}</td><td>${escapeHtml(x.phone||'-')}</td><td>${money(x.total)}</td><td><button class="btn secondary" onclick="loadInvoice('${escapeHtml(x.id)}')">Locked</button> <button class="btn whatsapp-btn" onclick="shareSavedInvoice('${escapeHtml(x.id)}')">Share via WhatsApp</button> ${bal>0?`<button class="btn primary" onclick="collectPayment('${escapeHtml(x.id)}')">Collect</button>`:''} <button class="danger" onclick="deleteInvoice('${escapeHtml(x.id)}')">Delete</button></td></tr>`}).join(''):'<tr><td colspan="6" style="text-align:center;color:#7a8794">No saved invoices.</td></tr>'}
function choosePaymentMethod(defaultMethod='Cash'){
  return new Promise(resolve=>{
    const methods=['Cash','Credit Card','PhonePe','Paytm','GPay','QR Scan'];
    const overlay=document.createElement('div');
    overlay.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:16px';
    const box=document.createElement('div');
    box.style.cssText='width:100%;max-width:380px;background:#fff;color:#172b40;padding:22px;border-radius:14px;font-family:Arial,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.25)';
    const title=document.createElement('h3');title.textContent='Select Payment Method';title.style.marginTop='0';
    const select=document.createElement('select');select.style.cssText='width:100%;padding:12px;margin:8px 0 20px;border:1px solid #ccd5df;border-radius:8px;background:#fff;color:#172b40;font-size:16px';
    methods.forEach(method=>{const option=document.createElement('option');option.value=method;option.textContent=method;select.appendChild(option)});
    select.value=methods.includes(defaultMethod)?defaultMethod:'Cash';
    const actions=document.createElement('div');actions.style.cssText='display:flex;justify-content:flex-end;gap:10px';
    const cancel=document.createElement('button');cancel.textContent='Cancel';
    const confirm=document.createElement('button');confirm.textContent='Confirm';
    [cancel,confirm].forEach(b=>b.style.cssText='padding:10px 18px;border:0;border-radius:8px;cursor:pointer;font-size:14px');
    cancel.style.background='#e8edf2';confirm.style.background='#ed087f';confirm.style.color='#fff';
    const finish=value=>{overlay.remove();resolve(value)};
    cancel.onclick=()=>finish(null);confirm.onclick=()=>finish(select.value);overlay.onclick=e=>{if(e.target===overlay)finish(null)};
    actions.append(cancel,confirm);box.append(title,select,actions);overlay.appendChild(box);document.body.appendChild(overlay);
  });
}
async function collectPayment(id){
  // Payment collection is available to all users. When signed in, changes sync to Supabase;
  // when signed out, they are saved only in this browser's local storage.
  let inv=history.find(x=>x.id===id); if(!inv)return;
  let total=Number(inv.total)||0, paid=Number(inv.advance)||0, balance=Math.max(0,total-paid);
  if(balance<=0){alert('This invoice is already fully paid.');return;}
  let raw=prompt('Invoice: '+inv.id+'\nAlready collected: '+money(paid)+'\nBalance due: '+money(balance)+'\nEnter additional amount received:');
  if(raw===null)return;
  let amount=Number(raw);
  if(!Number.isFinite(amount)||amount<=0){alert('Enter a valid payment amount.');return;}
  if(amount>balance){alert('Amount cannot exceed the balance due of '+money(balance)+'.');return;}
  const method=await choosePaymentMethod(inv.paymentMethod||'Cash');
  if(method===null)return;
  const now=new Date().toISOString();
  if(!Array.isArray(inv.payments)){
    inv.payments=[];
    if(paid>0)inv.payments.push({amount:paid,method:inv.paymentMethod||'Cash',datetime:inv.createdAt||now,note:'Previously recorded advance; original timestamp unavailable'});
  }
  inv.payments.push({amount,method,datetime:now,note:'Payment collection'});
  inv.advance=paid+amount;
  inv.balance=Math.max(0,total-inv.advance);
  inv.paymentMethod=method;
  await persistInvoices();
  renderHistory();refreshPeriodYears();renderBalance();
  alert('Payment recorded: '+money(amount)+'\nRecorded at: '+new Date(now).toLocaleString()+'\nBalance due: '+money(inv.balance));
}
$('historySearch').oninput=()=>{if(!currentUser&&!publicHistoryLoaded)loadPublicInvoiceHistory();renderHistory();};
function fmtDateTime(value){
  if(!value)return '—';
  const d=new Date(value);
  return Number.isNaN(d.getTime())?'—':d.toLocaleString();
}
function invoiceTotal(inv){return Number(inv.total??((Number(inv.subtotal)||0)-(Number(inv.discountAmount)||0)))||0}
function invoicePaid(inv){return Math.min(invoiceTotal(inv),Math.max(0,Number(inv.advance)||0))}
function invoiceBalance(inv){return Math.max(0,invoiceTotal(inv)-invoicePaid(inv))}

function isoMonth(value){
  if(!value)return '';
  const d=new Date(value);
  if(Number.isNaN(d.getTime()))return '';
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}
function isoYear(value){
  if(!value)return '';
  const d=new Date(value);
  return Number.isNaN(d.getTime())?'':String(d.getFullYear());
}
function paymentRecords(inv){
  const list=Array.isArray(inv.payments)?inv.payments:[];
  if(list.length)return list.map((p,i)=>({...p,invoiceId:inv.id,customer:inv.name||'Walk-in Customer',_index:i}));
  // Older invoices may have an advance but no individual payment records.
  const paid=Math.max(0,Number(inv.advance)||0);
  if(paid>0)return [{
    amount:paid,
    method:inv.paymentMethod||'Cash',
    datetime:inv.createdAt||inv.date||'',
    note:'Previously saved advance',
    invoiceId:inv.id,
    customer:inv.name||'Walk-in Customer',
    _legacy:true
  }];
  return [];
}
function periodState(){
  const period=$('periodFilter')?.value||'all';
  const month=$('monthFilter')?.value||isoMonth(new Date());
  const year=$('yearFilter')?.value||String(new Date().getFullYear());
  return {period,month,year};
}
function dateMatches(value,filters){
  if(filters.period==='all')return true;
  if(filters.period==='month')return isoMonth(value)===filters.month;
  if(filters.period==='year')return isoYear(value)===filters.year;
  return true;
}
function refreshPeriodYears(){
  if(!$('yearFilter'))return;
  const current=$('yearFilter').value||String(new Date().getFullYear());
  const years=new Set([String(new Date().getFullYear()),current]);
  history.forEach(inv=>{
    const y=isoYear(inv.date);if(y)years.add(y);
    paymentRecords(inv).forEach(p=>{const py=isoYear(p.datetime);if(py)years.add(py)});
  });
  $('yearFilter').innerHTML=[...years].sort((a,b)=>Number(b)-Number(a)).map(y=>`<option value="${y}">${y}</option>`).join('');
  $('yearFilter').value=years.has(current)?current:String(new Date().getFullYear());
}
function setupPeriodFilters(){
  if(!$('periodFilter'))return;
  $('monthFilter').value=isoMonth(new Date());
  const years=new Set([String(new Date().getFullYear())]);
  history.forEach(inv=>{
    const y=isoYear(inv.date);if(y)years.add(y);
    paymentRecords(inv).forEach(p=>{const py=isoYear(p.datetime);if(py)years.add(py)});
  });
  $('yearFilter').innerHTML=[...years].sort((a,b)=>Number(b)-Number(a)).map(y=>`<option value="${y}">${y}</option>`).join('');
  $('yearFilter').value=String(new Date().getFullYear());
  function updateVisibility(){
    $('monthFilterWrap').style.display=$('periodFilter').value==='month'?'flex':'none';
    $('yearFilterWrap').style.display=$('periodFilter').value==='year'?'flex':'none';
    renderBalance();
  }
  $('periodFilter').onchange=updateVisibility;
  $('monthFilter').onchange=renderBalance;
  $('yearFilter').onchange=renderBalance;
  updateVisibility();
}
function renderTransactions(filters){
  const records=[];
  const selectedMethod=$('transactionMethodFilter')?.value||'all';
  history.forEach(inv=>paymentRecords(inv).forEach(p=>{
    if(dateMatches(p.datetime||inv.date,filters) &&
       (selectedMethod==='all' || (p.method||'Cash')===selectedMethod)){
      records.push({...p,invoiceId:inv.id,customer:inv.name||'Walk-in Customer'});
    }
  }));
  records.sort((a,b)=>new Date(b.datetime||0)-new Date(a.datetime||0));
  const totalAmount=records.reduce((sum,p)=>sum+(Number(p.amount)||0),0);
  $('transactionCount').textContent=`${records.length} transaction${records.length===1?'':'s'}`;
  if($('transactionTotalAmount')) $('transactionTotalAmount').textContent=money(totalAmount);
  if($('transactionTotalLabel')) $('transactionTotalLabel').textContent=selectedMethod==='all'?'Total Amount':`Total ${selectedMethod}`;
  $('transactionsBody').innerHTML=records.length?records.map(p=>`<tr><td>${fmtDateTime(p.datetime||'')}</td><td><button class="invoice-link" onclick="showBalanceDetail('${p.invoiceId}')">${p.invoiceId}</button></td><td>${p.customer}</td><td>${p.method||'—'}</td><td>${p.note||'Payment received'}</td><td class="paid-text">${money(Number(p.amount)||0)}</td></tr>`).join(''):'<tr><td colspan="6" style="text-align:center;color:#7a8794">No payment transactions found for this method and period.</td></tr>';
}

function renderBalance(){
  if(!$('balanceBody'))return;
  const q=norm($('balanceSearch')?.value||'');
  const filters=periodState();
  // Invoice value and pending balances are based on invoices issued during the selected period.
  const periodInvoices=history.filter(x=>dateMatches(x.date,filters));
  $('totalInvoiceValue').textContent=money(periodInvoices.reduce((s,x)=>s+invoiceTotal(x),0));
  $('totalPending').textContent=money(periodInvoices.reduce((s,x)=>s+invoiceBalance(x),0));
  // Collections are based on the actual payment/collection timestamp.
  const periodPayments=[];
  history.forEach(inv=>paymentRecords(inv).forEach(p=>{
    if(dateMatches(p.datetime||inv.date,filters))periodPayments.push(p);
  }));
  $('totalCollected').textContent=money(periodPayments.reduce((s,p)=>s+(Number(p.amount)||0),0));
  const rows=periodInvoices.filter(x=>norm(x.id+' '+x.name+' '+x.phone).includes(q));
  $('balanceBody').innerHTML=rows.length?rows.map(x=>{
    const payments=paymentRecords(x);
    const last=payments.length?payments[payments.length-1].datetime:(x.createdAt||'');
    const detail=(x.items||[]).map(it=>`${it.size} × ${it.qty}`).join(', ')||'Order details unavailable';
    return `<tr><td><button class="invoice-link" onclick="showBalanceDetail('${x.id}')">${x.id}</button></td><td>${x.name||'Walk-in Customer'}</td><td>${detail}</td><td>${money(invoiceTotal(x))}</td><td>${money(invoicePaid(x))}</td><td class="${invoiceBalance(x)>0?'pending-text':'paid-text'}">${money(invoiceBalance(x))}</td><td>${fmtDateTime(last)}</td></tr>`;
  }).join(''):'<tr><td colspan="7" style="text-align:center;color:#7a8794">No invoices found for this period. Check Invoice History or choose another period.</td></tr>';
  renderTransactions(filters);
}
function showBalanceDetail(id){
  const inv=history.find(x=>x.id===id);if(!inv)return;
  const payments=Array.isArray(inv.payments)?inv.payments:[];
  const itemsHtml=(inv.items||[]).map(it=>`<tr><td>${it.size}</td><td>${it.flexType||'Normal Flex'}</td><td>${it.qty}</td><td>${money(it.rate)}</td><td>${money(it.rate*it.qty)}</td></tr>`).join('');
  const paymentsHtml=payments.length?payments.map(p=>`<tr><td>${fmtDateTime(p.datetime)}</td><td>${p.method||'—'}</td><td>${p.note||'Payment'}</td><td>${money(p.amount)}</td></tr>`).join(''):'<tr><td colspan="4">No payment records are available for this invoice yet.</td></tr>';
  const el=$('balanceDetail');el.hidden=false;
  el.innerHTML=`<div class="section-title"><h2>Invoice ${inv.id}</h2><button class="btn secondary" onclick="document.getElementById('balanceDetail').hidden=true">Close</button></div>
  <p><b>Customer:</b> ${inv.name||'Walk-in Customer'} &nbsp; <b>Invoice date:</b> ${inv.date||'—'}</p>
  <h3>Items Ordered</h3><div class="table-wrap"><table><thead><tr><th>Size</th><th>Flex Type</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead><tbody>${itemsHtml||'<tr><td colspan="5">No item details saved.</td></tr>'}</tbody></table></div>
  <div class="balance-detail-totals"><span>Invoice total (after discount): <b>${money(invoiceTotal(inv))}</b></span><span>Total collected: <b>${money(invoicePaid(inv))}</b></span><span>Balance pending: <b class="${invoiceBalance(inv)>0?'pending-text':'paid-text'}">${money(invoiceBalance(inv))}</b></span></div>
  <h3>Payment History</h3><div class="table-wrap"><table><thead><tr><th>Date & Time</th><th>Method</th><th>Details</th><th>Amount Received</th></tr></thead><tbody>${paymentsHtml}</tbody></table></div>`;
  el.scrollIntoView({behavior:'smooth',block:'start'});
}
$('balanceSearch').oninput=renderBalance;
if($('transactionMethodFilter')) $('transactionMethodFilter').onchange=()=>renderTransactions(periodState());
function renderRates(){let q=norm($('rateSearch')?.value||''),type=$('rateTypeSelect')?.value||FLEX_TYPES[0];$('rateGrid').innerHTML=Object.keys(RATES).filter(x=>!x.includes('above')&&norm(x).includes(q)).map(x=>{const r=rateFor(x,type);return `<div class="rate"><b>${x} · ${type}</b><span>${money(r)}</span></div>`}).join('')}
function renderMaterialRateEditor(){if(!$('rateTypeSelect'))return;const type=$('rateTypeSelect').value||FLEX_TYPES[0],size=$('rateSizeSelect').value||Object.keys(RATES)[0],r=rateFor(size,type);$('customRateInput').value=r===null?'':r;$('rateEditorNote').textContent=Object.prototype.hasOwnProperty.call(materialRates,materialRateKey(type,size))?'Custom rate saved for this material and size.':'Using existing default rate; enter a value to override it.';}
// Rate Card UI is intentionally removed from this build. Manual Size and Rate entry remains available.
function resetNewInvoice(){
  items=[];
  $('customerName').value='';
  $('customerPhone').value='';
  $('invoiceNo').value=invoiceNo();
  $('invoiceDate').value=new Date().toISOString().slice(0,10);
  $('sizeInput').value='';
  $('flexTypeInput').value=FLEX_TYPES[0];
  $('rateInput').value='';
  $('qtyInput').value=1;
  $('discountInput').value='';
  $('advanceInput').value=0;
  $('paymentMethod').value='Cash';
  $('sizeMessage').textContent='';
  renderItems();
  renderTotals();
}

function showPage(id){
  if(id==='balance' && !currentUser){
    pendingPageAfterLogin='balance';
    initSupabase();
    showLogin(configIsReady()?'Please sign in to access Balance and Transactions.':'Supabase setup required: check supabase-config.js.');
    return;
  }
  document.querySelectorAll('.page').forEach(p=>p.classList.toggle('active',p.id===id));
  document.querySelectorAll('.nav[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===id));
  if(id==='history'){if(!currentUser)loadPublicInvoiceHistory();renderHistory();}
  if(id==='balance')renderBalance();

}
document.querySelectorAll('.nav[data-page]').forEach(b=>b.addEventListener('click',()=>{
  const page=b.dataset.page;
  if(page==='invoice') resetNewInvoice();
  showPage(page);
}));
$('printBtn').onclick=async()=>{
  if(!items.length)return alert('Add at least one item.');
  const inv=currentInvoice();
  if(!inv.items.every(x=>(String(x.flexType||'')==='Bond'||String(x.size||'').trim()) && Number.isFinite(Number(x.rate)) && Number(x.rate)>=0))return alert('Check each item size and rate before generating.');
  if(history.some(x=>String(x.id)===String(inv.id)))return alert('This invoice number is already recorded and locked. Start a New Invoice.');
  await saveInvoiceRecord(inv);
  // Save the invoice to history without opening a print window or preview.
  resetNewInvoice();
};
function printInvoice(inv){
  const sub=Number(inv.subtotal)||0,discount=Number(inv.discountAmount)||0,percent=Number(inv.discountPercent??inv.discount)||0;
  const total=Number(inv.total)||Math.max(0,sub-discount),paid=Number(inv.advance)||0,balance=Math.max(0,total-paid);
  const rows=(inv.items||[]).map(x=>`<tr><td>${x.size}</td><td>${x.flexType||'Normal Flex'}</td><td>${x.qty}</td><td>${money(x.rate)}</td><td>${money(x.rate*x.qty)}</td></tr>`).join('');
  const w=open('','_blank'); if(!w){alert('Please allow pop-ups to generate the invoice.');return;}
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${inv.id}</title><style>*{box-sizing:border-box}body{font-family:Arial;color:#18212b}.page{max-width:850px;margin:auto;padding:30px}.head{display:flex;gap:18px;border-bottom:4px solid #ed087f;padding-bottom:15px}.head img{width:95px;height:95px;object-fit:cover;border-radius:50%}h1{margin:5px 0;color:#07345e;text-transform:uppercase}.tag{color:#ed087f;font-weight:bold}.biz{font-size:12px;line-height:1.5;margin-top:6px}.meta{display:flex;justify-content:space-between;background:#f1f5f8;padding:14px;margin:20px 0;border-radius:8px}table{width:100%;border-collapse:collapse}th,td{padding:11px;border-bottom:1px solid #ddd;text-align:left}th{background:#07345e;color:#fff}.totals{margin-left:auto;width:min(100%,360px);margin-top:20px}.totals div{display:flex;justify-content:space-between;gap:12px;padding:7px}.final{border-top:2px solid #07345e;margin-top:5px;padding-top:12px;font-size:21px;font-weight:bold;color:#ed087f}.footer{text-align:center;margin-top:45px;border-top:1px solid #ddd;padding-top:14px;font-size:12px;color:#667}@media print{.page{padding:10mm}}@media(max-width:600px){.page{padding:12px}.head{gap:10px}.head img{width:60px;height:60px}th,td{padding:5px;font-size:12px}}</style></head><body><div class="page"><div class="head"><img src="assets/logo-mark.png"><div><h1>Colours Flex Printing</h1><div class="tag">COLOURS YOUR IMAGINATION</div><div class="biz">Vinyl, Frontlit, lighting boards & flex printing<br>Besides Muthooth Finance, 1st Floor, V.T.Nagar Mall, Chintapally, Nalgonda - 508250<br>Phone: 77299 47523 | Email: coloursdigital4u@gmail.com</div></div></div><div class="meta"><div><b>Bill To:</b><br>${inv.name||'Walk-in Customer'}<br>${inv.phone||''}</div><div><b>Invoice:</b> ${inv.id}<br><b>Date:</b> ${inv.date||''}</div></div><table><thead><tr><th>Size</th><th>Flex Type</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table><div class="totals"><div><span>Subtotal</span><b>${money(sub)}</b></div><div><span>Discount (${percent.toFixed(2).replace(/\.?0+$/,'')}%)</span><b>-${money(discount)}</b></div><div class="final"><span>INVOICE TOTAL</span><span>${money(total)}</span></div><div><span>Amount Paid / Collected</span><b>${money(paid)}</b></div><div><span>Payment Method</span><b>${inv.paymentMethod||'Cash'}</b></div><div><span>BALANCE DUE</span><b>${money(balance)}</b></div></div><div class="footer">Thank you for your business!<br>Colours Flex Printing — Colours Your Imagination</div></div><script>onload=()=>setTimeout(()=>print(),400)<\\/script></body></html>`);w.document.close();
}
function sharePublicInvoice(id,date,total){
  const local=history.find(x=>String(x.id)===String(id));
  if(local){shareSavedInvoice(id);return;}
  const phone=prompt('Enter customer WhatsApp number (include country code if outside India):');
  if(phone===null||!String(phone).trim())return;
  const waPhone=normalizedWhatsAppPhone(phone);
  if(waPhone.length<10||waPhone.length>15)return alert('Please enter a valid WhatsApp phone number.');
  const message=`*Colours Flex Printing — Invoice ${id}*\nDate: ${date||'—'}\nInvoice Total: ${money(Number(total)||0)}\nFor the full invoice PDF, please contact Colours Flex Printing.\nThank you!`;
  window.open('https://wa.me/'+waPhone+'?text='+encodeURIComponent(message),'_blank','noopener');
}
function normalizedWhatsAppPhone(raw){let digits=String(raw||'').replace(/\D/g,'');if(digits.length===10)digits='91'+digits;return digits;}
async function loadJsPDF(){
  if(window.jspdf&&window.jspdf.jsPDF)return window.jspdf.jsPDF;
  if(window.__cfpJsPdfLoading)return window.__cfpJsPdfLoading;
  window.__cfpJsPdfLoading=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js';
    script.onload=()=>window.jspdf&&window.jspdf.jsPDF?resolve(window.jspdf.jsPDF):reject(new Error('PDF library did not load.'));
    script.onerror=()=>reject(new Error('Could not load the PDF generator. Check your internet connection and try again.'));
    document.head.appendChild(script);
  });
  return window.__cfpJsPdfLoading;
}
function makeInvoicePdf(inv,JsPDF,logoData){
  const doc=new JsPDF({unit:'mm',format:'a4'});
  const left=15,right=195;let y=18;
  if(logoData){try{doc.addImage(logoData,'PNG',left,8,18,18,undefined,'FAST');}catch(e){console.warn('Could not add header logo',e);}}
  const titleX=logoData?37:left;
  const sub=Number(inv.subtotal)||0,discount=Number(inv.discountAmount)||0,pct=Number(inv.discountPercent??inv.discount)||0;
  const total=Number(inv.total)||Math.max(0,sub-discount),paid=Number(inv.advance)||0,balance=Math.max(0,total-paid);
  const safe=v=>String(v??'—').replace(/[\r\n]+/g,' ').trim();
  doc.setFont('helvetica','bold');doc.setFontSize(20);doc.setTextColor(7,52,94);doc.text('COLOURS FLEX PRINTING',titleX,y);
  y+=7;doc.setFontSize(9);doc.setTextColor(237,8,127);doc.text('COLOURS YOUR IMAGINATION',titleX,y);
  y+=6;doc.setFont('helvetica','normal');doc.setTextColor(60,70,80);doc.text('Vinyl, Frontlit, lighting boards & flex printing',left,y);
  y+=5;doc.text('Besides Muthooth Finance, 1st Floor, V.T.Nagar Mall, Chintapally, Nalgonda - 508250',left,y);
  y+=5;doc.text('Phone: 77299 47523 | Email: coloursdigital4u@gmail.com',left,y);
  y+=5;doc.setDrawColor(237,8,127);doc.setLineWidth(1.2);doc.line(left,y,right,y);y+=9;
  doc.setFont('helvetica','bold');doc.setFontSize(12);doc.setTextColor(7,52,94);doc.text('INVOICE',left,y);
  y+=7;doc.setFont('helvetica','normal');doc.setFontSize(10);doc.setTextColor(30,40,50);
  doc.text('Invoice: '+safe(inv.id),left,y);doc.text('Date: '+safe(inv.date),120,y);y+=6;
  doc.text('Customer: '+safe(inv.name||'Walk-in Customer'),left,y);y+=6;doc.text('Phone: '+safe(inv.phone||'—'),left,y);y+=8;
  const headers=['Size','Flex Type','Qty','Rate','Amount'];
  doc.setFillColor(7,52,94);doc.rect(left,y-5,180,9,'F');doc.setFont('helvetica','bold');doc.setFontSize(8);doc.setTextColor(255,255,255);
  const hx=[22,62,116,136,158];headers.forEach((h,i)=>doc.text(h,hx[i],y));y+=9;
  doc.setFont('helvetica','normal');doc.setTextColor(35,45,55);
  (inv.items||[]).forEach((it,i)=>{
    if(y>265){doc.addPage();y=20;}
    const row=[safe(it.size),safe(it.flexType||'Normal Flex'),String(it.qty??1),money(it.rate),money((Number(it.qty)||0)*(Number(it.rate)||0))];
    doc.setDrawColor(220,225,230);doc.line(left,y+3,right,y+3);
    doc.text(row[0],22,y);doc.text(row[1].slice(0,24),62,y);doc.text(row[2],116,y);doc.text(row[3],136,y);doc.text(row[4],158,y);y+=9;
  });
  y+=8;if(y>255){doc.addPage();y=20;}
  const summary=[['Subtotal',money(sub)],['Discount ('+pct.toFixed(2).replace(/\.?0+$/,'')+'%)','-'+money(discount)],['INVOICE TOTAL',money(total)],['Amount Paid / Collected',money(paid)],['Payment Method',safe(inv.paymentMethod||'Cash')],['BALANCE DUE',money(balance)]];
  summary.forEach(([label,value],i)=>{if(i===2||i===5){doc.setFont('helvetica','bold');doc.setTextColor(237,8,127);doc.setFontSize(i===2?12:11);}else{doc.setFont('helvetica','normal');doc.setTextColor(45,55,65);doc.setFontSize(10);}doc.text(label,110,y);doc.text(value,right,y,{align:'right'});y+=7;});
  y+=10;doc.setFont('helvetica','italic');doc.setFontSize(9);doc.setTextColor(100,110,120);doc.text('Thank you for your business!',105,Math.min(y,285),{align:'center'});
  if(logoData){
    const pageCount=doc.internal.getNumberOfPages();
    for(let page=1;page<=pageCount;page++){
      doc.setPage(page);
      try{
        doc.saveGraphicsState();
        doc.setGState(new doc.GState({opacity:0.10}));
        const pageW=doc.internal.pageSize.getWidth(),pageH=doc.internal.pageSize.getHeight();
        const markW=pageW-12,markH=pageH-18;
        doc.addImage(logoData,'PNG',(pageW-markW)/2,(pageH-markH)/2,markW,markH,undefined,'FAST');
        doc.restoreGraphicsState();
      }catch(e){try{doc.restoreGraphicsState();}catch(_){} console.warn('Could not add PDF logo watermark',e);}
    }
  }
  return doc;
}
async function loadInvoiceWatermark(){
  return new Promise(resolve=>{
    const img=new Image();
    img.onload=()=>{try{const canvas=document.createElement('canvas');canvas.width=img.naturalWidth||img.width;canvas.height=img.naturalHeight||img.height;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);resolve(canvas.toDataURL('image/png'));}catch(e){resolve(null);}};
    img.onerror=()=>resolve(null);
    img.src=new URL('assets/splash_screen.png',document.baseURI).href;
  });
}
async function shareSavedInvoice(id){
  const inv=history.find(x=>String(x.id)===String(id));
  if(!inv){alert('Invoice not found in history.');return;}
  let phone=String(inv.phone||'').trim();
  if(!phone){phone=prompt('Enter the customer WhatsApp phone number, including country code if outside India:');if(phone===null)return;phone=String(phone).trim();if(!phone)return alert('A phone number is required to share the invoice.');inv.phone=phone;await persistInvoices();renderHistory();}
  const waPhone=normalizedWhatsAppPhone(phone);
  if(waPhone.length<10||waPhone.length>15)return alert('Please enter a valid WhatsApp phone number.');
  const total=Number(inv.total)||Math.max(0,(Number(inv.subtotal)||0)-(Number(inv.discountAmount)||0));
  const message=`Hello ${inv.name||'Customer'}, please find the PDF invoice ${inv.id} from Colours Flex Printing. Invoice total: ${money(total)}. Balance due: ${money(Math.max(0,total-(Number(inv.advance)||0)))}. Thank you!`;
  try{
    const JsPDF=await loadJsPDF();
    const logoData=await loadInvoiceWatermark();
    const doc=makeInvoicePdf(inv,JsPDF,logoData);
    const file=new File([doc.output('blob')],`Colours-Flex-Invoice-${String(inv.id).replace(/[^a-zA-Z0-9_-]/g,'_')}.pdf`,{type:'application/pdf'});
    if(navigator.share&&navigator.canShare&&navigator.canShare({files:[file]})){
      await navigator.share({files:[file],title:`Invoice ${inv.id}`,text:message});
      return;
    }
    // WhatsApp's wa.me URL cannot attach a local file automatically on browsers without file sharing.
    doc.save(file.name);
    window.open('https://wa.me/'+waPhone+'?text='+encodeURIComponent(message),'_blank','noopener');
    alert('Your invoice PDF has been downloaded. In WhatsApp, attach the downloaded PDF from your Downloads folder and send it to the customer. This browser cannot attach local files automatically.');
  }catch(e){
    console.error('PDF invoice sharing failed',e);
    alert('Could not create/share the PDF: '+(e&&e.message?e.message:'Unknown error')+'. Please try again.');
  }
}
$('loginForm').addEventListener('submit',async e=>{
  e.preventDefault();
  if(!supabaseClient){initSupabase();if(!supabaseClient)return;}
  const email=$('loginEmail').value.trim(),password=$('loginPassword').value;
  $('loginButton').disabled=true;$('loginButton').textContent='Signing in…';
  try{
    const {data,error}=await supabaseClient.auth.signInWithPassword({email,password});
    if(error)throw error;
    if(data.session)await activateSession(data.session);
  }catch(err){$('loginMessage').textContent=err.message||'Sign in failed.';}
  finally{$('loginButton').disabled=false;$('loginButton').textContent='Sign In';}
});
$('loginNavButton').addEventListener('click',()=>{
  if(currentUser){ $('loginMessage').textContent='You are signed in. Use Sign Out to end this session.'; showLogin('You are signed in. Cloud sync is enabled.'); return; }
  initSupabase();
  showLogin(configIsReady()?'Enter your authorized portal email and password.':'Supabase setup required: check supabase-config.js.');
});
$('logoutButton').addEventListener('click',async()=>{
  if(supabaseClient) await supabaseClient.auth.signOut();
  currentUser=null; cloudReady=false; pendingPageAfterLogin=null;
  $('logoutButton').hidden=true; $('loginNavButton').textContent='Login';
  if($('balanceNav')) $('balanceNav').classList.remove('active');
  hideLogin();
  renderHistory();
  resetNewInvoice();
  showPage('invoice');
});
$('loginScreen').addEventListener('click',e=>{ if(e.target===$('loginScreen')) hideLogin(); });
setup();
initSupabase();
// Always show the billing UI on startup; cloud sign-in remains available from the Login tab.
// This prevents a blank screen when testing the extracted folder without a saved Supabase session.
$('mainApp').hidden=false;
hideLogin();
// The billing interface remains available; login is opened only when the Login tab is clicked.
if(configIsReady() && window.supabase?.createClient){
  supabaseClient=window.supabase.createClient(window.COLOURS_SUPABASE_URL,window.COLOURS_SUPABASE_ANON_KEY);
  loadPublicInvoiceHistory();
  supabaseClient.auth.getSession().then(({data})=>{ if(data?.session) activateSession(data.session); });
}
