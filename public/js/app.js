'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const money = value => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(value || 0));
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const safeImage = value => /^\/(assets|uploads)\/[a-zA-Z0-9_./-]+$/.test(String(value || '')) ? value : '/assets/cover.jpg';
const state = { products: [], categories: ['Todos'], config: null, cart: [], currentCategory: 'Todos', adminProducts: [], adminOrders: [], adminZones: [], customer: null, checkoutItems: null, admin: null, toastTimer: null, confirmResolve: null, authMode: 'customer' };

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
function openCheckout() {
  renderCheckoutSummary(); openOverlay('checkoutOverlay');
  $('#orderSuccess').classList.add('hidden'); $('#checkoutForm').classList.remove('hidden');
  $('#checkoutTitle').textContent = state.checkoutItems ? 'Comprar producto' : 'Datos de entrega';
  if (!state.customer) {
    $('#googleBox').classList.remove('hidden'); $('#checkoutForm').classList.add('login-required-form');
    renderCustomerAccount(); openOverlay('customerAuthOverlay');
  } else { $('#checkoutForm').classList.remove('login-required-form'); }
}
function buyNow(id) {
  const p = productById(id); if (!p) return;
  state.checkoutItems = [{ id:Number(id), quantity:1 }];
  openCheckout();
  if (!state.customer) toast('Inicia sesión o crea tu cuenta para continuar con la compra.');
}
function openWhatsApp(message) {
  const raw = (state.config?.whatsapp || '').replace(/\D/g, '');
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
  }
  if (state.authMode === 'customer') {
    $('#customerAuthTitle').textContent = customer ? 'Tu cuenta de cliente' : ($('#authTabRegister').classList.contains('active') ? 'Crea tu cuenta' : 'Inicia sesión');
    $('#customerAuthDescription').textContent = customer ? 'Tu sesión está activa. Puedes continuar con tu pedido.' : 'Entra a tu cuenta para hacer tus pedidos y guardar tus datos.';
  }
}
function setAuthMode(mode = 'customer') {
  state.authMode = mode === 'owner' ? 'owner' : 'customer';
  const isOwner = state.authMode === 'owner';
  $('#authRoleCustomer').classList.toggle('active', !isOwner);
  $('#authRoleOwner').classList.toggle('active', isOwner);
  $('#customerAuthPanel').classList.toggle('hidden', isOwner);
  $('#ownerAuthPanel').classList.toggle('hidden', !isOwner);
  $('#customerAuthTitle').textContent = isOwner ? 'Acceso del dueño' : (state.customer ? 'Tu cuenta de cliente' : ($('#authTabRegister').classList.contains('active') ? 'Crea tu cuenta' : 'Inicia sesión'));
  $('#customerAuthDescription').textContent = isOwner ? 'Ingresa con el correo administrador y la contraseña privada del panel.' : (state.customer ? 'Tu sesión está activa. Puedes continuar con tu pedido.' : 'Entra a tu cuenta para hacer tus pedidos y guardar tus datos.');
}
function setCustomerAuthTab(tab) {
  const isLogin = tab === 'login';
  $('#authTabLogin').classList.toggle('active', isLogin);
  $('#authTabRegister').classList.toggle('active', !isLogin);
  $('#customerLoginForm').classList.toggle('hidden', !isLogin);
  $('#customerRegisterForm').classList.toggle('hidden', isLogin);
  if (state.authMode === 'customer') {
    $('#customerAuthTitle').textContent = isLogin ? 'Inicia sesión' : 'Crea tu cuenta';
    $('#customerAuthDescription').textContent = isLogin ? 'Entra a tu cuenta para hacer tus pedidos y guardar tus datos.' : 'Regístrate una sola vez para que tus pedidos queden asociados a tu nombre.';
  }
}
function openCustomerAuth() {
  renderCustomerAccount(); setAuthMode('customer'); openOverlay('customerAuthOverlay');
}
async function finishCustomerAuth(customer, message) {
  state.customer = customer;
  state.admin = null;
  hideAdminScreen();
  closeOverlay('customerAuthOverlay');
  await loadStore();
  renderCustomerAccount();
  toast(message);
}
async function customerLogin(event) {
  event.preventDefault(); const form = event.currentTarget; const btn = $('button[type="submit"]', form);
  const data = Object.fromEntries(new FormData(form)); btn.disabled = true; btn.textContent = 'Ingresando…';
  try { const result = await api('/api/auth/customer/login', { method:'POST', body:JSON.stringify(data) }); form.reset(); await finishCustomerAuth(result.customer, `Bienvenido, ${result.customer.full_name}.`); }
  catch (e) { toast(e.message); }
  finally { btn.disabled = false; btn.innerHTML = 'Entrar a mi cuenta <span>→</span>'; }
}
async function customerRegister(event) {
  event.preventDefault(); const form = event.currentTarget; const data = Object.fromEntries(new FormData(form));
  if (data.password !== data.password_confirm) return toast('Las contraseñas no coinciden.');
  const btn = $('button[type="submit"]', form); btn.disabled = true; btn.textContent = 'Creando cuenta…'; delete data.password_confirm;
  try { const result = await api('/api/auth/customer/register', { method:'POST', body:JSON.stringify(data) }); form.reset(); await finishCustomerAuth(result.customer, `Cuenta creada. ¡Bienvenido, ${result.customer.full_name}!`); }
  catch (e) { toast(e.message); }
  finally { btn.disabled = false; btn.innerHTML = 'Crear cuenta y continuar <span>→</span>'; }
}
async function customerLogout() {
  try { await api('/api/auth/customer/logout', { method:'POST' }); state.customer = null; await loadStore(); setCustomerAuthTab('login'); toast('Has cerrado tu sesión.'); }
  catch (e) { toast(e.message); }
}

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
      const box = $('#googleBox');
      box.querySelector('b').textContent = `Sesión iniciada: ${me.customer.full_name}`;
      $('#checkoutLoginHint').textContent = 'Tu sesión está activa. Completa teléfono, zona y dirección para registrar el pedido.';
      $('#checkoutLoginTrigger').classList.add('hidden');
      $('#googleLogin').classList.add('hidden');
      $('#googleSetupNote').classList.add('hidden');
      const checkout = $('#checkoutForm');
      if (checkout.elements.customer_name && !checkout.elements.customer_name.value) checkout.elements.customer_name.value = me.customer.full_name || '';
      if (checkout.elements.customer_email && !checkout.elements.customer_email.value) checkout.elements.customer_email.value = me.customer.email || '';
      if (checkout.elements.customer_phone && !checkout.elements.customer_phone.value) checkout.elements.customer_phone.value = me.customer.phone || '';
      checkout.classList.remove('login-required-form');
    } else {
      $('#googleBox').classList.remove('hidden');
      $('#checkoutLoginHint').textContent = 'Debes iniciar sesión o crear una cuenta antes de confirmar el pedido.';
      $('#checkoutLoginTrigger').classList.remove('hidden');
      $('#googleLogin').classList.toggle('hidden', !config.googleLoginConfigured);
      $('#googleSetupNote').classList.toggle('hidden', Boolean(config.googleLoginConfigured));
      $('#googleLoginModal').classList.toggle('hidden', !config.googleLoginConfigured);
      $('#googleAuthHelp').classList.toggle('hidden', Boolean(config.googleLoginConfigured));
      $('#checkoutForm').classList.add('login-required-form');
    }
    if (state.admin) showAdminScreen();
  } catch (e) {
    $('#productGrid').innerHTML = `<div class="loading-card">No fue posible conectar con la tienda. ${escapeHtml(e.message)}<br><small>Verifica que el servidor y MySQL estén encendidos.</small></div>`;
  }
}

function showAdminLogin() { renderCustomerAccount(); setAuthMode('owner'); openOverlay('customerAuthOverlay'); }
async function adminLogin(event) {
  event.preventDefault(); const form = event.currentTarget; const data = Object.fromEntries(new FormData(form));
  const btn = $('button[type="submit"]', form); btn.disabled = true; btn.textContent = 'Ingresando…';
  try { state.admin = (await api('/api/auth/admin/login', { method:'POST', body:JSON.stringify(data) })).admin; state.customer = null; renderCustomerAccount(); closeOverlay('customerAuthOverlay'); showAdminScreen(); await loadAdminOverview(); toast('Bienvenido al panel de AGUI.', 'success'); }
  catch (e) { toast(e.message); }
  finally { btn.disabled = false; btn.innerHTML = 'Entrar al panel <span>→</span>'; }
}
function showAdminScreen() {
  $('#adminScreen').classList.remove('hidden');
  $('#adminIdentity').textContent = state.admin?.email || 'Administrador';
  loadAdminOverview().catch(e => toast(e.message));
}
function hideAdminScreen() { $('#adminScreen').classList.add('hidden'); }
function switchAdminTab(tab) {
  $$('.admin-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.adminTab === tab));
  const paneIds = { overview:'adminOverview', products:'adminProducts', orders:'adminOrders', delivery:'adminDelivery', settings:'adminSettings' };
  Object.values(paneIds).forEach(id => $('#'+id).classList.add('hidden'));
  $('#'+paneIds[tab]).classList.remove('hidden');
  const jobs = { overview:loadAdminOverview, products:loadAdminProducts, orders:loadAdminOrders, delivery:loadAdminZones, settings:loadAdminSettings };
  if (jobs[tab]) jobs[tab]().catch(e => toast(e.message));
}
async function adminLogout() {
  try { await api('/api/auth/admin/logout', {method:'POST'}); } catch (_) {}
  state.admin = null; state.customer = null; renderCustomerAccount(); hideAdminScreen(); toast('Sesión del dueño cerrada.');
}
function statusLabel(status) { return ({pending:'Pendiente',confirmed:'Confirmado',preparing:'Preparando',ready:'Listo',delivered:'Entregado',cancelled:'Cancelado'})[status] || status; }
function statusBadge(status) { return `<span class="status-badge status-${escapeHtml(status)}">${escapeHtml(statusLabel(status))}</span>`; }
function ordersTable(orders, compact = false) {
  if (!orders.length) return '<p class="subtle-note">Todavía no hay pedidos registrados.</p>';
  return `<table class="admin-table"><thead><tr><th>Pedido</th><th>Cliente</th><th>Zona</th><th>Fecha</th><th>Estado</th>${compact ? '' : '<th>Detalle</th>'}</tr></thead><tbody>${orders.map(o => `<tr><td><strong>${escapeHtml(o.order_number)}</strong></td><td>${escapeHtml(o.customer_name)}<br><small>${escapeHtml(o.customer_phone)}</small></td><td>${escapeHtml(o.delivery_zone)}</td><td>${new Date(o.created_at).toLocaleDateString('es-CO')}</td><td>${statusBadge(o.status)}</td>${compact ? '' : `<td><details><summary>Ver pedido</summary><div class="order-detail"><p>${(o.items||[]).map(i=>`${escapeHtml(i.product_name)} × ${i.quantity}: ${money(i.line_total)}`).join('<br>')}</p><p><b>Subtotal:</b> ${money(o.subtotal)}<br><b>Entrega:</b> ${o.shipping_cost == null ? 'Por confirmar' : money(o.shipping_cost)}<br><b>Total:</b> ${o.total == null ? 'Por confirmar' : money(o.total)}</p><p>${escapeHtml(o.delivery_address)}<br>${escapeHtml(o.payment_method)}</p></div></details><label class="status-change">Cambiar estado <select data-order-status="${Number(o.id)}">${['pending','confirmed','preparing','ready','delivered','cancelled'].map(s=>`<option value="${s}" ${o.status===s?'selected':''}>${statusLabel(s)}</option>`).join('')}</select></label></td>`}</tr>`).join('')}</tbody></table>`;
}
async function loadAdminOverview() {
  const data = await api('/api/admin/dashboard');
  $('#adminStats').innerHTML = [
    ['Productos',data.products,'En catálogo'],['Visibles',data.activeProducts,'Publicados'],['Pedidos',data.orders,'Registrados'],['Pendientes',data.pendingOrders,'Necesitan atención']
  ].map(s=>`<article class="stat-card"><small>${s[0]}</small><b>${Number(s[1]||0).toLocaleString('es-CO')}</b><span>${s[2]}</span></article>`).join('');
  const orders = await api('/api/admin/orders'); state.adminOrders=orders;
  $('#recentOrders').innerHTML = ordersTable(orders.slice(0,5), true);
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
  const data = await api('/api/admin/settings'); const form = $('#settingsForm');
  for (const [key,value] of Object.entries(data)) if (form.elements[key]) form.elements[key].value=value;
}
async function saveSettings(event) {
  event.preventDefault(); const data=Object.fromEntries(new FormData(event.currentTarget));
  try { await api('/api/admin/settings',{method:'PUT',body:JSON.stringify(data)}); await refreshPublicConfig(); toast('Datos del negocio guardados.'); }
  catch(e) { toast(e.message); }
}
async function refreshPublicProducts() { state.products = await api('/api/products'); state.categories = await api('/api/categories'); renderCategories(); renderProducts(); renderCart(); }
async function refreshPublicConfig() { state.config = await api('/api/config'); renderZones(); }
async function checkoutSubmit(event) {
  event.preventDefault();
  const purchaseItems = activeCheckoutItems();
  if (!purchaseItems.length) return toast('Selecciona al menos un producto antes de continuar.');
  if (!state.customer) { $('#googleBox').classList.remove('hidden'); openOverlay('customerAuthOverlay'); return toast('Inicia sesión o crea una cuenta antes de comprar.'); }
  const form=event.currentTarget; const data=Object.fromEntries(new FormData(form));
  data.items=purchaseItems.map(i=>({id:i.id,quantity:i.quantity}));
  if (state.customer) { data.customer_email=data.customer_email || state.customer.email; data.customer_name=data.customer_name || state.customer.full_name; }
  const btn=$('#submitOrder'); btn.disabled=true; btn.textContent='Registrando pedido…';
  try {
    const result=await api('/api/orders',{method:'POST',body:JSON.stringify(data)});
    $('#orderSuccessText').textContent=`Número de pedido: ${result.order_number}. ${result.notice}`;
    $('#openOrderWhatsapp').href=result.whatsapp_url;
    $('#orderSuccess').classList.remove('hidden'); form.classList.add('hidden');
    if (!state.checkoutItems) { state.cart=[]; saveCart(); renderCart(); }
    state.checkoutItems = null;
  } catch(e) { toast(e.message); }
  finally { btn.disabled=false; btn.innerHTML='Registrar pedido y continuar a WhatsApp <span>↗</span>'; }
}

function initEvents() {
  $('#menuToggle').addEventListener('click',()=>{const nav=$('#mainNav'); const open=nav.classList.toggle('open'); $('#menuToggle').setAttribute('aria-expanded',String(open));});
  $$('#mainNav a').forEach(a=>a.addEventListener('click',()=>$('#mainNav').classList.remove('open')));
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
    const tab=e.target.closest('[data-admin-tab]');if(tab){switchAdminTab(tab.dataset.adminTab);return;}
    const switchTab=e.target.closest('[data-switch-tab]');if(switchTab){switchAdminTab(switchTab.dataset.switchTab);return;}
    const close=e.target.closest('[data-close]');if(close){if(close.dataset.close==='actionConfirmOverlay')finishConfirmation(false);else closeOverlay(close.dataset.close);return;}
  });
  $('#cartOpen').addEventListener('click',()=>{state.checkoutItems=null;renderCart();openOverlay('cartOverlay');});
  $('#goCheckout').addEventListener('click',()=>{if(!state.cart.length)return;state.checkoutItems=null;closeOverlay('cartOverlay');openCheckout();});
  $('#customerAccount').addEventListener('click',openCustomerAuth);
  $('#checkoutLoginTrigger').addEventListener('click',openCustomerAuth);
  $('#authTabLogin').addEventListener('click',()=>setCustomerAuthTab('login'));
  $('#authTabRegister').addEventListener('click',()=>setCustomerAuthTab('register'));
  $('#customerLoginForm').addEventListener('submit',customerLogin);
  $('#customerRegisterForm').addEventListener('submit',customerRegister);
  $('#customerLogout').addEventListener('click',customerLogout);
  ['heroWhatsapp','footerWhatsapp'].forEach(id=>$('#'+id).addEventListener('click',()=>openWhatsApp('Hola, AGUI. Quisiera consultar por sus productos y disponibilidad.')));
  $('#footerOwner').addEventListener('click',showAdminLogin);
  $('#authRoleCustomer').addEventListener('click',()=>setAuthMode('customer'));$('#authRoleOwner').addEventListener('click',()=>setAuthMode('owner'));
  $('#adminLoginForm').addEventListener('submit',adminLogin);
  $('#acceptActionConfirm').addEventListener('click',()=>finishConfirmation(true));$('#cancelActionConfirm').addEventListener('click',()=>finishConfirmation(false));$('#adminLogout').addEventListener('click',adminLogout);$('#adminClose').addEventListener('click',hideAdminScreen);
  $('#refreshDashboard').addEventListener('click',()=>loadAdminOverview().then(()=>toast('Resumen actualizado.')).catch(e=>toast(e.message)));
  $('#refreshOrders').addEventListener('click',()=>loadAdminOrders().catch(e=>toast(e.message)));$('#refreshZones').addEventListener('click',()=>loadAdminZones().catch(e=>toast(e.message)));
  $('#newProduct').addEventListener('click',()=>editProduct());$('#cancelProductEdit').addEventListener('click',()=>$('#productEditor').classList.add('hidden'));$('#productForm').addEventListener('submit',saveProduct);
  $('#settingsForm').addEventListener('submit',saveSettings);$('#checkoutForm').addEventListener('submit',checkoutSubmit);
  $('#orderStatusFilter').addEventListener('change',()=>loadAdminOrders().catch(e=>toast(e.message)));
  $('#adminOrderTable').addEventListener('change',e=>{const el=e.target.closest('[data-order-status]');if(el)updateOrderStatus(Number(el.dataset.orderStatus),el.value);});
  $('#adminOrderTable').addEventListener('click',e=>{const el=e.target.closest('[data-order-status]');if(el)el.dataset.previous=el.value;});
  ['googleLogin','googleLoginModal'].forEach(id=>$('#'+id).addEventListener('click',e=>{if(!state.config?.googleLoginConfigured)e.preventDefault();}));
  $$('.overlay').forEach(overlay=>overlay.addEventListener('click',e=>{if(e.target===overlay){if(overlay.id==='actionConfirmOverlay')finishConfirmation(false);else overlay.classList.add('hidden');}}));
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(!$('#actionConfirmOverlay').classList.contains('hidden'))finishConfirmation(false);$$('.overlay').forEach(o=>o.classList.add('hidden'));}});
}

async function boot() {
  loadCart(); initEvents();
  await loadStore();
  const params=new URLSearchParams(location.search);
  if(params.has('notice')) {
    const notices={google_config:'El acceso con Google necesita credenciales de configuración.',google_failed:'No se pudo iniciar sesión con Google. Inténtalo de nuevo.'};
    toast(notices[params.get('notice')] || ''); history.replaceState({},'',location.pathname+location.hash);
  }
  if(params.get('login')==='ok') { toast('Iniciaste sesión con Google.'); history.replaceState({},'',location.pathname+location.hash); }
  if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});
  window.setTimeout(() => { const splash = $('#aguiSplash'); if (splash) { splash.classList.add('splash-hidden'); window.setTimeout(() => splash.remove(), 700); } }, 1100);
}
document.addEventListener('DOMContentLoaded',boot);
