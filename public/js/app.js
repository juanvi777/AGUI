'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const money = value => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(value || 0));
const AGUI_CONTACT = Object.freeze({ phone: '3122405580', whatsapp: '573122405580', address: 'Cra. 52 No. 56 A-54, Vegachí, Antioquia, Colombia' });
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const safeImage = value => /^\/(assets|uploads)\/[a-zA-Z0-9_./-]+$/.test(String(value || '')) ? value : '/assets/cover.jpg';
const state = { products: [], categories: ['Todos'], config: null, cart: [], currentCategory: 'Todos', adminProducts: [], adminOrders: [], adminZones: [], adminTables: [], customer: null, checkoutItems: null, admin: null, toastTimer: null, confirmResolve: null, authMode: 'customer', customerAddresses: [], customerOrders: [], resetToken: null, customerAccountStatus: null, adminPasswordResolve: null, tableContext: null, trackingToken: null, trackingTimer: null, adminPollTimer: null, adminSeenOrderIds: null, adminSeenAccountRequestIds: null, lastTrackedStatus: null, game: { cells: Array(9).fill(''), over: false } };

function toast(message, type = 'info') {
  const el = $('#toast'); if (!el) return;
  const icons = { success: '✓', error: '!', info: '✦' };
  const safeType = ['success','error','info'].includes(type) ? type : 'info';
  el.className = `toast toast-${safeType}`;
  el.innerHTML = `<span class="toast-icon" aria-hidden="true">${icons[safeType]}</span><span class="toast-message">${escapeHtml(message)}</span>`;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => el.classList.remove('show'), 3600);
}
function askConfirmation({ title, message, acceptLabel = 'Confirmar', danger = false }) {
  $('#actionConfirmTitle').textContent = title;
  $('#actionConfirmMessage').textContent = message;
  $('#acceptActionConfirm').textContent = acceptLabel;
  $('#acceptActionConfirm').classList.toggle('btn-danger', danger);
  $('#acceptActionConfirm').classList.toggle('btn-primary', !danger);
  $('#actionConfirmIcon').textContent = danger ? '!' : '✦';
  $('#actionConfirmIcon').classList.toggle('confirm-icon-danger', danger);
  openOverlay('actionConfirmOverlay');
  return new Promise(resolve => { state.confirmResolve = resolve; });
}
function finishConfirmation(accepted) {
  closeOverlay('actionConfirmOverlay');
  const resolve = state.confirmResolve;
  state.confirmResolve = null;
  if (resolve) resolve(accepted);
}
async function api(url, options = {}) {
  const headers = { ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
  const res = await fetch(url, { credentials: 'same-origin', ...options, headers });
  let data = {};
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) throw new Error(data.error || `Error ${res.status}. Intenta de nuevo.`);
  return data;
}
function saveCart() { localStorage.setItem('agui_cart_v1', JSON.stringify(state.cart)); updateCartCount(); }
function loadCart() {
  try {
    const raw = JSON.parse(localStorage.getItem('agui_cart_v1') || '[]');
    state.cart = Array.isArray(raw) ? raw.filter(i => Number.isInteger(Number(i.id)) && Number(i.quantity) > 0).map(i => ({ id:Number(i.id), quantity:Math.min(50,Number(i.quantity)) })) : [];
  } catch (_) { state.cart = []; }
  updateCartCount();
}
function updateCartCount() { $('#cartCount').textContent = state.cart.reduce((sum, item) => sum + item.quantity, 0); }
function closeOverlay(id) { const el = document.getElementById(id); if (el) el.classList.add('hidden'); }
function openOverlay(id) { const el = document.getElementById(id); if (el) el.classList.remove('hidden'); }
function productById(id) { return state.products.find(p => Number(p.id) === Number(id)) || state.adminProducts.find(p => Number(p.id) === Number(id)); }
function productCard(p) {
  const soldOut = p.stock !== null && Number(p.stock) <= 0;
  return `<article class="product-card">
    <div class="product-photo"><img src="${escapeHtml(safeImage(p.image_url))}" alt="${escapeHtml(p.name)}" loading="lazy" onerror="this.src='/assets/cover.jpg'">${p.featured ? '<span class="product-label">✦ Favorito</span>' : ''}</div>
    <div class="product-info"><span class="product-category">${escapeHtml(p.category || 'AGUI')}</span><h3 class="product-name">${escapeHtml(p.name)}</h3><p class="product-description">${escapeHtml(p.description || 'Una opción deliciosa para disfrutar.')}</p><div class="product-bottom"><span class="price">${money(p.price)}</span><div class="product-actions"><button class="buy-now-button" data-buy-now="${Number(p.id)}" ${soldOut ? 'disabled' : ''}>${soldOut ? 'Agotado' : 'Comprar ahora'}</button><button class="add-button" data-add="${Number(p.id)}" ${soldOut ? 'disabled' : ''}>＋ Al carrito</button></div></div></div>
  </article>`;
}
function renderProducts() {
  const q = ($('#productSearch').value || '').trim().toLocaleLowerCase('es-CO');
  const products = state.products.filter(p => (state.currentCategory === 'Todos' || p.category === state.currentCategory) && (!q || `${p.name} ${p.description || ''} ${p.category || ''}`.toLocaleLowerCase('es-CO').includes(q)));
  $('#productGrid').innerHTML = products.length ? products.map(productCard).join('') : '';
  $('#emptyProducts').classList.toggle('hidden', products.length > 0);
}
function renderCategories() {
  const items = state.categories.length ? state.categories : ['Todos'];
  $('#categoryChips').innerHTML = items.map(category => `<button class="chip ${category === state.currentCategory ? 'active' : ''}" data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`).join('');
}
function renderZones() {
  const zones = state.config?.zones || [];
  const zoneHost = $('#zoneCards');
  if (zones.length) zoneHost.innerHTML = zones.map(z => `<article class="zone-card"><span>⌖</span><b>${escapeHtml(z.name)}</b><small>${z.shipping_fee == null ? 'Costo por confirmar' : `Envío: ${money(z.shipping_fee)}`} · ${escapeHtml(z.eta || 'Por confirmar')}</small></article>`).join('');
  const select = $('#deliveryZone');
  select.innerHTML = '<option value="">Selecciona una zona</option>' + zones.map(z => `<option value="${escapeHtml(z.name)}">${escapeHtml(z.name)}${z.shipping_fee == null ? ' · envío por confirmar' : ` · ${money(z.shipping_fee)}`}</option>`).join('');
  const pay = $('#paymentMethod');
  const enabled = (state.config?.payments || []).filter(p => p.enabled);
  pay.innerHTML = enabled.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.label)}</option>`).join('');
  if (!pay.options.length) pay.innerHTML = '<option value="contraentrega">Pago por confirmar</option>';
}
function renderCart() {
  const items = state.cart.map(cartItem => {
    const product = productById(cartItem.id);
    return product ? { ...product, quantity: cartItem.quantity } : null;
  }).filter(Boolean);
  state.cart = items.map(p => ({ id:Number(p.id), quantity:p.quantity })); saveCart();
  const host = $('#cartItems');
  if (!items.length) {
    host.innerHTML = '<div class="empty-cart">Tu carrito todavía está vacío. Explora el catálogo y agrega lo que se te antoje. 🧡</div>';
  } else {
    host.innerHTML = items.map(p => `<div class="cart-item"><img src="${escapeHtml(safeImage(p.image_url))}" alt="${escapeHtml(p.name)}"><div><strong>${escapeHtml(p.name)}</strong><small>${money(p.price)} por unidad</small><div class="quantity-control"><button type="button" data-qty="-1" data-id="${Number(p.id)}" aria-label="Quitar uno">−</button><span>${p.quantity}</span><button type="button" data-qty="1" data-id="${Number(p.id)}" aria-label="Agregar uno">+</button></div><button class="remove-item" type="button" data-remove="${Number(p.id)}">Quitar</button></div><span class="item-total">${money(Number(p.price) * p.quantity)}</span></div>`).join('');
  }
  $('#cartSubtotal').textContent = money(items.reduce((sum,p) => sum + Number(p.price) * p.quantity, 0));
  $('#goCheckout').disabled = !items.length;
  $('#goCheckout').style.opacity = items.length ? '1' : '.5';
  renderCheckoutSummary();
}
function activeCheckoutItems() { return state.checkoutItems || state.cart; }
function renderCheckoutSummary() {
  const items = activeCheckoutItems().map(ci => ({ ...productById(ci.id), quantity:ci.quantity })).filter(p => p.id);
  const total = items.reduce((sum,p)=>sum + Number(p.price||0)*p.quantity,0);
  const el = $('#checkoutSummary');
  if (el) el.innerHTML = `<span>${items.reduce((n,p)=>n+p.quantity,0)} artículo(s) · subtotal</span><b>${money(total)}</b>`;
}
function addToCart(id) {
  const p = productById(id); if (!p) return;
  const found = state.cart.find(i => Number(i.id) === Number(id));
  if (found) found.quantity = Math.min(50, found.quantity + 1); else state.cart.push({ id:Number(id), quantity:1 });
  state.checkoutItems = null;
  saveCart(); renderCart(); toast(`${p.name} agregado al carrito.`);
}
function configureCheckoutMode() {
  const isTable = Boolean(state.tableContext);
  $('#customerLoginBox').classList.toggle('hidden', isTable || Boolean(state.customer));
  $('#tableOrderBanner').classList.toggle('hidden', !isTable);
  $('#tableOrderLabel').textContent = state.tableContext?.label || 'tu mesa';
  $('#checkoutTitle').textContent = isTable ? `Pedido · ${state.tableContext.label}` : (state.checkoutItems ? 'Comprar producto' : 'Datos de entrega');
  $('#checkoutDescription').textContent = isTable ? 'Tu pedido llegará directamente a esta mesa.' : 'Para domicilios necesitas una cuenta AGUI autorizada por Guillermo y completar los datos de entrega.';
  const hiddenFields = isTable ? ['phone','email','zone','payment','address','notes'] : [];
  $$('[data-checkout-field]').forEach(label => {
    const hide = hiddenFields.includes(label.dataset.checkoutField);
    label.classList.toggle('hidden', hide);
    const input = label.querySelector('input,select,textarea');
    if (input) input.required = !hide && ['name','phone','zone','payment','address'].includes(label.dataset.checkoutField);
  });
  if (isTable) {
    $('#checkoutForm').classList.remove('login-required-form');
    $('#checkoutForm').elements.customer_name.value = '';
  } else if (!state.customer) {
    $('#checkoutForm').classList.add('login-required-form');
  } else {
    $('#checkoutForm').classList.remove('login-required-form');
  }
}
function openCheckout() {
  renderCheckoutSummary(); openOverlay('checkoutOverlay');
  $('#orderSuccess').classList.add('hidden'); $('#checkoutForm').classList.remove('hidden');
  configureCheckoutMode();
  if (!state.tableContext && !state.customer) {
    renderCustomerAccount(); setCustomerAuthTab('login'); openOverlay('customerAuthOverlay');
  }
}

function buyNow(id) {
  const p = productById(id); if (!p) return;
  state.checkoutItems = [{ id:Number(id), quantity:1 }];
  openCheckout();
  if (!state.customer) toast('Inicia sesión o crea tu cuenta para continuar con la compra.');
}
function openWhatsApp(message) {
  const raw = (state.config?.whatsapp || AGUI_CONTACT.whatsapp).replace(/\D/g, '');
  const base = raw ? `https://wa.me/${raw}` : 'https://wa.me/';
  window.open(`${base}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
}
function renderCustomerAccount() {
  const customer = state.customer;
  const greeting = $('#customerGreeting');
  if (greeting) greeting.textContent = customer ? `Hola, ${(customer.full_name || 'cliente').trim().split(/\s+/)[0]}` : 'Iniciar sesión';
  $('#customerSignedInPanel').classList.toggle('hidden', !customer);
  $('#customerAuthForms').classList.toggle('hidden', Boolean(customer));
  if (customer) {
    $('#customerNameDisplay').textContent = customer.full_name || 'cliente';
    $('#customerEmailDisplay').textContent = customer.email || '';
    renderCustomerVerification();
  }
}
function renderCustomerVerification() {
  const panel = $('#customerVerificationPanel');
  if (!panel || !state.customer) return;
  const verified = Boolean(state.customer.delivery_verified_at || state.customerAccountStatus?.delivery_verified_at);
  const latest = state.customerAccountStatus?.latest_request;
  const pending = latest?.status === 'pending';
  panel.classList.toggle('is-verified', verified);
  $('#customerVerificationStatus').textContent = verified
    ? 'Tu cuenta ya fue autorizada por AGUI. Puedes realizar pedidos a domicilio.'
    : pending
      ? `Tu solicitud #${latest.id} está pendiente de revisión por Guillermo. Puedes avisarle también por WhatsApp.`
      : latest?.status === 'rejected'
        ? 'La solicitud anterior no fue aprobada. Puedes enviar una nueva solicitud o comunicarte con Guillermo.'
        : 'Puedes usar tu cuenta normalmente. Para realizar domicilios, Guillermo debe autorizarla primero.';
  $('#requestCustomerVerification').disabled = verified || pending;
  $('#requestCustomerVerification').textContent = verified ? 'Cuenta autorizada' : pending ? 'Solicitud pendiente' : 'Solicitar verificación';
  $('#customerVerificationWhatsapp').classList.toggle('hidden', verified);
}
function setCustomerAuthTab(tab) {
  const login = tab === 'login';
  $('#unifiedLoginForm').classList.toggle('hidden', !login);
  $('#forgotPasswordLink').classList.toggle('hidden', !login);
  $('#openRegisterForm').closest('.auth-create-account').classList.toggle('hidden', !login);
  $('#customerRegisterForm').classList.toggle('hidden', tab !== 'register');
  $('#customerAuthTitle').textContent = login ? 'Inicia sesión' : 'Crear cuenta';
  $('#customerAuthDescription').textContent = login ? 'Ingresa con el correo y la contraseña de tu cuenta AGUI.' : 'Regístrate con tu nombre, correo y contraseña. No necesitas verificar el correo para crear tu cuenta.';
  state.authMode = tab;
}
function openCustomerAuth() {
  renderCustomerAccount();
  setCustomerAuthTab('login');
  if (state.customer) loadCustomerPortal().catch(e => toast(e.message));
  openOverlay('customerAuthOverlay');
}
async function finishCustomerAuth(customer, message) {
  state.customer = customer; state.admin = null; state.customerAccountStatus = null; hideAdminScreen(); closeOverlay('customerAuthOverlay');
  await loadStore(); renderCustomerAccount(); await loadCustomerPortal().catch(e => toast(e.message)); toast(message);
}
async function unifiedLogin(event) {
  event.preventDefault(); const form = event.currentTarget; const data = Object.fromEntries(new FormData(form));
  const btn = $('button[type="submit"]', form); btn.disabled = true; btn.textContent = 'Verificando acceso…';
  try {
    const result = await api('/api/auth/login', { method:'POST', body:JSON.stringify(data) }); form.reset();
    if (result.role === 'admin') {
      state.admin = result.admin; state.customer = null; state.customerAccountStatus = null; closeOverlay('customerAuthOverlay'); renderCustomerAccount();
      if (result.mustChangePassword && !(await firstAdminPasswordChange())) return;
      showAdminScreen();
      toast('Bienvenido al panel de AGUI.', 'success');
    } else await finishCustomerAuth(result.customer, `Bienvenido, ${result.customer.full_name}.`);
  } catch (e) { toast(e.message, 'error'); }
  finally { btn.disabled = false; btn.innerHTML = 'Iniciar sesión <span>→</span>'; }
}
async function customerRegister(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  const button = $('button[type="submit"]', form);
  button.disabled = true; button.textContent = 'Creando cuenta…';
  try {
    const result = await api('/api/auth/customer/register', { method:'POST', body:JSON.stringify(data) });
    form.reset();
    await finishCustomerAuth(result.customer, `Tu cuenta AGUI fue creada. Bienvenido, ${result.customer.full_name}.`);
  } catch (e) { toast(e.message, 'error'); }
  finally { button.disabled = false; button.innerHTML = 'Crear cuenta <span>→</span>'; }
}

async function requestCustomerVerification(useWhatsApp = false) {
  let whatsappTab = null;
  if (useWhatsApp) { whatsappTab = window.open('about:blank', '_blank'); if (whatsappTab) whatsappTab.opener = null; }
  try {
    const result = await api('/api/customer/verification-request', { method:'POST', body:JSON.stringify({}) });
    if (result.whatsapp_url && useWhatsApp && whatsappTab) whatsappTab.location = result.whatsapp_url;
    else if (whatsappTab) whatsappTab.close();
    if (result.alreadyVerified) toast(result.message, 'success');
    else toast(result.message, 'success');
    state.customerAccountStatus = await api('/api/customer/account-status');
    renderCustomerVerification();
  } catch (e) {
    if (whatsappTab) whatsappTab.close();
    toast(e.message, 'error');
  }
}

function firstAdminPasswordChange() {
  openOverlay('adminFirstPasswordOverlay');
  return new Promise(resolve => { state.adminPasswordResolve = resolve; });
}
async function submitFirstAdminPassword(event) {
  event.preventDefault(); const form=event.currentTarget; const data=Object.fromEntries(new FormData(form));
  const btn=$('button[type="submit"]',form);btn.disabled=true;btn.textContent='Guardando…';
  try { await api('/api/auth/admin/first-password-change',{method:'POST',body:JSON.stringify(data)});closeOverlay('adminFirstPasswordOverlay');form.reset();toast('Contraseña inicial actualizada. Guárdala en un lugar seguro.','success');const resolve=state.adminPasswordResolve;state.adminPasswordResolve=null;if(resolve)resolve(true); }
  catch(e){toast(e.message,'error');}
  finally{btn.disabled=false;btn.textContent='Guardar contraseña segura';}
}
async function submitAdminSecondPassword(event) {
  event.preventDefault(); const form=event.currentTarget; const data=Object.fromEntries(new FormData(form));
  const btn=$('button[type="submit"]',form); btn.disabled=true; btn.textContent='Guardando…';
  try {
    const result=await api('/api/auth/admin/change-password',{method:'POST',body:JSON.stringify({current_password:data.current_password,password:data.password,confirm:data.confirm})});
    form.reset(); toast(result.message,'success');
    const status=await api('/api/admin/password-status');
    $('#adminPasswordRemaining').textContent=`Cambios sin verificación disponibles: ${status.remaining} de 2.`;
    if(status.remaining<=0) form.classList.add('hidden');
  } catch(e) { toast(e.message,'error'); }
  finally { btn.disabled=false; btn.textContent='Cambiar contraseña'; }
}

async function customerLogout() {
  try { await api('/api/auth/customer/logout', { method:'POST' }); state.customer = null; state.customerAccountStatus = null; state.customerAddresses=[]; state.customerOrders=[]; await loadStore(); toast('Has cerrado tu sesión.'); }
  catch (e) { toast(e.message); }
}
function renderCustomerAddresses() {
  const host=$('#customerAddressList'); if(!host)return;
  host.innerHTML=state.customerAddresses.length?state.customerAddresses.map(a=>`<article class="customer-address-card"><div><b>${escapeHtml(a.label)}</b>${a.is_default?'<span class="status-badge status-ready">Principal</span>':''}<p>${escapeHtml(a.recipient)} · ${escapeHtml(a.phone)}<br>${escapeHtml(a.address)} · ${escapeHtml(a.zone)}</p>${a.notes?`<small>${escapeHtml(a.notes)}</small>`:''}</div><div class="customer-address-actions">${!a.is_default?`<button class="mini-btn" data-address-default="${Number(a.id)}">Usar como principal</button>`:''}<button class="mini-btn danger" data-address-delete="${Number(a.id)}">Eliminar</button></div></article>`).join(''):'<p class="subtle-note">Todavía no tienes direcciones guardadas.</p>';
}
function renderCustomerOrders() {
  const host=$('#customerOrderList'); if(!host)return;
  host.innerHTML=state.customerOrders.length?state.customerOrders.map(o=>`<article class="customer-order-card"><div class="customer-order-head"><b>${escapeHtml(o.order_number)}</b><span class="status-badge status-${escapeHtml(o.status)}">${escapeHtml(orderStatusLabel(o.status))}</span></div><small>${new Date(o.created_at).toLocaleString('es-CO')} · ${o.order_type==='table'?`Mesa ${escapeHtml(o.table_label||'')}`:'Domicilio'}</small><ul>${(o.items||[]).map(i=>`<li>${escapeHtml(i.product_name)} × ${Number(i.quantity)} <span>${money(i.line_total)}</span></li>`).join('')}</ul><div class="customer-receipt-total"><span>Subtotal ${money(o.subtotal)}${o.shipping_cost==null?' · envío por confirmar':` · envío ${money(o.shipping_cost)}`}</span><b>${o.total==null?'Total por confirmar':money(o.total)}</b></div><small>Estado: ${escapeHtml(orderStatusLabel(o.status))}</small><button type="button" class="mini-btn" data-order-track="${escapeHtml(o.tracking_token||'')}">Actualizar seguimiento</button></article>`).join(''):'<p class="subtle-note">Aún no tienes pedidos asociados a esta cuenta.</p>';
}
function renderSavedCheckoutAddresses(){
  const field=$('#savedAddressField'),select=$('#savedAddressSelect');if(!field||!select)return;
  field.classList.toggle('hidden',!state.customer||!state.customerAddresses.length||Boolean(state.tableContext));
  select.innerHTML='<option value="">Selecciona una dirección guardada</option>'+state.customerAddresses.map(a=>`<option value="${Number(a.id)}">${escapeHtml(a.label)}${a.is_default?' · Principal':''}</option>`).join('');
  const preferred=state.customerAddresses.find(a=>a.is_default)||state.customerAddresses[0];
  const checkout=$('#checkoutForm');
  if(preferred&&checkout&&!state.tableContext){select.value=String(preferred.id);if(!checkout.elements.delivery_address.value){checkout.elements.customer_name.value=preferred.recipient;checkout.elements.customer_phone.value=preferred.phone;checkout.elements.delivery_zone.value=preferred.zone;checkout.elements.delivery_address.value=preferred.address;checkout.elements.delivery_notes.value=preferred.notes||'';}}
}
async function loadCustomerPortal() {
  if(!state.customer)return;
  const [profile,addresses,orders,accountStatus]=await Promise.all([api('/api/customer/profile'),api('/api/customer/addresses'),api('/api/customer/orders'),api('/api/customer/account-status')]);
  state.customer={...state.customer,...profile}; state.customerAddresses=addresses; state.customerOrders=orders; state.customerAccountStatus=accountStatus;
  const form=$('#customerProfileForm'); if(form){form.elements.full_name.value=profile.full_name||'';form.elements.username.value=profile.username||'';form.elements.phone.value=profile.phone||'';form.elements.new_password.value='';form.elements.confirm_password.value='';}
  const zone=$('#customerAddressZone'); if(zone)zone.innerHTML='<option value="">Selecciona una zona</option>'+(state.config?.zones||[]).map(z=>`<option value="${escapeHtml(z.name)}">${escapeHtml(z.name)}</option>`).join('');
  renderCustomerAddresses();renderCustomerOrders();renderSavedCheckoutAddresses();renderCustomerAccount();
}
async function saveCustomerProfile(event){event.preventDefault();const form=event.currentTarget;try{const result=await api('/api/customer/profile',{method:'PATCH',body:JSON.stringify(Object.fromEntries(new FormData(form)))});state.customer={...state.customer,...result};renderCustomerAccount();toast('Perfil actualizado.','success');}catch(e){toast(e.message,'error');}}
async function saveCustomerAddress(event){event.preventDefault();const form=event.currentTarget;try{await api('/api/customer/addresses',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(form)))});form.reset();await loadCustomerPortal();toast('Dirección guardada.','success');}catch(e){toast(e.message,'error');}}
async function handleCustomerAddressAction(button){const id=Number(button.dataset.addressDelete||button.dataset.addressDefault);try{if(button.dataset.addressDelete){if(!await askConfirmation({title:'Eliminar dirección',message:'Esta dirección dejará de estar guardada en tu cuenta.',acceptLabel:'Eliminar',danger:true}))return;await api(`/api/customer/addresses/${id}`,{method:'DELETE'});}else await api(`/api/customer/addresses/${id}/default`,{method:'PATCH'});await loadCustomerPortal();toast('Direcciones actualizadas.','success');}catch(e){toast(e.message,'error');}}
async function refreshCustomerOrderStatus(button){const token=button.dataset.orderTrack;if(!token)return;try{const latest=await api(`/api/orders/track/${encodeURIComponent(token)}`);const order=state.customerOrders.find(o=>o.tracking_token===token);if(order)order.status=latest.status;renderCustomerOrders();toast(`Pedido ${latest.order_number}: ${orderStatusLabel(latest.status)}.`,'success');}catch(e){toast(e.message,'error');}}
async function requestPasswordReset(event){event.preventDefault();const form=event.currentTarget;const resultHost=$('#forgotPasswordResult');const wa=$('#forgotPasswordWhatsapp');wa.classList.add('hidden');wa.removeAttribute('href');try{const result=await api('/api/auth/forgot-password',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(form)))});resultHost.textContent=result.message;resultHost.classList.remove('hidden');if(result.whatsapp_url){wa.href=result.whatsapp_url;wa.classList.remove('hidden');}toast('Solicitud enviada para revisión.','success');}catch(e){toast(e.message,'error');}}
async function submitPasswordReset(event){event.preventDefault();const form=event.currentTarget;try{const data=Object.fromEntries(new FormData(form));data.token=state.resetToken;const result=await api('/api/auth/reset-password',{method:'POST',body:JSON.stringify(data)});toast(result.message,'success');state.resetToken=null;history.replaceState({},'',location.pathname+location.hash);closeOverlay('passwordResetOverlay');form.reset();openCustomerAuth();}catch(e){toast(e.message,'error');}}

async function loadStore() {
  try {
    const [config, products, categories, me] = await Promise.all([
      api('/api/config'), api('/api/products'), api('/api/categories'), api('/api/me')
    ]);
    state.config = config; state.products = products; state.categories = categories; state.customer = me.customer; state.admin = me.admin;
    $('#year').textContent = new Date().getFullYear();
    document.title = `${config.businessName || 'AGUI'} | Repostería y Arepas`;
    const footerTagline = $('.footer-tagline'); if (footerTagline) footerTagline.textContent = config.tagline || 'El mejor sabor, en cada bocado.';
    renderProducts(); renderCategories(); renderZones(); renderCart();
    renderCustomerAccount();
    if (me.customer) {
      const box = $('#customerLoginBox');
      box.querySelector('b').textContent = `Sesión iniciada: ${me.customer.full_name}`;
      $('#checkoutLoginHint').textContent = me.customer.delivery_verified_at ? 'Tu cuenta está autorizada para domicilios. Completa teléfono, zona y dirección para registrar el pedido.' : 'Tu cuenta está activa, pero Guillermo debe autorizarla antes de aceptar domicilios. Entra a tu perfil y pulsa “Solicitar verificación”.';
      $('#checkoutLoginTrigger').classList.add('hidden');
      const checkout = $('#checkoutForm');
      if (checkout.elements.customer_name && !checkout.elements.customer_name.value) checkout.elements.customer_name.value = me.customer.full_name || '';
      if (checkout.elements.customer_email && !checkout.elements.customer_email.value) checkout.elements.customer_email.value = me.customer.email || '';
      if (checkout.elements.customer_phone && !checkout.elements.customer_phone.value) checkout.elements.customer_phone.value = me.customer.phone || '';
      checkout.classList.remove('login-required-form');
    } else {
      $('#customerLoginBox').classList.remove('hidden');
      $('#checkoutLoginHint').textContent = 'Para domicilios necesitas iniciar sesión y contar con la autorización de Guillermo. Los pedidos desde mesa por QR no requieren cuenta.';
      $('#checkoutLoginTrigger').classList.remove('hidden');
      $('#checkoutForm').classList.add('login-required-form');
    }
    if (state.tableContext) configureCheckoutMode();
    if (state.admin) { const ready = !me.admin.mustChangePassword || await firstAdminPasswordChange(); if (ready) showAdminScreen(); else hideAdminScreen(); }
    else if (state.customer) loadCustomerPortal().catch(e => console.warn('No se pudo cargar el perfil:', e.message));
  } catch (e) {
    $('#productGrid').innerHTML = `<div class="loading-card">No fue posible conectar con la tienda. ${escapeHtml(e.message)}<br><small>Verifica que el servidor y MySQL estén encendidos.</small></div>`;
  }
}

function showAdminScreen() {
  $('#adminScreen').classList.remove('hidden');
  $('#adminIdentity').textContent = state.admin?.email || 'Administrador';
  loadAdminOverview().catch(e => toast(e.message));
  if (state.adminPollTimer) clearInterval(state.adminPollTimer);
  state.adminSeenOrderIds = null; state.adminSeenAccountRequestIds = null;
  pollAdminOrders();
  state.adminPollTimer = setInterval(pollAdminOrders, 18000);
}
function hideAdminScreen() { $('#adminScreen').classList.add('hidden'); }
function switchAdminTab(tab) {
  $$('.admin-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.adminTab === tab));
  const paneIds = { overview:'adminOverview', products:'adminProducts', orders:'adminOrders', accountRequests:'adminAccountRequests', tables:'adminTables', delivery:'adminDelivery', settings:'adminSettings' };
  Object.values(paneIds).forEach(id => $('#'+id).classList.add('hidden'));
  $('#'+paneIds[tab]).classList.remove('hidden');
  const jobs = { overview:loadAdminOverview, products:loadAdminProducts, orders:loadAdminOrders, accountRequests:loadAdminAccountRequests, tables:loadAdminTables, delivery:loadAdminZones, settings:loadAdminSettings };
  if (jobs[tab]) jobs[tab]().catch(e => toast(e.message));
}
async function adminLogout() {
  try { await api('/api/auth/admin/logout', {method:'POST'}); } catch (_) {}
  if (state.adminPollTimer) clearInterval(state.adminPollTimer); state.adminPollTimer = null; state.adminSeenOrderIds = null; state.adminSeenAccountRequestIds = null;
  state.admin = null; state.customer = null; renderCustomerAccount(); hideAdminScreen(); toast('Sesión del dueño cerrada.');
}
function statusLabel(status) { return ({pending:'Pendiente',confirmed:'Confirmado',preparing:'Preparando',ready:'Listo para recoger',shipped:'En camino',delivered:'Entregado',cancelled:'Cancelado'})[status] || status; }
function statusBadge(status) { return `<span class="status-badge status-${escapeHtml(status)}">${escapeHtml(statusLabel(status))}</span>`; }
function ordersTable(orders, compact = false) {
  if (!orders.length) return '<p class="subtle-note">Todavía no hay pedidos registrados.</p>';
  return `<table class="admin-table"><thead><tr><th>Pedido</th><th>Cliente</th><th>Modalidad</th><th>Zona / Mesa</th><th>Fecha</th><th>Estado</th>${compact ? '' : '<th>Detalle</th>'}</tr></thead><tbody>${orders.map(o => `<tr><td><strong>${escapeHtml(o.order_number)}</strong></td><td>${escapeHtml(o.customer_name)}<br><small>${escapeHtml(o.customer_phone || 'Pedido sin registro')}</small></td><td>${o.order_type === 'table' ? 'En mesa' : 'Domicilio'}</td><td>${escapeHtml(o.order_type === 'table' ? (o.table_label || 'Mesa') : o.delivery_zone)}</td><td>${new Date(o.created_at).toLocaleDateString('es-CO')}</td><td>${statusBadge(o.status)}</td>${compact ? '' : `<td><details><summary>Ver pedido</summary><div class="order-detail"><p>${(o.items||[]).map(i=>`${escapeHtml(i.product_name)} × ${i.quantity}: ${money(i.line_total)}`).join('<br>')}</p><p><b>Subtotal:</b> ${money(o.subtotal)}<br><b>Entrega:</b> ${o.shipping_cost == null ? 'Por confirmar' : money(o.shipping_cost)}<br><b>Total:</b> ${o.total == null ? 'Por confirmar' : money(o.total)}</p><p>${escapeHtml(o.delivery_address || (o.table_label ? `Mesa ${o.table_label}` : ''))}<br>${escapeHtml(o.payment_method || '')}</p></div></details><label class="status-change">Cambiar estado <select data-order-status="${Number(o.id)}">${['pending','confirmed','preparing','ready','shipped','delivered','cancelled'].map(s=>`<option value="${s}" ${o.status===s?'selected':''}>${statusLabel(s)}</option>`).join('')}</select></label><button type="button" class="mini-btn" data-whatsapp-order="${Number(o.id)}">Avisar por WhatsApp</button></td>`}</tr>`).join('')}</tbody></table>`;
}
async function loadAdminOverview() {
  const data = await api('/api/admin/dashboard');
  $('#adminStats').innerHTML = [
    ['Productos',data.products,'En catálogo'],['Visibles',data.activeProducts,'Publicados'],['Pedidos',data.orders,'Registrados'],['Pendientes',data.pendingOrders,'Necesitan atención']
  ].map(s=>`<article class="stat-card"><small>${s[0]}</small><b>${Number(s[1]||0).toLocaleString('es-CO')}</b><span>${s[2]}</span></article>`).join('');
  const orders = await api('/api/admin/orders'); state.adminOrders=orders;
  $('#recentOrders').innerHTML = ordersTable(orders.slice(0,5), true);
}
async function loadAdminAccountRequests() {
  const rows = await api('/api/admin/account-requests');
  const host = $('#adminAccountRequestList');
  host.innerHTML = rows.length ? `<div class="account-request-list">${rows.map(r => `<article class="account-request-card"><div class="account-request-head"><span class="status-badge status-pending">Pendiente</span><small>Solicitud #${Number(r.id)} · ${new Date(r.created_at).toLocaleString('es-CO')}</small></div><h3>${r.request_type === 'delivery_verification' ? 'Autorizar domicilios' : 'Recuperar contraseña'}</h3><p><b>${escapeHtml(r.full_name)}</b><br>${escapeHtml(r.email)}<br>${escapeHtml(r.phone || 'Sin teléfono registrado')}</p><div class="account-request-actions"><button type="button" class="btn btn-primary" data-approve-account-request="${Number(r.id)}">${r.request_type === 'delivery_verification' ? 'Autorizar cuenta' : 'Aprobar y generar enlace'}</button><button type="button" class="btn btn-outline" data-reject-account-request="${Number(r.id)}">Rechazar</button></div></article>`).join('')}</div>` : '<p class="subtle-note">No hay solicitudes pendientes.</p>';
}
async function handleAdminAccountRequest(button, approve) {
  const id = Number(button.dataset.approveAccountRequest || button.dataset.rejectAccountRequest);
  if (!id) return;
  if (!approve && !(await askConfirmation({title:'Rechazar solicitud',message:'La solicitud quedará marcada como rechazada. El cliente podrá enviar una nueva.',acceptLabel:'Rechazar'}))) return;
  button.disabled = true;
  try {
    const result = await api(`/api/admin/account-requests/${id}/${approve?'approve':'reject'}`, { method:'POST', body:JSON.stringify({}) });
    if (result.reset_url) {
      const host=$('#accountRequestResult');
      host.innerHTML=`<div class="admin-notice"><b>Enlace de recuperación aprobado</b><p>${escapeHtml(result.message)}</p><a href="${escapeHtml(result.reset_url)}" target="_blank" rel="noopener">Abrir enlace seguro</a><button type="button" class="mini-btn" data-copy-reset-url="${escapeHtml(result.reset_url)}">Copiar enlace para WhatsApp</button></div>`;
    } else toast(result.message || 'Solicitud actualizada.','success');
    await loadAdminAccountRequests();
  } catch(e) { toast(e.message,'error'); button.disabled=false; }
}

async function loadAdminProducts() {
  state.adminProducts = await api('/api/admin/products');
  $('#adminProductTable').innerHTML = state.adminProducts.length ? `<table class="admin-table"><thead><tr><th>Producto</th><th>Precio</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${state.adminProducts.map(p=>`<tr><td><div class="table-product"><img src="${escapeHtml(safeImage(p.image_url))}" alt="" loading="lazy"><span><strong>${escapeHtml(p.name)}</strong><br><small>${escapeHtml(p.category)}</small></span></div></td><td>${money(p.price)}</td><td>${p.active ? '<span class="status-badge status-ready">Visible</span>':'<span class="status-badge status-cancelled">Oculto</span>'}</td><td><div class="table-actions"><button class="mini-btn" data-edit-product="${Number(p.id)}">Editar</button>${p.active ? `<button class="mini-btn" data-hide-product="${Number(p.id)}">Ocultar</button>` : `<button class="mini-btn" data-show-product="${Number(p.id)}">Mostrar</button>`}<button class="mini-btn danger" data-delete-product="${Number(p.id)}">Eliminar</button></div></td></tr>`).join('')}</tbody></table>` : '<p>No hay productos. Usa “Nuevo producto” para crear el primero.</p>';
}
async function changeProductVisibility(id, visible) {
  const product = state.adminProducts.find(p => Number(p.id) === Number(id));
  if (!product) return;
  const confirmed = await askConfirmation({
    title: visible ? 'Volver a mostrar el producto' : 'Ocultar producto de la tienda',
    message: visible ? `“${product.name}” volverá a aparecer en el catálogo para tus clientes.` : `“${product.name}” dejará de aparecer en la tienda. Podrás mostrarlo de nuevo cuando quieras.`,
    acceptLabel: visible ? 'Mostrar producto' : 'Ocultar producto'
  });
  if (!confirmed) return;
  try {
    await api(`/api/admin/products/${id}/visibility`, { method: 'PATCH', body: JSON.stringify({ active: visible }) });
    await Promise.all([loadAdminProducts(), refreshPublicProducts()]);
    toast(visible ? 'Producto visible nuevamente en la tienda.' : 'Producto ocultado del catálogo.', 'success');
  } catch (e) { toast(e.message, 'error'); }
}
async function deleteProductPermanently(id) {
  const product = state.adminProducts.find(p => Number(p.id) === Number(id));
  if (!product) return;
  const confirmed = await askConfirmation({
    title: 'Eliminar producto definitivamente',
    message: `Vas a eliminar “${product.name}” del catálogo. Esta acción no se puede deshacer. Los pedidos anteriores conservarán el nombre y precio guardados.`,
    acceptLabel: 'Eliminar definitivamente', danger: true
  });
  if (!confirmed) return;
  try {
    await api(`/api/admin/products/${id}`, { method: 'DELETE' });
    await Promise.all([loadAdminProducts(), refreshPublicProducts()]);
    toast('Producto eliminado del catálogo.', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

function editProduct(product = null) {
  const editor = $('#productEditor'); const form = $('#productForm'); form.reset();
  form.elements.id.value = product?.id || '';
  if (product) {
    form.elements.name.value = product.name || ''; form.elements.category.value = product.category || 'Otros'; form.elements.price.value = product.price || 0;
    form.elements.stock.value = product.stock ?? ''; form.elements.description.value = product.description || ''; form.elements.image_url.value = product.image_url || '';
    form.elements.featured.checked = Boolean(product.featured); form.elements.active.checked = Boolean(product.active); $('#productEditorTitle').textContent='Editar producto';
  } else { form.elements.active.checked=true; $('#productEditorTitle').textContent='Nuevo producto'; }
  editor.classList.remove('hidden'); editor.scrollIntoView({behavior:'smooth',block:'start'});
}
async function saveProduct(event) {
  event.preventDefault(); const form = event.currentTarget; const f = form.elements; const id = f.id.value;
  const payload = { name:f.name.value, category:f.category.value, price:Number(f.price.value), stock:f.stock.value===''?null:Number(f.stock.value), description:f.description.value, image_url:f.image_url.value, featured:f.featured.checked, active:f.active.checked };
  const file = f.image_file.files[0];
  try {
    if (file) {
      const uploadData = new FormData(); uploadData.append('image', file);
      const uploaded = await api('/api/admin/upload', {method:'POST',body:uploadData}); payload.image_url=uploaded.image_url;
    }
    await api(id ? `/api/admin/products/${id}` : '/api/admin/products', {method:id?'PUT':'POST',body:JSON.stringify(payload)});
    $('#productEditor').classList.add('hidden'); await Promise.all([loadAdminProducts(), refreshPublicProducts()]); toast('Producto guardado.', 'success');
  } catch(e) { toast(e.message); }
}
async function loadAdminOrders() {
  const status = $('#orderStatusFilter').value;
  state.adminOrders = await api('/api/admin/orders'+(status?`?status=${encodeURIComponent(status)}`:''));
  $('#adminOrderTable').innerHTML = ordersTable(state.adminOrders, false);
}
async function updateOrderStatus(id, status) {
  try { await api(`/api/admin/orders/${id}`,{method:'PATCH',body:JSON.stringify({status})}); toast('Estado del pedido actualizado.'); await loadAdminOrders(); }
  catch(e) { toast(e.message); }
}
async function loadAdminZones() {
  state.adminZones = await api('/api/admin/zones');
  $('#adminZoneList').innerHTML = state.adminZones.map(z=>`<div class="zone-editor" data-zone-row="${Number(z.id)}"><label>Zona<input value="${escapeHtml(z.name)}" disabled></label><label>Tarifa de envío (COP)<input type="number" min="0" step="500" name="shipping_fee" value="${z.shipping_fee == null ? '' : Number(z.shipping_fee)}" placeholder="Por confirmar"></label><label>Tiempo estimado<input name="eta" maxlength="160" value="${escapeHtml(z.eta)}"></label><button class="btn btn-primary small" data-save-zone="${Number(z.id)}">Guardar</button></div>`).join('');
}
async function saveZone(id) {
  const row = $(`[data-zone-row="${id}"]`);
  try { await api(`/api/admin/zones/${id}`,{method:'PUT',body:JSON.stringify({shipping_fee:row.querySelector('[name="shipping_fee"]').value,eta:row.querySelector('[name="eta"]').value,active:true})}); await Promise.all([loadAdminZones(),refreshPublicConfig()]); toast('Zona de entrega actualizada.'); }
  catch(e) { toast(e.message); }
}
async function loadAdminSettings() {
  const [data, passwordStatus] = await Promise.all([api('/api/admin/settings'), api('/api/admin/password-status')]);
  const form = $('#settingsForm');
  const defaults = { business_address: AGUI_CONTACT.address, business_phone: AGUI_CONTACT.phone, business_whatsapp: AGUI_CONTACT.whatsapp };
  if (!data.business_address || data.business_address === 'Vegachí, Antioquia, Colombia') data.business_address = AGUI_CONTACT.address;
  for (const [key,value] of Object.entries(data)) if (form.elements[key]) form.elements[key].value=value || defaults[key] || '';
  for (const [key,value] of Object.entries(defaults)) if (form.elements[key] && !form.elements[key].value) form.elements[key].value=value;
  $('#adminPasswordRemaining').textContent = `Cambios sin verificación disponibles: ${passwordStatus.remaining} de 2.`;
  $('#adminSecondPasswordForm').classList.toggle('hidden', passwordStatus.remaining <= 0);
}
async function saveSettings(event) {
  event.preventDefault(); const data=Object.fromEntries(new FormData(event.currentTarget));
  try { await api('/api/admin/settings',{method:'PUT',body:JSON.stringify(data)}); await refreshPublicConfig(); toast('Datos del negocio guardados.'); }
  catch(e) { toast(e.message); }
}
async function refreshPublicProducts() { state.products = await api('/api/products'); state.categories = await api('/api/categories'); renderCategories(); renderProducts(); renderCart(); }
async function refreshPublicConfig() { state.config = await api('/api/config'); renderZones(); }
function orderStatusLabel(status) {
  return ({ pending:'Recibido · pendiente de confirmación', confirmed:'Confirmado por AGUI', preparing:'En preparación', ready:'Listo para recoger', shipped:'En camino a tu dirección', delivered:'Entregado', cancelled:'Cancelado' })[status] || status;
}
function startOrderTracking(token) {
  state.trackingToken = token;
  try { sessionStorage.setItem('agui_tracking_token', token); } catch (_) {}
  state.lastTrackedStatus = null;
  if (state.trackingTimer) clearInterval(state.trackingTimer);
  const check = async () => {
    if (!state.trackingToken) return;
    try {
      const info = await api(`/api/orders/track/${encodeURIComponent(state.trackingToken)}`);
      $('#orderTrackingStatus').textContent = orderStatusLabel(info.status);
      $('#orderTrackingHint').textContent = info.order_type === 'table'
        ? `Pedido ${info.order_number} · Mesa ${info.table_label || ''}. Esta pantalla se actualiza automáticamente.`
        : `Pedido ${info.order_number}. Esta pantalla se actualiza automáticamente.`;
      if (state.lastTrackedStatus && state.lastTrackedStatus !== info.status) {
        toast(`Actualización de AGUI: ${orderStatusLabel(info.status)}.`, 'success');
        if ('Notification' in window && Notification.permission === 'granted') new Notification('Actualización de tu pedido AGUI', { body: orderStatusLabel(info.status) });
      }
      state.lastTrackedStatus = info.status;
      if (['delivered','cancelled'].includes(info.status)) { clearInterval(state.trackingTimer); state.trackingTimer = null; }
    } catch (_) { /* El seguimiento no debe interrumpir la confirmación del pedido. */ }
  };
  check();
  state.trackingTimer = setInterval(check, 12000);
}
async function enableCustomerOrderAlerts() {
  if (!("Notification" in window)) return toast('Este navegador no permite avisos del sistema. Mantén abierta esta pantalla para ver cambios de estado.');
  const permission = await Notification.requestPermission();
  toast(permission === 'granted' ? 'Avisos de estado activados.' : 'Los avisos del sistema no se autorizaron. Esta pantalla seguirá actualizándose.', permission === 'granted' ? 'success' : 'info');
}
async function checkoutSubmit(event) {
  event.preventDefault();
  const purchaseItems = activeCheckoutItems();
  if (!purchaseItems.length) return toast('Selecciona al menos un producto antes de continuar.');
  const isTable = Boolean(state.tableContext);
  if (!isTable && !state.customer) {
    $('#customerLoginBox').classList.remove('hidden'); openCustomerAuth(); return;
  }
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  data.items = purchaseItems.map(i => ({ id:i.id, quantity:i.quantity }));
  if (isTable) {
    data.order_type = 'table'; data.table_token = state.tableContext.token;
    data.customer_phone = ''; data.customer_email = ''; data.delivery_zone = '';
    data.delivery_address = ''; data.payment_method = 'en_mesa';
  } else {
    data.order_type = 'delivery';
    data.customer_email = state.customer.email;
    data.customer_name = state.customer.full_name;
  }
  const btn = $('#submitOrder'); btn.disabled = true; btn.textContent = 'Registrando pedido…';
  try {
    const result = await api('/api/orders', { method:'POST', body:JSON.stringify(data) });
    $('#orderSuccessText').textContent = `${result.order_number}. ${result.notice}`;
    $('#openOrderWhatsapp').href = result.whatsapp_url;
    $('#orderSuccess').classList.remove('hidden'); form.classList.add('hidden');
    $('#tableAfterOrder').classList.toggle('hidden', !isTable);
    if (isTable) initTicTacToe();
    startOrderTracking(result.tracking_token);
    if (!state.checkoutItems) { state.cart = []; saveCart(); renderCart(); }
    state.checkoutItems = null;
  } catch (e) {
    toast(e.message, 'error');
    if (!isTable && String(e.message || '').toLowerCase().includes('autorizada para domicilios')) openCustomerAuth();
  }
  finally { btn.disabled = false; btn.innerHTML = 'Registrar pedido <span>↗</span>'; }
}

function ticTacToeWinner(board) {
  const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  for (const line of lines) if (board[line[0]] && line.every(i => board[i] === board[line[0]])) return board[line[0]];
  return board.every(Boolean) ? 'draw' : null;
}
function renderTicTacToe() {
  state.game.cells.forEach((value, i) => {
    const cell = $(`[data-game-cell="${i}"]`);
    cell.textContent = value;
    cell.disabled = Boolean(value) || state.game.over;
    cell.classList.toggle('game-x', value === 'X'); cell.classList.toggle('game-o', value === 'O');
  });
}
function finishTicTacToe(outcome) {
  state.game.over = true;
  $('#ticTacToeStatus').textContent = outcome === 'X' ? '¡Ganaste! 🎉' : outcome === 'O' ? 'El bot ganó esta vez. ¡Otra partida!' : '¡Empate! Buena partida.';
  renderTicTacToe();
}
function botMove() {
  state.game.botThinking = false;
  const board = state.game.cells;
  const open = board.map((v,i) => v ? -1 : i).filter(i => i >= 0);
  const chooseWinning = (mark) => open.find(i => { const test = [...board]; test[i] = mark; return ticTacToeWinner(test) === mark; });
  let choice = chooseWinning('O');
  if (choice === undefined) choice = chooseWinning('X');
  if (choice === undefined && open.includes(4)) choice = 4;
  if (choice === undefined) { const corners = open.filter(i => [0,2,6,8].includes(i)); if (corners.length) choice = corners[Math.floor(Math.random()*corners.length)]; }
  if (choice === undefined && open.length) choice = open[Math.floor(Math.random()*open.length)];
  if (choice !== undefined) board[choice] = 'O';
  const winner = ticTacToeWinner(board);
  if (winner) finishTicTacToe(winner);
  else { $('#ticTacToeStatus').textContent = 'Tu turno · Eres X'; renderTicTacToe(); }
}
function playTicTacToe(index) {
  if (state.game.over || state.game.botThinking || state.game.cells[index]) return;
  state.game.cells[index] = 'X';
  const winner = ticTacToeWinner(state.game.cells);
  if (winner) return finishTicTacToe(winner);
  state.game.botThinking = true; $('#ticTacToeStatus').textContent = 'El bot está pensando…'; renderTicTacToe();
  window.setTimeout(botMove, 350);
}
function initTicTacToe() {
  state.game = { cells:Array(9).fill(''), over:false, botThinking:false };
  $('#ticTacToeStatus').textContent = 'Tú eres X · El bot es O';
  renderTicTacToe();
}

function tableQrUrl(tableId) {
  return `/api/admin/tables/${Number(tableId)}/qr.png`;
}
async function loadAdminTables() {
  state.adminTables = await api('/api/admin/tables');
  const host = $('#adminTableGrid');
  host.innerHTML = state.adminTables.length ? state.adminTables.map(t => {
    const qr = tableQrUrl(t.id);
    return `<article class="table-qr-card"><div class="table-qr-image"><img src="${qr}" alt="Código QR de ${escapeHtml(t.label)}" loading="lazy"><span>${t.active ? 'ACTIVA' : 'INACTIVA'}</span></div><div class="table-qr-content"><label>Nombre de la mesa<input data-table-label="${Number(t.id)}" value="${escapeHtml(t.label)}" maxlength="80"></label><small>QR único · ID ${Number(t.id)}</small><div class="table-qr-actions"><a class="mini-btn" href="${qr}" download="AGUI-QR-${encodeURIComponent(t.label)}.png">Descargar QR</a><button class="mini-btn" type="button" data-save-table="${Number(t.id)}">Guardar nombre</button><button class="mini-btn danger" type="button" data-delete-table="${Number(t.id)}">Eliminar</button></div></div></article>`;
  }).join('') : '<p class="empty-cart">Todavía no hay mesas. Agrega la primera para generar su código QR.</p>';
}
async function createTable(event) {
  event.preventDefault(); const form = event.currentTarget; const label = form.elements.label.value.trim();
  if (!label) return;
  try { await api('/api/admin/tables', { method:'POST', body:JSON.stringify({label}) }); form.reset(); await loadAdminTables(); toast('Mesa creada y QR generado.', 'success'); }
  catch (e) { toast(e.message, 'error'); }
}
async function saveTable(id) {
  const input = $(`[data-table-label="${id}"]`); if (!input) return;
  try { await api(`/api/admin/tables/${id}`, { method:'PATCH', body:JSON.stringify({label:input.value,active:true}) }); await loadAdminTables(); toast('Mesa actualizada.'); }
  catch (e) { toast(e.message, 'error'); }
}
async function deleteTable(id) {
  const confirmed = await askConfirmation({ title:'Eliminar mesa', message:'El QR de esta mesa dejará de funcionar. Los pedidos históricos conservarán el nombre de la mesa.', acceptLabel:'Eliminar mesa', danger:true });
  if (!confirmed) return;
  try { await api(`/api/admin/tables/${id}`, { method:'DELETE' }); await loadAdminTables(); toast('Mesa eliminada y QR invalidado.', 'success'); }
  catch (e) { toast(e.message, 'error'); }
}
function openOrderWhatsApp(orderId) {
  const order = state.adminOrders.find(o => Number(o.id) === Number(orderId));
  if (!order || !order.customer_phone) return toast('Este pedido no tiene teléfono de contacto registrado.');
  const text = `Hola ${order.customer_name}, te escribe AGUI. Tu pedido ${order.order_number} está: ${orderStatusLabel(order.status)}. ¡Gracias por elegirnos!`;
  const digits = String(order.customer_phone).replace(/\D/g,'');
  window.open(`https://wa.me/${digits}?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
}
async function pollAdminOrders() {
  if (!state.admin) return;
  try {
    const orders = await api('/api/admin/orders');
    if (state.adminSeenOrderIds === null) {
      state.adminSeenOrderIds = new Set(orders.map(o => Number(o.id)));
      state.adminOrders = orders;
      return;
    }
    const fresh = orders.filter(o => !state.adminSeenOrderIds.has(Number(o.id)));
    for (const order of fresh) {
      state.adminSeenOrderIds.add(Number(order.id));
      const where = order.order_type === 'table' ? `Mesa ${order.table_label || ''}` : 'Domicilio';
      toast(`¡Nuevo pedido ${where}: ${order.order_number}!`, 'success');
      if ('Notification' in window && Notification.permission === 'granted') new Notification('Nuevo pedido en AGUI', { body:`${where} · ${order.customer_name} · ${order.order_number}` });
    }
    if (fresh.length) loadAdminOverview().catch(() => {});
    const accountRequests = await api('/api/admin/account-requests');
    const requestIds = new Set(accountRequests.map(r => Number(r.id)));
    if (state.adminSeenAccountRequestIds === null) state.adminSeenAccountRequestIds = requestIds;
    else {
      const newRequests = accountRequests.filter(r => !state.adminSeenAccountRequestIds.has(Number(r.id)));
      newRequests.forEach(r => toast(`Nueva solicitud de ${r.request_type === 'delivery_verification' ? 'verificación de cuenta' : 'recuperación de contraseña'}: ${r.full_name}.`, 'success'));
      state.adminSeenAccountRequestIds = requestIds;
      if (newRequests.length && !$('#adminAccountRequests').classList.contains('hidden')) loadAdminAccountRequests().catch(() => {});
    }
  } catch (_) { /* Mantiene el panel utilizable si la red falla. */ }
}
async function enableAdminAlerts() {
  if (!('Notification' in window)) return toast('Este navegador no permite avisos de escritorio. El panel seguirá mostrando avisos dentro de AGUI.');
  const permission = await Notification.requestPermission();
  if (permission === 'granted') { $('#adminAlertHint').classList.remove('hidden'); toast('Avisos de nuevos pedidos activados.', 'success'); }
  else toast('No se autorizó el aviso del navegador. Los avisos internos siguen activos.');
}
async function loadTableFromQr() {
  const params = new URLSearchParams(location.search);
  const token = params.get('mesa');
  if (!token) return;
  try {
    const table = await api(`/api/tables/${encodeURIComponent(token)}`);
    state.tableContext = { token, label: table.label };
    toast(`¡Bienvenido! Estás pidiendo desde ${table.label}.`, 'success');
    const intro = $('.hero-note');
    if (intro) intro.innerHTML = `<span>✦</span> Pedido en mesa: <b>${escapeHtml(table.label)}</b> <span>·</span> Sin registro obligatorio`;
    // Conservamos el parámetro mesa en la URL para que una recarga mantenga el contexto del QR.
  } catch (e) { state.tableContext = null; toast(e.message, 'error'); }
}

function initEvents() {
  $('#menuToggle').addEventListener('click',()=>{const nav=$('#mainNav'); const open=nav.classList.toggle('open'); $('#menuToggle').setAttribute('aria-expanded',String(open)); $('#menuToggle').setAttribute('aria-label',open?'Cerrar menú':'Abrir menú');});
  $$('#mainNav a').forEach(a=>a.addEventListener('click',()=>{ $('#mainNav').classList.remove('open'); $('#menuToggle').setAttribute('aria-expanded','false'); $('#menuToggle').setAttribute('aria-label','Abrir menú'); }));
  $('#productSearch').addEventListener('input',renderProducts);
  $('#categoryChips').addEventListener('click',e=>{const btn=e.target.closest('[data-category]');if(!btn)return;state.currentCategory=btn.dataset.category;renderCategories();renderProducts();});
  document.addEventListener('click', e=>{
    const buyNowButton=e.target.closest('[data-buy-now]'); if(buyNowButton){buyNow(Number(buyNowButton.dataset.buyNow));return;}
    const add=e.target.closest('[data-add]'); if(add){addToCart(Number(add.dataset.add));return;}
    const qty=e.target.closest('[data-qty]'); if(qty){const it=state.cart.find(i=>i.id===Number(qty.dataset.id));if(it){it.quantity+=Number(qty.dataset.qty);if(it.quantity<=0)state.cart=state.cart.filter(i=>i.id!==it.id);if(it.quantity>50)it.quantity=50;saveCart();renderCart();}return;}
    const remove=e.target.closest('[data-remove]');if(remove){state.cart=state.cart.filter(i=>i.id!==Number(remove.dataset.remove));saveCart();renderCart();return;}
    const edit=e.target.closest('[data-edit-product]');if(edit){editProduct(state.adminProducts.find(p=>Number(p.id)===Number(edit.dataset.editProduct)));return;}
    const hide=e.target.closest('[data-hide-product]');if(hide){changeProductVisibility(Number(hide.dataset.hideProduct),false);return;}
    const show=e.target.closest('[data-show-product]');if(show){changeProductVisibility(Number(show.dataset.showProduct),true);return;}
    const del=e.target.closest('[data-delete-product]');if(del){deleteProductPermanently(Number(del.dataset.deleteProduct));return;}
    const saveZoneBtn=e.target.closest('[data-save-zone]');if(saveZoneBtn){saveZone(Number(saveZoneBtn.dataset.saveZone));return;}
    const saveTableBtn=e.target.closest('[data-save-table]');if(saveTableBtn){saveTable(Number(saveTableBtn.dataset.saveTable));return;}
    const deleteTableBtn=e.target.closest('[data-delete-table]');if(deleteTableBtn){deleteTable(Number(deleteTableBtn.dataset.deleteTable));return;}
    const waOrder=e.target.closest('[data-whatsapp-order]');if(waOrder){openOrderWhatsApp(Number(waOrder.dataset.whatsappOrder));return;}
    const tab=e.target.closest('[data-admin-tab]');if(tab){switchAdminTab(tab.dataset.adminTab);return;}
    const switchTab=e.target.closest('[data-switch-tab]');if(switchTab){switchAdminTab(switchTab.dataset.switchTab);return;}
    const close=e.target.closest('[data-close]');if(close){if(close.dataset.close==='actionConfirmOverlay')finishConfirmation(false);else closeOverlay(close.dataset.close);return;}
  });
  $('#cartOpen').addEventListener('click',()=>{state.checkoutItems=null;renderCart();openOverlay('cartOverlay');});
  $('#goCheckout').addEventListener('click',()=>{if(!state.cart.length)return;state.checkoutItems=null;closeOverlay('cartOverlay');openCheckout();});
  $('#customerAccount').addEventListener('click',openCustomerAuth);
  $('#checkoutLoginTrigger').addEventListener('click',openCustomerAuth);
  $('#unifiedLoginForm').addEventListener('submit',unifiedLogin);
  $('#customerRegisterForm').addEventListener('submit',customerRegister);
  $('#requestCustomerVerification').addEventListener('click',()=>requestCustomerVerification(false));
  $('#customerVerificationWhatsapp').addEventListener('click',()=>requestCustomerVerification(true));
  $('#openRegisterForm').addEventListener('click',()=>setCustomerAuthTab('register'));
  $('#openLoginForm').addEventListener('click',()=>setCustomerAuthTab('login'));
  $('#postOrderRegister').addEventListener('click',()=>{openCustomerAuth();setCustomerAuthTab('register');});
  $('#customerProfileForm').addEventListener('submit',saveCustomerProfile);
  $('#customerAddressForm').addEventListener('submit',saveCustomerAddress);
  $('#customerAddressList').addEventListener('click',e=>{const b=e.target.closest('[data-address-delete],[data-address-default]');if(b)handleCustomerAddressAction(b);});
  $('#customerOrderList').addEventListener('click',e=>{const b=e.target.closest('[data-order-track]');if(b)refreshCustomerOrderStatus(b);});
  $('#savedAddressSelect').addEventListener('change',e=>{const a=state.customerAddresses.find(x=>Number(x.id)===Number(e.target.value));if(!a)return;const f=$('#checkoutForm');f.elements.customer_name.value=a.recipient;f.elements.customer_phone.value=a.phone;f.elements.delivery_zone.value=a.zone;f.elements.delivery_address.value=a.address;f.elements.delivery_notes.value=a.notes||'';});
  $('#forgotPasswordLink').addEventListener('click',e=>{e.preventDefault();$('#forgotPasswordForm').classList.remove('hidden');$('#resetPasswordForm').classList.add('hidden');openOverlay('passwordResetOverlay');});
  $('#forgotPasswordForm').addEventListener('submit',requestPasswordReset);
  $('#adminSecondPasswordForm').addEventListener('submit',submitAdminSecondPassword);
  $('#adminAccountRequestRefresh').addEventListener('click',()=>loadAdminAccountRequests().catch(e=>toast(e.message)));
  $('#adminAccountRequestList').addEventListener('click',e=>{const approve=e.target.closest('[data-approve-account-request]');const reject=e.target.closest('[data-reject-account-request]');const copy=e.target.closest('[data-copy-reset-url]');if(approve)handleAdminAccountRequest(approve,true);else if(reject)handleAdminAccountRequest(reject,false);else if(copy){navigator.clipboard?.writeText(copy.dataset.copyResetUrl).then(()=>toast('Enlace copiado.','success')).catch(()=>toast('No se pudo copiar automáticamente; abre y copia el enlace.','error'));}});
  $('#resetPasswordForm').addEventListener('submit',submitPasswordReset);
  $('#adminFirstPasswordForm').addEventListener('submit',submitFirstAdminPassword);
  $('#customerLogout').addEventListener('click',customerLogout);
  ['heroWhatsapp','footerWhatsapp'].forEach(id=>$('#'+id).addEventListener('click',()=>openWhatsApp('Hola, AGUI. Quisiera consultar por sus productos y disponibilidad.')));
  $('#acceptActionConfirm').addEventListener('click',()=>finishConfirmation(true));$('#cancelActionConfirm').addEventListener('click',()=>finishConfirmation(false));$('#adminLogout').addEventListener('click',adminLogout);$('#adminClose').addEventListener('click',hideAdminScreen);
  $('#refreshDashboard').addEventListener('click',()=>loadAdminOverview().then(()=>toast('Resumen actualizado.')).catch(e=>toast(e.message)));
  $('#refreshOrders').addEventListener('click',()=>loadAdminOrders().catch(e=>toast(e.message)));$('#refreshZones').addEventListener('click',()=>loadAdminZones().catch(e=>toast(e.message)));
  $('#newProduct').addEventListener('click',()=>editProduct());$('#cancelProductEdit').addEventListener('click',()=>$('#productEditor').classList.add('hidden'));$('#productForm').addEventListener('submit',saveProduct);
  $('#settingsForm').addEventListener('submit',saveSettings);$('#checkoutForm').addEventListener('submit',checkoutSubmit);
  $('#newTableForm').addEventListener('submit',createTable); $('#refreshTables').addEventListener('click',()=>loadAdminTables().catch(e=>toast(e.message)));
  $('#enableAdminAlerts').addEventListener('click',enableAdminAlerts);
  $('#printTables').addEventListener('click',()=>window.print());
  $('#resetTicTacToe').addEventListener('click',initTicTacToe);
  $('#enableOrderAlerts').addEventListener('click',enableCustomerOrderAlerts);
  $('#ticTacToe').addEventListener('click',e=>{const cell=e.target.closest('[data-game-cell]');if(cell)playTicTacToe(Number(cell.dataset.gameCell));});
  $('#orderStatusFilter').addEventListener('change',()=>loadAdminOrders().catch(e=>toast(e.message)));
  $('#adminOrderTable').addEventListener('change',e=>{const el=e.target.closest('[data-order-status]');if(el)updateOrderStatus(Number(el.dataset.orderStatus),el.value);});
  $('#adminOrderTable').addEventListener('click',e=>{const el=e.target.closest('[data-order-status]');if(el)el.dataset.previous=el.value;});
  $$('.overlay').forEach(overlay=>overlay.addEventListener('click',e=>{if(e.target===overlay){if(overlay.id==='actionConfirmOverlay')finishConfirmation(false);else if(overlay.id!=='adminFirstPasswordOverlay')overlay.classList.add('hidden');}}));
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(!$('#actionConfirmOverlay').classList.contains('hidden'))finishConfirmation(false);$$('.overlay').forEach(o=>{if(o.id!=='adminFirstPasswordOverlay')o.classList.add('hidden');});}});
}

async function boot() {
  loadCart(); initEvents();
  await loadTableFromQr();
  await loadStore();
  const params=new URLSearchParams(location.search);
  if(params.has('reset')) { state.resetToken=params.get('reset'); $('#forgotPasswordForm').classList.add('hidden'); $('#resetPasswordForm').classList.remove('hidden'); openOverlay('passwordResetOverlay'); }
  if (state.tableContext) { configureCheckoutMode(); $('#cartOpen').setAttribute('aria-label', `Carrito · ${state.tableContext.label}`); }
  if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});
  window.setTimeout(() => { const splash = $('#aguiSplash'); if (splash) { splash.classList.add('splash-hidden'); window.setTimeout(() => splash.remove(), 700); } }, 1100);
}
document.addEventListener('DOMContentLoaded',boot);
