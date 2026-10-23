/* JoyGroup storefront.
   Catalog, prices, login and orders come from the backend API (`/api`, see docs/reports/04-storefront-api.md).
   The browser keeps only the login token, the cart ({ variationId: qty }) and saved products.
   Prices exist only in the signed-in catalog (`/api/client/catalog`); a guest never receives them. */
(function () {
  'use strict';

  const CONFIG = window.JG_CONFIG || {};
  const API = String(CONFIG.apiBase || '').replace(/\/+$/, '') + '/api';
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const params = new URLSearchParams(location.search);
  const page = document.body.dataset.page;

  /* ---------- Browser storage ---------- */
  const storeIn = (area) => ({
    get(key, fallback) {
      try { const v = JSON.parse(area().getItem(key)); return v === null ? fallback : v; } catch (e) { return fallback; }
    },
    set(key, value) { try { area().setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ } },
    del(key) { try { area().removeItem(key); } catch (e) { /* private mode */ } },
  });
  const store = storeIn(() => localStorage);
  const tabStore = storeIn(() => sessionStorage);   // a login without "remember me" lives until the tab closes

  /* ---------- Language: Armenian by default, Russian by the header switch. Texts live in js/i18n.js ---------- */
  const LANGS = ['hy', 'ru'];
  const lang = LANGS.includes(store.get('jg_lang', 'hy')) ? store.get('jg_lang', 'hy') : 'hy';
  const DICT = window.JG_I18N || {};
  /* t('cart.option', { label, option }): the text in the chosen language, `{name}` filled in. A missing key shows itself. */
  function t(key, vars = {}) {
    const entry = DICT[key];
    const text = entry ? (entry[lang] !== undefined ? entry[lang] : entry.hy) : key;
    if (typeof text === 'function') return text(vars);
    return text.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? vars[name] : m));
  }
  /* Static texts of the HTML pages: `data-i18n="key"` sets the text, `data-i18n-attr="aria-label:key,placeholder:key"` the attributes. */
  function translatePage() {
    document.documentElement.lang = lang;
    $$('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    $$('[data-i18n-attr]').forEach((el) => el.dataset.i18nAttr.split(',').forEach((pair) => {
      const [attr, key] = pair.split(':').map((s) => s.trim());
      el.setAttribute(attr, t(key));
    }));
  }

  const state = {
    token: CONFIG.staticDemo ? null : (store.get('jg_token', null) || tabStore.get('jg_token', null)),
    profile: store.get('jg_profile', null) || tabStore.get('jg_profile', null),
    cart: store.get('jg_cart', {}),   // { variationId: qty }
    wish: store.get('jg_wish', []),   // [productId]
  };
  state.authed = !!state.token;
  const saveCart = () => { store.set('jg_cart', state.cart); updateBadges(); };

  function saveSession(token, profile, remember) {
    const keep = remember ? store : tabStore;
    keep.set('jg_token', token); keep.set('jg_profile', profile);
    Object.assign(state, { token, profile, authed: true });
  }
  function saveProfile(profile) {
    (store.get('jg_token', null) ? store : tabStore).set('jg_profile', profile);
    state.profile = profile;
  }
  function dropSession() {
    [store, tabStore].forEach((s) => { s.del('jg_token'); s.del('jg_profile'); });
    Object.assign(state, { token: null, profile: null, authed: false });
  }

  /* ---------- API ---------- */
  /* Refusals carry the server's `message`, already in the language of the request. */
  class ApiError extends Error {
    constructor(status, data) {
      super((data && data.message) || t(status ? 'err.server' : 'err.network'));
      this.status = status; this.code = data && data.code; this.data = data || {};
    }
  }
  async function api(path, { method = 'GET', body, headers = {} } = {}) {
    if (CONFIG.staticDemo) return staticApi(path, method);
    const h = { Accept: 'application/json', 'Accept-Language': lang, ...headers };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (state.token) h.Authorization = `Bearer ${state.token}`;
    let res;
    try {
      res = await fetch(API + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) { throw new ApiError(0, null); }
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (res.status === 401 && state.token) dropSession();   // token expired, login disabled or signed out elsewhere
    if (!res.ok) throw new ApiError(res.status, data);
    return { status: res.status, data };
  }
  /* Демо без бэкенда: отдаётся только гостевой каталог из файла, остальные запросы — отказ с понятным текстом. */
  async function staticApi(path, method) {
    if (method === 'GET' && path === '/catalog') {
      let res;
      try { res = await fetch(`data/catalog-${lang}.json`); } catch (e) { throw new ApiError(0, null); }
      if (!res.ok) throw new ApiError(res.status, null);
      return { status: 200, data: (await res.json()).data };
    }
    throw new ApiError(503, { message: t('demo.loginOff', { phone: CONTACT.phone }), code: 'demo' });
  }
  /* A client request failed: on 401 go back to the login page, otherwise say what happened. */
  function fail(err) {
    if (err.status === 401) { location.href = `login.html?next=${page}`; return; }
    toast(err.message);
  }
  const cartItems = () => Object.entries(state.cart)
    .filter(([, qty]) => qty > 0)
    .map(([vid, qty]) => ({ variation_id: Number(vid), quantity: qty }));
  /* Server-side cart: the organization's prices and totals with VAT. Items the client can no longer order leave the cart. */
  async function quoteCart() {
    const { data } = await api('/client/cart', { method: 'POST', body: { items: cartItems() } });
    if (data.unavailable && data.unavailable.length) {
      data.unavailable.forEach((vid) => { delete state.cart[vid]; });
      saveCart();
      toast(t('cart.removed', { n: data.unavailable.length }));
    }
    return data;
  }

  /* ---------- Catalog ---------- */
  let DATA = { categories: [], products: [], home: { bestsellers: [], newest: [] } };
  let PRICES = {};   // { variationId: price with VAT }, signed-in clients only
  let productById = new Map(), catBySlug = new Map(), variationIndex = new Map();

  async function loadCatalog() {
    if (state.authed) {
      try {
        const { data } = await api('/client/catalog');
        PRICES = data.prices || {};
        return data;
      } catch (e) {
        if (e.status !== 401) throw e;   // signed out meanwhile: show the guest catalog
      }
    }
    PRICES = {};
    return (await api('/catalog')).data;
  }
  function useCatalog(data) {
    DATA = { ...data, categories: data.categories.filter((c) => c.count > 0) };   // empty categories stay off the menus
    productById = new Map(DATA.products.map((p) => [p.id, p]));
    catBySlug = new Map(DATA.categories.map((c) => [c.slug, c]));
    variationIndex = new Map();
    DATA.products.forEach((p) => p.variations.forEach((v) => variationIndex.set(String(v.id), { p, v })));
  }

  const round2 = (n) => Math.round(n * 100) / 100;
  const num = (n) => n.toLocaleString('ru-RU', { maximumFractionDigits: 2 }).replace(/[  ]/g, ' ');
  const money = (n) => num(n) + ' ֏';
  const priceOf = (vid) => (state.authed ? PRICES[vid] : undefined);
  const canOrder = (v) => v.inStock || !!CONFIG.orderOutOfStock;
  const priceRange = (p) => {
    const list = p.variations.map((v) => priceOf(v.id)).filter((n) => n !== undefined);
    if (!list.length) return null;
    const min = Math.min(...list), max = Math.max(...list);
    return min === max ? money(min) : `${num(min)} – ${money(max)}`;
  };
  const mainCat = (p) => catBySlug.get(p.cats[0]);
  const variantCount = (n) => t('count.variants', { n });
  const cartLines = () => Object.entries(state.cart)
    .map(([vid, qty]) => ({ ...variationIndex.get(vid), vid, qty }))
    .filter((l) => l.p && l.qty > 0);
  const cartQty = () => cartLines().reduce((s, l) => s + l.qty, 0);

  /* ---------- Icons ---------- */
  const PATHS = {
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/>',
    heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.500 15.4 12 20 12 20z"/>',
    bag: '<path d="M5.500 8h13l1 12h-15l1-12z"/><path d="M9 8V7a3 3 0 0 1 6 0v1"/>',
    user: '<circle cx="12" cy="8.500" r="3.7"/><path d="M4.500 20c1.300-3.600 4.200-5 7.500-5s6.200 1.400 7.500 5"/>',
    shop: '<path d="M4 9.500l1.400-5h13.200l1.400 5"/><path d="M5 10v10h14V10"/><path d="M4 9.500a2.700 2.700 0 0 0 5.300 0 2.700 2.700 0 0 0 5.400 0 2.700 2.700 0 0 0 5.300 0"/><path d="M10 20v-5h4v5"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    chevron: '<path d="M6 9l6 6 6-6"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2.500"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/>',
    check: '<path d="M5 12.500l4.500 4.500L19 7.500"/>',
    phone: '<path d="M6.500 4h3l1.500 4-2 1.500a11 11 0 0 0 5.500 5.500l1.500-2 4 1.500v3a2 2 0 0 1-2.200 2A16 16 0 0 1 4.500 6.200 2 2 0 0 1 6.500 4z"/>',
    mail: '<rect x="3.500" y="5.500" width="17" height="13" rx="2.500"/><path d="M4 7l8 6 8-6"/>',
    pin: '<path d="M12 21s-6.500-6-6.500-11a6.500 6.500 0 0 1 13 0c0 5-6.500 11-6.500 11z"/><circle cx="12" cy="10" r="2.300"/>',
    clock: '<circle cx="12" cy="12" r="8.500"/><path d="M12 7.500V12l3 2"/>',
    box: '<path d="M4 8l8-4 8 4v8l-8 4-8-4V8z"/><path d="M4 8l8 4 8-4M12 12v8"/>',
    file: '<path d="M7 3.500h7l4 4V20.500H7z"/><path d="M14 3.500V8h4M10 13h5M10 16.500h5"/>',
    repeat: '<path d="M4 12a8 8 0 0 1 13.700-5.600L20 8.500M20 4v4.500h-4.500"/><path d="M20 12a8 8 0 0 1-13.700 5.600L4 15.500M4 20v-4.500h4.500"/>',
    logout: '<path d="M14 5H6v14h8M10 12h10M17 8.500l3.500 3.500-3.500 3.500"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>',
    spark: '<path d="M12 3.500l1.800 5.200 5.200 1.800-5.200 1.800L12 17.500l-1.800-5.200L5 10.500l5.200-1.800z"/>',
  };
  const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${PATHS[name]}</svg>`;

  /* ---------- Contacts: the one place to change them (contact page, footer, confirmation messages) ---------- */
  const CONTACT = {
    phone: '+374 33 710703', phoneHref: 'tel:+37433710703',
    email: 'joygroup794@gmail.com',
    address: t('contact.address'),   // the address and hours in both languages are in js/i18n.js
    hours: t('contact.hours'),
  };

  const contactRow = (ic, label, value, href) => {
    const inner = `<span class="circle">${icon(ic)}</span><span><small>${label}</small>${value}</span>`;
    return href ? `<a href="${href}">${inner}</a>` : `<div>${inner}</div>`;
  };

  /* ---------- Header, footer, chrome ---------- */
  const accountHref = () => (state.authed ? 'account.html' : 'login.html');
  const cur = (name) => (page === name ? ' aria-current="page"' : '');
  const catLinks = (cls = '') => DATA.categories.map((c) =>
    `<a class="${c.parent ? 'sub ' : ''}${cls}" href="shop.html?cat=${c.slug}">${esc(c.name)} <span>${c.count}</span></a>`).join('');
  const logo = (cls = '') => `<a href="index.html" class="logo ${cls}" aria-label="${t('nav.logo')}"><img src="assets/logo/joygroup-logo.png" alt="JoyGroup" width="640" height="351"></a>`;
  /* ՀԱՅ / РУС: each button is labelled in its own language, so it reads the same on both versions. */
  const langSwitch = () => `
    <div class="lang-switch" role="group" aria-label="${t('lang.label')}">
      <button type="button" data-lang="hy" lang="hy" aria-pressed="${lang === 'hy'}" aria-label="Հայերեն">ՀԱՅ</button>
      <button type="button" data-lang="ru" lang="ru" aria-pressed="${lang === 'ru'}" aria-label="Русский">РУС</button>
    </div>`;

  function renderHeader() {
    $('#header').innerHTML = `
      <header class="site-header">
        <div class="wrap">
          <button class="icon-btn menu-toggle" id="menuToggle" aria-label="${t('nav.menu')}" aria-expanded="false">${icon('menu')}</button>
          ${logo()}
          <nav class="main-nav" aria-label="${t('nav.mainMenu')}">
            <a href="index.html"${cur('home')}>${t('nav.home')}</a>
            <div class="nav-drop" id="shopDrop">
              <button type="button" aria-expanded="false"${page === 'shop' ? ' aria-current="page"' : ''}>${t('nav.shop')} ${icon('chevron', 'icon-sm')}</button>
              <div class="nav-drop-menu">
                <a href="shop.html">${t('nav.allProducts')} <span>${DATA.products.length}</span></a>
                ${catLinks()}
              </div>
            </div>
            <a href="about.html"${cur('about')}>${t('nav.about')}</a>
            <a href="contact.html"${cur('contact')}>${t('nav.contact')}</a>
          </nav>
          <div class="header-actions">
            ${langSwitch()}
            <button class="icon-btn" id="searchToggle" aria-label="${t('nav.search')}" aria-expanded="false">${icon('search')}</button>
            <a class="icon-btn hide-m" href="wishlist.html" aria-label="${t('nav.wishlist')}">${icon('heart')}<span class="badge" data-badge="wish" hidden></span></a>
            <a class="icon-btn hide-m" href="cart.html" aria-label="${t('nav.cart')}">${icon('bag')}<span class="badge" data-badge="cart" hidden></span></a>
            ${state.authed
              ? `<a class="btn btn-secondary btn-sm" href="account.html">${icon('user', 'icon-sm')} ${t('nav.account')}</a>`
              : `<a class="btn btn-primary btn-sm" href="login.html">${t('nav.login')}</a>`}
          </div>
        </div>
      </header>
      <div class="search-sheet" id="searchSheet">
        <div class="wrap on-pink">
          <form action="shop.html" role="search">
            <label class="sr-only" for="searchInput">${t('nav.search')}</label>
            <input class="input" id="searchInput" name="q" type="search" placeholder="${t('search.placeholder')}" autocomplete="off">
          </form>
          <div class="search-results" id="searchResults"></div>
        </div>
      </div>
      <nav class="mobile-menu" id="mobileMenu" aria-label="${t('nav.menu')}">
        <a href="index.html">${t('nav.home')}</a>
        <a href="shop.html">${t('nav.shop')} <span>${DATA.products.length}</span></a>
        ${catLinks('sub')}
        <a href="about.html">${t('nav.about')}</a>
        <a href="contact.html">${t('nav.contact')}</a>
        <a href="${accountHref()}">${state.authed ? t('nav.account') : t('nav.login')}</a>
        ${langSwitch()}
      </nav>
      <nav class="tab-bar" aria-label="${t('nav.quick')}">
        <a href="shop.html"${cur('shop')}>${icon('shop')}${t('nav.shop')}</a>
        <a href="wishlist.html"${cur('wishlist')}>${icon('heart')}${t('nav.wishlist')}<span class="badge" data-badge="wish" hidden></span></a>
        <a href="cart.html"${cur('cart')}>${icon('bag')}${t('nav.cart')}<span class="badge" data-badge="cart" hidden></span></a>
        <a href="${accountHref()}"${cur('account')}${cur('login')}>${icon('user')}${t('nav.accountShort')}</a>
      </nav>`;

    const drop = $('#shopDrop'), dropBtn = $('button', drop);
    const setDrop = (open) => { drop.classList.toggle('open', open); dropBtn.setAttribute('aria-expanded', open); };
    dropBtn.addEventListener('click', (e) => { e.stopPropagation(); setDrop(!drop.classList.contains('open')); });
    let dropTimer;   // short grace period so a slightly off cursor path does not close the menu
    drop.addEventListener('mouseenter', () => { clearTimeout(dropTimer); setDrop(true); });
    drop.addEventListener('mouseleave', () => { dropTimer = setTimeout(() => setDrop(false), 220); });

    const sheet = $('#searchSheet'), sToggle = $('#searchToggle'), sInput = $('#searchInput');
    const menu = $('#mobileMenu'), mToggle = $('#menuToggle');
    const setSheet = (open) => {
      sheet.classList.toggle('open', open); sToggle.setAttribute('aria-expanded', open);
      if (open) { setMenu(false); sInput.focus(); }
    };
    const setMenu = (open) => {
      menu.classList.toggle('open', open); mToggle.setAttribute('aria-expanded', open);
      mToggle.innerHTML = icon(open ? 'close' : 'menu');
      if (open) setSheet(false);
    };
    sToggle.addEventListener('click', (e) => { e.stopPropagation(); setSheet(!sheet.classList.contains('open')); });
    mToggle.addEventListener('click', () => setMenu(!menu.classList.contains('open')));
    sheet.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => { setDrop(false); setSheet(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { setDrop(false); setSheet(false); setMenu(false); } });

    sInput.addEventListener('input', () => {
      const q = sInput.value.trim().toLowerCase();
      const hits = q ? DATA.products.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 6) : [];
      $('#searchResults').innerHTML = hits.map((p) =>
        `<a href="product.html?id=${p.id}"><img src="${p.image}" alt=""><span>${esc(p.name)}</span></a>`).join('')
        || (q ? `<p class="muted">${t('search.none')}</p>` : '');
    });
  }

  function renderFooter() {
    $('#footer').innerHTML = `
      <footer class="site-footer">
        <div class="wrap">
          <div class="footer-grid">
            <div>
              ${logo('logo-chip')}
              <p style="margin-top:16px;max-width:34ch">${t('footer.tagline')}</p>
              <ul class="footer-contacts">
                <li><a href="${CONTACT.phoneHref}">${icon('phone', 'icon-sm')} ${CONTACT.phone}</a></li>
                <li><a href="mailto:${CONTACT.email}">${icon('mail', 'icon-sm')} ${CONTACT.email}</a></li>
                <li><span>${icon('pin', 'icon-sm')} ${CONTACT.address}</span></li>
                <li><span>${icon('clock', 'icon-sm')} ${CONTACT.hours}</span></li>
              </ul>
            </div>
            <div>
              <h3>${t('nav.shop')}</h3>
              <ul>${DATA.categories.filter((c) => !c.parent).map((c) => `<li><a href="shop.html?cat=${c.slug}">${esc(c.name)}</a></li>`).join('')}</ul>
            </div>
            <div>
              <h3>${t('footer.company')}</h3>
              <ul>
                <li><a href="about.html">${t('nav.about')}</a></li>
                <li><a href="contact.html">${t('nav.contact')}</a></li>
                <li><a href="signup.html">${t('nav.signup')}</a></li>
                <li><a href="terms.html">${t('nav.terms')}</a></li>
              </ul>
            </div>
            <div>
              <h3>${t('footer.clients')}</h3>
              <ul>
                <li><a href="${accountHref()}">${t('nav.account')}</a></li>
                <li><a href="cart.html">${t('nav.cart')}</a></li>
                <li><a href="wishlist.html">${t('nav.wishlist')}</a></li>
              </ul>
            </div>
          </div>
          <div class="footer-bottom"><span>Cnund.JoyGroup © 2026</span><span>${t('footer.pricesNote')}</span></div>
        </div>
      </footer>`;
  }

  function updateBadges() {
    const counts = { cart: state.authed ? cartQty() : 0, wish: state.wish.length };
    $$('[data-badge]').forEach((b) => {
      const n = counts[b.dataset.badge];
      b.hidden = !n; b.textContent = n > 99 ? '99+' : n;
    });
  }

  let toastTimer;
  function toast(text, link) {
    let el = $('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.append(el); }
    el.innerHTML = `<span>${esc(text)}</span>${link ? `<a href="${link.href}">${esc(link.label)}</a>` : ''}`;
    requestAnimationFrame(() => el.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  /* ---------- Components ---------- */
  function card(p) {
    const cat = mainCat(p), range = priceRange(p), wished = state.wish.includes(p.id);
    return `
      <article class="card${p.inStock ? '' : ' sold'}">
        ${p.inStock ? '' : `<span class="tag tag-sold">${t('stock.out')}</span>`}
        <button class="wish-btn" type="button" data-wish="${p.id}" aria-pressed="${wished}" aria-label="${t('card.wish')}">${icon('heart', 'icon-sm')}</button>
        <div class="ph">${p.image ? `<img loading="lazy" src="${p.image}" alt="${esc(p.name)}">` : ''}</div>
        <div class="card-body">
          <h3 class="card-name"><a href="product.html?id=${p.id}">${esc(p.name)}</a></h3>
          <div class="card-meta">${esc(cat ? cat.name : '')}${p.single ? '' : ' · ' + variantCount(p.variations.length)}</div>
          ${range ? `<div class="card-price">${range}</div>`
                  : `<div class="card-lock">${icon('lock', 'icon-sm')} ${t('card.priceLocked')}</div>`}
        </div>
      </article>`;
  }
  const cards = (list) => list.map(card).join('');

  function stepper(vid, qty, cls = '') {
    return `<div class="stepper ${cls}" data-stepper="${vid}">
      <button type="button" data-step="-1" aria-label="${t('step.minus')}">${icon('minus', 'icon-sm')}</button>
      <input type="number" inputmode="numeric" min="0" max="9999" value="${qty}" aria-label="${t('step.qty')}">
      <button type="button" data-step="1" aria-label="${t('step.plus')}">${icon('plus', 'icon-sm')}</button>
    </div>`;
  }
  /* One delegated handler for every stepper on the page; `onChange(vid, qty)` decides what a change means. */
  function bindSteppers(root, onChange) {
    const read = (box) => Math.max(0, Math.min(9999, parseInt($('input', box).value, 10) || 0));
    root.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-step]'); if (!btn) return;
      const box = btn.closest('[data-stepper]');
      const next = Math.max(0, read(box) + Number(btn.dataset.step));
      $('input', box).value = next; onChange(box.dataset.stepper, next, box);
    });
    root.addEventListener('change', (e) => {
      const box = e.target.closest('[data-stepper]'); if (!box) return;
      const next = read(box); $('input', box).value = next; onChange(box.dataset.stepper, next, box);
    });
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-wish]'); if (!btn) return;
    e.preventDefault();
    const id = Number(btn.dataset.wish), i = state.wish.indexOf(id);
    if (i > -1) state.wish.splice(i, 1); else state.wish.push(id);
    store.set('jg_wish', state.wish);
    $$(`[data-wish="${id}"]`).forEach((b) => b.setAttribute('aria-pressed', i === -1));
    updateBadges();
    if (page === 'wishlist') pages.wishlist();
    else toast(t(i === -1 ? 'wish.added' : 'wish.removed'), { href: 'wishlist.html', label: t('nav.view') });
  });

  const emptyState = (ic, title, text, btn, ok) => `
    <div class="panel empty">
      <div class="circle${ok ? ' ok' : ''}">${icon(ic)}</div>
      <h2 class="h-md">${title}</h2>
      <p class="muted">${text}</p>
      ${btn ? `<a class="btn btn-primary" href="${btn.href}">${btn.label}</a>` : ''}
    </div>`;
  const loginGate = (text) => emptyState('lock', t('gate.title'), text, { href: `login.html?next=${page}`, label: t('login.submit') });

  /* ---------- Home hero: hand-painted clouds drifting to the right, forever ---------- */
  function heroClouds(root) {
    const SHAPES = [
      'M30 92 C8 92 4 70 22 62 C14 40 42 28 56 44 C62 18 102 14 110 42 C126 26 156 38 150 60 C176 58 184 90 160 92 Z',
      'M26 90 C4 88 8 62 30 62 C28 38 64 32 74 52 C86 28 124 32 126 58 C148 48 174 64 164 84 C160 92 150 92 140 90 Z',
      'M38 94 C10 96 10 68 32 66 C30 48 54 42 64 56 C72 32 106 34 110 56 C122 44 146 52 142 68 C164 66 172 92 150 94 Z',
    ];
    const SCRIBBLES = ['M48 66 q9 -10 18 0 t18 0 t18 0', 'M60 74 q8 -8 16 0 t16 0', 'M92 58 q7 -8 14 0 t14 0'];
    /* [shape, left %, top %, width %, min width px]; clouds stay in the top and bottom bands so the text stays readable. */
    const LAYERS = [
      { cls: 'far', clouds: [[0, 6, 30, 9, 70], [1, 34, 52, 8, 64], [2, 58, 38, 10, 76], [0, 82, 58, 8, 60]] },
      { cls: 'mid', clouds: [[1, 2, 12, 15, 120], [2, 44, 6, 13, 104], [0, 74, 16, 16, 124], [1, 20, 76, 14, 110], [2, 62, 80, 15, 116]] },
      { cls: 'near', clouds: [[2, 24, 2, 21, 160], [0, 86, 4, 19, 150], [1, 40, 82, 23, 170], [0, -6, 84, 20, 150]] },
    ];
    const cloud = ([shape, left, top, width, min], i) => `
      <svg class="cloud" viewBox="0 0 190 110" style="left:${left}%;top:${top}%;width:max(${width}%, ${min}px)">
        <g filter="url(#crayon)">
          <path class="c-fill" d="${SHAPES[shape]}"/>
          <path class="c-line" d="${SCRIBBLES[i % 3]}"/>
          <path class="c-line" d="${SCRIBBLES[(i + 1) % 3]}" transform="translate(-8 14)"/>
        </g>
      </svg>`;
    root.innerHTML = `
      <svg width="0" height="0" style="position:absolute"><defs>
        <filter id="crayon" x="-5%" y="-10%" width="110%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="7" result="n"/>
          <feDisplacementMap in="SourceGraphic" in2="n" scale="7"/>
        </filter>
      </defs></svg>
      ${LAYERS.map((l) => {
        const half = `<div class="sky-half">${l.clouds.map(cloud).join('')}</div>`;
        return `<div class="sky-layer sky-${l.cls}">${half}${half}</div>`;   // two identical halves = seamless loop
      }).join('')}`;
  }

  /* ---------- Pages ---------- */
  const pages = {
    home() {
      const pick = (ids) => ids.map((id) => productById.get(id)).filter(Boolean);
      $('#catGrid').innerHTML = DATA.categories.filter((c) => !c.parent).map((c) => `
        <a class="cat-card" href="shop.html?cat=${c.slug}">
          <div class="ph"><img loading="lazy" src="${c.image}" alt=""></div>
          <div><strong>${esc(c.name)}</strong><small>${t('count.products', { n: c.count })}</small></div>
        </a>`).join('');
      $('#bestGrid').innerHTML = cards(pick(DATA.home.bestsellers));
      $('#newGrid').innerHTML = cards(pick(DATA.home.newest));
      /* Promo photos: the first two different products of the home selections */
      const promo = [...new Set([...DATA.home.bestsellers, ...DATA.home.newest])].map((id) => productById.get(id)).filter((p) => p && p.image);
      $('#promoA').innerHTML = promo[0] ? `<img src="${promo[0].image}" alt="">` : '';
      $('#promoB').innerHTML = promo[1] ? `<img src="${promo[1].image}" alt="">` : '';
      heroClouds($('#heroMedia'));
      const cta = $('#ctaActions');
      cta.innerHTML = state.authed
        ? `<a class="btn btn-on-red" href="shop.html">${t('nav.toShop')}</a><a class="btn btn-ghost-on-red" href="account.html">${t('nav.myOrders')}</a>`
        : `<a class="btn btn-on-red" href="login.html">${t('login.submit')}</a><a class="btn btn-ghost-on-red" href="signup.html">${t('nav.signup')}</a>`;
      if (state.authed) $('#ctaText').textContent = t('home.ctaClient');
    },

    shop() {
      const slug = params.get('cat'), q = (params.get('q') || '').trim();
      const cat = catBySlug.get(slug);
      const all = { slug: '', name: t('shop.all'), count: DATA.products.length };
      $('#chips').innerHTML = [all, ...DATA.categories].map((c) =>
        `<a class="chip" href="shop.html${c.slug ? '?cat=' + c.slug : ''}" aria-current="${(c.slug || null) === (slug || null) && !q}">${esc(c.name)} <small>${c.count}</small></a>`).join('');
      $('#shopTitle').textContent = q ? t('shop.searchTitle', { q }) : cat ? cat.name : t('nav.shop');
      $('#crumbHere').textContent = cat ? cat.name : t('nav.shop');
      if (state.authed) $('#sort').insertAdjacentHTML('beforeend', `<option value="price">${t('shop.sortPrice')}</option>`);

      let list = DATA.products.filter((p) => (!cat || p.cats.includes(cat.slug)) && (!q || p.name.toLowerCase().includes(q.toLowerCase())));
      const minPrice = (p) => Math.min(...p.variations.map((v) => PRICES[v.id] ?? Infinity));
      const draw = () => {
        const mode = $('#sort').value;
        const sorted = [...list].sort(mode === 'name' ? (a, b) => a.name.localeCompare(b.name, lang)
          : mode === 'price' ? (a, b) => minPrice(a) - minPrice(b) : (a, b) => b.id - a.id);
        $('#count').textContent = t('count.products', { n: sorted.length });
        $('#shopGrid').innerHTML = cards(sorted);
        $('#shopEmpty').innerHTML = sorted.length ? '' : emptyState('search', t('search.none'), t('shop.emptyText'), { href: 'shop.html', label: t('nav.allProducts') });
      };
      $('#sort').addEventListener('change', draw);
      draw();
    },

    product() {
      const wanted = params.get('id');
      const p = wanted ? productById.get(Number(wanted)) : DATA.products[0];
      if (!p) {   // unknown or removed product
        document.title = `${t('product.notFound')} · JoyGroup`;
        $('#crumbs').innerHTML = `<a href="index.html">${t('nav.home')}</a><span aria-hidden="true">/</span><a href="shop.html">${t('nav.shop')}</a>`;
        const box = $('.product'); box.classList.remove('product');
        box.innerHTML = emptyState('search', t('product.notFound'), t('product.notFoundText'), { href: 'shop.html', label: t('nav.toShop') });
        $('#relatedTitle').textContent = t('product.newest');
        $('#related').innerHTML = cards(DATA.home.newest.slice(0, 4).map((id) => productById.get(id)).filter(Boolean));
        return;
      }
      const cat = mainCat(p) || { slug: '', name: t('nav.shop') }, range = priceRange(p);
      document.title = `${p.name} · JoyGroup`;
      $('#crumbs').innerHTML = `<a href="index.html">${t('nav.home')}</a><span aria-hidden="true">/</span>
        <a href="shop.html?cat=${cat.slug}">${esc(cat.name)}</a><span aria-hidden="true">/</span><span>${esc(p.name)}</span>`;

      const setMain = (src) => {
        $('#mainImg').src = src;
        $$('#thumbs button').forEach((b) => {
          const on = b.dataset.src === src;
          b.setAttribute('aria-current', on);
          if (on) b.parentElement.scrollTo({ left: b.offsetLeft - b.parentElement.offsetLeft - 8, behavior: 'smooth' });   // slide the strip only, never the page
        });
        $$('#info .variant').forEach((t) => {
          const ph = $('[data-src]', t);
          t.classList.toggle('selected', !!ph && ph.dataset.src === src);
        });
      };
      $('#gallery').innerHTML = `
        <div class="gallery-main"><img id="mainImg" src="${p.image}" alt="${esc(p.name)}"></div>
        ${p.gallery.length > 1 ? `<div class="thumbs" id="thumbs">${p.gallery.map((src) =>
          `<button type="button" data-src="${src}" aria-current="${src === p.image}" aria-label="${t('product.photo')}"><img loading="lazy" src="${src}" alt=""></button>`).join('')}</div>` : ''}`;

      const qty = {};   // picked quantities on this page, before they go to the cart
      const variantTile = (v) => {
        const price = priceOf(v.id);
        const photo = v.image
          ? `<button type="button" class="v-ph" data-src="${v.image}" aria-label="${esc(v.option)}"><img loading="lazy" src="${v.image}" alt=""></button>`
          : `<div class="v-ph empty">${esc(v.option)}</div>`;
        return `<div class="variant${v.inStock ? '' : ' sold'}" data-variant="${v.id}">
          ${photo}
          <div class="v-name">${esc(v.option)}</div>
          ${!canOrder(v) ? `<div class="v-price">${t('stock.out')}</div>`
            : price !== undefined ? `<div class="v-price">${money(price)}</div>${stepper(v.id, 0)}` : ''}
        </div>`;
      };

      $('#info').innerHTML = `
        <div class="tags">
          <a class="tag tag-purple" href="shop.html?cat=${cat.slug}">${esc(cat.name)}</a>
          <span class="tag${p.inStock ? '' : ' tag-sold'}">${t(p.inStock ? 'stock.in' : 'stock.out')}</span>
        </div>
        <h1>${esc(p.name)}</h1>
        ${range ? `<div class="price-line">${range} <small>${t('product.perPiece')}</small></div>` : `
          <div class="guest-box">
            <div class="row">${icon('lock')}<div><strong>${t('product.guestTitle')}</strong>
              <p class="muted">${t('login.lead')}</p></div></div>
            <div class="actions"><a class="btn btn-primary" href="login.html?next=product&id=${p.id}">${t('login.submit')}</a>
              <a class="btn btn-secondary" href="signup.html">${t('nav.signup')}</a></div>
          </div>`}
        ${p.single ? (range && canOrder(p) ? `<div class="variants-head"><h2>${t('step.qty')}</h2></div>${stepper(p.variations[0].id, 0, 'stepper-lg')}` : '') : `
          <div class="variants-head"><h2>${p.optionLabel}</h2><span class="muted">${variantCount(p.variations.length)}</span></div>
          <div class="variants">${p.variations.map(variantTile).join('')}</div>`}
        ${range && canOrder(p) ? `
          <div class="order-bar">
            <div class="sum"><small id="barQty">${t('product.pickQty')}</small><strong id="barSum">0 ֏</strong></div>
            <button class="btn btn-on-red" id="addBtn" type="button" disabled>${icon('bag', 'icon-sm')} ${t('product.add')}</button>
          </div>` : ''}
        <dl class="specs">
          <div><dt>${t('product.category')}</dt><dd>${p.cats.map((s) => catBySlug.get(s)).filter(Boolean).map((c) => esc(c.name)).join(', ')}</dd></div>
          ${p.single ? '' : `<div><dt>${p.optionLabel}</dt><dd>${variantCount(p.variations.length)}</dd></div>`}
          <div><dt>${t('product.availability')}</dt><dd>${t(p.inStock ? 'stock.in' : 'stock.out')}</dd></div>
        </dl>`;

      document.addEventListener('click', (e) => {
        const b = e.target.closest('[data-src]'); if (b) setMain(b.dataset.src);
      });
      setMain(p.image);   // mark the variant shown in the big photo from the start

      const refreshBar = () => {
        const picked = Object.entries(qty).filter(([, n]) => n > 0);
        const count = picked.reduce((s, [, n]) => s + n, 0);
        const sum = round2(picked.reduce((s, [vid, n]) => s + n * PRICES[vid], 0));   // preview only; the cart shows the server's totals
        $('#barQty').textContent = count ? `${t('count.pcs', { n: count })} · ${variantCount(picked.length)}` : t('product.pickQty');
        $('#barSum').textContent = money(sum);
        $('#addBtn').disabled = !count;
      };
      bindSteppers($('#info'), (vid, n, box) => {
        qty[vid] = n;
        const tile = box.closest('.variant');
        if (tile) {
          tile.classList.toggle('has-qty', n > 0);
          const ph = $('[data-src]', tile); if (ph) setMain(ph.dataset.src);   // changing a quantity also selects that variant
        }
        refreshBar();
      });
      const addBtn = $('#addBtn');
      if (addBtn) addBtn.addEventListener('click', () => {
        let added = 0;
        Object.entries(qty).forEach(([vid, n]) => { if (n > 0) { state.cart[vid] = (state.cart[vid] || 0) + n; added += n; qty[vid] = 0; } });
        saveCart();
        $$('#info [data-stepper] input').forEach((i) => { i.value = 0; });
        $$('#info .variant').forEach((t) => t.classList.remove('has-qty'));
        refreshBar();
        toast(t('product.added', { n: added }), { href: 'cart.html', label: t('nav.cart') });
      });

      const related = DATA.products.filter((x) => x.id !== p.id && x.cats.includes(cat.slug)).slice(0, 4);
      $('#related').innerHTML = cards(related.length ? related : DATA.products.filter((x) => x.id !== p.id).slice(0, 4));
    },

    cart() {
      const root = $('#cartRoot');
      let seq = 0;   // only the latest answer is drawn when the client clicks fast
      const draw = async () => {
        if (!state.authed) { root.innerHTML = loginGate(t('cart.gate')); return; }
        const empty = () => { root.innerHTML = emptyState('bag', t('cart.empty'), t('cart.emptyText'), { href: 'shop.html', label: t('nav.toShop') }); };
        if (!cartItems().length) return empty();
        const my = ++seq;
        let quote;
        try { quote = await quoteCart(); } catch (e) { if (my === seq) fail(e); return; }
        if (my !== seq) return;
        if (!quote.lines.length) return empty();
        root.innerHTML = `
          <div class="split">
            <div class="panel">${quote.lines.map((l) => {
              const known = variationIndex.get(String(l.variation_id)), single = known ? known.p.single : false;
              const label = known ? known.p.optionLabel : t('cart.variant');
              return `
              <div class="line">
                <a class="l-ph" href="product.html?id=${l.product_id}"><img src="${l.image || (known && known.p.image) || ''}" alt=""></a>
                <div class="l-text"><div class="l-name"><a href="product.html?id=${l.product_id}">${esc(l.name)}</a></div>
                  <div class="l-meta">${single || !l.option ? '' : esc(t('cart.option', { label, option: l.option })) + ' · '}${money(l.unit_price)}${l.in_stock ? '' : ' · ' + t('stock.out')}</div></div>
                ${stepper(l.variation_id, l.quantity)}
                <div class="l-total">${money(l.total)}</div>
                <button class="icon-btn l-del" type="button" data-remove="${l.variation_id}" aria-label="${t('cart.remove')}">${icon('trash', 'icon-sm')}</button>
              </div>`;
            }).join('')}
            </div>
            <aside class="panel aside">
              <h2 class="h-md">${t('cart.summary')}</h2>
              <div class="sum-rows">
                <div><span class="muted">${t('cart.items')}</span><span>${t('count.lines', { n: quote.lines.length })} · ${t('count.pcs', { n: quote.quantity })}</span></div>
                <div><span class="muted">${t('sum.withoutVat')}</span><span>${money(quote.total_without_vat)}</span></div>
                <div><span class="muted">${t('sum.vat')}</span><span>${money(quote.vat)}</span></div>
                <div class="total"><span>${t('sum.total')}</span><span>${money(quote.total)}</span></div>
              </div>
              <a class="btn btn-primary btn-block" href="checkout.html">${t('cart.checkout')}</a>
              <a class="btn btn-secondary btn-block" href="shop.html" style="margin-top:10px">${t('cart.continue')}</a>
            </aside>
          </div>`;
      };
      bindSteppers(root, (vid, n) => { if (n > 0) state.cart[vid] = n; else delete state.cart[vid]; saveCart(); draw(); });
      root.addEventListener('click', (e) => {
        const b = e.target.closest('[data-remove]'); if (!b) return;
        delete state.cart[b.dataset.remove]; saveCart(); draw();
      });
      return draw();
    },

    async checkout() {
      const root = $('#checkoutRoot');
      if (!state.authed) { root.innerHTML = loginGate(t('checkout.gate')); return; }
      const emptyCart = () => { root.innerHTML = emptyState('bag', t('cart.empty'), t('checkout.emptyText'), { href: 'shop.html', label: t('nav.toShop') }); };
      if (!cartItems().length) return emptyCart();

      /* One key per opened checkout page: a double click or a retry after a lost answer returns the same order. */
      const key = window.crypto && crypto.randomUUID ? crypto.randomUUID()
        : Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
      let quote, profile;
      try {
        [quote, { data: { profile } }] = await Promise.all([quoteCart(), api('/auth/me')]);
      } catch (e) { return fail(e); }
      saveProfile(profile);
      if (!quote.lines.length) return emptyCart();

      const drawSummary = (q) => {
        $('#sumLines').innerHTML = q.lines.map((l) =>
          `<div><span>${esc(l.name)}${l.option ? ' · ' + esc(l.option) : ''} × ${l.quantity}</span><span>${money(l.total)}</span></div>`).join('');
        $('#sumCount').textContent = t('count.pcs', { n: q.quantity });
        $('#sumNet').textContent = money(q.total_without_vat);
        $('#sumVat').textContent = money(q.vat);
        $('#sumTotal').textContent = money(q.total);
      };
      drawSummary(quote);

      const org = profile.organization || {};
      $('#buyer').innerHTML = `
        <div class="field"><label>${t('org.name')}</label><input class="input" value="${esc(org.legal_name || org.trade_name || '')}" readonly></div>
        <div class="field"><label>${t('org.tin')}</label><input class="input" value="${esc(org.tin || '—')}" readonly></div>`;
      const addrs = profile.delivery_addresses || [];
      $('#addresses').innerHTML = addrs.length
        ? addrs.map((a) => `<label class="radio-card"><input type="radio" name="addr" value="${a.id}"${a.id === profile.default_delivery_address_id || addrs.length === 1 ? ' checked' : ''}>
            <span><strong>${esc(a.label || a.address)}</strong>${a.label ? `<small>${esc(a.address)}</small>` : ''}</span></label>`).join('')
        : `<p class="muted">${t('checkout.addressByManager')}</p>`;

      const form = $('#checkoutForm'), btn = $('button[type="submit"]', form);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (btn.disabled) return;   // already sending
        const picked = $('input[name="addr"]:checked', form);
        if (addrs.length && !picked) return toast(t('checkout.pickAddress'));
        const note = $('#c7').value.trim();
        btn.disabled = true;
        try {
          const { data } = await api('/client/orders', {
            method: 'POST',
            headers: { 'Idempotency-Key': key },
            body: { items: cartItems(), ...(picked ? { delivery_address_id: Number(picked.value) } : {}), ...(note ? { note } : {}) },
          });
          state.cart = {}; saveCart();
          root.innerHTML = emptyState('check', t('checkout.thanks'), t('checkout.thanksText', { number: esc(data.order.number), phone: CONTACT.phone }), { href: 'account.html', label: t('nav.myOrders') }, true);
          window.scrollTo({ top: 0 });
        } catch (err) {
          btn.disabled = false;
          if (err.code === 'items_unavailable') {
            (err.data.unavailable || []).forEach((vid) => { delete state.cart[vid]; });
            saveCart();
            toast(err.message, { href: 'cart.html', label: t('nav.cart') });
            if (!cartItems().length) return emptyCart();
            try { const q = await quoteCart(); return q.lines.length ? drawSummary(q) : emptyCart(); } catch (ex) { return fail(ex); }
          }
          fail(err);
        }
      });
    },

    async account() {
      const root = $('#accountRoot');
      if (!state.authed) { root.innerHTML = loginGate(t('account.gate')); return; }
      let profile, list;
      try {
        [{ data: { profile } }, { data: list }] = await Promise.all([api('/auth/me'), api('/client/orders')]);
      } catch (e) { return fail(e); }
      saveProfile(profile);
      const org = profile.organization || {};
      const person = profile.name || profile.login;
      const initials = person.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
      const TAGS = { new: 'tag-purple', processing: 'tag-purple', awaiting_payment: 'tag-purple', cancelled: 'tag-sold', completed: 'tag-sold' };
      const date = (iso) => new Date(iso).toLocaleDateString('ru-RU');
      const orderRow = (o) => `
        <div class="order">
          <div><strong>№ ${esc(o.number)}</strong><small>${date(o.placed_at)}</small></div>
          <div><span class="tag ${TAGS[o.status] || ''}">${esc(o.status_label)}</span></div>
          <div>${t('count.pcs', { n: o.quantity })}<small>${t('count.lines', { n: o.lines_count })}</small></div>
          <div><strong>${money(o.total)}</strong></div>
          <div class="acts">
            <button class="btn btn-secondary btn-sm" type="button" data-repeat="${esc(o.number)}">${icon('repeat', 'icon-sm')} ${t('account.repeat')}</button>
            <button class="btn btn-secondary btn-sm" type="button" data-invoice>${icon('file', 'icon-sm')} ${t('account.invoice')}</button>
          </div>
        </div>`;
      const more = () => (list.pagination.page < list.pagination.pages
        ? `<div style="margin-top:16px"><button class="btn btn-secondary btn-sm" type="button" id="moreOrders">${t('account.more')}</button></div>` : '');
      const field = (id, label, value) => `<div class="field"><label for="${id}">${label}</label><input class="input" id="${id}" value="${esc(value || '—')}" readonly></div>`;
      const views = {
        orders: () => `
          <div class="stat-row">
            <div class="stat block-purple"><strong>${list.summary.orders}</strong>${t('account.statOrders', { n: list.summary.orders })}</div>
            <div class="stat block-green"><strong>${list.summary.quantity}</strong>${t('account.statQty', { n: list.summary.quantity })}</div>
            <div class="stat block-white"><strong>${money(list.summary.total)}</strong>${t('account.statTotal')}</div>
          </div>
          <div class="panel">
            <h2 class="h-md" style="margin-bottom:8px">${t('nav.myOrders')}</h2>
            <div id="orderList">${list.orders.length ? list.orders.map(orderRow).join('') : `<p class="muted">${t('account.noOrders')}</p>`}</div>
            <div id="orderMore">${more()}</div>
          </div>`,
        profile: () => `
          <div class="panel">
            <h2 class="h-md" style="margin-bottom:20px">${t('account.myData')}</h2>
            <div class="form">
              <div class="form-row">${field('pf1', t('account.name'), profile.name)}${field('pf2', t('account.login'), profile.login)}</div>
              <div class="form-row">${field('pf3', t('account.shopName'), org.trade_name)}${field('pf4', t('contact.phoneLabel'), profile.phone)}</div>
              <div class="form-row">${field('pf5', t('org.name'), org.legal_name)}${field('pf6', t('org.tin'), org.tin)}</div>
              ${(profile.delivery_addresses || []).map((a, i) => field(`pa${i}`, t('checkout.address'), (a.label ? a.label + ' — ' : '') + a.address)).join('')}
              <p class="note note-purple">${t('account.changeNote', { phone: CONTACT.phone })}</p>
            </div>
          </div>`,
      };
      const show = (name) => {
        $('#accountView').innerHTML = views[name]();
        $$('#sideNav [data-view]').forEach((b) => b.setAttribute('aria-current', b.dataset.view === name));
      };
      root.innerHTML = `
        <div class="account">
          <aside class="panel">
            <div class="user-chip"><div class="avatar">${esc(initials)}</div><div><strong>${esc(person)}</strong><br><span class="muted" style="font-size:.875rem">${esc(org.trade_name || org.legal_name || '')}</span></div></div>
            <div class="side-nav" id="sideNav">
              <button type="button" data-view="orders">${icon('box', 'icon-sm')} ${t('account.orders')}</button>
              <button type="button" data-view="profile">${icon('user', 'icon-sm')} ${t('account.myData')}</button>
              <a href="wishlist.html">${icon('heart', 'icon-sm')} ${t('nav.wishlist')}</a>
              <button type="button" id="logout">${icon('logout', 'icon-sm')} ${t('account.logout')}</button>
            </div>
          </aside>
          <div id="accountView"></div>
        </div>`;
      root.addEventListener('click', async (e) => {
        const v = e.target.closest('[data-view]'); if (v) return show(v.dataset.view);
        const r = e.target.closest('[data-repeat]');
        if (r) {
          r.disabled = true;
          try {
            const { data } = await api(`/client/orders/${encodeURIComponent(r.dataset.repeat)}`);
            /* only what the client can still order: the cart page would drop the rest anyway */
            const items = data.order.items.filter((it) => it.variation_id && variationIndex.has(String(it.variation_id)));
            items.forEach((it) => { state.cart[it.variation_id] = (state.cart[it.variation_id] || 0) + it.quantity; });
            saveCart();
            const skipped = data.order.items.length - items.length;
            toast(skipped ? t('account.repeatPartial', { added: items.length, skipped }) : t('account.repeatDone'), { href: 'cart.html', label: t('nav.cart') });
          } catch (err) { fail(err); }
          r.disabled = false;
          return;
        }
        if (e.target.closest('#moreOrders')) {
          try {
            const { data } = await api(`/client/orders?page=${list.pagination.page + 1}`);
            list = { ...data, orders: [...list.orders, ...data.orders] };
            $('#orderList').insertAdjacentHTML('beforeend', data.orders.map(orderRow).join(''));
            $('#orderMore').innerHTML = more();
          } catch (err) { fail(err); }
          return;
        }
        if (e.target.closest('[data-invoice]')) return toast(t('account.invoiceSoon'));
        if (e.target.closest('#logout')) {
          await api('/auth/logout', { method: 'POST' }).catch(() => {});
          dropSession();
          state.cart = {}; store.set('jg_cart', {});   // the next client on this computer starts with an empty cart
          location.href = 'index.html';
        }
      });
      show('orders');
    },

    wishlist() {
      const list = state.wish.map((id) => productById.get(id)).filter(Boolean);
      $('#wishGrid').innerHTML = cards(list);
      $('#wishEmpty').innerHTML = list.length ? '' : emptyState('heart', t('wish.empty'), t('wish.emptyText'), { href: 'shop.html', label: t('nav.toShop') });
    },

    login() {
      const form = $('#loginForm'), btn = $('button[type="submit"]', form), err = $('#loginError');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        err.hidden = true; btn.disabled = true;
        try {
          const { data } = await api('/auth/login', { method: 'POST', body: { login: $('#l1').value.trim(), password: $('#l2').value, device_name: 'storefront' } });
          saveSession(data.token, data.profile, $('#remember').checked);
          const next = params.get('next'), id = params.get('id');
          location.href = next && /^[a-z]+$/.test(next) ? `${next}.html${id ? '?id=' + encodeURIComponent(id) : ''}` : 'shop.html';
        } catch (ex) {
          btn.disabled = false;
          err.textContent = ex.status === 422 && !ex.code && ex.data.errors ? t('login.fill') : ex.message;
          err.hidden = false;
        }
      });
      const flip = (reset) => { $('#loginPanel').hidden = reset; $('#resetPanel').hidden = !reset; };
      $('#toReset').addEventListener('click', () => flip(true));
      $('#toLogin').addEventListener('click', () => flip(false));
      $('#resetText').innerHTML = t('login.resetText', { phone: `<a class="link" href="${CONTACT.phoneHref}">${CONTACT.phone}</a>` });
    },

    /* No request forms: the backend does not take them. Visitors call or write to the manager instead. */
    signup() {
      $('#signupContacts').innerHTML = contactRow('phone', t('contact.phoneLabel'), CONTACT.phone, CONTACT.phoneHref) +
        contactRow('mail', t('contact.emailLabel'), CONTACT.email, `mailto:${CONTACT.email}`);
      $('#signupHours').textContent = CONTACT.hours;
    },

    contact() {
      $('#contactList').innerHTML =
        contactRow('phone', t('contact.phoneLabel'), CONTACT.phone, CONTACT.phoneHref) +
        contactRow('mail', t('contact.emailLabel'), CONTACT.email, `mailto:${CONTACT.email}`) +
        contactRow('pin', t('contact.addressLabel'), CONTACT.address) +
        contactRow('clock', t('contact.hoursLabel'), CONTACT.hours);
    },

    notfound() { heroClouds($('#notFoundMedia')); },

    about() {
      heroClouds($('#aboutMedia'));
      $('#aboutActions').innerHTML = state.authed
        ? `<a class="btn btn-on-red" href="shop.html">${t('nav.toShop')}</a>`
        : `<a class="btn btn-on-red" href="signup.html">${t('nav.signup')}</a><a class="btn btn-ghost-on-red" href="login.html">${t('login.submit')}</a>`;

      const tops = DATA.categories.filter((c) => !c.parent);
      const variants = DATA.products.reduce((n, p) => n + p.variations.length, 0);
      $('#aboutStats').innerHTML = [[DATA.products.length, 'about.statProducts'], [variants, 'about.statVariants'], [tops.length, 'about.statSections']]
        .map(([n, key]) => `<div class="about-stat"><strong>${n}</strong><span>${t(key, { n })}</span></div>`).join('');

      $('#aboutBento').innerHTML = tops.map((c, i) => `
        <a class="bento-tile${i < 2 ? ' big' : ''}" href="shop.html?cat=${c.slug}">
          <div class="bento-text"><h3 class="h-md">${esc(c.name)}</h3><span class="muted">${t('count.products', { n: c.count })}</span>
            <span class="link-arrow">${t('nav.view')} ${icon('arrow', 'icon-sm')}</span></div>
          <div class="bento-ph"><img loading="lazy" src="${c.image}" alt=""></div>
        </a>`).join('');

      $('#aboutContact').innerHTML = `
        <div>
          <p class="eyebrow">${t('about.contactEyebrow')}</p>
          <h2 class="h-lg" style="margin-top:8px">${t('about.contactTitle')}</h2>
          <p class="body-lg" style="margin-top:12px;max-width:44ch">${t('about.contactLead')}</p>
          <div class="actions">
            <a class="btn btn-primary" href="${state.authed ? 'shop.html' : 'signup.html'}">${t(state.authed ? 'nav.toShop' : 'nav.signup')}</a>
            <a class="btn btn-secondary" href="contact.html">${t('about.write')}</a>
          </div>
        </div>
        <ul>
          <li><a href="${CONTACT.phoneHref}">${icon('phone')}<span><small>${t('contact.phoneLabel')}</small>${CONTACT.phone}</span></a></li>
          <li><a href="mailto:${CONTACT.email}">${icon('mail')}<span><small>${t('contact.emailLabel')}</small>${CONTACT.email}</span></a></li>
          <li><div>${icon('pin')}<span><small>${t('contact.addressLabel')}</small>${CONTACT.address}</span></div></li>
          <li><div>${icon('clock')}<span><small>${t('contact.hoursLabel')}</small>${CONTACT.hours}</span></div></li>
        </ul>`;
    },
  };

  /* ---------- Language switch ---------- */
  /* Switching reloads the page, so the catalog and every text come again in the new language.
     The cart and the login stay in browser storage; what the client typed or picked on this page is carried over. */
  const fieldKey = (el) => {
    const box = el.closest('[data-stepper]');
    if (box) return `step:${box.dataset.stepper}`;
    if (el.type === 'radio') return `radio:${el.name}:${el.value}`;
    return el.id ? `id:${el.id}` : null;
  };
  const pageFields = () => $$('main input, main textarea, main select')
    .filter((el) => fieldKey(el) && !el.readOnly && el.type !== 'password');
  function keepPage() {
    const fields = {};
    pageFields().forEach((el) => { fields[fieldKey(el)] = el.type === 'radio' || el.type === 'checkbox' ? el.checked : el.value; });
    const view = $('#sideNav [aria-current="true"]');
    tabStore.set('jg_keep', { href: location.href, y: window.scrollY, fields, view: view ? view.dataset.view : null });
  }
  function restorePage() {
    const keep = tabStore.get('jg_keep', null);
    tabStore.del('jg_keep');
    if (!keep || keep.href !== location.href) return;
    const view = keep.view && $(`#sideNav [data-view="${keep.view}"]`);
    if (view) view.click();
    pageFields().forEach((el) => {
      const k = fieldKey(el);
      if (!(k in keep.fields)) return;
      const checkable = el.type === 'radio' || el.type === 'checkbox';
      if ((checkable ? el.checked : el.value) === keep.fields[k]) return;
      if (checkable) el.checked = keep.fields[k]; else el.value = keep.fields[k];
      el.dispatchEvent(new Event('change', { bubbles: true }));   // steppers and the sort pick it up as a change by hand
    });
    window.scrollTo({ top: keep.y, behavior: 'instant' });
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-lang]'); if (!b) return;
    if (b.dataset.lang === lang) return;
    store.set('jg_lang', b.dataset.lang);
    keepPage();
    location.reload();
  });

  /* ---------- Boot ---------- */
  translatePage();
  $$('[data-icon]').forEach((el) => { el.outerHTML = icon(el.dataset.icon, el.className); });

  const io = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { rootMargin: '0px 0px -8% 0px' })
    : null;
  $$('.reveal').forEach((el) => (io ? io.observe(el) : el.classList.add('in')));

  /* Text pages work without the catalog; the rest show a "try again" state when the server cannot be reached. */
  const NEEDS_CATALOG = ['home', 'shop', 'product', 'cart', 'checkout', 'account', 'wishlist', 'about'];
  (async () => {
    let failed = null;
    try { useCatalog(await loadCatalog()); } catch (e) { failed = e; }
    renderHeader();
    renderFooter();
    updateBadges();
    if (failed && NEEDS_CATALOG.includes(page)) {
      $('main').innerHTML = `<div class="wrap" style="margin-top:12px">${emptyState('box', t('err.pageTitle'), esc(failed.message), { href: location.href, label: t('err.reload') })}</div>`;
      return;
    }
    if (pages[page]) await pages[page]();
    updateBadges();
    restorePage();
  })();
})();
