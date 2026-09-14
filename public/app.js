const money = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const state={department:'',q:'',cart:JSON.parse(localStorage.getItem('mercado_cart')||'[]'),departments:[]};
const $=s=>document.querySelector(s);

async function api(url,options){const r=await fetch(url,options);const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b.error||`HTTP ${r.status}`);return b}
function saveCart(){localStorage.setItem('mercado_cart',JSON.stringify(state.cart));renderCart()}
function cartQty(){return state.cart.reduce((s,i)=>s+i.qty,0)}
function addToCart(p){const row=state.cart.find(i=>i.id===p.id);if(row)row.qty+=1;else state.cart.push({id:p.id,name:p.name,price:Number(p.price),image_url:p.image_url,qty:1});saveCart();openCart()}
function changeQty(id,delta){const i=state.cart.find(x=>x.id===id);if(!i)return;i.qty+=delta;if(i.qty<=0)state.cart=state.cart.filter(x=>x.id!==id);saveCart()}
function openCart(){$('#cartDrawer').classList.add('open');$('#overlay').classList.add('open')}
function closeCart(){$('#cartDrawer').classList.remove('open');$('#overlay').classList.remove('open')}

async function loadDepartments(){state.departments=await api('/api/departments');$('#nav').innerHTML='<button class="active" data-dept="">Todos</button>'+state.departments.map(d=>`<button data-dept="${d.slug}">${d.name}</button>`).join('');$('#departments').innerHTML=state.departments.map(d=>`<button class="dept-card" data-dept="${d.slug}"><strong>${d.name}</strong><span>${d.categories.length} categorias</span></button>`).join('');document.querySelectorAll('[data-dept]').forEach(b=>b.addEventListener('click',()=>{state.department=b.dataset.dept;state.q='';$('#searchInput').value='';document.querySelectorAll('#nav button').forEach(x=>x.classList.toggle('active',x.dataset.dept===state.department));loadProducts()}))}

async function loadProducts(){const p=new URLSearchParams({limit:'40'});if(state.department)p.set('department',state.department);if(state.q)p.set('q',state.q);$('#products').innerHTML='<div class="empty">Carregando produtos…</div>';try{const data=await api(`/api/products?${p}`);const label=state.q?`Busca: “${state.q}”`:state.department?(state.departments.find(d=>d.slug===state.department)?.name||'Produtos'):'Produtos em destaque';$('#productsTitle').textContent=label;$('#productsSub').textContent=`${data.items.length} produto(s) nesta visualização.`;if(!data.items.length){$('#products').innerHTML='<div class="empty">Nenhum produto encontrado. O catálogo pode estar aguardando importação ou liberação de estoque/preço.</div>';return}$('#products').innerHTML=data.items.map(p=>`<article class="product"><div class="product-img">${p.image_url?`<img loading="lazy" src="${esc(p.image_url)}" alt="${esc(p.name)}">`:'<span class="placeholder">🛍️</span>'}</div><div class="product-body"><span class="product-brand">${esc(p.brand||p.department||'Mercado')}</span><div class="product-name">${esc(p.name)}</div><span class="product-size">${esc(p.package_size||p.unit||'un')}</span><div class="price-row"><div><div class="price">${Number(p.price)>0?money.format(p.price):'Consultar'}</div><small class="muted">Estoque: ${Number(p.stock_qty)>0?'disponível':'a confirmar'}</small></div><button class="add" data-add="${p.id}" ${Number(p.price)<=0?'disabled':''}>+</button></div></div></article>`).join('');data.items.forEach(p=>document.querySelector(`[data-add="${p.id}"]`)?.addEventListener('click',()=>addToCart(p)))}catch(e){$('#products').innerHTML=`<div class="empty">${esc(e.message)}</div>`}}

function renderCart(){$('#cartCount').textContent=cartQty();if(!state.cart.length){$('#cartItems').innerHTML='<div class="empty">Seu carrinho está vazio.</div>';$('#cartTotal').textContent=money.format(0);return}$('#cartItems').innerHTML=state.cart.map(i=>`<div class="cart-item"><div><strong>${esc(i.name)}</strong><div class="muted">${money.format(i.price)} cada</div></div><div class="qty"><button data-minus="${i.id}">−</button><strong>${i.qty}</strong><button data-plus="${i.id}">+</button></div></div>`).join('');state.cart.forEach(i=>{document.querySelector(`[data-minus="${i.id}"]`)?.addEventListener('click',()=>changeQty(i.id,-1));document.querySelector(`[data-plus="${i.id}"]`)?.addEventListener('click',()=>changeQty(i.id,1))});$('#cartTotal').textContent=money.format(state.cart.reduce((s,i)=>s+i.price*i.qty,0))}

async function checkout(){
  if(!state.cart.length)return alert('Adicione produtos ao carrinho.');
  const customerName=prompt('Nome para o pedido:');if(!customerName)return;
  const customerPhone=prompt('Telefone/WhatsApp:');if(!customerPhone)return;
  const customerEmail=prompt('E-mail (opcional, recomendado para pagamento online):')||'';
  const street=prompt('Rua:');const number=prompt('Número:');const district=prompt('Bairro:');const city=prompt('Cidade:');const stateCode=(prompt('Estado (UF):')||'').toUpperCase();const postalCode=prompt('CEP:');
  if(!street||!number||!district||!city||stateCode.length!==2||!postalCode)return alert('Preencha o endereço completo.');
  const provider=$('#paymentProvider')?.value||'later';
  let order;
  try{
    order=await api('/api/orders',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({customerName,customerEmail,customerPhone,address:{street,number,district,city,state:stateCode,postalCode},items:state.cart.map(i=>({productId:i.id,qty:i.qty}))})});
    if(provider==='later'){
      state.cart=[];saveCart();closeCart();
      alert(`Pedido ${order.orderNumber} criado. Total: ${money.format(order.total)}. Pagamento combinado/na entrega.`);
      return;
    }
    try{
      const payment=await api('/api/payments/create',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({orderNumber:order.orderNumber,customerPhone,provider})});
      state.cart=[];saveCart();closeCart();
      if(payment.checkoutUrl){location.assign(payment.checkoutUrl);return}
      alert(`Pedido ${order.orderNumber} criado, mas o provedor não retornou uma URL de pagamento.`);
    }catch(paymentError){
      alert(`Pedido ${order.orderNumber} foi criado, mas o pagamento não pôde ser iniciado: ${paymentError.message}`);
    }
  }catch(e){
    alert(e.message);
  }
}

function esc(v=''){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}

$('#searchForm').addEventListener('submit',e=>{e.preventDefault();state.q=$('#searchInput').value.trim();state.department='';document.querySelectorAll('#nav button').forEach(x=>x.classList.toggle('active',x.dataset.dept===''));loadProducts()});$('#clearFilter').addEventListener('click',()=>{state.q='';state.department='';$('#searchInput').value='';loadProducts()});$('#cartButton').addEventListener('click',openCart);$('#closeCart').addEventListener('click',closeCart);$('#overlay').addEventListener('click',closeCart);$('#checkoutButton').addEventListener('click',checkout);$('#aiButton').addEventListener('click',()=>$('#aiPanel').classList.toggle('open'));$('#aiForm').addEventListener('submit',async e=>{e.preventDefault();const q=$('#aiInput').value.trim();if(!q)return;$('#aiBody').innerHTML=`<strong>Você:</strong> ${esc(q)}<br><br>Consultando catálogo…`;try{const r=await api('/api/ai/ask',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question:q})});$('#aiBody').innerHTML=`<strong>Assistente:</strong> ${esc(r.answer)}${r.products?.length?'<hr>'+r.products.map(p=>`${esc(p.name)} — <strong>${money.format(p.price)}</strong>`).join('<br>'):''}`;$('#aiInput').value=''}catch(err){$('#aiBody').textContent=err.message}});

renderCart();Promise.all([loadDepartments()]).then(loadProducts).catch(e=>console.error(e));
