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
let items=[], history=JSON.parse(localStorage.getItem('cfp_invoices')||'[]');
const $=id=>document.getElementById(id);
const money=n=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}).format(n);
const norm=s=>String(s||'').toLowerCase().replace(/\\s+/g,'').replace(/[×*]/g,'x');
const rateFor=s=>RATES[norm(s)]??null;
function invoiceNo(){return 'CFP-'+new Date().toISOString().slice(0,10).replaceAll('-','')+'-'+String(Date.now()).slice(-5)}
function setup(){ $('invoiceDate').value=new Date().toISOString().slice(0,10);$('invoiceNo').value=invoiceNo();$('sizes').innerHTML=Object.keys(RATES).filter(x=>!x.includes('above')).map(x=>`<option value="${x}">`).join('');renderItems();renderTotals();renderRates();renderHistory();}
$('sizeInput').addEventListener('input',()=>{let r=rateFor($('sizeInput').value);$('rateInput').value=r===null?'':money(r);$('sizeMessage').textContent=r===null&&$('sizeInput').value?'Size not found in rate card.':r!==null?'Rate found: '+money(r):'';});
$('addBtn').onclick=()=>{let r=rateFor($('sizeInput').value),q=Math.max(1,Number($('qtyInput').value)||1);if(r===null)return alert('Please enter a size from the rate card.');items.push({size:norm($('sizeInput').value),rate:r,qty:q});$('sizeInput').value='';$('rateInput').value='';$('qtyInput').value=1;$('sizeMessage').textContent='';renderItems();renderTotals()};
$('clearItems').onclick=()=>{items=[];renderItems();renderTotals()};
$('qtyInput').addEventListener('focus',()=>{if($('qtyInput').value==='1'||$('qtyInput').value==='0')$('qtyInput').value='';});
$('qtyInput').addEventListener('blur',()=>{if(!$('qtyInput').value.trim()||Number($('qtyInput').value)<1)$('qtyInput').value='1';});
$('discountInput').oninput=renderTotals;
$('advanceInput').oninput=renderTotals;

['discountInput','advanceInput'].forEach(id=>{
  $(id).addEventListener('focus',()=>{
    if($(id).value==='0') $(id).value='';
  });
  $(id).addEventListener('blur',()=>{
    if($(id).value.trim()==='') $(id).value='0';
    renderTotals();
  });
});
function renderItems(){$('itemsBody').innerHTML=items.length?items.map((x,i)=>`<tr><td>${i+1}</td><td>${x.size}</td><td>${money(x.rate)}</td><td>${x.qty}</td><td>${money(x.rate*x.qty)}</td><td><button class="danger" onclick="removeItem(${i})">Delete</button></td></tr>`).join(''):'<tr><td colspan="6" style="text-align:center;color:#7a8794">No items added.</td></tr>'}
function removeItem(i){items.splice(i,1);renderItems();renderTotals()}
function totals(){
  let sub=items.reduce((s,x)=>s+x.rate*x.qty,0),
      p=Math.min(100,Math.max(0,Number($('discountInput').value)||0)),
      d=sub*p/100,
      total=sub-d,
      advance=Math.min(Math.max(0,Number($('advanceInput').value)||0),total),
      balance=total-advance;
  return{sub,p,d,total,advance,balance}
}
function renderTotals(){
  let t=totals();
  $('subtotal').textContent=money(t.sub);
  $('discountDisplay').textContent=money(t.d);
  $('discountAmount').textContent=money(t.d);
  $('finalPrice').textContent=money(t.balance);
  $('grandTotal').textContent=money(t.balance);
  $('advanceDisplay').textContent=money(t.advance);
  $('summaryAdvance').textContent=money(t.advance);
  $('balanceDue').textContent=money(t.balance);
  $('itemCount').textContent=items.length+' item'+(items.length===1?'':'s')
}
function currentInvoice(){let t=totals();return{id:$('invoiceNo').value||invoiceNo(),date:$('invoiceDate').value,name:$('customerName').value.trim()||'Walk-in Customer',phone:$('customerPhone').value.trim(),items:[...items],discount:t.p,subtotal:t.sub,discountAmount:t.d,total:t.total,advance:t.advance,balance:t.balance,paymentMethod:$('paymentMethod').value||'Cash'}}
$('saveBtn').onclick=()=>{if(!items.length)return alert('Add at least one item.');let inv=currentInvoice(),i=history.findIndex(x=>x.id===inv.id);if(i>=0)history[i]=inv;else history.unshift(inv);localStorage.setItem('cfp_invoices',JSON.stringify(history));renderHistory();alert('Invoice saved successfully.')};
function loadInvoice(id){
  let x=history.find(v=>v.id===id);
  if(!x)return;
  showPage('invoice');
  items=x.items||[];
  $('invoiceNo').value=x.id;
  $('invoiceDate').value=x.date;
  $('customerName').value=x.name;
  $('customerPhone').value=x.phone;
  $('discountInput').value=x.discount||0;
  $('advanceInput').value=x.advance||0;
  $('paymentMethod').value=x.paymentMethod||'Cash';
  renderItems();
  renderTotals();
}
function deleteInvoice(id){if(!confirm('Delete this saved invoice?'))return;history=history.filter(x=>x.id!==id);localStorage.setItem('cfp_invoices',JSON.stringify(history));renderHistory()}
function renderHistory(){let q=norm($('historySearch')?.value||'');let rows=history.filter(x=>norm(x.id+' '+x.name+' '+x.phone).includes(q));$('historyBody').innerHTML=rows.length?rows.map(x=>{let bal=Math.max(0,Number(x.balance??(Number(x.total||0)-Number(x.advance||0))));return `<tr><td>${x.id}</td><td>${x.date}</td><td>${x.name}</td><td>${x.phone||'-'}</td><td>${money(x.total)}</td><td><button class="btn secondary" onclick="loadInvoice('${x.id}')">Open</button> ${bal>0?`<button class="btn primary" onclick="collectPayment('${x.id}')">Collect</button>`:''} <button class="danger" onclick="deleteInvoice('${x.id}')">Delete</button></td></tr>`}).join(''):'<tr><td colspan="6" style="text-align:center;color:#7a8794">No saved invoices.</td></tr>'}
function collectPayment(id){
  let inv=history.find(x=>x.id===id); if(!inv)return;
  let total=Number(inv.total)||0, paid=Number(inv.advance)||0, balance=Math.max(0,total-paid);
  if(balance<=0){alert('This invoice is already fully paid.');return;}
  let raw=prompt('Balance due: '+money(balance)+'\nEnter amount received:');
  if(raw===null)return;
  let amount=Number(raw);
  if(!Number.isFinite(amount)||amount<=0){alert('Enter a valid payment amount.');return;}
  if(amount>balance){alert('Amount cannot exceed the balance due of '+money(balance)+'.');return;}
  let method=prompt('Payment method: Cash, Credit Card, PhonePe, Paytm, GPay, QR Scan',inv.paymentMethod||'Cash');
  if(method===null)return;
  let allowed=['Cash','Credit Card','PhonePe','Paytm','GPay','QR Scan'];
  method=allowed.find(m=>m.toLowerCase()===method.trim().toLowerCase())||null;
  if(!method){alert('Choose one of: Cash, Credit Card, PhonePe, Paytm, GPay, QR Scan.');return;}
  inv.advance=paid+amount; inv.balance=Math.max(0,total-inv.advance); inv.paymentMethod=method;
  localStorage.setItem('cfp_invoices',JSON.stringify(history)); renderHistory();
  alert('Payment recorded: '+money(amount)+'\nBalance due: '+money(inv.balance));
}
$('historySearch').oninput=renderHistory;
function renderRates(){let q=norm($('rateSearch')?.value||'');$('rateGrid').innerHTML=Object.keys(RATES).filter(x=>norm(x).includes(q)).map(x=>`<div class="rate"><b>${x}</b><span>${money(RATES[x])}</span></div>`).join('')}
$('rateSearch').oninput=renderRates;
function resetNewInvoice(){
  items=[];
  $('customerName').value='';
  $('customerPhone').value='';
  $('invoiceNo').value=invoiceNo();
  $('invoiceDate').value=new Date().toISOString().slice(0,10);
  $('sizeInput').value='';
  $('rateInput').value='';
  $('qtyInput').value=1;
  $('discountInput').value=0;
  $('advanceInput').value=0;
  $('paymentMethod').value='Cash';
  $('sizeMessage').textContent='';
  renderItems();
  renderTotals();
}

function showPage(id){
  document.querySelectorAll('.page').forEach(p=>p.classList.toggle('active',p.id===id));
  document.querySelectorAll('.nav').forEach(b=>b.classList.toggle('active',b.dataset.page===id));
  if(id==='history')renderHistory();
  if(id==='rates')renderRates();
}
document.querySelectorAll('.nav').forEach(b=>b.onclick=()=>{
  if(b.dataset.page==='invoice'){
    resetNewInvoice();
    showPage('invoice');
  } else {
    showPage(b.dataset.page);
  }
});
$('printBtn').onclick=()=>{if(!items.length)return alert('Add at least one item. Save the invoice first if you want it in history.');printInvoice(currentInvoice())};
function printInvoice(inv){let t=totals(),rows=inv.items.map((x,i)=>`<tr><td>${i+1}</td><td>${x.size}</td><td>${x.qty}</td><td>${money(x.rate)}</td><td>${money(x.rate*x.qty)}</td></tr>`).join('');let w=open('','_blank');w.document.write(`<!doctype html><html><head><title>${inv.id}</title><style>*{box-sizing:border-box}body{font-family:Arial;color:#18212b}.page{max-width:850px;margin:auto;padding:30px}.head{display:flex;gap:18px;border-bottom:4px solid #ed087f;padding-bottom:15px}.head img{width:95px;height:95px;object-fit:cover;border-radius:50%}h1{margin:5px 0;color:#07345e;text-transform:uppercase}.tag{color:#ed087f;font-weight:bold}.biz{font-size:12px;line-height:1.5;margin-top:6px}.meta{display:flex;justify-content:space-between;background:#f1f5f8;padding:14px;margin:20px 0;border-radius:8px}table{width:100%;border-collapse:collapse}th,td{padding:11px;border-bottom:1px solid #ddd;text-align:left}th{background:#07345e;color:#fff}.totals{margin-left:auto;width:320px;margin-top:20px}.totals div{display:flex;justify-content:space-between;padding:7px}.final{border-top:2px solid #07345e;margin-top:5px;padding-top:12px;font-size:21px;font-weight:bold;color:#ed087f}.footer{text-align:center;margin-top:45px;border-top:1px solid #ddd;padding-top:14px;font-size:12px;color:#667}@media print{.page{padding:10mm}}</style></head><body><div class="page"><div class="head"><img src="assets/logo-mark.jpg"><div><h1>Colours Flex Printing</h1><div class="tag">COLOURS YOUR IMAGINATION</div><div class="biz">Vinyl, Frontlit, lighting boards & flex printing<br>Besides Muthooth Finance, 1st Floor, V.T.Nagar Mall, Chintapally, Nalgonda - 508250<br>Phone: 77299 47523 | Email: coloursdigital4u@gmail.com</div></div></div><div class="meta"><div><b>Bill To:</b><br>${inv.name}<br>${inv.phone}</div><div><b>Invoice:</b> ${inv.id}<br><b>Date:</b> ${inv.date}</div></div><table><thead><tr><th>#</th><th>Size</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table><div class="totals"><div><span>Subtotal</span><b>${money(t.sub)}</b></div><div><span>Discount (${t.p}%)</span><b>-${money(t.d)}</b></div><div class="final"><span>INVOICE TOTAL</span><span>${money(t.total)}</span></div><div><span>Advance (${inv.paymentMethod||'Cash'})</span><b>${money(t.advance)}</b></div><div><span>BALANCE DUE</span><b>${money(t.balance)}</b></div></div><div class="footer">Thank you for your business!<br>Colours Flex Printing — Colours Your Imagination</div></div><script>onload=()=>setTimeout(()=>print(),400)<\/script></body></html>`);w.document.close()}
setup();
