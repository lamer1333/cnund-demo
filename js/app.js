/* JoyGroup storefront prototype.
   Everything that would come from the server lives behind three small things:
   JG_DATA (catalog), JG_PRICES (client-only prices) and the `state` object below (session, cart, saved).
   Swap those for real API calls; the markup and CSS stay as they are. */
(function () {
  'use strict';

  const DATA = window.JG_DATA;
  const PRICES = window.JG_PRICES || {};
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const params = new URLSearchParams(location.search);
  const page = document.body.dataset.page;

  /* ---------- State (localStorage stands in for the backend session) ---------- */
  const store = {
    get(key, fallback) {
      try { const v = JSON.parse(localStorage.getItem(key)); return v === null ? fallback : v; } catch (e) { return fallback; }
    },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ } },
  };
  const state = {
    authed: false,  // демо без цен: всегда гость
    cart: store.get('jg_cart', {}),   // { variationId: qty }
    wish: store.get('jg_wish', []),   // [productId]
  };
  const saveCart = () => { store.set('jg_cart', state.cart); updateBadges(); };

  /* ---------- Catalog helpers ---------- */
  const productById = new Map(DATA.products.map((p) => [p.id, p]));
  const catBySlug = new Map(DATA.categories.map((c) => [c.slug, c]));
  const variationIndex = new Map();
  DATA.products.forEach((p) => p.variations.forEach((v) => variationIndex.set(String(v.id), { p, v })));

  const num = (n) => n.toLocaleString('ru-RU').replace(/[\u00a0\u202f]/g, ' ');
  const money = (n) => num(n) + ' ֏';
  const priceOf = (vid) => (state.authed ? PRICES[vid] : undefined);
  const priceRange = (p) => {
    const list = p.variations.map((v) => priceOf(v.id)).filter((n) => n !== undefined);
    if (!list.length) return null;
    const min = Math.min(...list), max = Math.max(...list);
    return min === max ? money(min) : `${num(min)} – ${money(max)}`;
  };
  const mainCat = (p) => catBySlug.get(p.cats[0]);
  const variantCount = (n) => `${n} տարբերակ`;
  const cartLines = () => Object.entries(state.cart)
    .map(([vid, qty]) => ({ ...variationIndex.get(vid), vid, qty }))
    .filter((l) => l.p && l.qty > 0);
  const cartQty = () => cartLines().reduce((s, l) => s + l.qty, 0);
  const cartTotal = () => cartLines().reduce((s, l) => s + l.qty * (PRICES[l.vid] || 0), 0);

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
    address: 'Ք. Երևան, Թբլիսյան խճ. 35 ա',
    hours: 'Երկ–Ուրբ՝ 10:00 – 18:00',
  };

  /* ---------- Header, footer, chrome ---------- */
  const accountHref = () => (state.authed ? 'account.html' : 'login.html');
  const cur = (name) => (page === name ? ' aria-current="page"' : '');
  const catLinks = (cls = '') => DATA.categories.map((c) =>
    `<a class="${c.parent ? 'sub ' : ''}${cls}" href="shop.html?cat=${c.slug}">${esc(c.name)} <span>${c.count}</span></a>`).join('');
  const logo = (cls = '') => `<a href="index.html" class="logo ${cls}" aria-label="JoyGroup, գլխավոր էջ"><img src="assets/logo/joygroup-logo.png" alt="JoyGroup" width="640" height="351"></a>`;

  function renderHeader() {
    $('#header').innerHTML = `
      <header class="site-header">
        <div class="wrap">
          <button class="icon-btn menu-toggle" id="menuToggle" aria-label="Մենյու" aria-expanded="false">${icon('menu')}</button>
          ${logo()}
          <nav class="main-nav" aria-label="Գլխավոր մենյու">
            <a href="index.html"${cur('home')}>Գլխավոր</a>
            <div class="nav-drop" id="shopDrop">
              <button type="button" aria-expanded="false"${page === 'shop' ? ' aria-current="page"' : ''}>Խանութ ${icon('chevron', 'icon-sm')}</button>
              <div class="nav-drop-menu">
                <a href="shop.html">Բոլոր ապրանքները <span>${DATA.products.length}</span></a>
                ${catLinks()}
              </div>
            </div>
            <a href="about.html"${cur('about')}>Մեր մասին</a>
            <a href="contact.html"${cur('contact')}>Կապ մեզ հետ</a>
          </nav>
          <div class="header-actions">
            <button class="icon-btn" id="searchToggle" aria-label="Որոնում" aria-expanded="false">${icon('search')}</button>
            <a class="icon-btn hide-m" href="wishlist.html" aria-label="Հիշվածներ">${icon('heart')}<span class="badge" data-badge="wish" hidden></span></a>
            <a class="icon-btn hide-m" href="cart.html" aria-label="Զամբյուղ">${icon('bag')}<span class="badge" data-badge="cart" hidden></span></a>
            ${state.authed
              ? `<a class="btn btn-secondary btn-sm" href="account.html">${icon('user', 'icon-sm')} Անձնական էջ</a>`
              : '<a class="btn btn-primary btn-sm" href="login.html">Մուտք</a>'}
          </div>
        </div>
      </header>
      <div class="search-sheet" id="searchSheet">
        <div class="wrap on-pink">
          <form action="shop.html" role="search">
            <label class="sr-only" for="searchInput">Որոնում</label>
            <input class="input" id="searchInput" name="q" type="search" placeholder="Որոնել ապրանք…" autocomplete="off">
          </form>
          <div class="search-results" id="searchResults"></div>
        </div>
      </div>
      <nav class="mobile-menu" id="mobileMenu" aria-label="Մենյու">
        <a href="index.html">Գլխավոր</a>
        <a href="shop.html">Խանութ <span>${DATA.products.length}</span></a>
        ${catLinks('sub')}
        <a href="about.html">Մեր մասին</a>
        <a href="contact.html">Կապ մեզ հետ</a>
        <a href="${accountHref()}">${state.authed ? 'Անձնական էջ' : 'Մուտք'}</a>
      </nav>
      <nav class="tab-bar" aria-label="Արագ անցում">
        <a href="shop.html"${cur('shop')}>${icon('shop')}Խանութ</a>
        <a href="wishlist.html"${cur('wishlist')}>${icon('heart')}Հիշվածներ<span class="badge" data-badge="wish" hidden></span></a>
        <a href="cart.html"${cur('cart')}>${icon('bag')}Զամբյուղ<span class="badge" data-badge="cart" hidden></span></a>
        <a href="${accountHref()}"${cur('account')}${cur('login')}>${icon('user')}Անձնական էջ</a>
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
        || (q ? '<p class="muted">Ոչինչ չի գտնվել</p>' : '');
    });
  }

  function renderFooter() {
    $('#footer').innerHTML = `
      <footer class="site-footer">
        <div class="wrap">
          <div class="footer-grid">
            <div>
              ${logo('logo-chip')}
              <p style="margin-top:16px;max-width:34ch">Ծննդյան և տոնական պարագաներ՝ մեծածախ, մեկ վայրում։</p>
              <ul class="footer-contacts">
                <li><a href="${CONTACT.phoneHref}">${icon('phone', 'icon-sm')} ${CONTACT.phone}</a></li>
                <li><a href="mailto:${CONTACT.email}">${icon('mail', 'icon-sm')} ${CONTACT.email}</a></li>
                <li><span>${icon('pin', 'icon-sm')} ${CONTACT.address}</span></li>
                <li><span>${icon('clock', 'icon-sm')} ${CONTACT.hours}</span></li>
              </ul>
            </div>
            <div>
              <h3>Խանութ</h3>
              <ul>${DATA.categories.filter((c) => !c.parent).map((c) => `<li><a href="shop.html?cat=${c.slug}">${esc(c.name)}</a></li>`).join('')}</ul>
            </div>
            <div>
              <h3>Ընկերություն</h3>
              <ul>
                <li><a href="about.html">Մեր մասին</a></li>
                <li><a href="contact.html">Կապ մեզ հետ</a></li>
                <li><a href="signup.html">Դառնալ հաճախորդ</a></li>
                <li><a href="terms.html">Առաքում և վերադարձ</a></li>
              </ul>
            </div>
            <div>
              <h3>Հաճախորդին</h3>
              <ul>
                <li><a href="${accountHref()}">Անձնական էջ</a></li>
                <li><a href="cart.html">Զամբյուղ</a></li>
                <li><a href="wishlist.html">Հիշվածներ</a></li>
              </ul>
            </div>
          </div>
          <div class="footer-bottom"><span>Cnund.JoyGroup © 2026</span><span>Գները տեսանելի են միայն գրանցված հաճախորդներին</span></div>
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
        ${p.inStock ? '' : '<span class="tag tag-sold">Առկա չէ</span>'}
        <button class="wish-btn" type="button" data-wish="${p.id}" aria-pressed="${wished}" aria-label="Հիշել">${icon('heart', 'icon-sm')}</button>
        <div class="ph"><img loading="lazy" src="${p.image}" alt="${esc(p.name)}"></div>
        <div class="card-body">
          <h3 class="card-name"><a href="product.html?id=${p.id}">${esc(p.name)}</a></h3>
          <div class="card-meta">${esc(cat ? cat.name : '')}${p.single ? '' : ' · ' + variantCount(p.variations.length)}</div>
          ${range ? `<div class="card-price">${range}</div>`
                  : `<div class="card-lock">${icon('lock', 'icon-sm')} Գինը՝ մուտքից հետո</div>`}
        </div>
      </article>`;
  }
  const cards = (list) => list.map(card).join('');

  function stepper(vid, qty, cls = '') {
    return `<div class="stepper ${cls}" data-stepper="${vid}">
      <button type="button" data-step="-1" aria-label="Պակասեցնել">${icon('minus', 'icon-sm')}</button>
      <input type="number" inputmode="numeric" min="0" max="9999" value="${qty}" aria-label="Քանակ">
      <button type="button" data-step="1" aria-label="Ավելացնել">${icon('plus', 'icon-sm')}</button>
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
    else toast(i === -1 ? 'Ավելացվեց հիշվածներին' : 'Հեռացվեց հիշվածներից', { href: 'wishlist.html', label: 'Դիտել' });
  });

  const emptyState = (ic, title, text, btn, ok) => `
    <div class="panel empty">
      <div class="circle${ok ? ' ok' : ''}">${icon(ic)}</div>
      <h2 class="h-md">${title}</h2>
      <p class="muted">${text}</p>
      ${btn ? `<a class="btn btn-primary" href="${btn.href}">${btn.label}</a>` : ''}
    </div>`;
  const loginGate = (text) => emptyState('lock', 'Մուտք գործեք', text, { href: `login.html?next=${page}`, label: 'Մուտք' });

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
          <div><strong>${esc(c.name)}</strong><small>${c.count} ապրանք</small></div>
        </a>`).join('');
      $('#bestGrid').innerHTML = cards(pick(DATA.home.bestsellers));
      $('#newGrid').innerHTML = cards(pick(DATA.home.newest));
      $('#promoA').innerHTML = `<img src="${productById.get(11145).image}" alt="">`;
      $('#promoB').innerHTML = `<img src="${productById.get(11858).image}" alt="">`;
      heroClouds($('#heroMedia'));
      const cta = $('#ctaActions');
      cta.innerHTML = state.authed
        ? '<a class="btn btn-on-red" href="shop.html">Անցնել խանութ</a><a class="btn btn-ghost-on-red" href="account.html">Իմ պատվերները</a>'
        : '<a class="btn btn-on-red" href="login.html">Մուտք</a><a class="btn btn-ghost-on-red" href="signup.html">Դառնալ հաճախորդ</a>';
      if (state.authed) $('#ctaText').textContent = 'Գները բաց են ձեզ համար։ Հավաքեք պատվերը մի քանի րոպեում։';
    },

    shop() {
      const slug = params.get('cat'), q = (params.get('q') || '').trim();
      const cat = catBySlug.get(slug);
      const all = { slug: '', name: 'Բոլորը', count: DATA.products.length };
      $('#chips').innerHTML = [all, ...DATA.categories].map((c) =>
        `<a class="chip" href="shop.html${c.slug ? '?cat=' + c.slug : ''}" aria-current="${(c.slug || null) === (slug || null) && !q}">${esc(c.name)} <small>${c.count}</small></a>`).join('');
      $('#shopTitle').textContent = q ? `Որոնում՝ «${q}»` : cat ? cat.name : 'Խանութ';
      $('#crumbHere').textContent = cat ? cat.name : 'Խանութ';
      if (state.authed) $('#sort').insertAdjacentHTML('beforeend', '<option value="price">Գինը՝ աճման կարգով</option>');

      let list = DATA.products.filter((p) => (!cat || p.cats.includes(cat.slug)) && (!q || p.name.toLowerCase().includes(q.toLowerCase())));
      const minPrice = (p) => Math.min(...p.variations.map((v) => PRICES[v.id]));
      const draw = () => {
        const mode = $('#sort').value;
        const sorted = [...list].sort(mode === 'name' ? (a, b) => a.name.localeCompare(b.name, 'hy')
          : mode === 'price' ? (a, b) => minPrice(a) - minPrice(b) : (a, b) => b.id - a.id);
        $('#count').textContent = `${sorted.length} ապրանք`;
        $('#shopGrid').innerHTML = cards(sorted);
        $('#shopEmpty').innerHTML = sorted.length ? '' : emptyState('search', 'Ոչինչ չի գտնվել', 'Փորձեք այլ բառ կամ ընտրեք բաժիններից մեկը։', { href: 'shop.html', label: 'Բոլոր ապրանքները' });
      };
      $('#sort').addEventListener('change', draw);
      draw();
    },

    product() {
      const wanted = params.get('id');
      const p = wanted ? productById.get(Number(wanted)) : DATA.products[0];
      if (!p) {   // unknown or removed product
        document.title = 'Ապրանքը չի գտնվել · JoyGroup';
        $('#crumbs').innerHTML = '<a href="index.html">Գլխավոր</a><span aria-hidden="true">/</span><a href="shop.html">Խանութ</a>';
        const box = $('.product'); box.classList.remove('product');
        box.innerHTML = emptyState('search', 'Ապրանքը չի գտնվել', 'Հնարավոր է՝ այն հանվել է տեսականուց, կամ հղումը սխալ է։', { href: 'shop.html', label: 'Անցնել խանութ' });
        $('#relatedTitle').textContent = 'Նոր ապրանքներ';
        $('#related').innerHTML = cards(DATA.home.newest.slice(0, 4).map((id) => productById.get(id)).filter(Boolean));
        return;
      }
      const cat = mainCat(p), range = priceRange(p);
      document.title = `${p.name} · JoyGroup`;
      $('#crumbs').innerHTML = `<a href="index.html">Գլխավոր</a><span aria-hidden="true">/</span>
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
          `<button type="button" data-src="${src}" aria-current="${src === p.image}" aria-label="Լուսանկար"><img loading="lazy" src="${src}" alt=""></button>`).join('')}</div>` : ''}`;

      const qty = {};   // picked quantities on this page, before they go to the cart
      const variantTile = (v) => {
        const price = priceOf(v.id);
        const photo = v.image
          ? `<button type="button" class="v-ph" data-src="${v.image}" aria-label="${esc(v.option)}"><img loading="lazy" src="${v.image}" alt=""></button>`
          : `<div class="v-ph empty">${esc(v.option)}</div>`;
        return `<div class="variant${v.inStock ? '' : ' sold'}" data-variant="${v.id}">
          ${photo}
          <div class="v-name">${esc(v.option)}</div>
          ${!v.inStock ? '<div class="v-price">Առկա չէ</div>'
            : price !== undefined ? `<div class="v-price">${money(price)}</div>${stepper(v.id, 0)}` : ''}
        </div>`;
      };

      $('#info').innerHTML = `
        <div class="tags">
          <a class="tag tag-purple" href="shop.html?cat=${cat.slug}">${esc(cat.name)}</a>
          <span class="tag${p.inStock ? '' : ' tag-sold'}">${p.inStock ? 'Առկա է' : 'Առկա չէ'}</span>
        </div>
        <h1>${esc(p.name)}</h1>
        ${range ? `<div class="price-line">${range} <small>/ հատը</small></div>` : `
          <div class="guest-box">
            <div class="row">${icon('lock')}<div><strong>Գները տեսանելի են միայն հաճախորդներին</strong>
              <p class="muted">Մուտք գործեք՝ գները տեսնելու և պատվեր ձևակերպելու համար։</p></div></div>
            <div class="actions"><a class="btn btn-primary" href="login.html?next=product&id=${p.id}">Մուտք</a>
              <a class="btn btn-secondary" href="signup.html">Դառնալ հաճախորդ</a></div>
          </div>`}
        ${p.single ? (range && p.inStock ? `<div class="variants-head"><h2>Քանակ</h2></div>${stepper(p.variations[0].id, 0, 'stepper-lg')}` : '') : `
          <div class="variants-head"><h2>${p.optionLabel}</h2><span class="muted">${variantCount(p.variations.length)}</span></div>
          <div class="variants">${p.variations.map(variantTile).join('')}</div>`}
        ${range && p.inStock ? `
          <div class="order-bar">
            <div class="sum"><small id="barQty">Ընտրեք քանակը</small><strong id="barSum">0 ֏</strong></div>
            <button class="btn btn-on-red" id="addBtn" type="button" disabled>${icon('bag', 'icon-sm')} Ավելացնել զամբյուղ</button>
          </div>` : ''}
        <dl class="specs">
          <div><dt>Կատեգորիա</dt><dd>${p.cats.map((s) => esc(catBySlug.get(s).name)).join(', ')}</dd></div>
          ${p.single ? '' : `<div><dt>${p.optionLabel}</dt><dd>${variantCount(p.variations.length)}</dd></div>`}
          <div><dt>Առկայություն</dt><dd>${p.inStock ? 'Առկա է' : 'Առկա չէ'}</dd></div>
        </dl>`;

      document.addEventListener('click', (e) => {
        const b = e.target.closest('[data-src]'); if (b) setMain(b.dataset.src);
      });
      setMain(p.image);   // mark the variant shown in the big photo from the start

      const refreshBar = () => {
        const picked = Object.entries(qty).filter(([, n]) => n > 0);
        const count = picked.reduce((s, [, n]) => s + n, 0);
        const sum = picked.reduce((s, [vid, n]) => s + n * PRICES[vid], 0);
        $('#barQty').textContent = count ? `${count} հատ · ${variantCount(picked.length)}` : 'Ընտրեք քանակը';
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
        toast(`${added} հատ ավելացվեց զամբյուղ`, { href: 'cart.html', label: 'Զամբյուղ' });
      });

      const related = DATA.products.filter((x) => x.id !== p.id && x.cats.includes(cat.slug)).slice(0, 4);
      $('#related').innerHTML = cards(related.length ? related : DATA.products.filter((x) => x.id !== p.id).slice(0, 4));
    },

    cart() {
      const root = $('#cartRoot');
      const draw = () => {
        if (!state.authed) { root.innerHTML = loginGate('Զամբյուղը և գները հասանելի են միայն գրանցված հաճախորդներին։'); return; }
        const lines = cartLines();
        if (!lines.length) {
          root.innerHTML = emptyState('bag', 'Զամբյուղը դատարկ է', 'Ընտրեք ապրանքներ խանութից և ավելացրեք այստեղ։', { href: 'shop.html', label: 'Անցնել խանութ' });
          return;
        }
        root.innerHTML = `
          <div class="split">
            <div class="panel">${lines.map((l) => `
              <div class="line">
                <a class="l-ph" href="product.html?id=${l.p.id}"><img src="${l.v.image || l.p.image}" alt=""></a>
                <div class="l-text"><div class="l-name"><a href="product.html?id=${l.p.id}">${esc(l.p.name)}</a></div>
                  <div class="l-meta">${l.p.single ? '' : esc(l.p.optionLabel + '՝ ' + l.v.option) + ' · '}${money(PRICES[l.vid])}</div></div>
                ${stepper(l.vid, l.qty)}
                <div class="l-total">${money(l.qty * PRICES[l.vid])}</div>
                <button class="icon-btn l-del" type="button" data-remove="${l.vid}" aria-label="Հեռացնել">${icon('trash', 'icon-sm')}</button>
              </div>`).join('')}
            </div>
            <aside class="panel aside">
              <h2 class="h-md">Պատվերի ամփոփում</h2>
              <div class="sum-rows">
                <div><span class="muted">Ապրանքներ</span><span>${lines.length} տող · ${cartQty()} հատ</span></div>
                <div class="total"><span>Ընդամենը</span><span>${money(cartTotal())}</span></div>
              </div>
              <a class="btn btn-primary btn-block" href="checkout.html">Ձևակերպել պատվերը</a>
              <a class="btn btn-secondary btn-block" href="shop.html" style="margin-top:10px">Շարունակել գնումները</a>
            </aside>
          </div>`;
      };
      bindSteppers(root, (vid, n) => { if (n > 0) state.cart[vid] = n; else delete state.cart[vid]; saveCart(); draw(); });
      root.addEventListener('click', (e) => {
        const b = e.target.closest('[data-remove]'); if (!b) return;
        delete state.cart[b.dataset.remove]; saveCart(); draw();
      });
      draw();
    },

    checkout() {
      const root = $('#checkoutRoot');
      if (!state.authed) { root.innerHTML = loginGate('Պատվեր ձևակերպելու համար անհրաժեշտ է մուտք գործել։'); return; }
      const lines = cartLines();
      if (!lines.length) { root.innerHTML = emptyState('bag', 'Զամբյուղը դատարկ է', 'Պատվեր ձևակերպելու համար նախ ավելացրեք ապրանքներ։', { href: 'shop.html', label: 'Անցնել խանութ' }); return; }
      $('#sumLines').innerHTML = lines.map((l) =>
        `<div><span>${esc(l.p.name)}${l.p.single ? '' : ' · ' + esc(l.v.option)} × ${l.qty}</span><span>${money(l.qty * PRICES[l.vid])}</span></div>`).join('');
      $('#sumTotal').textContent = money(cartTotal());
      $('#sumCount').textContent = `${cartQty()} հատ`;
      $('#checkoutForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const num = 'JG-' + String(Date.now()).slice(-6);
        state.cart = {}; saveCart();
        root.innerHTML = emptyState('check', 'Շնորհակալություն, պատվերն ընդունված է', `Պատվերի համարը՝ ${num}։ Մենեջերը կկապվի ձեզ հետ հաստատման համար։ Հարցերի դեպքում՝ ${CONTACT.phone}։`, { href: 'account.html', label: 'Իմ պատվերները' }, true);
        window.scrollTo({ top: 0 });
      });
    },

    account() {
      const root = $('#accountRoot');
      if (!state.authed) { root.innerHTML = loginGate('Անձնական էջը հասանելի է միայն գրանցված հաճախորդներին։'); return; }
      /* Sample orders so the screen can be designed; the real list comes from the backend. */
      const sample = [
        { num: 'JG-204518', date: '28.09.2026', status: 'Ընթացքում', tag: 'tag-purple', items: [[11146, 20], [11108, 20], [10609, 12]] },
        { num: 'JG-203977', date: '11.09.2026', status: 'Առաքված', tag: '', items: [[13500, 50], [13501, 50], [11859, 10]] },
        { num: 'JG-203120', date: '22.08.2026', status: 'Ավարտված', tag: 'tag-sold', items: [[10719, 30], [11055, 30], [11374, 24], [11299, 15]] },
      ].map((o) => {
        const items = o.items.filter(([vid]) => variationIndex.has(String(vid)));
        return { ...o, items, qty: items.reduce((s, [, n]) => s + n, 0), total: items.reduce((s, [vid, n]) => s + n * (PRICES[vid] || 0), 0) };
      });
      const views = {
        orders: () => `
          <div class="stat-row">
            <div class="stat block-purple"><strong>${sample.length}</strong>պատվեր</div>
            <div class="stat block-green"><strong>${sample.reduce((s, o) => s + o.qty, 0)}</strong>հատ ապրանք</div>
            <div class="stat block-white"><strong>${money(sample.reduce((s, o) => s + o.total, 0))}</strong>ընդհանուր գումար</div>
          </div>
          <div class="panel">
            <h2 class="h-md" style="margin-bottom:8px">Իմ պատվերները</h2>
            ${sample.map((o, i) => `
              <div class="order">
                <div><strong>${o.num}</strong><small>${o.date}</small></div>
                <div><span class="tag ${o.tag}">${o.status}</span></div>
                <div>${o.qty} հատ<small>${o.items.length} տող</small></div>
                <div><strong>${money(o.total)}</strong></div>
                <div class="acts">
                  <button class="btn btn-secondary btn-sm" type="button" data-repeat="${i}">${icon('repeat', 'icon-sm')} Կրկնել</button>
                  <button class="btn btn-secondary btn-sm" type="button" data-invoice>${icon('file', 'icon-sm')} Հաշիվ</button>
                </div>
              </div>`).join('')}
          </div>`,
        profile: () => `
          <div class="panel">
            <h2 class="h-md" style="margin-bottom:20px">Իմ տվյալները</h2>
            <form class="form" id="profileForm">
              <div class="form-row">
                <div class="field"><label for="pf1">Անուն Ազգանուն</label><input class="input" id="pf1" value="Անի Սարգսյան"></div>
                <div class="field"><label for="pf2">Խանութի անվանումը</label><input class="input" id="pf2" value="Տոնական աշխարհ"></div>
              </div>
              <div class="form-row">
                <div class="field"><label for="pf3">Հեռախոս</label><input class="input" id="pf3" type="tel" value="+374 00 000000"></div>
                <div class="field"><label for="pf4">Էլ. փոստ</label><input class="input" id="pf4" type="email" value="client@example.am"></div>
              </div>
              <div class="field"><label for="pf5">Առաքման հասցե</label><input class="input" id="pf5" value="Երևան"></div>
              <div class="form-row">
                <div class="field"><label for="pf6">Նոր գաղտնաբառ</label><input class="input" id="pf6" type="password" autocomplete="new-password"></div>
                <div class="field"><label for="pf7">Կրկնել գաղտնաբառը</label><input class="input" id="pf7" type="password" autocomplete="new-password"></div>
              </div>
              <div><button class="btn btn-primary" type="submit">Պահպանել</button></div>
            </form>
          </div>`,
      };
      const show = (name) => {
        $('#accountView').innerHTML = views[name]();
        $$('#sideNav [data-view]').forEach((b) => b.setAttribute('aria-current', b.dataset.view === name));
      };
      root.innerHTML = `
        <div class="account">
          <aside class="panel">
            <div class="user-chip"><div class="avatar">ԱՍ</div><div><strong>Անի Սարգսյան</strong><br><span class="muted" style="font-size:.875rem">Տոնական աշխարհ</span></div></div>
            <div class="side-nav" id="sideNav">
              <button type="button" data-view="orders">${icon('box', 'icon-sm')} Պատվերներ</button>
              <button type="button" data-view="profile">${icon('user', 'icon-sm')} Իմ տվյալները</button>
              <a href="wishlist.html">${icon('heart', 'icon-sm')} Հիշվածներ</a>
              <button type="button" id="logout">${icon('logout', 'icon-sm')} Ելք</button>
            </div>
          </aside>
          <div id="accountView"></div>
        </div>`;
      root.addEventListener('click', (e) => {
        const v = e.target.closest('[data-view]'); if (v) return show(v.dataset.view);
        const r = e.target.closest('[data-repeat]');
        if (r) {
          sample[r.dataset.repeat].items.forEach(([vid, n]) => { state.cart[vid] = (state.cart[vid] || 0) + n; });
          saveCart(); return toast('Պատվերի ապրանքներն ավելացվեցին զամբյուղ', { href: 'cart.html', label: 'Զամբյուղ' });
        }
        if (e.target.closest('[data-invoice]')) return toast('Հաշիվը (PDF) կներբեռնվի այստեղից');
        if (e.target.closest('#logout')) { store.set('jg_auth', false); location.href = 'index.html'; }
      });
      root.addEventListener('submit', (e) => { e.preventDefault(); toast('Տվյալները պահպանված են'); });
      show('orders');
    },

    wishlist() {
      const list = state.wish.map((id) => productById.get(id)).filter(Boolean);
      $('#wishGrid').innerHTML = cards(list);
      $('#wishEmpty').innerHTML = list.length ? '' : emptyState('heart', 'Հիշված ապրանք չկա', 'Սեղմեք սրտիկի վրա՝ ապրանքը այստեղ պահելու համար։', { href: 'shop.html', label: 'Անցնել խանութ' });
    },

    login() {
      $('#loginForm').addEventListener('submit', (e) => {
        e.preventDefault();
        $('#loginPanel').innerHTML = emptyState('lock', 'Մուտքը ժամանակավորապես անհասանելի է', `Գների և պատվերների համար զանգահարեք՝ ${CONTACT.phone}։`, { href: 'shop.html', label: 'Դիտել տեսականին' });
      });
      const flip = (reset) => { $('#loginPanel').hidden = reset; $('#resetPanel').hidden = !reset; };
      $('#toReset').addEventListener('click', () => flip(true));
      $('#toLogin').addEventListener('click', () => flip(false));
      $('#resetForm').addEventListener('submit', (e) => {
        e.preventDefault();
        $('#resetPanel').innerHTML = emptyState('lock', 'Մուտքը ժամանակավորապես անհասանելի է', `Հարցերի դեպքում զանգահարեք՝ ${CONTACT.phone}։`, { href: 'shop.html', label: 'Դիտել տեսականին' });
      });
    },

    signup() {
      $('#signupForm').addEventListener('submit', (e) => {
        e.preventDefault();
        $('#signupPanel').innerHTML = emptyState('phone', 'Առցանց հայտերը դեռ չեն ընդունվում', `Հաճախորդ դառնալու համար զանգահարեք՝ ${CONTACT.phone}։`, { href: 'shop.html', label: 'Դիտել տեսականին' });
        window.scrollTo({ top: 0 });
      });
    },

    contact() {
      const row = (ic, label, value, href) => {
        const inner = `<span class="circle">${icon(ic)}</span><span><small>${label}</small>${value}</span>`;
        return href ? `<a href="${href}">${inner}</a>` : `<div>${inner}</div>`;
      };
      $('#contactList').innerHTML =
        row('phone', 'Հեռախոս', CONTACT.phone, CONTACT.phoneHref) +
        row('mail', 'Էլ. փոստ', CONTACT.email, `mailto:${CONTACT.email}`) +
        row('pin', 'Հասցե', CONTACT.address) +
        row('clock', 'Աշխատանքային ժամեր', CONTACT.hours);
      $('#contactForm').addEventListener('submit', (e) => {
        e.preventDefault();
        $('#contactPanel').innerHTML = emptyState('phone', 'Հաղորդագրությունը չի ուղարկվել', `Կայքի այս տարբերակը դեռ չի ընդունում հաղորդագրություններ։ Զանգահարեք՝ ${CONTACT.phone} կամ գրեք՝ ${CONTACT.email}։`, null);
      });
    },

    notfound() { heroClouds($('#notFoundMedia')); },

    about() {
      heroClouds($('#aboutMedia'));
      $('#aboutActions').innerHTML = state.authed
        ? '<a class="btn btn-on-red" href="shop.html">Անցնել խանութ</a>'
        : '<a class="btn btn-on-red" href="signup.html">Դառնալ հաճախորդ</a><a class="btn btn-ghost-on-red" href="login.html">Մուտք</a>';

      const tops = DATA.categories.filter((c) => !c.parent);
      const variants = DATA.products.reduce((n, p) => n + p.variations.length, 0);
      $('#aboutStats').innerHTML = [[DATA.products.length, 'ապրանք'], [variants, 'տարբերակ'], [tops.length, 'բաժին']]
        .map(([n, label]) => `<div class="about-stat"><strong>${n}</strong><span>${label}</span></div>`).join('');

      $('#aboutBento').innerHTML = tops.map((c, i) => `
        <a class="bento-tile${i < 2 ? ' big' : ''}" href="shop.html?cat=${c.slug}">
          <div class="bento-text"><h3 class="h-md">${esc(c.name)}</h3><span class="muted">${c.count} ապրանք</span>
            <span class="link-arrow">Դիտել ${icon('arrow', 'icon-sm')}</span></div>
          <div class="bento-ph"><img loading="lazy" src="${c.image}" alt=""></div>
        </a>`).join('');

      $('#aboutContact').innerHTML = `
        <div>
          <p class="eyebrow">Կապ</p>
          <h2 class="h-lg" style="margin-top:8px">Եկեք աշխատենք միասին</h2>
          <p class="body-lg" style="margin-top:12px;max-width:44ch">Զանգահարեք, գրեք կամ այցելեք մեզ. կպատասխանենք բոլոր հարցերին։</p>
          <div class="actions">
            <a class="btn btn-primary" href="${state.authed ? 'shop.html' : 'signup.html'}">${state.authed ? 'Անցնել խանութ' : 'Դառնալ հաճախորդ'}</a>
            <a class="btn btn-secondary" href="contact.html">Գրել մեզ</a>
          </div>
        </div>
        <ul>
          <li><a href="${CONTACT.phoneHref}">${icon('phone')}<span><small>Հեռախոս</small>${CONTACT.phone}</span></a></li>
          <li><a href="mailto:${CONTACT.email}">${icon('mail')}<span><small>Էլ. փոստ</small>${CONTACT.email}</span></a></li>
          <li><div>${icon('pin')}<span><small>Հասցե</small>${CONTACT.address}</span></div></li>
          <li><div>${icon('clock')}<span><small>Աշխատանքային ժամեր</small>${CONTACT.hours}</span></div></li>
        </ul>`;
    },
  };

  /* ---------- Boot ---------- */
  renderHeader();
  renderFooter();
  if (pages[page]) pages[page]();
  updateBadges();

  $$('[data-icon]').forEach((el) => { el.outerHTML = icon(el.dataset.icon, el.className); });

  const io = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { rootMargin: '0px 0px -8% 0px' })
    : null;
  $$('.reveal').forEach((el) => (io ? io.observe(el) : el.classList.add('in')));
})();
