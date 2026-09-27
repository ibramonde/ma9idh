/* ============================================================
   مِربَط · MAQIDH — Application (routeur, vues, logique métier)
   ============================================================ */
(function () {
  'use strict';

  const D = window.MirbatData;
  const U = window.UI;
  const { esc, money, moneyTxt, num, date, dateShort, daysBetween, icon, icons, badge, healthBadge, progress, toast, modal, closeModal, confirmBox, field, formData, dataTable, exportCSV, kpi, segmented } = U;

  let db = D.load();
  let me = null;
  let charts = [];
  const TODAY = D.util.todayISO();
  const FRAMED = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();

  /* =========================================================
     Permissions
     ========================================================= */
  const roleOf = (u) => db.roles.find((r) => r.key === u.role);
  const isAdmin = () => !!(me && roleOf(me) && roleOf(me).admin);
  const can = (p) => !!(me && roleOf(me) && roleOf(me).perms.includes(p));
  const canOwners = () => can('birds') || can('bookings') || can('finance');

  const NAV = [
    { route: 'dashboard', label: 'لوحة التحكم', icon: 'layout-dashboard', show: () => true },
    { route: 'birds', label: 'الطيور', icon: 'bird', show: () => can('birds') },
    { route: 'owners', label: 'الملاك', icon: 'users', show: canOwners },
    { route: 'bookings', label: 'الحجوزات والاستلام', icon: 'calendar-check', show: () => can('bookings') },
    { route: 'health', label: 'الصحة والتحصينات', icon: 'heart-pulse', show: () => can('health') },
    { route: 'inventory', label: 'التغذية والمخزون', icon: 'package', show: () => can('inventory') },
    { route: 'delivery', label: 'التوصيل', icon: 'truck', show: () => can('delivery') },
    { route: 'finance', label: 'المالية والمحاسبة', icon: 'wallet', show: () => can('finance') },
    { route: 'reports', label: 'التقارير', icon: 'file-bar-chart', show: () => true, group: 'إدارة' },
    { route: 'staff', label: 'الموظفون والصلاحيات', icon: 'shield-check', show: isAdmin, group: 'إدارة' },
    { route: 'settings', label: 'إعدادات المقيض', icon: 'settings', show: isAdmin, group: 'إدارة' },
  ];

  /* =========================================================
     Accès aux données & calculs métier
     ========================================================= */
  const S = () => db.settings;
  const owner = (id) => db.owners.find((o) => o.id === +id);
  const bird = (id) => db.birds.find((b) => b.id === +id);
  const birdByRing = (ring) => db.birds.find((b) => b.ring.toLowerCase() === String(ring).trim().toLowerCase());
  const staff = (id) => db.staff.find((s) => s.id === +id);
  const itemById = (id) => db.items.find((i) => i.id === +id);
  const supplier = (id) => db.suppliers.find((s) => s.id === +id);
  const persist = () => D.save();
  const log = (action) => { db.audit.unshift({ ts: new Date().toISOString(), user: me ? me.name : '—', action }); db.audit = db.audit.slice(0, 300); };

  const activeBirds = () => db.birds.filter((b) => b.status === 'active');
  const occupied = () => activeBirds().length;
  const capacity = () => +S().season.capacity;
  const seasonDay = () => Math.max(1, daysBetween(S().season.start, TODAY) + 1);
  const seasonLen = () => daysBetween(S().season.start, S().season.end) + 1;
  const stayDay = (b) => Math.max(1, daysBetween(b.entryDate, b.exitDate && b.exitDate < TODAY ? b.exitDate : TODAY) + 1);
  const stayLen = (b) => daysBetween(b.entryDate, b.endDate);
  const daysLeft = (b) => daysBetween(TODAY, b.endDate);
  const nearEnd = (b) => b.status === 'active' && daysLeft(b) <= 30;
  const birdTreatments = (b) => db.treatments.filter((t) => t.birdId === b.id);
  const lastVaccine = (b) => b.vaccines[b.vaccines.length - 1];
  const vacDue = (b) => {
    if (b.status !== 'active' || b.vaccines.length >= S().vacProgram.doses) return false;
    const last = lastVaccine(b);
    return last ? daysBetween(last.date, TODAY) >= S().vacProgram.intervalDays : daysBetween(b.entryDate, TODAY) >= 7;
  };
  const birdDeliveries = (b) => db.deliveries.filter((d) => d.birdId === b.id && d.status !== 'لم تتم');
  const birdCharges = (b) => {
    const stay = +b.price;
    const treat = birdTreatments(b).reduce((s, t) => s + +t.cost, 0);
    const vac = b.vaccines.reduce((s, v) => s + +v.cost, 0);
    const deliv = birdDeliveries(b).reduce((s, d) => s + +d.fee, 0);
    return { stay, treat, vac, deliv, total: stay + treat + vac + deliv };
  };
  const birdPaid = (b) => db.payments.filter((p) => p.birdId === b.id).reduce((s, p) => s + +p.amount, 0);
  const birdBalance = (b) => birdCharges(b).total - birdPaid(b);
  const unpaidTreatment = (b) => birdTreatments(b).some((t) => !t.paid);
  const ownerBirds = (o) => db.birds.filter((b) => b.ownerId === o.id);
  const ownerAccount = (o) => {
    const acc = { stay: 0, treat: 0, deliv: 0, total: 0, paid: 0 };
    ownerBirds(o).forEach((b) => { const c = birdCharges(b); acc.stay += c.stay; acc.treat += c.treat + c.vac; acc.deliv += c.deliv; acc.total += c.total; acc.paid += birdPaid(b); });
    db.payments.filter((p) => p.ownerId === o.id && !p.birdId).forEach((p) => { acc.paid += +p.amount; acc.total += +p.amount; acc.stay += +p.amount; });
    acc.balance = acc.total - acc.paid;
    return acc;
  };

  /* Toutes les dépenses : saisies + générées automatiquement (achats, traitements, vaccins) */
  function allExpenses() {
    const list = db.expenses.map((e) => ({ ...e, source: 'يدوي' }));
    db.purchases.forEach((p) => {
      const it = itemById(p.itemId);
      list.push({ id: `P${p.id}`, date: p.date, category: 'التغذية والفريس', amount: p.qty * p.unitPrice, note: `شراء ${it ? it.name : ''} (${num(p.qty)} ${it ? it.unit : ''}) — ${supplier(p.supplierId)?.name || ''}`, source: 'تلقائي' });
    });
    db.treatments.forEach((t) => list.push({ id: `T${t.id}`, date: t.date, category: 'العلاج والتحصينات', amount: +t.cost, note: `علاج ${bird(t.birdId)?.ring || ''} — ${t.disease}`, source: 'تلقائي' }));
    db.birds.forEach((b) => b.vaccines.forEach((v) => list.push({ id: `V${b.id}-${v.dose}`, date: v.date, category: 'العلاج والتحصينات', amount: +v.cost, note: `تحصين ${b.ring} — الجرعة ${v.dose}`, source: 'تلقائي' })));
    return list.sort((a, b) => (a.date < b.date ? 1 : -1));
  }

  function periodRange(kind, from, to) {
    const t = new Date(TODAY);
    const y = t.getFullYear(), m = t.getMonth();
    switch (kind) {
      case 'day': return [TODAY, TODAY];
      case 'month': return [D.util.iso(new Date(y, m, 1)), D.util.iso(new Date(y, m + 1, 0))];
      case 'year': return [`${y}-01-01`, `${y}-12-31`];
      case 'custom': return [from || S().season.start, to || TODAY];
      default: return [S().season.start, S().season.end];
    }
  }
  const inRange = (d, [a, b]) => d >= a && d <= b;

  /* =========================================================
     Routeur
     ========================================================= */
  function currentRoute() {
    const h = (location.hash || '').replace('#', '');
    if (!h) return { name: 'dashboard' };
    const m = h.match(/^bird-(\d+)$/);
    if (m) return { name: 'bird', id: +m[1] };
    return { name: h };
  }
  function go(route) { if (location.hash === '#' + route) render(); else location.hash = route; }
  window.addEventListener('hashchange', () => render());

  function render() {
    charts.forEach((c) => c.destroy()); charts = [];
    if (!me) return renderLogin();
    const r = currentRoute();
    const views = { dashboard: viewDashboard, birds: viewBirds, bird: viewBird, owners: viewOwners, bookings: viewBookings, health: viewHealth, inventory: viewInventory, delivery: viewDelivery, finance: viewFinance, reports: viewReports, staff: viewStaff, settings: viewSettings };
    const navItem = NAV.find((n) => n.route === (r.name === 'bird' ? 'birds' : r.name));
    if (!views[r.name] || (navItem && !navItem.show())) {
      renderShell('dashboard');
      if (r.name !== 'dashboard' && views[r.name]) toast('ليست لديك صلاحية الوصول إلى هذه الصفحة', 'bad');
      viewDashboard(document.getElementById('view')); icons();
      if (r.name !== 'dashboard') history.replaceState(null, '', '#dashboard');
      return;
    }
    renderShell(r.name === 'bird' ? 'birds' : r.name);
    views[r.name](document.getElementById('view'), r);
    icons();
    document.getElementById('view').classList.add('fade-in');
  }

  /* =========================================================
     Page de connexion
     ========================================================= */
  function renderLogin(err) {
    const demo = db.staff.filter((s, i, arr) => arr.findIndex((x) => x.role === s.role) === i);
    document.getElementById('app').innerHTML = `
    <div class="login-bg flex min-h-screen items-center justify-center px-4 py-10">
      <div class="w-full max-w-md fade-in">
        <div class="mb-8 flex flex-col items-center text-center">
          <img src="assets/img/logo.png" alt="شعار مِربَط" class="h-28 w-auto drop-shadow-[0_10px_30px_rgba(214,178,107,.25)]">
          <div class="mt-4 font-brand text-5xl font-bold leading-none text-white">مِربَط</div>
          <div class="mt-2 text-xs font-medium tracking-[0.5em] text-gold" dir="ltr">MAQIDH</div>
          <p class="mt-3 text-sm text-white/60">منصة مقيض الطيور</p>
        </div>

        <form id="login-form" class="rounded-2xl bg-white p-6 shadow-2xl shadow-black/30 sm:p-8" novalidate>
          <h1 class="text-xl font-extrabold text-navy">تسجيل الدخول</h1>
          <p class="mt-1 text-sm text-mute">أدخل بيانات حسابك للوصول إلى لوحة المقيض</p>
          ${err ? `<div class="mt-4 flex items-center gap-2 rounded-xl bg-bad-100 px-3 py-2.5 text-sm font-medium text-bad" role="alert">${icon('circle-alert', 'size-4 shrink-0')}${esc(err)}</div>` : ''}
          <div class="mt-5 flex flex-col gap-4">
            <label class="flex flex-col gap-1.5" for="login-user">
              <span class="text-sm font-bold text-navy">اسم المستخدم</span>
              <div class="relative">
                <span class="pointer-events-none absolute inset-y-0 start-3 grid place-items-center text-mute">${icon('user-round')}</span>
                <input id="login-user" name="username" autocomplete="username" class="input ps-10" placeholder="مثال: admin" required dir="ltr" style="text-align:right">
              </div>
            </label>
            <label class="flex flex-col gap-1.5" for="login-pass">
              <span class="text-sm font-bold text-navy">كلمة المرور</span>
              <div class="relative">
                <span class="pointer-events-none absolute inset-y-0 start-3 grid place-items-center text-mute">${icon('lock-keyhole')}</span>
                <input id="login-pass" name="password" type="password" autocomplete="current-password" class="input ps-10 pe-11" placeholder="••••••••" required dir="ltr" style="text-align:right">
                <button type="button" id="toggle-pass" class="absolute inset-y-0 end-1 my-auto btn-icon size-8" aria-label="إظهار كلمة المرور">${icon('eye')}</button>
              </div>
            </label>
            <button class="btn btn-primary mt-1 w-full py-3 text-base" type="submit">${icon('log-in', 'size-5')} دخول</button>
          </div>
        </form>

        <details class="group mt-5 rounded-2xl bg-white/5 px-4 py-3 text-white/80 ring-1 ring-white/10">
          <summary class="flex cursor-pointer list-none items-center justify-between text-sm font-bold text-gold">
            <span class="flex items-center gap-2">${icon('key-round')} حسابات تجريبية حسب الدور</span>
            <span class="transition group-open:rotate-180">${icon('chevron-down')}</span>
          </summary>
          <ul class="mt-3 grid gap-1.5 text-sm">
            ${demo.map((s) => `<li><button type="button" class="demo-fill flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-start hover:bg-white/10" data-u="${esc(s.username)}" data-p="${esc(s.password)}">
              <span class="font-bold text-white">${esc(roleOf(s).label)}</span>
              <span class="ltr text-xs text-white/60">${esc(s.username)} / ${esc(s.password)}</span></button></li>`).join('')}
          </ul>
        </details>
        <p class="mt-6 text-center text-xs text-white/40">كل طائر له ملف .. وكل عملية لها أثر .. وكل قرار مبني على البيانات</p>
      </div>
    </div>`;
    icons();
    const form = document.getElementById('login-form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const u = form.username.value.trim(), p = form.password.value;
      if (!u || !p) return renderLogin('يرجى إدخال اسم المستخدم وكلمة المرور');
      const user = db.staff.find((s) => s.username.toLowerCase() === u.toLowerCase() && s.password === p);
      if (!user) return renderLogin('اسم المستخدم أو كلمة المرور غير صحيحة');
      if (!user.active) return renderLogin('هذا الحساب معطّل. تواصل مع مدير المقيض');
      me = user; D.session.set({ id: user.id });
      log('تسجيل الدخول'); persist();
      if (location.hash && location.hash !== '#dashboard') location.hash = 'dashboard'; else render();
    });
    document.getElementById('toggle-pass').addEventListener('click', (e) => {
      const inp = document.getElementById('login-pass');
      inp.type = inp.type === 'password' ? 'text' : 'password';
      e.currentTarget.innerHTML = icon(inp.type === 'password' ? 'eye' : 'eye-off'); icons();
    });
    document.querySelectorAll('.demo-fill').forEach((b) => b.addEventListener('click', () => {
      document.getElementById('login-user').value = b.dataset.u;
      document.getElementById('login-pass').value = b.dataset.p;
      document.getElementById('login-pass').focus();
    }));
  }

  function logout() { log('تسجيل الخروج'); persist(); me = null; D.session.clear(); history.replaceState(null, '', location.pathname); render(); }

  /* =========================================================
     Structure (barre latérale + en-tête)
     ========================================================= */
  function renderShell(active) {
    const items = NAV.filter((n) => n.show());
    const main = items.filter((n) => !n.group), admin = items.filter((n) => n.group);
    const link = (n) => `<a href="#${n.route}" class="nav-link" ${n.route === active ? 'aria-current="page"' : ''}>${icon(n.icon, 'size-[18px]')}<span>${n.label}</span></a>`;
    const r = roleOf(me);
    const pct = Math.round((occupied() / capacity()) * 100);
    document.getElementById('app').innerHTML = `
    <div class="min-h-screen">
      <div id="scrim" class="fixed inset-0 z-20 hidden bg-navy-900/50 lg:hidden"></div>
      <aside id="sidebar" class="sidebar fixed inset-y-0 start-0 z-30 flex w-72 translate-x-full flex-col overflow-y-auto transition-transform lg:translate-x-0">
        <div class="flex items-center gap-3 px-5 pb-5 pt-6">
          <img src="assets/img/logo.png" alt="" class="h-11 w-auto">
          <div><div class="font-brand text-2xl font-bold leading-none text-white">مِربَط</div><div class="mt-1 text-[10px] tracking-[0.4em] text-gold" dir="ltr">MAQIDH</div></div>
        </div>
        <div class="mx-4 mb-4 rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
          <div class="flex items-center justify-between text-xs text-white/60"><span>${esc(S().tenant)}</span><span class="font-bold text-gold">${esc(S().season.name)}</span></div>
          <div class="mt-2 flex items-baseline justify-between"><span class="text-sm font-bold text-white">الطاقة المشغولة</span><span class="text-sm font-extrabold text-white tabular-nums">${num(occupied())} / ${num(capacity())}</span></div>
          <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"><div class="h-full rounded-full bg-gold" style="width:${pct}%"></div></div>
        </div>
        <nav class="flex flex-1 flex-col gap-1 px-3" aria-label="القائمة الرئيسية">
          ${main.map(link).join('')}
          ${admin.length ? `<div class="mt-4 px-3 pb-1 text-[11px] font-bold tracking-wide text-white/35">إدارة</div>${admin.map(link).join('')}` : ''}
        </nav>
        <div class="m-3 mt-6 rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
          <div class="flex items-center gap-3">
            <span class="grid size-10 shrink-0 place-items-center rounded-full bg-gold font-extrabold text-navy">${esc(me.name.replace('د. ', '').trim().charAt(0))}</span>
            <div class="min-w-0 flex-1"><div class="truncate text-sm font-bold text-white">${esc(me.name)}</div><div class="truncate text-xs text-gold">${esc(r.label)}</div></div>
            <button id="logout" class="btn-icon text-white/60 hover:bg-white/10 hover:text-white" aria-label="تسجيل الخروج" title="تسجيل الخروج">${icon('log-out')}</button>
          </div>
        </div>
      </aside>

      <div class="lg:ms-72">
        <header class="sticky top-0 z-10 border-b border-line bg-white/90 backdrop-blur" style="top:env(safe-area-inset-top,0px)">
          <div class="mx-auto flex max-w-[1400px] items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
            <button id="menu-btn" class="btn-icon lg:hidden" aria-label="القائمة">${icon('menu', 'size-5')}</button>
            <div class="hidden items-center gap-2 rounded-full bg-gold-100 px-3 py-1.5 text-xs font-bold text-gold-700 sm:flex">${icon('calendar-range', 'size-3.5')} ${esc(S().season.name)} · اليوم ${num(seasonDay())} من ${num(seasonLen())}</div>
            ${canOwners() ? `<div class="relative ms-auto w-full max-w-md">
              <span class="pointer-events-none absolute inset-y-0 start-3 grid place-items-center text-mute">${icon('search')}</span>
              <input id="global-search" type="search" class="input ps-10" placeholder="ابحث برقم الحلقة أو المالك أو الجوال" autocomplete="off">
              <div id="search-results" class="absolute inset-x-0 top-full z-20 mt-2 hidden overflow-hidden rounded-xl border border-line bg-white shadow-xl"></div>
            </div>` : '<div class="ms-auto"></div>'}
            <span class="hidden whitespace-nowrap text-xs text-mute md:inline">${date(TODAY)}</span>
          </div>
        </header>
        <main id="view" class="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8"></main>
      </div>
    </div>`;
    const sb = document.getElementById('sidebar'), scrim = document.getElementById('scrim');
    const toggle = (open) => { sb.classList.toggle('translate-x-full', !open); scrim.classList.toggle('hidden', !open); };
    document.getElementById('menu-btn').addEventListener('click', () => toggle(true));
    scrim.addEventListener('click', () => toggle(false));
    sb.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => toggle(false)));
    document.getElementById('logout').addEventListener('click', () => confirmBox({ title: 'تسجيل الخروج', message: 'هل تريد إنهاء الجلسة الحالية؟', okText: 'خروج', onOk: logout }));
    bindSearch();
  }

  function bindSearch() {
    const inp = document.getElementById('global-search'); if (!inp) return;
    const box = document.getElementById('search-results');
    inp.addEventListener('input', () => {
      const q = inp.value.trim().toLowerCase();
      if (q.length < 2) { box.classList.add('hidden'); return; }
      const ownersHit = db.owners.filter((o) => o.name.toLowerCase().includes(q) || o.phone.replace(/\s/g, '').includes(q.replace(/\s/g, ''))).slice(0, 4);
      const birdsHit = can('birds') ? db.birds.filter((b) => b.ring.toLowerCase().includes(q) || String(b.id) === q || ownersHit.some((o) => o.id === b.ownerId)).slice(0, 6) : [];
      box.innerHTML = (birdsHit.map((b) => `<a href="#bird-${b.id}" class="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-paper"><span class="flex items-center gap-2">${icon('bird', 'size-4 text-gold-600')}<b class="ltr">${esc(b.ring)}</b> · ${esc(b.species)}</span><span class="truncate text-xs text-mute">${esc(owner(b.ownerId).name)}</span></a>`).join('') +
        ownersHit.map((o) => `<button type="button" data-owner="${o.id}" class="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-start text-sm hover:bg-paper"><span class="flex items-center gap-2">${icon('user-round', 'size-4 text-navy-500')}${esc(o.name)}</span><span class="ltr text-xs text-mute">${esc(o.phone)}</span></button>`).join('')) || '<div class="px-4 py-4 text-sm text-mute">لا توجد نتائج مطابقة</div>';
      box.classList.remove('hidden'); icons();
      box.querySelectorAll('[data-owner]').forEach((b) => b.addEventListener('click', () => { box.classList.add('hidden'); inp.value = ''; ownerModal(owner(b.dataset.owner)); }));
      box.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => { box.classList.add('hidden'); inp.value = ''; }));
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('#global-search, #search-results')) box.classList.add('hidden'); });
  }

  const pageHead = (title, sub, actions = '') => `
    <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div><h1 class="text-2xl font-extrabold text-navy sm:text-[1.75rem]">${title}</h1>${sub ? `<p class="mt-1 text-sm text-mute">${sub}</p>` : ''}</div>
      ${actions ? `<div class="flex flex-wrap items-center gap-2">${actions}</div>` : ''}
    </div>`;
  const section = (title, ic, body, extra = '') => `<section class="card"><div class="card-h"><h2 class="card-t">${icon(ic, 'size-5 text-gold-600')}${title}</h2>${extra}</div><div class="p-5">${body}</div></section>`;

  function chart(canvasId, cfg) {
    const el = document.getElementById(canvasId); if (!el || !window.Chart) return;
    Chart.defaults.font.family = 'Tajawal, system-ui, sans-serif';
    Chart.defaults.color = '#6B7280';
    charts.push(new Chart(el, cfg));
  }

  /* =========================================================
     Tableau de bord
     ========================================================= */
  function viewDashboard(v) {
    const r = roleOf(me);
    const act = activeBirds();
    const occ = act.length, cap = capacity(), pct = (occ / cap) * 100;
    const weekAgo = D.util.iso(D.util.addDays(TODAY, -7));
    const blocks = [];

    if (can('birds') || can('bookings')) {
      const pending = db.bookings.filter((b) => b.status === 'pending');
      blocks.push(`
      <section class="card overflow-hidden lg:col-span-2">
        <div class="grid gap-6 p-5 sm:grid-cols-[auto_1fr] sm:items-center">
          <div class="gauge relative mx-auto grid size-40 place-items-center rounded-full" style="--p:${pct.toFixed(1)}">
            <div class="grid size-[7.6rem] place-items-center rounded-full bg-white text-center">
              <div><div class="text-3xl font-extrabold text-navy tabular-nums">${pct.toFixed(1)}%</div><div class="text-xs text-mute tabular-nums">${num(occ)} / ${num(cap)} مكان</div></div>
            </div>
          </div>
          <div>
            <h2 class="card-t">${icon('warehouse', 'size-5 text-gold-600')} الطاقة الاستيعابية · ${esc(S().season.name)}</h2>
            <p class="mt-1 text-sm text-mute">عدّاد يتحدّث مع كل استلام. تنبيه الامتلاء: ${ruleLabel(S().rules.capacity)}</p>
            <div class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              ${miniStat('الطيور الموجودة', num(occ))}
              ${miniStat('الأماكن المتاحة', num(Math.max(0, cap - occ)))}
              ${miniStat('جديدة هذا الأسبوع', num(act.filter((b) => b.entryDate >= weekAgo).length))}
              ${miniStat('حجوزات بانتظار الاستلام', num(pending.length))}
            </div>
          </div>
        </div>
      </section>`);
    }

    if (can('birds')) {
      const underT = act.filter((b) => b.health === 'تحت العلاج').length;
      const near = act.filter(nearEnd);
      blocks.push(section('الطيور', 'bird', `
        <div class="grid grid-cols-3 gap-3">${miniStat('إجمالي الطيور', num(db.birds.length))}${miniStat('الخارجة', num(db.birds.filter((b) => b.status === 'exited').length))}${miniStat('قرب انتهاء المدة', num(near.length), 'warn')}</div>
        ${listMini('تنتهي مدتها قريباً', near.sort((a, b) => a.endDate.localeCompare(b.endDate)).slice(0, 4).map((b) => ({ href: `#bird-${b.id}`, a: b.ring, b: owner(b.ownerId).name, c: badge(`${daysLeft(b)} يوم`, 'warn') })))}
      `, `<a href="#birds" class="text-xs font-bold text-gold-700 hover:underline">عرض الكل</a>`));
      void underT;
    }

    if (can('health')) {
      const underT = act.filter((b) => b.health === 'تحت العلاج');
      const due = act.filter(vacDue);
      const tCost = db.treatments.reduce((s, t) => s + +t.cost, 0);
      blocks.push(section('الصحة', 'heart-pulse', `
        <div class="grid grid-cols-3 gap-3">${miniStat('تحت العلاج', num(underT.length), 'bad')}${miniStat('تحصينات مستحقة', num(due.length), 'warn')}${miniStat('مصاريف العلاج', moneyTxt(tCost))}</div>
        ${listMini('الطيور تحت العلاج', underT.slice(0, 4).map((b) => { const t = birdTreatments(b).find((x) => x.status === 'جاري'); return { href: `#bird-${b.id}`, a: b.ring, b: t ? t.disease : '—', c: t ? `<span class="text-xs text-mute">${esc(t.doctor)}</span>` : '' }; }))}
      `, `<a href="#health" class="text-xs font-bold text-gold-700 hover:underline">فتح الوحدة</a>`));
    }

    if (can('finance')) {
      const rng = periodRange('season');
      const inc = db.payments.filter((p) => inRange(p.date, rng)).reduce((s, p) => s + +p.amount, 0);
      const exp = allExpenses().filter((e) => inRange(e.date, rng)).reduce((s, e) => s + +e.amount, 0);
      const due = db.birds.reduce((s, b) => s + birdCharges(b).total, 0);
      const paidB = db.birds.reduce((s, b) => s + birdPaid(b), 0);
      const unpaid = db.birds.filter((b) => birdBalance(b) > 0).length;
      blocks.push(`
      <section class="card lg:col-span-2">
        <div class="card-h"><h2 class="card-t">${icon('wallet', 'size-5 text-gold-600')} المالية · ${esc(S().season.name)}</h2><a href="#finance" class="text-xs font-bold text-gold-700 hover:underline">المحاسبة التفصيلية</a></div>
        <div class="grid gap-5 p-5 lg:grid-cols-[1fr_1.4fr]">
          <div class="grid grid-cols-2 content-start gap-3">
            ${miniStat('المدخول', moneyTxt(inc), 'ok')}${miniStat('المصروفات', moneyTxt(exp), 'bad')}
            ${miniStat('صافي الدخل', moneyTxt(inc - exp))}${miniStat('نسبة التحصيل', `${((paidB / due) * 100).toFixed(1)}%`)}
            ${miniStat('المتبقي على الملاك', moneyTxt(due - paidB), 'warn')}${miniStat('حسابات غير مسددة', num(unpaid), 'warn')}
          </div>
          <div class="h-64"><canvas id="ch-fin" aria-label="المدخول والمصروفات حسب الشهر"></canvas></div>
        </div>
      </section>`);
    }

    if (can('inventory')) {
      const low = db.items.filter((i) => i.qty < i.min);
      const value = db.items.reduce((s, i) => s + i.qty * i.unitCost, 0);
      blocks.push(section('المخزون والفريس', 'package', `
        <div class="flex flex-col gap-3">${db.items.map((i) => `
          <div><div class="mb-1 flex items-baseline justify-between text-sm"><span class="font-bold text-navy">${esc(i.name)}</span><span class="tabular-nums ${i.qty < i.min ? 'font-bold text-bad' : 'text-mute'}">${num(i.qty)} ${esc(i.unit)}</span></div>${progress((i.qty / i.max) * 100, i.qty < i.min ? 'bad' : 'navy')}</div>`).join('')}
        </div>
        <div class="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-paper px-3 py-2 text-sm"><span class="text-mute">قيمة المخزون</span><b class="text-navy">${money(value)}</b></div>
        ${low.length ? `<div class="mt-3 flex items-start gap-2 rounded-xl bg-bad-100 px-3 py-2 text-sm text-bad">${icon('triangle-alert', 'size-4 mt-0.5 shrink-0')}<span>تنبيه إعادة الطلب: ${low.map((i) => esc(i.name)).join('، ')}</span></div>` : ''}
      `, `<a href="#inventory" class="text-xs font-bold text-gold-700 hover:underline">فتح الوحدة</a>`));
    }

    if (can('delivery')) {
      const mine = me.role === 'driver' ? db.deliveries.filter((d) => d.driverId === me.id) : db.deliveries;
      const pend = mine.filter((d) => d.status === 'معلّقة').sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
      blocks.push(section(me.role === 'driver' ? 'مهامي في التوصيل' : 'التوصيل', 'truck', `
        <div class="grid grid-cols-3 gap-3">${miniStat('معلّقة', num(pend.length), 'warn')}${miniStat('مكتملة', num(mine.filter((d) => d.status === 'تمت').length), 'ok')}${miniStat('رسوم التوصيل', moneyTxt(mine.filter((d) => d.status !== 'لم تتم').reduce((s, d) => s + +d.fee, 0)))}</div>
        ${listMini('القادمة', pend.slice(0, 4).map((d) => ({ href: '#delivery', a: `${d.direction === 'خروج' ? '↩' : '↪'} ${bird(d.birdId)?.ring || ''}`, b: d.address, c: `<span class="text-xs text-mute whitespace-nowrap">${dateShort(d.date)} · <span class="ltr">${d.time}</span></span>` })))}
      `, `<a href="#delivery" class="text-xs font-bold text-gold-700 hover:underline">كل الطلبات</a>`));
    }

    if (can('bookings')) {
      const pending = db.bookings.filter((b) => b.status === 'pending').sort((a, b) => a.arrival.localeCompare(b.arrival));
      blocks.push(section('الاستلامات القادمة', 'calendar-clock', listMini('', pending.slice(0, 6).map((b) => ({ href: '#bookings', a: b.ring, b: owner(b.ownerId).name, c: `<span class="text-xs whitespace-nowrap ${b.arrival < TODAY ? 'font-bold text-bad' : 'text-mute'}">${dateShort(b.arrival)}</span>` }))) || '<p class="text-sm text-mute">لا توجد حجوزات بانتظار الاستلام</p>',
        `<a href="#bookings" class="text-xs font-bold text-gold-700 hover:underline">إدارة الحجوزات</a>`));
    }

    const hour = new Date().getHours();
    v.innerHTML = pageHead(`${hour < 12 ? 'صباح الخير' : 'مساء الخير'}، ${esc(me.name.startsWith('د.') ? me.name.split(' ').slice(0, 2).join(' ') : me.name.split(' ')[0])}`, `${esc(r.label)} · صلاحياتك: ${r.perms.map((p) => D.MODULES.find((m) => m.key === p)?.label).join('، ') || '—'}`,
      can('bookings') ? `<button class="btn btn-gold" id="dash-new-booking">${icon('plus')} حجز جديد</button>` : '') +
      `<div class="grid gap-5 lg:grid-cols-2">${blocks.join('')}</div>`;

    if (can('finance')) {
      const months = monthsOfSeason();
      chart('ch-fin', {
        type: 'bar',
        data: { labels: months.map((m) => U.AR_MONTHS[m.m]), datasets: [
          { label: 'المدخول', data: months.map((m) => db.payments.filter((p) => p.date.startsWith(m.key)).reduce((s, p) => s + +p.amount, 0)), backgroundColor: '#223A63', borderRadius: 6, maxBarThickness: 26 },
          { label: 'المصروفات', data: months.map((m) => allExpenses().filter((e) => e.date.startsWith(m.key)).reduce((s, e) => s + +e.amount, 0)), backgroundColor: '#D6B26B', borderRadius: 6, maxBarThickness: 26 },
        ] },
        options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom', rtl: true, labels: { usePointStyle: true, boxWidth: 8 } }, tooltip: { rtl: true, callbacks: { label: (c) => `${c.dataset.label}: ${moneyTxt(c.raw)}` } } },
          scales: { x: { reverse: true, grid: { display: false } }, y: { position: 'right', grid: { color: '#EEF1F5' }, ticks: { callback: (x) => `${x / 1000}k` } } } },
      });
    }
    const nb = document.getElementById('dash-new-booking'); if (nb) nb.addEventListener('click', () => bookingModal());
  }

  const miniStat = (label, value, tone) => {
    const c = tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-gold-700' : tone === 'ok' ? 'text-ok' : 'text-navy';
    return `<div class="rounded-xl bg-paper px-3 py-2.5"><div class="text-[11px] font-bold text-mute">${label}</div><div class="mt-0.5 text-lg font-extrabold tabular-nums ${c}">${value}</div></div>`;
  };
  const listMini = (title, rows) => rows.length ? `${title ? `<div class="mt-4 mb-1 text-xs font-bold text-mute">${title}</div>` : ''}<ul class="divide-y divide-line">${rows.map((r) => `
    <li><a href="${r.href}" class="flex items-center justify-between gap-3 py-2 text-sm hover:text-gold-700"><span class="flex min-w-0 items-center gap-2"><b class="ltr shrink-0 text-navy">${esc(r.a)}</b><span class="truncate text-mute">${esc(r.b)}</span></span>${r.c || ''}</a></li>`).join('')}</ul>` : '';
  function monthsOfSeason() {
    const out = []; const s = new Date(S().season.start); const e = new Date(Math.min(new Date(S().season.end), new Date(TODAY)));
    for (let d = new Date(s.getFullYear(), s.getMonth(), 1); d <= e; d.setMonth(d.getMonth() + 1)) out.push({ key: `${d.getFullYear()}-${D.util.pad(d.getMonth() + 1, 2)}`, m: d.getMonth() });
    return out;
  }
  const ruleLabel = (lvl) => ({ mandatory: badge('إلزامي', 'bad'), warning: badge('تحذير', 'warn'), off: badge('معطّل', 'mute') }[lvl]);

  /* =========================================================
     Oiseaux
     ========================================================= */
  const BIRD_FILTERS = [
    { key: 'all', label: 'الكل' },
    { key: 'treat', label: 'تحت العلاج', fn: (b) => b.health === 'تحت العلاج' },
    { key: 'ok', label: 'سليم', fn: (b) => b.health === 'سليم' },
    { key: 'check', label: 'يحتاج فحص', fn: (b) => b.health === 'يحتاج فحص' },
    { key: 'near', label: 'قرب انتهاء المدة', fn: nearEnd },
    { key: 'vac', label: 'تحصين مستحق', fn: vacDue },
    { key: 'due', label: 'مبلغ مستحق', fn: (b) => birdBalance(b) > 0, fin: true },
    { key: 'tunpaid', label: 'علاج غير مسدد', fn: unpaidTreatment, fin: true },
  ];
  let birdState = { filter: 'all', status: 'active', q: '' };

  function viewBirds(v) {
    const filters = BIRD_FILTERS.filter((f) => !f.fin || can('finance') || isAdmin());
    v.innerHTML = pageHead('الطيور', 'ملف إلكتروني لكل طائر · الحلقة هي المفتاح الأساسي',
      `${can('bookings') ? `<button class="btn btn-gold" id="b-new">${icon('plus')} حجز جديد</button>` : ''}`) + `
      <div class="card">
        <div class="flex flex-col gap-3 border-b border-line p-4">
          <div class="flex flex-wrap items-center gap-3">
            <div class="relative w-full max-w-xs"><span class="pointer-events-none absolute inset-y-0 start-3 grid place-items-center text-mute">${icon('search')}</span>
              <input id="b-q" type="search" class="input ps-10" placeholder="رقم الحلقة، المالك، الجوال" value="${esc(birdState.q)}"></div>
            ${segmented('b-status', [{ value: 'active', label: 'في الإقامة' }, { value: 'exited', label: 'خرجت' }, { value: 'all', label: 'الكل' }], birdState.status)}
          </div>
          <div class="flex flex-wrap items-center gap-2"><span class="text-xs font-bold text-mute">مرشحات سريعة:</span>
            ${filters.map((f) => `<button type="button" class="chip" data-f="${f.key}" aria-pressed="${birdState.filter === f.key}">${f.label} <span class="opacity-60 tabular-nums">${num(f.fn ? db.birds.filter((b) => (birdState.status === 'all' || b.status === birdState.status) && f.fn(b)).length : db.birds.filter((b) => birdState.status === 'all' || b.status === birdState.status).length)}</span></button>`).join('')}
          </div>
        </div>
        <div id="b-table" class="p-4"></div>
      </div>`;
    const cols = [
      { key: 'ring', label: 'الحلقة', render: (b) => `<b class="ltr text-navy">${esc(b.ring)}</b>` },
      { key: 'species', label: 'النوع', render: (b) => `${esc(b.species)} <span class="text-xs text-mute">· ${esc(b.sex)}</span>` },
      { key: 'owner', label: 'المالك', sort: (b) => owner(b.ownerId).name, render: (b) => `${esc(owner(b.ownerId).name)}${owner(b.ownerId).vip ? ' ' + icon('star', 'size-3.5 inline text-gold fill-gold') : ''}` },
      { key: 'entryDate', label: 'الدخول', render: (b) => dateShort(b.entryDate) },
      { key: 'day', label: 'اليوم X من N', sort: (b) => stayDay(b) / stayLen(b), render: (b) => `<div class="w-28"><div class="mb-1 text-xs tabular-nums text-mute">${b.status === 'exited' ? 'خرج ' + dateShort(b.exitDate) : `اليوم ${stayDay(b)} من ${stayLen(b)}`}</div>${progress((stayDay(b) / stayLen(b)) * 100, nearEnd(b) ? 'gold' : 'navy')}</div>` },
      { key: 'health', label: 'الحالة الصحية', render: (b) => healthBadge(b.health) },
      { key: 'vac', label: 'التحصين', sort: (b) => b.vaccines.length, render: (b) => vacDue(b) ? badge(`${b.vaccines.length}/${S().vacProgram.doses} مستحق`, 'warn') : `<span class="text-xs tabular-nums text-mute">${b.vaccines.length}/${S().vacProgram.doses}</span>` },
    ];
    if (can('finance') || isAdmin()) cols.push({ key: 'bal', label: 'المتبقي', sort: birdBalance, render: (b) => { const x = birdBalance(b); return x > 0 ? `<b class="text-bad">${money(x)}</b>` : `<span class="text-ok">${icon('check', 'size-4 inline')} مسدد</span>`; } });

    const rowsNow = () => {
      const f = BIRD_FILTERS.find((x) => x.key === birdState.filter);
      const q = birdState.q.trim().toLowerCase();
      return db.birds.filter((b) => (birdState.status === 'all' || b.status === birdState.status) && (!f.fn || f.fn(b)) &&
        (!q || b.ring.toLowerCase().includes(q) || owner(b.ownerId).name.toLowerCase().includes(q) || owner(b.ownerId).phone.replace(/\s/g, '').includes(q.replace(/\s/g, ''))));
    };
    const t = dataTable(document.getElementById('b-table'), { columns: cols, rows: rowsNow(), onRow: (b) => go(`bird-${b.id}`), empty: 'لا توجد طيور مطابقة للمرشحات' });
    document.getElementById('b-q').addEventListener('input', (e) => { birdState.q = e.target.value; t.redraw(rowsNow()); });
    v.querySelectorAll('[data-f]').forEach((c) => c.addEventListener('click', () => { birdState.filter = c.dataset.f; viewBirds(v); icons(); }));
    v.querySelectorAll('input[name=b-status]').forEach((r) => r.addEventListener('change', () => { birdState.status = r.value; viewBirds(v); icons(); }));
    const nb = document.getElementById('b-new'); if (nb) nb.addEventListener('click', () => bookingModal());
  }

  /* ---------- Fiche oiseau ---------- */
  let birdTab = 'profile';
  function viewBird(v, r) {
    const b = bird(r.id);
    if (!b) { v.innerHTML = pageHead('طائر غير موجود', '') + `<a href="#birds" class="btn btn-ghost">${icon('arrow-right')} العودة إلى الطيور</a>`; return; }
    const o = owner(b.ownerId);
    const showFin = can('finance') || isAdmin();
    const tabs = [
      { k: 'profile', l: 'الملف' }, { k: 'timeline', l: 'الخط الزمني' }, { k: 'health', l: 'الصحة والعلاج' },
      { k: 'vac', l: 'التحصينات' }, { k: 'weight', l: 'الوزن والانسلاخ' }, ...(showFin ? [{ k: 'account', l: 'الحساب' }] : []),
    ];
    if (!tabs.find((t) => t.k === birdTab)) birdTab = 'profile';
    const actions = [
      b.status === 'active' ? `<button class="btn btn-ghost btn-sm" data-act="weight">${icon('scale')} تسجيل وزن</button>` : '',
      can('health') && b.status === 'active' ? `<button class="btn btn-ghost btn-sm" data-act="treat">${icon('stethoscope')} تسجيل علاج</button><button class="btn btn-ghost btn-sm" data-act="vac">${icon('syringe')} تسجيل تحصين</button>` : '',
      (can('bookings') || can('delivery')) && b.status === 'active' ? `<button class="btn btn-ghost btn-sm" data-act="deliv">${icon('truck')} طلب توصيل</button>` : '',
      can('finance') ? `<button class="btn btn-ghost btn-sm" data-act="pay">${icon('banknote')} تسجيل دفعة</button>` : '',
      can('bookings') && b.status === 'active' ? `<button class="btn btn-primary btn-sm" data-act="exit">${icon('door-open')} خروج الطائر</button>` : '',
    ].join('');
    v.innerHTML = `
      <a href="#birds" class="mb-4 inline-flex items-center gap-1 text-sm font-bold text-mute hover:text-navy">${icon('arrow-right')} الطيور</a>
      <section class="card overflow-hidden">
        <div class="ring-pattern flex flex-wrap items-start gap-5 bg-navy p-5 text-white sm:p-6">
          <div class="grid size-16 shrink-0 place-items-center rounded-2xl bg-gold/15 ring-1 ring-gold/40">${icon('bird', 'size-8 text-gold')}</div>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2"><h1 class="ltr text-3xl font-extrabold">${esc(b.ring)}</h1>${healthBadge(b.health)}${b.status === 'exited' ? badge('خرج', 'mute') : badge('في الإقامة', 'gold')}${nearEnd(b) ? badge('قرب انتهاء المدة', 'warn', 'clock') : ''}${vacDue(b) ? badge('تحصين مستحق', 'warn', 'syringe') : ''}</div>
            <p class="mt-1 text-sm text-white/70">${esc(b.species)} · ${esc(b.sex)} · ${b.age} سنوات · معرّف الإقامة <span class="ltr">#${esc(b.stayId)}</span></p>
            <button type="button" class="mt-2 inline-flex items-center gap-1.5 text-sm font-bold text-gold hover:underline" data-act="owner">${icon('user-round', 'size-4')} ${esc(o.name)}${o.vip ? ' · عميل مميز' : ''}</button>
          </div>
          <div class="w-full rounded-xl bg-white/5 p-3 ring-1 ring-white/10 sm:w-64">
            <div class="flex items-baseline justify-between text-sm"><span class="text-white/70">مدة الإقامة</span><b class="tabular-nums">${b.status === 'exited' ? 'منتهية' : `اليوم ${stayDay(b)} من ${stayLen(b)}`}</b></div>
            <div class="mt-2 h-2 overflow-hidden rounded-full bg-white/10"><div class="h-full rounded-full bg-gold" style="width:${Math.min(100, (stayDay(b) / stayLen(b)) * 100)}%"></div></div>
            <div class="mt-2 flex justify-between text-xs text-white/60"><span>${dateShort(b.entryDate)}</span><span>${dateShort(b.exitDate || b.endDate)}</span></div>
          </div>
        </div>
        ${actions ? `<div class="flex flex-wrap gap-2 border-b border-line bg-paper/60 px-5 py-3">${actions}</div>` : ''}
        <div class="flex gap-5 overflow-x-auto border-b border-line px-5 pt-3" role="tablist">${tabs.map((t) => `<button role="tab" class="tab whitespace-nowrap" data-tab="${t.k}" aria-selected="${birdTab === t.k}">${t.l}</button>`).join('')}</div>
        <div id="bird-tab" class="p-5"></div>
      </section>`;
    v.querySelectorAll('[data-tab]').forEach((t) => t.addEventListener('click', () => { birdTab = t.dataset.tab; viewBird(v, r); icons(); }));
    v.querySelectorAll('[data-act]').forEach((btn) => btn.addEventListener('click', () => {
      const a = btn.dataset.act;
      if (a === 'owner') ownerModal(o);
      if (a === 'weight') weightModal(b);
      if (a === 'treat') treatmentModal(b);
      if (a === 'vac') vaccineModal(b);
      if (a === 'deliv') deliveryModal(b);
      if (a === 'pay') paymentModal({ ownerId: b.ownerId, birdId: b.id });
      if (a === 'exit') exitModal(b);
    }));
    renderBirdTab(b);
  }

  function renderBirdTab(b) {
    const el = document.getElementById('bird-tab');
    const o = owner(b.ownerId);
    const dl = (rows) => `<div>${rows.map(([k, val]) => `<div class="dl-row"><span class="text-mute">${k}</span><span class="text-end font-bold text-navy">${val}</span></div>`).join('')}</div>`;
    if (birdTab === 'profile') {
      el.innerHTML = `<div class="grid gap-6 md:grid-cols-2">
        <div><h3 class="mb-2 text-sm font-extrabold text-gold-700">بيانات الطائر</h3>${dl([
          ['رقم الحلقة (المفتاح الأساسي)', `<span class="ltr">${esc(b.ring)}</span>`], ['جواز الصقر', `<span class="ltr">${esc(b.passport)}</span>`],
          ['الشريحة (Microchip)', `<span class="ltr">${esc(b.chip)}</span>`], ['مرجع CITES', b.cites ? `<span class="ltr">${esc(b.cites)}</span>` : '<span class="text-mute">غير مسجل</span>'],
          ['النوع والجنس', `${esc(b.species)} · ${esc(b.sex)}`], ['العمر', `${b.age} سنوات`],
          ['آخر وزن', `${num(b.weights[b.weights.length - 1]?.g)} غ`], ['الموظف المسؤول', esc(staff(b.staffId)?.name || '—')]])}</div>
        <div><h3 class="mb-2 text-sm font-extrabold text-gold-700">المالك والإقامة</h3>${dl([
          ['المالك', `${esc(o.name)} ${o.vip ? badge('عميل مميز', 'gold', 'star') : ''}`], ['الجوال', `<span class="ltr">${esc(o.phone)}</span>`],
          ['الموقع', esc(o.area)], ['تاريخ الدخول', date(b.entryDate)], ['نهاية المدة', date(b.endDate)],
          ['تاريخ الخروج', b.exitDate ? date(b.exitDate) : '—'], ['قادم من عيادة', b.fromClinic ? 'نعم' : 'لا'], ['فحص الاستلام', `${esc(b.intakeExam.result)} · ${dateShort(b.intakeExam.date)}`]])}</div>
      </div>`;
    }
    if (birdTab === 'timeline') {
      const ev = [{ d: b.entryDate, t: 'دخول الطائر وفتح الإقامة', s: `#${b.stayId}`, ic: 'log-in' }, { d: b.intakeExam.date, t: 'فحص الاستلام', s: b.intakeExam.result, ic: 'clipboard-check' }];
      b.vaccines.forEach((x) => ev.push({ d: x.date, t: `التحصين ${x.dose === 1 ? 'الأول' : x.dose === 2 ? 'الثاني' : x.dose}`, s: `${x.name} · ${x.clinic}`, ic: 'syringe' }));
      birdTreatments(b).forEach((x) => ev.push({ d: x.date, t: `علاج: ${x.disease}`, s: `${x.clinic} · ${x.doctor}`, ic: 'stethoscope' }));
      db.deliveries.filter((x) => x.birdId === b.id).forEach((x) => ev.push({ d: x.date, t: `توصيل (${x.direction})`, s: x.status, ic: 'truck' }));
      if (b.exitDate) ev.push({ d: b.exitDate, t: 'الخروج وإغلاق الحساب', s: '', ic: 'door-open' });
      ev.sort((a, c) => a.d.localeCompare(c.d));
      el.innerHTML = `<ol class="relative ms-3 border-s-2 border-line">${ev.map((x) => `
        <li class="mb-5 ms-6"><span class="absolute -start-[17px] grid size-8 place-items-center rounded-full bg-white ring-2 ring-gold">${icon(x.ic, 'size-4 text-navy')}</span>
          <div class="text-xs font-bold text-gold-700">${date(x.d)}</div><div class="font-bold text-navy">${esc(x.t)}</div>${x.s ? `<div class="text-sm text-mute">${esc(x.s)}</div>` : ''}</li>`).join('')}</ol>`;
    }
    if (birdTab === 'health') {
      const ts = birdTreatments(b);
      el.innerHTML = `<div class="mb-4 flex flex-wrap items-center gap-3 rounded-xl bg-paper p-3 text-sm"><span class="text-mute">الحالة الصحية الحالية:</span>${healthBadge(b.health)}
        ${can('health') && b.health !== 'سليم' ? `<button class="btn btn-ghost btn-sm ms-auto" id="mark-ok">${icon('check')} تعيين كـ «سليم»</button>` : ''}</div>
        ${ts.length ? `<div class="grid gap-3">${ts.map((t) => `<div class="rounded-xl border border-line p-4">
          <div class="flex flex-wrap items-center justify-between gap-2"><b class="text-navy">${esc(t.disease)}</b><div class="flex gap-2">${badge(t.status, t.status === 'جاري' ? 'bad' : 'ok')}${(can('finance') || isAdmin()) ? badge(t.paid ? 'مسدد' : 'غير مسدد', t.paid ? 'ok' : 'warn') : ''}</div></div>
          <div class="mt-2 grid gap-1 text-sm text-mute sm:grid-cols-2"><span>${icon('calendar', 'size-3.5 inline')} ${date(t.date)} · ${t.days} أيام</span><span>${icon('hospital', 'size-3.5 inline')} ${esc(t.clinic)} · ${esc(t.doctor)}</span><span>${icon('pill', 'size-3.5 inline')} ${esc(t.meds)}</span><span>${icon('receipt', 'size-3.5 inline')} ${moneyTxt(t.cost)}</span></div>
          ${can('health') && t.status === 'جاري' ? `<button class="btn btn-ghost btn-sm mt-3" data-end="${t.id}">${icon('check-check')} إنهاء العلاج</button>` : ''}</div>`).join('')}</div>` : '<p class="py-6 text-center text-sm text-mute">لا يوجد سجل علاجي لهذا الطائر</p>'}`;
      const mo = document.getElementById('mark-ok'); if (mo) mo.addEventListener('click', () => { b.health = 'سليم'; log(`تعيين ${b.ring} كسليم`); persist(); toast('تم تحديث الحالة الصحية'); render(); });
      el.querySelectorAll('[data-end]').forEach((x) => x.addEventListener('click', () => { const t = db.treatments.find((y) => y.id === +x.dataset.end); t.status = 'منتهي'; t.endDate = TODAY; if (!birdTreatments(b).some((y) => y.status === 'جاري')) b.health = 'سليم'; log(`إنهاء علاج ${b.ring}`); persist(); toast('تم إنهاء العلاج'); render(); }));
    }
    if (birdTab === 'vac') {
      const n = S().vacProgram.doses;
      const steps = Array.from({ length: n }, (_, i) => b.vaccines[i]);
      el.innerHTML = `<div class="mb-2 flex items-baseline justify-between"><h3 class="font-extrabold text-navy">مسار التحصين</h3><span class="text-sm text-mute tabular-nums">التقدّم: ${b.vaccines.length} / ${n}</span></div>
        <ol class="grid gap-3 sm:grid-cols-${n + 1}">${steps.map((x, i) => `<li class="rounded-xl border ${x ? 'border-ok/30 bg-ok-100' : i === b.vaccines.length && vacDue(b) ? 'border-gold bg-gold-100' : 'border-line'} p-4">
          <div class="flex items-center gap-2"><span class="grid size-7 place-items-center rounded-full ${x ? 'bg-ok text-white' : 'bg-white text-navy ring-1 ring-line'} text-xs font-extrabold">${i + 1}</span><b class="text-navy">التحصين ${i === 0 ? 'الأول' : i === 1 ? 'الثاني' : i + 1}</b></div>
          <div class="mt-2 text-sm ${x ? 'text-ok' : 'text-mute'}">${x ? `تم · ${dateShort(x.date)}` : i === b.vaccines.length && vacDue(b) ? '<b class="text-gold-700">مستحق الآن</b>' : 'مجدول'}</div>${x ? `<div class="text-xs text-mute">${esc(x.name)}</div>` : ''}</li>`).join('')}
          <li class="rounded-xl border ${b.vaccines.length >= n ? 'border-ok/30 bg-ok-100' : 'border-dashed border-line'} p-4"><div class="flex items-center gap-2"><span class="grid size-7 place-items-center rounded-full ${b.vaccines.length >= n ? 'bg-ok text-white' : 'bg-white ring-1 ring-line'}">${icon('shield-check', 'size-4')}</span><b class="text-navy">البرنامج مكتمل</b></div></li>
        </ol>
        <p class="mt-4 text-xs text-mute">برنامج قياسي: ${n} حقن بفاصل ${S().vacProgram.intervalDays} يوماً · مهلة العلاج ← التحصين: ${S().vacDelayDays} يوماً (${{ mandatory: 'إلزامي', warning: 'تحذير', off: 'معطّل' }[S().rules.vacDelay]})</p>`;
    }
    if (birdTab === 'weight') {
      el.innerHTML = `<div class="grid gap-6 lg:grid-cols-[1.6fr_1fr]"><div class="h-72"><canvas id="ch-w" aria-label="منحنى تطور الوزن"></canvas></div>
        <div><h3 class="mb-2 font-extrabold text-navy">تتبع الانسلاخ</h3><div class="mb-1 flex justify-between text-sm"><span class="text-mute">نسبة تبديل الريش</span><b class="tabular-nums text-navy">${b.molt}%</b></div>${progress(b.molt, 'gold')}
        <div class="mt-4 grid grid-cols-3 gap-2">${[0, 1, 2].map((i) => `<div class="grid aspect-square place-items-center rounded-xl bg-paper text-center text-xs text-mute ring-1 ring-line">${icon('image', 'size-5 mx-auto mb-1')}<span>صورة ${dateShort(D.util.iso(D.util.addDays(b.entryDate, 30 * (i + 1))))}</span></div>`).join('')}</div>
        <p class="mt-2 text-xs text-mute">صور مؤرخة لمراحل الانسلاخ</p></div></div>`;
      chart('ch-w', { type: 'line', data: { labels: b.weights.map((w) => dateShort(w.date)), datasets: [{ label: 'الوزن (غ)', data: b.weights.map((w) => w.g), borderColor: '#223A63', backgroundColor: 'rgba(214,178,107,.18)', fill: true, tension: 0.35, pointRadius: b.weights.map((_, i) => (i === b.weights.length - 1 ? 5 : 2)), pointBackgroundColor: '#D6B26B' }] },
        options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { rtl: true } }, scales: { x: { reverse: true, grid: { display: false }, ticks: { maxTicksLimit: 8 } }, y: { position: 'right', grid: { color: '#EEF1F5' } } } } });
    }
    if (birdTab === 'account') {
      const c = birdCharges(b), paid = birdPaid(b);
      const pays = db.payments.filter((p) => p.birdId === b.id);
      el.innerHTML = `<div class="grid gap-6 md:grid-cols-2"><div class="rounded-xl bg-paper p-4">
        ${[['قيمة المقيض', c.stay, '+'], ['تكاليف العلاج', c.treat, '+'], ['التحصينات', c.vac, '+'], ['رسوم التوصيل', c.deliv, '+']].map(([k, val]) => `<div class="dl-row"><span class="text-mute">${k}</span><span class="font-bold tabular-nums">${money(val)}</span></div>`).join('')}
        <div class="dl-row border-solid"><span class="font-extrabold text-navy">= الإجمالي المستحق</span><b class="text-navy">${money(c.total)}</b></div>
        <div class="dl-row"><span class="text-mute">− المحصّل</span><b class="text-ok">${money(paid)}</b></div>
        <div class="mt-2 flex items-center justify-between rounded-lg ${c.total - paid > 0 ? 'bg-bad-100 text-bad' : 'bg-ok-100 text-ok'} px-3 py-2"><span class="font-extrabold">= المتبقي</span><b class="text-lg">${money(c.total - paid)}</b></div></div>
        <div><h3 class="mb-2 font-extrabold text-navy">الدفعات المسجلة</h3>${pays.length ? `<ul class="divide-y divide-line text-sm">${pays.map((p) => `<li class="flex items-center justify-between gap-2 py-2"><span><b class="ltr text-navy">${p.receipt}</b> · ${esc(p.type)} · <span class="text-mute">${esc(p.method)}</span></span><span class="text-end"><b>${money(p.amount)}</b><br><span class="text-xs text-mute">${dateShort(p.date)}</span></span></li>`).join('')}</ul>` : '<p class="text-sm text-mute">لا توجد دفعات</p>'}</div></div>`;
    }
    icons();
  }

  /* ---------- Modales liées à l'oiseau ---------- */
  function weightModal(b) {
    modal({ title: `تسجيل وزن · <span class="ltr">${esc(b.ring)}</span>`, size: 'sm',
      body: `<form id="f" class="grid gap-4">${field({ id: 'g', label: 'الوزن (غرام)', type: 'number', required: true, min: 200, max: 3000, value: b.weights[b.weights.length - 1]?.g })}${field({ id: 'molt', label: 'نسبة الانسلاخ %', type: 'number', min: 0, max: 100, value: b.molt })}${field({ id: 'd', label: 'التاريخ', type: 'date', value: TODAY, required: true })}</form>`,
      footer: `<button class="btn btn-ghost" data-close>إلغاء</button><button class="btn btn-primary" form="f">حفظ</button>`,
      onMount: (r) => r.querySelector('#f').addEventListener('submit', (e) => { e.preventDefault(); const f = formData(e.target); b.weights.push({ date: f.d, g: +f.g }); b.weights.sort((a, c) => a.date.localeCompare(c.date)); b.molt = +f.molt; log(`تسجيل وزن ${b.ring}: ${f.g} غ`); persist(); closeModal(); toast('تم حفظ الوزن'); render(); }) });
  }

  const birdPicker = (id, b) => b ? `<input type="hidden" name="${id}" value="${esc(b.ring)}"><div class="rounded-xl bg-paper px-3 py-2.5 text-sm"><span class="text-mute">الطائر:</span> <b class="ltr text-navy">${esc(b.ring)}</b> · ${esc(owner(b.ownerId).name)}</div>` :
    `${field({ id, label: 'رقم الحلقة', required: true, placeholder: 'QA-0001' })}<datalist id="rings">${activeBirds().slice(0, 400).map((x) => `<option value="${x.ring}">`).join('')}</datalist>`;

  function treatmentModal(b) {
    const cl = S().clinics;
    modal({ title: 'تسجيل علاج', size: 'md',
      body: `<form id="f" class="grid gap-4 sm:grid-cols-2"><div class="sm:col-span-2">${birdPicker('ring', b)}</div>
        ${field({ id: 'disease', label: 'المرض / التشخيص', required: true, placeholder: 'مثال: التهاب الجهاز التنفسي' })}
        ${field({ id: 'date', label: 'التاريخ', type: 'date', value: TODAY, required: true })}
        ${field({ id: 'clinic', label: 'العيادة', type: 'select', options: cl.map((c) => c.name) })}
        ${field({ id: 'doctor', label: 'الطبيب', type: 'select', options: [...new Set(cl.flatMap((c) => c.doctors))] })}
        ${field({ id: 'meds', label: 'العلاج والأدوية', required: true, cls: 'sm:col-span-2' })}
        ${field({ id: 'days', label: 'أيام العلاج', type: 'number', min: 1, value: 7, required: true })}
        ${field({ id: 'cost', label: 'التكلفة (ر.ق)', type: 'number', min: 0, value: 300, required: true, hint: 'تُضاف إلى حساب الطائر وتُسجَّل مصروفاً تلقائياً' })}</form>`,
      footer: `<button class="btn btn-ghost" data-close>إلغاء</button><button class="btn btn-primary" form="f">${icon('save')} حفظ العلاج</button>`,
      onMount: (r) => {
        const inp = r.querySelector('#ring'); if (inp) inp.setAttribute('list', 'rings');
        r.querySelector('#f').addEventListener('submit', (e) => {
          e.preventDefault(); const f = formData(e.target); const tb = b || birdByRing(f.ring);
          if (!tb || tb.status !== 'active') return toast('رقم الحلقة غير موجود ضمن الطيور المقيمة', 'bad');
          db.treatments.push({ id: Math.max(0, ...db.treatments.map((t) => t.id)) + 1, birdId: tb.id, disease: f.disease, date: f.date, clinic: f.clinic, doctor: f.doctor, meds: f.meds, days: +f.days, cost: +f.cost, status: 'جاري', paid: false });
          tb.health = 'تحت العلاج'; log(`تسجيل علاج للطائر ${tb.ring}: ${f.disease}`); persist(); closeModal(); toast(`تم تسجيل العلاج للطائر <b class="ltr">${tb.ring}</b>`); render();
        });
      } });
  }

  function vaccineModal(b) {
    modal({ title: 'تسجيل تحصين', size: 'md',
      body: `<form id="f" class="grid gap-4 sm:grid-cols-2"><div class="sm:col-span-2">${birdPicker('ring', b)}</div>
        ${field({ id: 'name', label: 'اسم اللقاح', value: 'لقاح نيوكاسل (PMV-1)', required: true })}
        ${field({ id: 'date', label: 'التاريخ', type: 'date', value: TODAY, required: true })}
        ${field({ id: 'clinic', label: 'العيادة', type: 'select', options: S().clinics.map((c) => c.name), value: S().clinics[2]?.name })}
        ${field({ id: 'cost', label: 'التكلفة (ر.ق)', type: 'number', min: 0, value: S().vaccineCost })}
        <div id="rule-msg" class="sm:col-span-2"></div></form>`,
      footer: `<button class="btn btn-ghost" data-close>إلغاء</button><button class="btn btn-primary" form="f">${icon('syringe')} حفظ التحصين</button>`,
      onMount: (r) => {
        const inp = r.querySelector('#ring'); if (inp) inp.setAttribute('list', 'rings');
        r.querySelector('#f').addEventListener('submit', (e) => {
          e.preventDefault(); const f = formData(e.target); const tb = b || birdByRing(f.ring);
          if (!tb || tb.status !== 'active') return toast('رقم الحلقة غير موجود ضمن الطيور المقيمة', 'bad');
          if (tb.vaccines.length >= S().vacProgram.doses) return toast('برنامج التحصين مكتمل لهذا الطائر', 'warn');
          // Règle : délai entre traitement et vaccination
          const lastT = birdTreatments(tb).sort((a, c) => c.date.localeCompare(a.date))[0];
          const lvl = S().rules.vacDelay;
          if (lastT && lvl !== 'off') {
            const endT = lastT.endDate || D.util.iso(D.util.addDays(lastT.date, lastT.days));
            const gap = daysBetween(endT, f.date);
            if (lastT.status === 'جاري' || gap < S().vacDelayDays) {
              const msg = `لم تنقضِ مهلة ${S().vacDelayDays} يوماً بين العلاج والتحصين (آخر علاج: ${lastT.disease}).`;
              if (lvl === 'mandatory') { r.querySelector('#rule-msg').innerHTML = `<div class="flex gap-2 rounded-xl bg-bad-100 p-3 text-sm text-bad">${icon('octagon-x', 'size-4 mt-0.5 shrink-0')}<span><b>قاعدة إلزامية:</b> ${msg}</span></div>`; icons(); return; }
              toast(`<b>تحذير:</b> ${msg}`, 'warn');
            }
          }
          tb.vaccines.push({ dose: tb.vaccines.length + 1, name: f.name, date: f.date, clinic: f.clinic, cost: +f.cost });
          log(`تسجيل التحصين ${tb.vaccines.length} للطائر ${tb.ring}`); persist(); closeModal(); toast(`تم تسجيل التحصين ${tb.vaccines.length}/${S().vacProgram.doses}`); render();
        });
      } });
  }

  function exitModal(b) {
    const bal = birdBalance(b);
    modal({ title: `خروج الطائر · <span class="ltr">${esc(b.ring)}</span>`, size: 'sm',
      body: `<form id="f" class="grid gap-4">${field({ id: 'date', label: 'تاريخ الخروج', type: 'date', value: TODAY, required: true })}
        ${field({ id: 'reason', label: 'سبب الخروج', type: 'select', options: ['انتهاء المدة', 'خروج مبكر بطلب المالك', 'متوفى'] })}
        ${bal > 0 ? `<div class="flex gap-2 rounded-xl bg-gold-100 p-3 text-sm text-gold-700">${icon('triangle-alert', 'size-4 mt-0.5 shrink-0')}<span>يوجد مبلغ متبقٍ على المالك: <b>${moneyTxt(bal)}</b>. يمكن تسجيل الخروج مع بقاء المبلغ مستحقاً.</span></div>` : `<div class="rounded-xl bg-ok-100 p-3 text-sm text-ok">الحساب مسدد بالكامل.</div>`}</form>`,
      footer: `<button class="btn btn-ghost" data-close>إلغاء</button><button class="btn btn-primary" form="f">تأكيد الخروج</button>`,
      onMount: (r) => r.querySelector('#f').addEventListener('submit', (e) => { e.preventDefault(); const f = formData(e.target); b.status = 'exited'; b.exitDate = f.date; b.exitReason = f.reason; if (f.reason === 'متوفى') b.health = 'متوفى'; log(`خروج الطائر ${b.ring} (${f.reason}) وتحرير المكان`); persist(); closeModal(); toast('تم تسجيل الخروج وتحرير المكان'); render(); }) });
  }

  /* =========================================================
     Propriétaires
     ========================================================= */
  function viewOwners(v) {
    const fin = can('finance') || isAdmin();
    v.innerHTML = pageHead('الملاك', 'المالك كيان دائم يتراكم عبر المواسم: طيوره وحسابه وتاريخه', can('bookings') ? `<button class="btn btn-gold" id="o-new">${icon('user-plus')} مالك جديد</button>` : '') +
      `<div class="card"><div class="border-b border-line p-4"><div class="relative max-w-xs"><span class="pointer-events-none absolute inset-y-0 start-3 grid place-items-center text-mute">${icon('search')}</span><input id="o-q" type="search" class="input ps-10" placeholder="الاسم أو الجوال أو المنطقة"></div></div><div id="o-t" class="p-4"></div></div>`;
    const cols = [
      { key: 'name', label: 'المالك', render: (o) => `<b class="text-navy">${esc(o.name)}</b> ${o.vip ? badge('عميل مميز', 'gold', 'star') : ''} ${!o.active ? badge('مؤرشف', 'mute') : ''}` },
      { key: 'area', label: 'الموقع' },
      { key: 'phone', label: 'الجوال', render: (o) => `<span class="ltr">${esc(o.phone)}</span>` },
      { key: 'nb', label: 'الطيور', sort: (o) => ownerBirds(o).length, render: (o) => `<span class="tabular-nums">${ownerBirds(o).filter((b) => b.status === 'active').length} / ${ownerBirds(o).length}</span>` },
      { key: 'seasons', label: 'المواسم', render: (o) => `<span class="tabular-nums">${o.seasons}</span>` },
    ];
    if (fin) cols.push({ key: 'bal', label: 'المتبقي', sort: (o) => ownerAccount(o).balance, render: (o) => { const x = ownerAccount(o).balance; return x > 0 ? `<b class="text-bad">${money(x)}</b>` : `<span class="text-ok">مسدد</span>`; } });
    const rows = () => { const q = (document.getElementById('o-q')?.value || '').trim().toLowerCase(); return db.owners.filter((o) => !q || o.name.toLowerCase().includes(q) || o.area.includes(q) || o.phone.replace(/\s/g, '').includes(q.replace(/\s/g, ''))); };
    const t = dataTable(document.getElementById('o-t'), { columns: cols, rows: rows(), onRow: (o) => ownerModal(o) });
    document.getElementById('o-q').addEventListener('input', () => t.redraw(rows()));
    const n = document.getElementById('o-new'); if (n) n.addEventListener('click', () => ownerFormModal());
  }

  function ownerModal(o) {
    const acc = ownerAccount(o), fin = can('finance') || isAdmin();
    const bs = ownerBirds(o);
    modal({ title: `${esc(o.name)} ${o.vip ? badge('عميل مميز', 'gold', 'star') : ''}`, size: 'lg',
      body: `<div class="grid gap-6 md:grid-cols-2"><div>
        <h4 class="mb-2 text-sm font-extrabold text-gold-700">بيانات المالك</h4>
        ${[['الجوال', `<span class="ltr">${esc(o.phone)}</span>`], ['البريد', `<span class="ltr">${esc(o.email)}</span>`], ['الموقع', esc(o.area)], ['الهوية', `<span class="ltr">${esc(o.qid)}</span>`], ['الجنسية', esc(o.nationality)], ['سجل الحجوزات', `${o.seasons} مواسم`]].map(([k, val]) => `<div class="dl-row"><span class="text-mute">${k}</span><span class="font-bold text-navy">${val}</span></div>`).join('')}
        <h4 class="mb-2 mt-5 text-sm font-extrabold text-gold-700">الطيور (${bs.length})</h4>
        <ul class="divide-y divide-line text-sm">${bs.map((b) => `<li class="flex items-center justify-between py-2">${can('birds') ? `<a href="#bird-${b.id}" data-close class="font-bold text-navy hover:text-gold-700 ltr">${esc(b.ring)}</a>` : `<b class="ltr">${esc(b.ring)}</b>`}<span class="text-mute">${esc(b.species)}</span>${b.status === 'active' ? healthBadge(b.health) : badge('خرج', 'mute')}</li>`).join('') || '<li class="py-2 text-mute">لا توجد طيور</li>'}</ul></div>
        ${fin ? `<div><h4 class="mb-2 text-sm font-extrabold text-gold-700">الحساب المالي للمالك</h4><div class="rounded-xl bg-paper p-4">
          ${[['قيمة المقيض (حسب عدد الطيور)', acc.stay], ['+ تكاليف العلاج والتحصينات', acc.treat], ['+ رسوم التوصيل', acc.deliv]].map(([k, val]) => `<div class="dl-row"><span class="text-mute">${k}</span><span class="font-bold">${money(val)}</span></div>`).join('')}
          <div class="dl-row"><span class="font-extrabold text-navy">= الإجمالي المستحق</span><b>${money(acc.total)}</b></div><div class="dl-row"><span class="text-mute">− المحصّل</span><b class="text-ok">${money(acc.paid)}</b></div>
          <div class="mt-2 flex items-center justify-between rounded-lg ${acc.balance > 0 ? 'bg-bad-100 text-bad' : 'bg-ok-100 text-ok'} px-3 py-2"><b>= المتبقي على المالك</b><b class="text-lg">${money(acc.balance)}</b></div></div></div>` : ''}</div>`,
      footer: `${isAdmin() || can('bookings') ? `<button class="btn btn-ghost" id="o-vip">${icon('star')} ${o.vip ? 'إزالة شارة التميز' : 'عميل مميز'}</button><button class="btn btn-ghost" id="o-arch">${icon('archive')} ${o.active ? 'أرشفة' : 'إعادة تفعيل'}</button>` : ''}
        ${can('finance') ? `<button class="btn btn-primary" id="o-pay">${icon('banknote')} تسجيل دفعة</button>` : ''}<button class="btn btn-ghost" data-close>إغلاق</button>`,
      onMount: (r) => {
        r.querySelector('#o-vip')?.addEventListener('click', () => { o.vip = !o.vip; log(`تحديث شارة التميز: ${o.name}`); persist(); closeModal(); toast('تم التحديث'); render(); });
        r.querySelector('#o-arch')?.addEventListener('click', () => { o.active = !o.active; log(`${o.active ? 'تفعيل' : 'أرشفة'} المالك ${o.name}`); persist(); closeModal(); toast(o.active ? 'تمت إعادة التفعيل' : 'تمت الأرشفة مع بقاء السجل'); render(); });
        r.querySelector('#o-pay')?.addEventListener('click', () => paymentModal({ ownerId: o.id }));
      } });
  }

  function ownerFormModal(after) {
    modal({ title: 'مالك جديد', size: 'md',
      body: `<form id="f" class="grid gap-4 sm:grid-cols-2">${field({ id: 'name', label: 'الاسم الكامل', required: true, cls: 'sm:col-span-2' })}${field({ id: 'phone', label: 'الجوال', required: true, placeholder: '+974 …' })}${field({ id: 'email', label: 'البريد الإلكتروني', type: 'email' })}${field({ id: 'area', label: 'الموقع', type: 'select', options: ['الدوحة', 'الوكرة', 'الريان', 'الخور', 'أم صلال', 'الشمال', 'لوسيل', 'الشحانية'] })}${field({ id: 'qid', label: 'رقم الهوية' })}${field({ id: 'nationality', label: 'الجنسية', value: 'قطري' })}</form>`,
      footer: `<button class="btn btn-ghost" data-close>إلغاء</button><button class="btn btn-primary" form="f">حفظ</button>`,
      onMount: (r) => r.querySelector('#f').addEventListener('submit', (e) => {
        e.preventDefault(); const f = formData(e.target);
        const o = { id: Math.max(...db.owners.map((x) => x.id)) + 1, name: f.name, phone: f.phone, email: f.email, area: f.area, qid: f.qid, nationality: f.nationality, vip: false, active: true, seasons: 1 };
        db.owners.push(o); log(`إضافة المالك ${o.name}`); persist(); closeModal(); toast('تم إضافة المالك'); after ? after(o) : render();
      }) });
  }

  /* =========================================================
     Réservations, réception & capacité
     ========================================================= */
  let bookTab = 'pending';
  function viewBookings(v) {
    const occ = occupied(), cap = capacity();
    const pend = db.bookings.filter((b) => b.status === 'pending');
    v.innerHTML = pageHead('الحجوزات والاستلام', 'حجز ← استلام وفحص ← إقامة نشطة', `<button class="btn btn-gold" id="bk-new">${icon('plus')} حجز جديد</button>`) + `
      <div class="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        ${kpi({ label: 'الأماكن المشغولة', value: `${num(occ)} / ${num(cap)}`, sub: `${((occ / cap) * 100).toFixed(1)}% من الطاقة`, ic: 'warehouse' })}
        ${kpi({ label: 'الأماكن المتاحة', value: num(cap - occ), ic: 'square-dashed', tone: 'ok' })}
        ${kpi({ label: 'بانتظار الاستلام', value: num(pend.length), sub: `${pend.filter((b) => b.arrival < TODAY).length} متأخر`, ic: 'calendar-clock', tone: 'gold' })}
        ${kpi({ label: 'العربون المحصّل', value: moneyTxt(db.payments.filter((p) => p.type === 'عربون' && !p.birdId).reduce((s, p) => s + p.amount, 0)), sub: 'حجوزات لم تُستلم بعد', ic: 'hand-coins', tone: 'gold' })}
      </div>
      <div class="card"><div class="flex gap-5 overflow-x-auto border-b border-line px-5 pt-3" role="tablist">
        ${[['pending', 'بانتظار الاستلام'], ['checked_in', 'تم الاستلام'], ['rejected', 'مرفوضة / ملغاة']].map(([k, l]) => `<button role="tab" class="tab whitespace-nowrap" data-t="${k}" aria-selected="${bookTab === k}">${l}</button>`).join('')}
      </div><div id="bk-t" class="p-4"></div></div>`;
    const rows = db.bookings.filter((b) => b.status === bookTab).sort((a, b) => (bookTab === 'pending' ? a.arrival.localeCompare(b.arrival) : b.arrival.localeCompare(a.arrival)));
    const cols = [
      { key: 'id', label: 'رقم الحجز', render: (b) => `<b class="ltr text-navy">#${esc(b.id)}</b>` },
      { key: 'owner', label: 'المالك', sort: (b) => owner(b.ownerId).name, render: (b) => esc(owner(b.ownerId).name) },
      { key: 'ring', label: 'الحلقة', render: (b) => `<span class="ltr">${esc(b.ring)}</span>` },
      { key: 'species', label: 'النوع' },
      { key: 'arrival', label: 'موعد الاستلام', render: (b) => `${dateShort(b.arrival)} · <span class="ltr text-mute">${b.time}</span> ${b.status === 'pending' && b.arrival < TODAY ? badge('متأخر', 'bad') : ''}` },
      { key: 'deposit', label: 'العربون', render: (b) => b.deposit ? money(b.deposit) : badge('بدون عربون', 'warn') },
    ];
    if (bookTab === 'pending') cols.push({ key: 'act', label: '', nosort: true, render: (b) => `<div class="flex justify-end gap-1.5"><button class="btn btn-primary btn-sm" data-in="${b.id}">${icon('clipboard-check', 'size-3.5')} استلام وفحص</button><button class="btn btn-ghost btn-sm" data-rej="${b.id}">رفض</button></div>` });
    if (bookTab === 'checked_in') cols.push({ key: 'go', label: '', nosort: true, render: (b) => b.birdId ? `<a class="btn btn-ghost btn-sm" href="#bird-${b.birdId}">فتح الملف</a>` : '' });
    if (bookTab === 'rejected') cols.push({ key: 'reason', label: 'السبب', render: (b) => `<span class="text-sm text-mute">${esc(b.reason || '')}</span>` });
    const bind = () => {
      v.querySelectorAll('[data-in]').forEach((x) => x.onclick = () => checkInModal(db.bookings.find((b) => b.id === x.dataset.in)));
      v.querySelectorAll('[data-rej]').forEach((x) => x.onclick = () => rejectModal(db.bookings.find((b) => b.id === x.dataset.rej)));
    };
    dataTable(document.getElementById('bk-t'), { columns: cols, rows, empty: 'لا توجد حجوزات في هذه القائمة' });
    bind(); new MutationObserver(bind).observe(document.getElementById('bk-t'), { childList: true });
    v.querySelectorAll('[data-t]').forEach((x) => x.addEventListener('click', () => { bookTab = x.dataset.t; viewBookings(v); icons(); }));
    document.getElementById('bk-new').addEventListener('click', () => bookingModal());
  }

  function bookingModal(presetOwner) {
    const st = S();
    const nextRing = `QA-${D.util.pad(Math.max(...db.birds.map((b) => b.id), ...db.bookings.map((b) => +b.ring.replace(/\D/g, '') || 0)) + 1)}`;
    modal({ title: 'حجز جديد', size: 'md',
      body: `<form id="f" class="grid gap-4 sm:grid-cols-2">
        <div class="flex items-end gap-2 sm:col-span-2">${field({ id: 'ownerId', label: 'المالك', type: 'select', required: true, cls: 'flex-1', value: presetOwner?.id, options: db.owners.filter((o) => o.active).map((o) => ({ value: o.id, label: `${o.name} · ${o.phone}` })) })}<button type="button" class="btn btn-ghost" id="new-owner">${icon('user-plus')} جديد</button></div>
        ${field({ id: 'ring', label: 'رقم الحلقة', required: true, value: nextRing })}
        ${field({ id: 'species', label: 'نوع الطائر', type: 'select', options: st.species })}
        ${field({ id: 'arrival', label: 'موعد الاستلام', type: 'date', required: true, value: D.util.iso(D.util.addDays(TODAY, 2)) })}
        ${field({ id: 'time', label: 'الوقت', type: 'time', value: '10:00' })}
        ${st.depositEnabled ? `${field({ id: 'deposit', label: 'العربون (ر.ق)', type: 'number', min: 0, value: st.deposit })}${field({ id: 'method', label: 'وسيلة الدفع', type: 'select', options: st.paymentMethods })}` : '<p class="text-sm text-mute sm:col-span-2">العربون غير مفعّل في إعدادات المقيض.</p>'}
        <p class="rounded-xl bg-paper p-3 text-xs text-mute sm:col-span-2">سعر الإقامة الافتراضي ${moneyTxt(st.price)} لمدة ${st.stayMonths} أشهر · يُدفع العربون عند الحجز والباقي عند الاستلام.</p></form>`,
      footer: `<button class="btn btn-ghost" data-close>إلغاء</button><button class="btn btn-primary" form="f">${icon('check')} تأكيد الحجز</button>`,
      onMount: (r) => {
        r.querySelector('#new-owner').addEventListener('click', () => ownerFormModal((o) => bookingModal(o)));
        r.querySelector('#f').addEventListener('submit', (e) => {
          e.preventDefault(); const f = formData(e.target);
          if (birdByRing(f.ring) || db.bookings.some((b) => b.ring === f.ring && b.status === 'pending')) return toast('رقم الحلقة مستخدم مسبقاً', 'bad');
          const id = `R-${D.util.pad(db.bookings.length + 1)}`;
          const dep = +(f.deposit || 0);
          db.bookings.push({ id, birdId: null, ownerId: +f.ownerId, ring: f.ring.trim(), species: f.species, date: TODAY, arrival: f.arrival, time: f.time, deposit: dep, status: 'pending' });
          if (dep > 0) addPayment({ ownerId: +f.ownerId, birdId: null, bookingId: id, amount: dep, type: 'عربون', method: f.method, date: TODAY });
          log(`حجز جديد #${id} للحلقة ${f.ring}`); persist(); closeModal(); toast(`تم إنشاء الحجز <b class="ltr">#${id}</b>`);
          if (location.hash !== '#bookings') go('bookings'); else render();
        });
      } });
  }

  function checkInModal(bk) {
    const st = S();
    const remaining = st.price - (bk.deposit || 0);
    modal({ title: `استلام وفحص · <span class="ltr">#${esc(bk.id)}</span>`, size: 'lg',
      body: `<form id="f" class="grid gap-4 sm:grid-cols-2">
        <div class="rounded-xl bg-paper p-3 text-sm sm:col-span-2"><b class="ltr text-navy">${esc(bk.ring)}</b> · ${esc(bk.species)} · ${esc(owner(bk.ownerId).name)}</div>
        ${field({ id: 'entry', label: 'تاريخ الدخول الفعلي', type: 'date', value: TODAY, required: true })}
        ${field({ id: 'weight', label: 'الوزن عند الدخول (غ)', type: 'number', min: 200, max: 3000, required: true, value: 1050 })}
        ${field({ id: 'sex', label: 'الجنس', type: 'select', options: ['أنثى', 'ذكر'] })}
        ${field({ id: 'age', label: 'العمر (سنوات)', type: 'number', min: 0, value: 2 })}
        ${field({ id: 'passport', label: 'جواز الصقر', placeholder: 'QFP-…' })}
        ${field({ id: 'chip', label: 'الشريحة (Microchip)' })}
        <fieldset class="rounded-xl border border-line p-4 sm:col-span-2"><legend class="px-1 text-sm font-extrabold text-navy">الفحص البيطري عند الاستلام · ${ruleLabel(st.rules.intakeExam)}</legend>
          <div class="grid gap-4 sm:grid-cols-3">
            <label class="flex items-center gap-2 text-sm"><input type="checkbox" name="examDone" class="size-4 accent-[#17294A]"> تم الفحص البيطري</label>
            ${field({ id: 'examResult', label: 'نتيجة الفحص', type: 'select', options: ['سليم', 'يحتاج فحص', 'مرفوض'] })}
            <label class="flex items-center gap-2 text-sm"><input type="checkbox" name="fromClinic" class="size-4 accent-[#17294A]"> قادم من عيادة</label>
          </div></fieldset>
        ${field({ id: 'pay', label: 'دفعة الاستلام (ر.ق)', type: 'number', min: 0, value: remaining })}
        ${field({ id: 'method', label: 'وسيلة الدفع', type: 'select', options: st.paymentMethods })}
        <div id="rule-msg" class="sm:col-span-2"></div></form>`,
      footer: `<button class="btn btn-ghost" data-close>إلغاء</button><button class="btn btn-primary" form="f">${icon('log-in')} فتح الإقامة</button>`,
      onMount: (r) => r.querySelector('#f').addEventListener('submit', (e) => {
        e.preventDefault(); const f = formData(e.target); const msg = r.querySelector('#rule-msg');
        const block = (t) => { msg.innerHTML = `<div class="flex gap-2 rounded-xl bg-bad-100 p-3 text-sm text-bad">${icon('octagon-x', 'size-4 mt-0.5 shrink-0')}<span>${t}</span></div>`; icons(); };
        if (f.examResult === 'مرفوض') return block('نتيجة الفحص «مرفوض»: استخدم زر «رفض» في قائمة الحجوزات لتسجيل السبب ومعالجة العربون.');
        if (!f.examDone && st.rules.intakeExam === 'mandatory') return block('<b>قاعدة إلزامية:</b> لا يمكن فتح الإقامة قبل تسجيل الفحص البيطري عند الاستلام.');
        if (occupied() >= capacity()) {
          if (st.rules.capacity === 'mandatory') return block(`<b>قاعدة إلزامية:</b> الطاقة الاستيعابية ممتلئة (${occupied()}/${capacity()}).`);
          if (st.rules.capacity === 'warning') toast('<b>تحذير:</b> تم تجاوز الطاقة الاستيعابية للموسم', 'warn');
        }
        if (!f.examDone && st.rules.intakeExam === 'warning') toast('<b>تحذير:</b> تم الاستلام بدون فحص بيطري', 'warn');
        const id = Math.max(...db.birds.map((b) => b.id)) + 1;
        const nb = { id, ring: bk.ring, ownerId: bk.ownerId, species: bk.species, sex: f.sex, age: +f.age, passport: f.passport || '—', chip: f.chip || '—', cites: '',
          entryDate: f.entry, endDate: D.util.iso(D.util.addMonths(f.entry, st.stayMonths)), exitDate: null, status: 'active', health: f.examResult, weights: [{ date: f.entry, g: +f.weight }], vaccines: [],
          price: st.price, molt: 0, fromClinic: !!f.fromClinic, intakeExam: { done: !!f.examDone, result: f.examDone ? f.examResult : 'لم يُفحص', date: f.entry }, staffId: 6, stayId: `M-${D.util.pad(id)}` };
        db.birds.push(nb);
        bk.status = 'checked_in'; bk.birdId = id;
        db.payments.filter((p) => p.bookingId === bk.id).forEach((p) => { p.birdId = id; });
        if (+f.pay > 0) addPayment({ ownerId: bk.ownerId, birdId: id, amount: +f.pay, type: 'دفعة استلام', method: f.method, date: f.entry });
        log(`استلام الطائر ${bk.ring} وفتح الإقامة #${nb.stayId}`); persist(); closeModal();
        toast(`تم فتح الإقامة <b class="ltr">#${nb.stayId}</b> · العدّاد ${occupied()}/${capacity()}`); go(`bird-${id}`);
      }) });
  }

  function rejectModal(bk) {
    modal({ title: `رفض / إلغاء الحجز · <span class="ltr">#${esc(bk.id)}</span>`, size: 'sm',
      body: `<form id="f" class="grid gap-4">${field({ id: 'reason', label: 'السبب', type: 'select', options: ['نتيجة فحص الاستلام', 'إلغاء من المالك', 'عدم الحضور في الموعد', 'امتلاء الطاقة', 'أخرى'] })}${field({ id: 'note', label: 'ملاحظة', type: 'textarea' })}
        ${bk.deposit ? field({ id: 'dep', label: 'معالجة العربون', type: 'select', options: ['استرداد العربون', 'الاحتفاظ بالعربون'] }) : ''}</form>`,
      footer: `<button class="btn btn-ghost" data-close>إلغاء</button><button class="btn btn-danger" form="f">تأكيد الرفض</button>`,
      onMount: (r) => r.querySelector('#f').addEventListener('submit', (e) => {
        e.preventDefault(); const f = formData(e.target);
        bk.status = 'rejected'; bk.reason = `${f.reason}${f.note ? ' — ' + f.note : ''}`;
        if (f.dep === 'استرداد العربون') addPayment({ ownerId: bk.ownerId, birdId: null, bookingId: bk.id, amount: -bk.deposit, type: 'استرداد عربون', method: 'تحويل بنكي', date: TODAY });
        log(`رفض الحجز #${bk.id}: ${f.reason}`); persist(); closeModal(); toast('تم تسجيل الرفض'); render();
      }) });
  }

  /* =========================================================
     Santé
     ========================================================= */
  let healthTab = 'current';
  function viewHealth(v) {
    const act = activeBirds();
    const under = act.filter((b) => b.health === 'تحت العلاج'), due = act.filter(vacDue), check = act.filter((b) => b.health === 'يحتاج فحص');
    v.innerHTML = pageHead('الصحة والعلاج والتحصينات', 'سجل علاجي مستقل لكل طائر، مرتبط تلقائياً بالمحاسبة',
      `<button class="btn btn-ghost" id="h-vac">${icon('syringe')} تسجيل تحصين</button><button class="btn btn-gold" id="h-treat">${icon('plus')} تسجيل علاج</button>`) + `
      <div class="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        ${kpi({ label: 'تحت العلاج', value: num(under.length), ic: 'stethoscope', tone: 'bad' })}
        ${kpi({ label: 'يحتاج فحص', value: num(check.length), ic: 'search', tone: 'gold' })}
        ${kpi({ label: 'تحصينات مستحقة', value: num(due.length), ic: 'syringe', tone: 'gold' })}
        ${kpi({ label: 'برنامج التحصين مكتمل', value: `${((act.filter((b) => b.vaccines.length >= S().vacProgram.doses).length / act.length) * 100).toFixed(0)}%`, sub: `${act.filter((b) => b.vaccines.length >= S().vacProgram.doses).length} طائر`, ic: 'shield-check', tone: 'ok' })}
      </div>
      <div class="card"><div class="flex gap-5 overflow-x-auto border-b border-line px-5 pt-3" role="tablist">
        ${[['current', `العلاجات الجارية (${db.treatments.filter((t) => t.status === 'جاري').length})`], ['all', 'سجل العلاج'], ['vac', `تحصينات مستحقة (${due.length})`], ['check', `يحتاج فحص (${check.length})`]].map(([k, l]) => `<button role="tab" class="tab whitespace-nowrap" data-t="${k}" aria-selected="${healthTab === k}">${l}</button>`).join('')}
      </div><div id="h-t" class="p-4"></div></div>`;
    const el = document.getElementById('h-t');
    if (healthTab === 'current' || healthTab === 'all') {
      const rows = db.treatments.filter((t) => healthTab === 'all' || t.status === 'جاري').sort((a, b) => b.date.localeCompare(a.date));
      dataTable(el, { rows, onRow: (t) => go(`bird-${t.birdId}`), columns: [
        { key: 'ring', label: 'الحلقة', sort: (t) => bird(t.birdId).ring, render: (t) => `<b class="ltr text-navy">${esc(bird(t.birdId).ring)}</b>` },
        { key: 'disease', label: 'المرض' }, { key: 'date', label: 'التاريخ', render: (t) => dateShort(t.date) },
        { key: 'clinic', label: 'العيادة والطبيب', render: (t) => `${esc(t.clinic)}<div class="text-xs text-mute">${esc(t.doctor)}</div>` },
        { key: 'meds', label: 'العلاج' }, { key: 'days', label: 'الأيام' },
        { key: 'cost', label: 'التكلفة', render: (t) => money(t.cost) },
        { key: 'status', label: 'الحالة', render: (t) => badge(t.status, t.status === 'جاري' ? 'bad' : 'ok') },
      ] });
    } else {
      const rows = healthTab === 'vac' ? due : check;
      dataTable(el, { rows, onRow: (b) => go(`bird-${b.id}`), columns: [
        { key: 'ring', label: 'الحلقة', render: (b) => `<b class="ltr text-navy">${esc(b.ring)}</b>` },
        { key: 'species', label: 'النوع' }, { key: 'owner', label: 'المالك', sort: (b) => owner(b.ownerId).name, render: (b) => esc(owner(b.ownerId).name) },
        { key: 'vac', label: 'التحصين', sort: (b) => b.vaccines.length, render: (b) => `${b.vaccines.length}/${S().vacProgram.doses}` },
        { key: 'last', label: 'آخر تحصين', sort: (b) => lastVaccine(b)?.date || '', render: (b) => lastVaccine(b) ? dateShort(lastVaccine(b).date) : '—' },
        { key: 'health', label: 'الحالة', render: (b) => healthBadge(b.health) },
        { key: 'a', label: '', nosort: true, render: (b) => healthTab === 'vac' ? `<button class="btn btn-ghost btn-sm" data-vac="${b.id}">${icon('syringe', 'size-3.5')} تحصين</button>` : '' },
      ] });
      const bind = () => el.querySelectorAll('[data-vac]').forEach((x) => x.onclick = () => vaccineModal(bird(x.dataset.vac)));
      bind(); new MutationObserver(bind).observe(el, { childList: true });
    }
    v.querySelectorAll('[data-t]').forEach((x) => x.addEventListener('click', () => { healthTab = x.dataset.t; viewHealth(v); icons(); }));
    document.getElementById('h-treat').addEventListener('click', () => treatmentModal());
    document.getElementById('h-vac').addEventListener('click', () => vaccineModal());
  }

  /* =========================================================
     Nourriture, stock & proies
     ========================================================= */
  function viewInventory(v) {
    const prey = db.items.find((i) => i.prey);
    const preyBought = db.purchases.filter((p) => p.itemId === prey.id).reduce((s, p) => s + p.qty, 0);
    const preyUsed = db.consumption.filter((c) => c.itemId === prey.id).reduce((s, c) => s + c.qty, 0);
    const stockValue = db.items.reduce((s, i) => s + i.qty * i.unitCost, 0);
    v.innerHTML = pageHead('التغذية والمخزون والفريس', 'من الشراء إلى الاستهلاك: كل كمية داخلة ومستخدمة ومتبقية مسجّلة',
      `<button class="btn btn-ghost" id="i-use">${icon('minus-circle')} تسجيل استهلاك</button><button class="btn btn-gold" id="i-buy">${icon('shopping-cart')} شراء من مورد</button>`) + `
      <div class="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">${db.items.map((i) => {
        const low = i.qty < i.min;
        return `<div class="card p-4 ${low ? 'ring-2 ring-bad/30' : ''}"><div class="flex items-center justify-between"><span class="font-extrabold text-navy">${esc(i.name)}</span>${low ? badge('إعادة الطلب', 'bad', 'triangle-alert') : badge('متوفر', 'ok')}</div>
          <div class="mt-3 text-3xl font-extrabold tabular-nums text-navy">${num(i.qty)} <span class="text-sm font-medium text-mute">${esc(i.unit)}</span></div>
          <div class="mt-3">${progress((i.qty / i.max) * 100, low ? 'bad' : 'navy')}</div>
          <div class="mt-2 flex justify-between text-xs text-mute"><span>حد التنبيه: ${num(i.min)}</span><span>القيمة: ${moneyTxt(i.qty * i.unitCost)}</span></div></div>`;
      }).join('')}</div>
      <div class="mb-5 grid gap-5 lg:grid-cols-3">
        ${section('الفريس', 'feather', `<div class="grid grid-cols-3 gap-3">${miniStat('المشتراة', num(preyBought))}${miniStat('المستخدمة', num(preyUsed))}${miniStat('المتبقية', num(prey.qty), prey.qty < prey.min ? 'bad' : 'ok')}</div>
          <div class="mt-4 flex justify-between rounded-xl bg-paper px-3 py-2 text-sm"><span class="text-mute">سعر الفريس</span><b>${money(prey.unitCost)}</b></div>
          <div class="mt-2 flex justify-between rounded-xl bg-paper px-3 py-2 text-sm"><span class="text-mute">قيمة المخزون المتبقي</span><b>${money(stockValue)}</b></div>`)}
        <div class="lg:col-span-2">${section('الموردون', 'store', `<ul class="divide-y divide-line">${db.suppliers.map((s) => `<li class="flex flex-wrap items-center justify-between gap-3 py-2.5">
          <div class="flex items-center gap-2"><button class="btn-icon size-8" data-star="${s.id}" aria-label="مورد رئيسي">${icon('star', `size-4 ${s.starred ? 'fill-gold text-gold' : ''}`)}</button><div><b class="text-navy">${esc(s.name)}</b><div class="text-xs text-mute">${esc(s.items)}</div></div></div>
          <span class="ltr text-sm text-mute">${esc(s.phone)}</span></li>`).join('')}</ul>`)}</div>
      </div>
      <div class="grid gap-5 lg:grid-cols-2">
        ${section('سجل المشتريات', 'receipt', '<div id="i-pur"></div>', '<span class="text-xs text-mute">كل شراء يُغذّي المخزون ويُسجَّل مصروفاً</span>')}
        ${section('الاستهلاك اليومي', 'utensils', '<div id="i-con"></div>')}
      </div>`;
    dataTable(document.getElementById('i-pur'), { pageSize: 8, minW: 'min-w-[520px]', rows: db.purchases.slice().sort((a, b) => b.date.localeCompare(a.date)), columns: [
      { key: 'date', label: 'التاريخ', render: (p) => dateShort(p.date) },
      { key: 'item', label: 'الصنف', sort: (p) => itemById(p.itemId).name, render: (p) => esc(itemById(p.itemId).name) },
      { key: 'sup', label: 'المورد', sort: (p) => supplier(p.supplierId).name, render: (p) => `<span class="text-xs">${esc(supplier(p.supplierId).name)}</span>` },
      { key: 'qty', label: 'الكمية', render: (p) => num(p.qty) }, { key: 'unitPrice', label: 'سعر الوحدة', render: (p) => money(p.unitPrice) },
      { key: 'total', label: 'الإجمالي', sort: (p) => p.qty * p.unitPrice, render: (p) => `<b>${money(p.qty * p.unitPrice)}</b>` },
    ] });
    dataTable(document.getElementById('i-con'), { pageSize: 8, minW: 'min-w-0', rows: db.consumption.slice().sort((a, b) => b.date.localeCompare(a.date)), columns: [
      { key: 'date', label: 'التاريخ', render: (c) => dateShort(c.date) },
      { key: 'item', label: 'الصنف', sort: (c) => itemById(c.itemId).name, render: (c) => esc(itemById(c.itemId).name) },
      { key: 'qty', label: 'الكمية', render: (c) => `${num(c.qty)} ${esc(itemById(c.itemId).unit)}` },
    ] });
    v.querySelectorAll('[data-star]').forEach((b) => b.addEventListener('click', () => { const s = supplier(b.dataset.star); s.starred = !s.starred; persist(); render(); }));
    document.getElementById('i-buy').addEventListener('click', purchaseModal);
    document.getElementById('i-use').addEventListener('click', consumeModal);
  }

  function purchaseModal() {
    modal({ title: 'شراء من مورد', size: 'md',
      body: `<form id="f" class="grid gap-4 sm:grid-cols-2">${field({ id: 'supplierId', label: 'المورد', type: 'select', options: db.suppliers.map((s) => ({ value: s.id, label: `${s.starred ? '★ ' : ''}${s.name}` })) })}
        ${field({ id: 'itemId', label: 'الصنف', type: 'select', options: db.items.map((i) => ({ value: i.id, label: i.name })) })}
        ${field({ id: 'qty', label: 'الكمية', type: 'number', min: 1, required: true })}${field({ id: 'unitPrice', label: 'سعر الوحدة (ر.ق)', type: 'number', min: 0, step: '0.1', required: true, value: db.items[0].unitCost })}
        ${field({ id: 'date', label: 'تاريخ الشراء', type: 'date', value: TODAY, required: true })}<div class="flex items-end"><div class="w-full rounded-xl bg-paper px-3 py-2.5 text-sm">الإجمالي: <b id="tot">—</b></div></div></form>`,
      footer: `<button class="btn btn-ghost" data-close>إلغاء</button><button class="btn btn-primary" form="f">حفظ الشراء</button>`,
      onMount: (r) => {
        const upd = () => { r.querySelector('#tot').textContent = moneyTxt((+r.querySelector('#qty').value || 0) * (+r.querySelector('#unitPrice').value || 0)); };
        r.querySelector('#itemId').addEventListener('change', (e) => { r.querySelector('#unitPrice').value = itemById(e.target.value).unitCost; upd(); });
        r.querySelectorAll('#qty,#unitPrice').forEach((x) => x.addEventListener('input', upd));
        r.querySelector('#f').addEventListener('submit', (e) => {
          e.preventDefault(); const f = formData(e.target); const it = itemById(f.itemId);
          db.purchases.push({ id: Math.max(0, ...db.purchases.map((p) => p.id)) + 1, date: f.date, supplierId: +f.supplierId, itemId: it.id, qty: +f.qty, unitPrice: +f.unitPrice });
          it.qty += +f.qty; log(`شراء ${num(f.qty)} ${it.unit} ${it.name}`); persist(); closeModal(); toast(`تمت إضافة ${num(f.qty)} ${it.unit} إلى المخزون`); render();
        });
      } });
  }

  function consumeModal() {
    modal({ title: 'تسجيل استهلاك', size: 'sm',
      body: `<form id="f" class="grid gap-4">${field({ id: 'itemId', label: 'الصنف', type: 'select', options: db.items.map((i) => ({ value: i.id, label: `${i.name} (متوفر ${num(i.qty)} ${i.unit})` })) })}${field({ id: 'qty', label: 'الكمية', type: 'number', min: 1, required: true })}${field({ id: 'date', label: 'التاريخ', type: 'date', value: TODAY })}</form>`,
      footer: `<button class="btn btn-ghost" data-close>إلغاء</button><button class="btn btn-primary" form="f">حفظ</button>`,
      onMount: (r) => r.querySelector('#f').addEventListener('submit', (e) => {
        e.preventDefault(); const f = formData(e.target); const it = itemById(f.itemId);
        if (+f.qty > it.qty) return toast(`الكمية المطلوبة أكبر من المتوفر (${num(it.qty)} ${it.unit})`, 'bad');
        it.qty -= +f.qty; db.consumption.push({ date: f.date, itemId: it.id, qty: +f.qty });
        log(`استهلاك ${num(f.qty)} ${it.unit} ${it.name}`); persist(); closeModal();
        toast(it.qty < it.min ? `تم الحفظ · <b>تنبيه إعادة الطلب</b> لـ ${it.name}` : 'تم تسجيل الاستهلاك', it.qty < it.min ? 'warn' : 'ok'); render();
      }) });
  }

  /* =========================================================
     Livraison
     ========================================================= */
  let delivFilter = 'معلّقة';
  function viewDelivery(v) {
    const driver = me.role === 'driver';
    const base = driver ? db.deliveries.filter((d) => d.driverId === me.id) : db.deliveries;
    v.innerHTML = pageHead(driver ? 'مهامي في التوصيل' : 'التوصيل', 'خدمة اختيارية عند الدخول أو الخروج · تُضاف الرسوم تلقائياً إلى حساب الطائر والمالك',
      !driver ? `<button class="btn btn-gold" id="d-new">${icon('plus')} طلب توصيل</button>` : '') + `
      <div class="mb-5 grid gap-3 sm:grid-cols-3">${kpi({ label: 'معلّقة', value: num(base.filter((d) => d.status === 'معلّقة').length), ic: 'clock', tone: 'gold' })}${kpi({ label: 'تمت', value: num(base.filter((d) => d.status === 'تمت').length), ic: 'circle-check', tone: 'ok' })}${kpi({ label: 'لم تتم', value: num(base.filter((d) => d.status === 'لم تتم').length), ic: 'circle-x', tone: 'bad' })}</div>
      <div class="card"><div class="flex flex-wrap gap-2 border-b border-line p-4">${['معلّقة', 'تمت', 'لم تتم', 'الكل'].map((s) => `<button class="chip" data-s="${s}" aria-pressed="${delivFilter === s}">${s}</button>`).join('')}</div><div id="d-t" class="p-4"></div></div>`;
    const rows = base.filter((d) => delivFilter === 'الكل' || d.status === delivFilter).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    const el = document.getElementById('d-t');
    dataTable(el, { rows, empty: 'لا توجد طلبات توصيل', columns: [
      { key: 'id', label: '#', render: (d) => `<span class="ltr text-mute">D-${D.util.pad(d.id, 3)}</span>` },
      { key: 'bird', label: 'الطائر', sort: (d) => bird(d.birdId)?.ring, render: (d) => `<b class="ltr text-navy">${esc(bird(d.birdId)?.ring || '')}</b><div class="text-xs text-mute">${esc(owner(d.ownerId).name)}</div>` },
      { key: 'direction', label: 'الاتجاه', render: (d) => badge(d.direction, d.direction === 'خروج' ? 'info' : 'gold', d.direction === 'خروج' ? 'log-out' : 'log-in') },
      { key: 'address', label: 'العنوان', render: (d) => `<span class="text-sm">${esc(d.address)}</span><div class="ltr text-xs text-mute">${esc(owner(d.ownerId).phone)}</div>` },
      { key: 'date', label: 'الموعد', sort: (d) => d.date + d.time, render: (d) => `${dateShort(d.date)} <span class="ltr text-mute">${d.time}</span>` },
      { key: 'driver', label: 'السائق', sort: (d) => staff(d.driverId)?.name || '', render: (d) => d.driverId ? esc(staff(d.driverId).name) : (isAdmin() ? `<button class="btn btn-ghost btn-sm" data-assign="${d.id}">تعيين سائق</button>` : badge('غير معيّن', 'warn')) },
      { key: 'fee', label: 'الرسوم', render: (d) => money(d.fee) },
      { key: 'status', label: 'الحالة', render: (d) => d.status === 'معلّقة' && (driver || isAdmin()) && d.driverId ? `<div class="flex gap-1"><button class="btn btn-primary btn-sm" data-done="${d.id}">تمت</button><button class="btn btn-ghost btn-sm" data-fail="${d.id}">لم تتم</button></div>` : badge(d.status, d.status === 'تمت' ? 'ok' : d.status === 'لم تتم' ? 'bad' : 'warn') },
    ] });
    const bind = () => {
      el.querySelectorAll('[data-done]').forEach((x) => x.onclick = () => setDeliv(+x.dataset.done, 'تمت'));
      el.querySelectorAll('[data-fail]').forEach((x) => x.onclick = () => setDeliv(+x.dataset.fail, 'لم تتم'));
      el.querySelectorAll('[data-assign]').forEach((x) => x.onclick = () => assignModal(db.deliveries.find((d) => d.id === +x.dataset.assign)));
    };
    bind(); new MutationObserver(bind).observe(el, { childList: true });
    v.querySelectorAll('[data-s]').forEach((x) => x.addEventListener('click', () => { delivFilter = x.dataset.s; viewDelivery(v); icons(); }));
    document.getElementById('d-new')?.addEventListener('click', () => deliveryModal());
  }
  function setDeliv(id, status) { const d = db.deliveries.find((x) => x.id === id); d.status = status; log(`تحديث التوصيل D-${D.util.pad(id, 3)}: ${status}`); persist(); toast(`تم تحديث الحالة: ${status}`, status === 'تمت' ? 'ok' : 'warn'); render(); }
  function assignModal(d) {
    modal({ title: 'تعيين سائق', size: 'sm', body: `<form id="f">${field({ id: 'driverId', label: 'السائق', type: 'select', options: db.staff.filter((s) => s.role === 'driver' && s.active).map((s) => ({ value: s.id, label: s.name })) })}</form>`,
      footer: `<button class="btn btn-ghost" data-close>إلغاء</button><button class="btn btn-primary" form="f">تعيين</button>`,
      onMount: (r) => r.querySelector('#f').addEventListener('submit', (e) => { e.preventDefault(); d.driverId = +formData(e.target).driverId; log(`تعيين ${staff(d.driverId).name} للتوصيل D-${d.id}`); persist(); closeModal(); toast('تم تعيين السائق'); render(); }) });
  }
  function deliveryModal(b) {
    modal({ title: 'طلب توصيل', size: 'md',
      body: `<form id="f" class="grid gap-4 sm:grid-cols-2"><div class="sm:col-span-2">${birdPicker('ring', b)}</div>
        ${field({ id: 'direction', label: 'الاتجاه', type: 'select', options: ['خروج', 'دخول'] })}${field({ id: 'fee', label: 'رسوم التوصيل (ر.ق)', type: 'number', min: 0, value: S().deliveryFee })}
        ${field({ id: 'address', label: 'العنوان', required: true, cls: 'sm:col-span-2', value: b ? `${owner(b.ownerId).area} — ` : '' })}
        ${field({ id: 'date', label: 'التاريخ', type: 'date', value: D.util.iso(D.util.addDays(TODAY, 1)), required: true })}${field({ id: 'time', label: 'الوقت', type: 'time', value: '10:00' })}
        ${field({ id: 'driverId', label: 'السائق', type: 'select', options: [{ value: '', label: '— لاحقاً —' }, ...db.staff.filter((s) => s.role === 'driver').map((s) => ({ value: s.id, label: s.name }))] })}</form>`,
      footer: `<button class="btn btn-ghost" data-close>إلغاء</button><button class="btn btn-primary" form="f">إنشاء الطلب</button>`,
      onMount: (r) => {
        const inp = r.querySelector('#ring'); if (inp) inp.setAttribute('list', 'rings');
        r.querySelector('#f').addEventListener('submit', (e) => {
          e.preventDefault(); const f = formData(e.target); const tb = b || birdByRing(f.ring);
          if (!tb) return toast('رقم الحلقة غير موجود', 'bad');
          db.deliveries.push({ id: Math.max(0, ...db.deliveries.map((d) => d.id)) + 1, birdId: tb.id, ownerId: tb.ownerId, direction: f.direction, address: f.address, date: f.date, time: f.time, driverId: f.driverId ? +f.driverId : null, status: 'معلّقة', fee: +f.fee });
          log(`طلب توصيل (${f.direction}) للطائر ${tb.ring}`); persist(); closeModal(); toast('تم إنشاء طلب التوصيل وإضافة الرسوم إلى الحساب'); render();
        });
      } });
  }

  /* =========================================================
     Finances
     ========================================================= */
  let finState = { period: 'season', from: '', to: '', tab: 'payments' };
  function addPayment(p) {
    const n = Math.max(0, ...db.payments.map((x) => x.id)) + 1;
    const pay = { id: n, receipt: `RC-${D.util.pad(n, 5)}`, ...p };
    db.payments.push(pay); return pay;
  }
  function viewFinance(v) {
    const rng = periodRange(finState.period, finState.from, finState.to);
    const pays = db.payments.filter((p) => inRange(p.date, rng));
    const exps = allExpenses().filter((e) => inRange(e.date, rng));
    const inc = pays.reduce((s, p) => s + +p.amount, 0), exp = exps.reduce((s, e) => s + +e.amount, 0);
    const due = db.birds.reduce((s, b) => s + birdCharges(b).total, 0), coll = db.birds.reduce((s, b) => s + birdPaid(b), 0);
    const unpaid = db.birds.filter((b) => birdBalance(b) > 0);
    v.innerHTML = pageHead('المالية والمحاسبة', 'المدخول − المصروفات = صافي الدخل، لأي فترة تختارها',
      `<button class="btn btn-ghost" id="f-exp">${icon('minus')} مصروف</button><button class="btn btn-gold" id="f-pay">${icon('banknote')} تسجيل دفعة</button>`) + `
      <div class="mb-5 flex flex-wrap items-center gap-3">${segmented('period', [{ value: 'day', label: 'اليوم' }, { value: 'month', label: 'الشهر' }, { value: 'season', label: 'الموسم' }, { value: 'year', label: 'السنة' }, { value: 'custom', label: 'فترة مخصصة' }], finState.period)}
        ${finState.period === 'custom' ? `<input type="date" id="f-from" class="input w-auto" value="${finState.from || S().season.start}"><span class="text-mute">إلى</span><input type="date" id="f-to" class="input w-auto" value="${finState.to || TODAY}">` : ''}
        <span class="text-xs text-mute">${date(rng[0])} ← ${date(rng[1])}</span></div>
      <div class="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        ${kpi({ label: 'المدخول', value: money(inc), sub: `${num(pays.length)} دفعة`, ic: 'trending-up', tone: 'ok' })}
        ${kpi({ label: 'المصروفات', value: money(exp), sub: `${num(exps.length)} قيد`, ic: 'trending-down', tone: 'bad' })}
        ${kpi({ label: 'صافي الدخل', value: money(inc - exp), ic: 'scale', tone: inc - exp >= 0 ? 'navy' : 'bad' })}
        ${kpi({ label: 'نسبة التحصيل (كل الحسابات)', value: `${((coll / due) * 100).toFixed(1)}%`, sub: `المتبقي ${moneyTxt(due - coll)}`, ic: 'percent', tone: 'gold' })}
      </div>
      <div class="mb-5 grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        ${section('المدخول والمصروفات حسب الشهر', 'chart-column', '<div class="h-64"><canvas id="ch-m"></canvas></div>')}
        ${section('هيكل التكاليف للفترة', 'chart-pie', '<div class="h-64"><canvas id="ch-c"></canvas></div>')}
      </div>
      <div class="card"><div class="flex gap-5 overflow-x-auto border-b border-line px-5 pt-3" role="tablist">
        ${[['payments', 'المدفوعات'], ['expenses', 'المصروفات'], ['unpaid', `الحسابات غير المسددة (${unpaid.length})`]].map(([k, l]) => `<button role="tab" class="tab whitespace-nowrap" data-t="${k}" aria-selected="${finState.tab === k}">${l}</button>`).join('')}
      </div><div id="f-t" class="p-4"></div></div>`;
    const el = document.getElementById('f-t');
    if (finState.tab === 'payments') dataTable(el, { rows: pays.slice().sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id), columns: [
      { key: 'receipt', label: 'الإيصال', render: (p) => `<b class="ltr text-navy">${p.receipt}</b>` }, { key: 'date', label: 'التاريخ', render: (p) => dateShort(p.date) },
      { key: 'owner', label: 'المالك', sort: (p) => owner(p.ownerId).name, render: (p) => esc(owner(p.ownerId).name) },
      { key: 'bird', label: 'الطائر', render: (p) => p.birdId ? `<span class="ltr">${esc(bird(p.birdId)?.ring)}</span>` : `<span class="text-xs text-mute">حجز ${esc(p.bookingId || '')}</span>` },
      { key: 'type', label: 'النوع' }, { key: 'method', label: 'الوسيلة' },
      { key: 'amount', label: 'المبلغ', render: (p) => `<b class="${p.amount < 0 ? 'text-bad' : 'text-ok'}">${money(p.amount)}</b>` },
    ] });
    if (finState.tab === 'expenses') dataTable(el, { rows: exps, columns: [
      { key: 'date', label: 'التاريخ', render: (e) => dateShort(e.date) }, { key: 'category', label: 'البند' },
      { key: 'note', label: 'البيان', render: (e) => `<span class="text-sm">${esc(e.note)}</span>` },
      { key: 'source', label: 'المصدر', render: (e) => badge(e.source, e.source === 'تلقائي' ? 'info' : 'mute') },
      { key: 'amount', label: 'المبلغ', render: (e) => `<b class="text-bad">${money(e.amount)}</b>` },
    ] });
    if (finState.tab === 'unpaid') dataTable(el, { rows: unpaid.sort((a, b) => birdBalance(b) - birdBalance(a)), onRow: can('birds') ? (b) => go(`bird-${b.id}`) : null, columns: [
      { key: 'ring', label: 'الحلقة', render: (b) => `<b class="ltr text-navy">${esc(b.ring)}</b>` },
      { key: 'owner', label: 'المالك', sort: (b) => owner(b.ownerId).name, render: (b) => `${esc(owner(b.ownerId).name)}<div class="ltr text-xs text-mute">${esc(owner(b.ownerId).phone)}</div>` },
      { key: 'total', label: 'الإجمالي', sort: (b) => birdCharges(b).total, render: (b) => money(birdCharges(b).total) },
      { key: 'paid', label: 'المحصّل', sort: birdPaid, render: (b) => money(birdPaid(b)) },
      { key: 'bal', label: 'المتبقي', sort: birdBalance, render: (b) => `<b class="text-bad">${money(birdBalance(b))}</b>` },
      { key: 'a', label: '', nosort: true, render: (b) => `<button class="btn btn-ghost btn-sm" data-pay="${b.id}">تحصيل</button>` },
    ] });
    const bind = () => el.querySelectorAll('[data-pay]').forEach((x) => x.onclick = () => { const b = bird(x.dataset.pay); paymentModal({ ownerId: b.ownerId, birdId: b.id }); });
    bind(); new MutationObserver(bind).observe(el, { childList: true });

    const months = monthsOfSeason(); const all = allExpenses();
    chart('ch-m', { type: 'bar', data: { labels: months.map((m) => U.AR_MONTHS[m.m]), datasets: [
      { label: 'المدخول', data: months.map((m) => db.payments.filter((p) => p.date.startsWith(m.key)).reduce((s, p) => s + +p.amount, 0)), backgroundColor: '#223A63', borderRadius: 6, maxBarThickness: 24 },
      { label: 'المصروفات', data: months.map((m) => all.filter((e) => e.date.startsWith(m.key)).reduce((s, e) => s + +e.amount, 0)), backgroundColor: '#D6B26B', borderRadius: 6, maxBarThickness: 24 },
    ] }, options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom', rtl: true, labels: { usePointStyle: true, boxWidth: 8 } }, tooltip: { rtl: true, callbacks: { label: (c) => `${c.dataset.label}: ${moneyTxt(c.raw)}` } } }, scales: { x: { reverse: true, grid: { display: false } }, y: { position: 'right', grid: { color: '#EEF1F5' }, ticks: { callback: (x) => `${x / 1000}k` } } } } });
    const cats = {}; exps.forEach((e) => { cats[e.category] = (cats[e.category] || 0) + +e.amount; });
    chart('ch-c', { type: 'doughnut', data: { labels: Object.keys(cats), datasets: [{ data: Object.values(cats), backgroundColor: ['#17294A', '#D6B26B', '#6E93C4', '#2A6B4F', '#A6472E', '#5B6B82'], borderColor: '#fff', borderWidth: 2 }] },
      options: { maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'bottom', rtl: true, labels: { usePointStyle: true, boxWidth: 8 } }, tooltip: { rtl: true, callbacks: { label: (c) => `${c.label}: ${moneyTxt(c.raw)}` } } } } });

    v.querySelectorAll('input[name=period]').forEach((r) => r.addEventListener('change', () => { finState.period = r.value; viewFinance(v); icons(); }));
    v.querySelector('#f-from')?.addEventListener('change', (e) => { finState.from = e.target.value; charts.forEach((c) => c.destroy()); charts = []; viewFinance(v); icons(); });
    v.querySelector('#f-to')?.addEventListener('change', (e) => { finState.to = e.target.value; charts.forEach((c) => c.destroy()); charts = []; viewFinance(v); icons(); });
    v.querySelectorAll('[data-t]').forEach((x) => x.addEventListener('click', () => { finState.tab = x.dataset.t; charts.forEach((c) => c.destroy()); charts = []; viewFinance(v); icons(); }));
    document.getElementById('f-pay').addEventListener('click', () => paymentModal({}));
    document.getElementById('f-exp').addEventListener('click', expenseModal);
  }

  function paymentModal({ ownerId, birdId }) {
    const oid = ownerId || db.owners[0].id;
    const birdsOpts = (id) => db.birds.filter((b) => b.ownerId === +id).map((b) => ({ value: b.id, label: `${b.ring} — متبقٍ ${moneyTxt(birdBalance(b))}` }));
    modal({ title: 'تسجيل دفعة', size: 'md',
      body: `<form id="f" class="grid gap-4 sm:grid-cols-2">${field({ id: 'ownerId', label: 'المالك', type: 'select', value: oid, cls: 'sm:col-span-2', options: db.owners.map((o) => ({ value: o.id, label: o.name })) })}
        <div id="bird-wrap" class="sm:col-span-2">${field({ id: 'birdId', label: 'الطائر', type: 'select', value: birdId, options: birdsOpts(oid) })}</div>
        ${field({ id: 'type', label: 'نوع الدفعة', type: 'select', options: ['دفعة استلام', 'دفعة إقامة', 'علاج', 'تحصين', 'توصيل', 'عربون'] })}${field({ id: 'amount', label: 'المبلغ (ر.ق)', type: 'number', min: 1, required: true, value: birdId ? Math.max(0, birdBalance(bird(birdId))) || '' : '' })}
        ${field({ id: 'method', label: 'وسيلة الدفع', type: 'select', options: S().paymentMethods })}${field({ id: 'date', label: 'التاريخ', type: 'date', value: TODAY })}</form>`,
      footer: `<button class="btn btn-ghost" data-close>إلغاء</button><button class="btn btn-primary" form="f">${icon('receipt')} حفظ وإصدار إيصال</button>`,
      onMount: (r) => {
        const refill = () => { const bid = r.querySelector('#birdId').value; const b = bird(bid); r.querySelector('#amount').value = b ? Math.max(0, birdBalance(b)) || '' : ''; };
        r.querySelector('#ownerId').addEventListener('change', (e) => { r.querySelector('#bird-wrap').innerHTML = field({ id: 'birdId', label: 'الطائر', type: 'select', options: birdsOpts(e.target.value) }); r.querySelector('#birdId').addEventListener('change', refill); refill(); });
        r.querySelector('#birdId')?.addEventListener('change', refill);
        r.querySelector('#f').addEventListener('submit', (e) => {
          e.preventDefault(); const f = formData(e.target);
          if (!f.birdId) return toast('لا يوجد طائر مرتبط بهذا المالك', 'bad');
          const p = addPayment({ ownerId: +f.ownerId, birdId: +f.birdId, amount: +f.amount, type: f.type, method: f.method, date: f.date });
          if (f.type === 'علاج') { let left = +f.amount; birdTreatments(bird(f.birdId)).filter((t) => !t.paid).forEach((t) => { if (left >= t.cost) { t.paid = true; left -= t.cost; } }); }
          log(`تسجيل دفعة ${p.receipt} بمبلغ ${moneyTxt(p.amount)}`); persist(); closeModal(); receiptModal(p);
        });
      } });
  }

  function receiptModal(p) {
    const o = owner(p.ownerId), b = bird(p.birdId);
    modal({ title: 'إيصال استلام', size: 'sm',
      body: `<div class="rounded-2xl border-2 border-dashed border-gold/60 p-5 text-center">
        <img src="assets/img/logo.png" alt="" class="mx-auto h-12 w-auto"><div class="mt-1 font-brand text-xl font-bold text-navy">مِربَط</div><div class="text-xs text-mute">${esc(S().tenant)}</div>
        <div class="my-4 text-3xl font-extrabold text-navy">${money(p.amount)}</div>
        <div class="text-start text-sm">${[['رقم الإيصال', `<span class="ltr">${p.receipt}</span>`], ['التاريخ', date(p.date)], ['المالك', esc(o.name)], ['الطائر', b ? `<span class="ltr">${esc(b.ring)}</span>` : '—'], ['النوع', esc(p.type)], ['الوسيلة', esc(p.method)], ['المتبقي بعد الدفعة', b ? moneyTxt(birdBalance(b)) : '—']].map(([k, val]) => `<div class="dl-row"><span class="text-mute">${k}</span><b class="text-navy">${val}</b></div>`).join('')}</div></div>`,
      footer: `<button class="btn btn-primary" data-close>تم</button>`, onClose: () => render() });
    toast(`تم تسجيل الدفعة <b class="ltr">${p.receipt}</b>`);
  }

  function expenseModal() {
    modal({ title: 'تسجيل مصروف', size: 'sm',
      body: `<form id="f" class="grid gap-4">${field({ id: 'category', label: 'البند', type: 'select', options: ['الرواتب', 'مصاريف التشغيل', 'اشتراك المنصة', 'التغذية والفريس', 'العلاج والتحصينات', 'أخرى'] })}${field({ id: 'amount', label: 'المبلغ (ر.ق)', type: 'number', min: 1, required: true })}${field({ id: 'date', label: 'التاريخ', type: 'date', value: TODAY })}${field({ id: 'note', label: 'البيان', type: 'textarea' })}</form>`,
      footer: `<button class="btn btn-ghost" data-close>إلغاء</button><button class="btn btn-primary" form="f">حفظ</button>`,
      onMount: (r) => r.querySelector('#f').addEventListener('submit', (e) => { e.preventDefault(); const f = formData(e.target); db.expenses.push({ id: Math.max(0, ...db.expenses.map((x) => x.id)) + 1, date: f.date, category: f.category, amount: +f.amount, note: f.note || f.category }); log(`تسجيل مصروف ${f.category}: ${moneyTxt(f.amount)}`); persist(); closeModal(); toast('تم تسجيل المصروف'); render(); }) });
  }

  /* =========================================================
     Rapports
     ========================================================= */
  let reportKey = null;
  function reportDefs() {
    const fin = can('finance') || isAdmin();
    return [
      { key: 'birds', label: 'الطيور', icon: 'bird', show: can('birds') || isAdmin(), rows: () => db.birds, cols: [
        { key: 'ring', label: 'الحلقة' }, { key: 'species', label: 'النوع' }, { key: 'sex', label: 'الجنس' }, { key: 'owner', label: 'المالك', text: (b) => owner(b.ownerId).name },
        { key: 'entryDate', label: 'الدخول' }, { key: 'endDate', label: 'نهاية المدة' }, { key: 'status', label: 'الحالة', text: (b) => (b.status === 'active' ? 'في الإقامة' : 'خرج') }, { key: 'health', label: 'الصحة' }] },
      { key: 'owners', label: 'الملاك', icon: 'users', show: canOwners(), rows: () => db.owners, cols: [
        { key: 'name', label: 'الاسم' }, { key: 'phone', label: 'الجوال' }, { key: 'area', label: 'الموقع' }, { key: 'nationality', label: 'الجنسية' }, { key: 'nb', label: 'عدد الطيور', text: (o) => ownerBirds(o).length },
        ...(fin ? [{ key: 'bal', label: 'المتبقي', text: (o) => ownerAccount(o).balance }] : [])] },
      { key: 'health', label: 'العلاج', icon: 'stethoscope', show: can('health'), rows: () => db.treatments, cols: [
        { key: 'ring', label: 'الحلقة', text: (t) => bird(t.birdId).ring }, { key: 'disease', label: 'المرض' }, { key: 'date', label: 'التاريخ' }, { key: 'clinic', label: 'العيادة' }, { key: 'doctor', label: 'الطبيب' }, { key: 'cost', label: 'التكلفة' }, { key: 'status', label: 'الحالة' }] },
      { key: 'vac', label: 'التحصينات', icon: 'syringe', show: can('health'), rows: () => activeBirds(), cols: [
        { key: 'ring', label: 'الحلقة' }, { key: 'v', label: 'الجرعات', text: (b) => `${b.vaccines.length}/${S().vacProgram.doses}` }, { key: 'last', label: 'آخر تحصين', text: (b) => lastVaccine(b)?.date || '' }, { key: 'due', label: 'مستحق', text: (b) => (vacDue(b) ? 'نعم' : 'لا') }] },
      { key: 'finance', label: 'المالية', icon: 'wallet', show: fin, rows: () => db.birds, cols: [
        { key: 'ring', label: 'الحلقة' }, { key: 'owner', label: 'المالك', text: (b) => owner(b.ownerId).name }, { key: 'total', label: 'الإجمالي', text: (b) => birdCharges(b).total }, { key: 'paid', label: 'المحصّل', text: birdPaid }, { key: 'bal', label: 'المتبقي', text: birdBalance }] },
      { key: 'inventory', label: 'المخزون', icon: 'package', show: can('inventory'), rows: () => db.items, cols: [
        { key: 'name', label: 'الصنف' }, { key: 'qty', label: 'الكمية' }, { key: 'unit', label: 'الوحدة' }, { key: 'min', label: 'حد التنبيه' }, { key: 'val', label: 'القيمة', text: (i) => i.qty * i.unitCost }] },
      { key: 'delivery', label: 'التوصيل', icon: 'truck', show: can('delivery'), rows: () => (me.role === 'driver' ? db.deliveries.filter((d) => d.driverId === me.id) : db.deliveries), cols: [
        { key: 'ring', label: 'الطائر', text: (d) => bird(d.birdId)?.ring }, { key: 'direction', label: 'الاتجاه' }, { key: 'address', label: 'العنوان' }, { key: 'date', label: 'التاريخ' }, { key: 'driver', label: 'السائق', text: (d) => staff(d.driverId)?.name || '' }, { key: 'status', label: 'الحالة' }, { key: 'fee', label: 'الرسوم' }] },
      { key: 'staff', label: 'الموظفون', icon: 'id-card', show: isAdmin(), rows: () => db.staff, cols: [
        { key: 'name', label: 'الاسم' }, { key: 'username', label: 'المستخدم' }, { key: 'role', label: 'الدور', text: (s) => roleOf(s).label }, { key: 'phone', label: 'الجوال' }, { key: 'active', label: 'الحالة', text: (s) => (s.active ? 'نشط' : 'معطّل') }] },
    ].filter((r) => r.show);
  }
  function viewReports(v) {
    const defs = reportDefs();
    if (!defs.find((d) => d.key === reportKey)) reportKey = defs[0]?.key;
    const rep = defs.find((d) => d.key === reportKey);
    v.innerHTML = pageHead('التقارير', 'ترتيب حسب أي عمود، مع التصدير إلى Excel') + `
      <div class="mb-5 flex flex-wrap gap-2">${defs.map((d) => `<button class="chip" data-r="${d.key}" aria-pressed="${d.key === reportKey}">${icon(d.icon, 'size-3.5')} ${d.label}</button>`).join('')}</div>
      ${rep ? `<div class="card"><div class="card-h"><h2 class="card-t">${icon(rep.icon, 'size-5 text-gold-600')} تقرير ${rep.label}</h2>
        <div class="flex gap-2">${FRAMED ? '<span class="text-xs text-mute">التصدير والطباعة متاحان عند تشغيل التطبيق من ملفاته</span>' : `<button class="btn btn-ghost btn-sm" id="r-csv">${icon('file-spreadsheet', 'size-3.5')} Excel</button><button class="btn btn-ghost btn-sm" id="r-print">${icon('printer', 'size-3.5')} طباعة</button>`}</div></div><div id="r-t" class="p-4"></div></div>` : '<p class="text-mute">لا توجد تقارير متاحة لدورك.</p>'}`;
    if (rep) {
      const rows = rep.rows();
      const cols = rep.cols.map((c) => ({ key: c.key, label: c.label, sort: c.text || ((r) => r[c.key]), render: (r) => esc(c.text ? c.text(r) : r[c.key]) }));
      const t = dataTable(document.getElementById('r-t'), { columns: cols, rows, pageSize: 15 });
      document.getElementById('r-csv')?.addEventListener('click', () => exportCSV(`mirbat-${rep.key}-${TODAY}.csv`, rep.cols, t.getRows()));
      document.getElementById('r-print')?.addEventListener('click', () => window.print());
    }
    v.querySelectorAll('[data-r]').forEach((x) => x.addEventListener('click', () => { reportKey = x.dataset.r; viewReports(v); icons(); }));
  }

  /* =========================================================
     Personnel & permissions (admin)
     ========================================================= */
  let staffTab = 'matrix';
  function viewStaff(v) {
    v.innerHTML = pageHead('الموظفون والصلاحيات', 'كل إجراء له صلاحية، تُمنح مباشرةً أو عبر أدوار قابلة للتعديل', `<button class="btn btn-gold" id="s-new">${icon('user-plus')} موظف جديد</button>`) + `
      <div class="card"><div class="flex gap-5 overflow-x-auto border-b border-line px-5 pt-3" role="tablist">
        ${[['matrix', 'مصفوفة الصلاحيات'], ['staff', 'الموظفون'], ['audit', 'سجل التدقيق']].map(([k, l]) => `<button role="tab" class="tab whitespace-nowrap" data-t="${k}" aria-selected="${staffTab === k}">${l}</button>`).join('')}
      </div><div id="s-body" class="p-5"></div></div>`;
    const el = document.getElementById('s-body');
    if (staffTab === 'matrix') {
      el.innerHTML = `<div class="overflow-x-auto"><table class="w-full min-w-[640px] text-sm"><thead><tr><th class="px-3 py-2 text-start text-xs text-mute">الدور</th>${D.MODULES.map((m) => `<th class="px-3 py-2 text-center text-xs font-bold text-navy"><span class="inline-flex flex-col items-center gap-1">${icon(m.icon, 'size-4 text-gold-600')}${m.label}</span></th>`).join('')}</tr></thead>
        <tbody>${db.roles.map((r) => `<tr class="border-t border-line"><td class="px-3 py-3 font-bold text-navy">${esc(r.label)} ${r.admin ? badge('إدارة الصلاحيات', 'gold') : ''}<div class="text-xs font-normal text-mute">${db.staff.filter((s) => s.role === r.key).length} موظف</div></td>
          ${D.MODULES.map((m) => `<td class="px-3 py-3 text-center"><label class="inline-grid cursor-pointer place-items-center"><input type="checkbox" class="peer sr-only" data-role="${r.key}" data-perm="${m.key}" ${r.perms.includes(m.key) ? 'checked' : ''} ${r.admin ? 'disabled' : ''}>
            <span class="grid size-8 place-items-center rounded-full bg-paper text-transparent ring-1 ring-line transition peer-checked:bg-ok peer-checked:text-white peer-checked:ring-ok peer-focus-visible:ring-2 peer-focus-visible:ring-gold peer-disabled:opacity-80">${icon('check', 'size-4')}</span></label></td>`).join('')}</tr>`).join('')}</tbody></table></div>
        <div class="mt-5 grid gap-3 rounded-xl bg-navy p-4 text-sm text-white/80 sm:grid-cols-2">
          ${['صلاحية محددة لكل إجراء، بلا أدوار مبرمجة مسبقاً', 'صلاحيات مباشرة لموظف أو أدوار جاهزة', 'إدارة الصلاحيات صلاحية بحد ذاتها', 'سجل تدقيق: من فعل ماذا ومتى'].map((t) => `<div class="flex items-center gap-2">${icon('shield-check', 'size-4 text-gold shrink-0')}${t}</div>`).join('')}</div>`;
      el.querySelectorAll('input[data-role]').forEach((c) => c.addEventListener('change', () => {
        const r = db.roles.find((x) => x.key === c.dataset.role);
        r.perms = c.checked ? [...new Set([...r.perms, c.dataset.perm])] : r.perms.filter((p) => p !== c.dataset.perm);
        log(`تعديل صلاحيات الدور «${r.label}»: ${c.checked ? '+' : '−'}${D.MODULES.find((m) => m.key === c.dataset.perm).label}`); persist();
        toast(`تم تحديث صلاحيات «${esc(r.label)}»`);
      }));
    }
    if (staffTab === 'staff') {
      dataTable(el, { rows: db.staff, columns: [
        { key: 'name', label: 'الاسم', render: (s) => `<b class="text-navy">${esc(s.name)}</b>` },
        { key: 'username', label: 'المستخدم', render: (s) => `<span class="ltr">${esc(s.username)}</span>` },
        { key: 'role', label: 'الدور', sort: (s) => roleOf(s).label, render: (s) => badge(roleOf(s).label, s.role === 'admin' ? 'gold' : 'info') },
        { key: 'phone', label: 'الجوال', render: (s) => `<span class="ltr">${esc(s.phone)}</span>` },
        { key: 'active', label: 'الحالة', render: (s) => badge(s.active ? 'نشط' : 'معطّل', s.active ? 'ok' : 'mute') },
        { key: 'a', label: '', nosort: true, render: (s) => s.id === me.id ? '' : `<button class="btn btn-ghost btn-sm" data-edit="${s.id}">تعديل</button>` },
      ] });
      const bind = () => el.querySelectorAll('[data-edit]').forEach((x) => x.onclick = () => staffModal(staff(x.dataset.edit)));
      bind(); new MutationObserver(bind).observe(el, { childList: true });
    }
    if (staffTab === 'audit') {
      el.innerHTML = `<ul class="divide-y divide-line">${db.audit.slice(0, 60).map((a) => { const d = new Date(a.ts); return `<li class="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm"><span><b class="text-navy">${esc(a.user)}</b> · ${esc(a.action)}</span><span class="text-xs text-mute tabular-nums">${dateShort(a.ts)} · <span class="ltr">${D.util.pad(d.getHours(), 2)}:${D.util.pad(d.getMinutes(), 2)}</span></span></li>`; }).join('')}</ul>`;
    }
    v.querySelectorAll('[data-t]').forEach((x) => x.addEventListener('click', () => { staffTab = x.dataset.t; viewStaff(v); icons(); }));
    document.getElementById('s-new').addEventListener('click', () => staffModal());
  }
  function staffModal(s) {
    modal({ title: s ? 'تعديل موظف' : 'موظف جديد', size: 'md',
      body: `<form id="f" class="grid gap-4 sm:grid-cols-2">${field({ id: 'name', label: 'الاسم', required: true, value: s?.name, cls: 'sm:col-span-2' })}${field({ id: 'username', label: 'اسم المستخدم', required: true, value: s?.username })}${field({ id: 'password', label: 'كلمة المرور', type: 'password', required: !s, placeholder: s ? 'اتركها فارغة دون تغيير' : '' })}
        ${field({ id: 'role', label: 'الدور', type: 'select', value: s?.role, options: db.roles.map((r) => ({ value: r.key, label: r.label })) })}${field({ id: 'phone', label: 'الجوال', value: s?.phone })}
        ${s ? field({ id: 'active', label: 'الحالة', type: 'select', value: s.active ? '1' : '0', options: [{ value: '1', label: 'نشط' }, { value: '0', label: 'معطّل' }] }) : ''}</form>`,
      footer: `<button class="btn btn-ghost" data-close>إلغاء</button><button class="btn btn-primary" form="f">حفظ</button>`,
      onMount: (r) => r.querySelector('#f').addEventListener('submit', (e) => {
        e.preventDefault(); const f = formData(e.target);
        if (db.staff.some((x) => x.username.toLowerCase() === f.username.toLowerCase() && x !== s)) return toast('اسم المستخدم مستخدم مسبقاً', 'bad');
        if (s) { Object.assign(s, { name: f.name, username: f.username, role: f.role, phone: f.phone, active: f.active === '1' }); if (f.password) s.password = f.password; log(`تعديل بيانات الموظف ${s.name}`); }
        else { db.staff.push({ id: Math.max(...db.staff.map((x) => x.id)) + 1, name: f.name, username: f.username, password: f.password, role: f.role, phone: f.phone, active: true }); log(`إضافة الموظف ${f.name}`); }
        persist(); closeModal(); toast('تم الحفظ'); render();
      }) });
  }

  /* =========================================================
     Paramètres (admin)
     ========================================================= */
  function viewSettings(v) {
    const st = S();
    const lvl = [{ value: 'mandatory', label: 'إلزامي' }, { value: 'warning', label: 'تحذير' }, { value: 'off', label: 'معطّل' }];
    v.innerHTML = pageHead('إعدادات المقيض', 'كل مقيض يضبط قواعده ومستوى الإلزام دون تعديل في النظام', `<button class="btn btn-primary" form="set-f">${icon('save')} حفظ الإعدادات</button>`) + `
      <form id="set-f" class="grid gap-5 lg:grid-cols-2">
        ${section('الموسم والطاقة', 'calendar-range', `<div class="grid gap-4 sm:grid-cols-2">${field({ id: 'tenant', label: 'اسم المقيض', value: st.tenant, cls: 'sm:col-span-2' })}${field({ id: 'sname', label: 'اسم الموسم', value: st.season.name })}${field({ id: 'capacity', label: 'الطاقة الاستيعابية (طائر)', type: 'number', min: 1, value: st.season.capacity, hint: 'بين 200 و 500 عادةً' })}${field({ id: 'sstart', label: 'بداية الموسم', type: 'date', value: st.season.start })}${field({ id: 'send', label: 'نهاية الموسم', type: 'date', value: st.season.end })}</div>`)}
        ${section('الأسعار والرسوم', 'banknote', `<div class="grid gap-4 sm:grid-cols-2">${field({ id: 'price', label: 'سعر الإقامة الافتراضي (ر.ق)', type: 'number', value: st.price })}${field({ id: 'stayMonths', label: 'مدة الإقامة (أشهر)', type: 'number', value: st.stayMonths })}${field({ id: 'deposit', label: 'العربون (ر.ق)', type: 'number', value: st.deposit })}${field({ id: 'depositEnabled', label: 'سياسة العربون', type: 'select', value: st.depositEnabled ? '1' : '0', options: [{ value: '1', label: 'مفعّل' }, { value: '0', label: 'معطّل' }] })}${field({ id: 'deliveryFee', label: 'رسوم التوصيل (ر.ق)', type: 'number', value: st.deliveryFee })}${field({ id: 'vaccineCost', label: 'تكلفة التحصين (ر.ق)', type: 'number', value: st.vaccineCost })}</div>`)}
        ${section('قواعد مرنة ومستوى الإلزام', 'sliders-horizontal', `<div class="flex flex-col gap-4">
          ${[['intakeExam', 'فحص الاستلام البيطري', 'يمنع فتح الإقامة قبل تسجيل الفحص'], ['capacity', 'امتلاء الطاقة الاستيعابية', 'لا قائمة انتظار: الامتلاء يخضع لمستوى الإلزام'], ['vacDelay', 'مهلة التحصين بعد العلاج', 'الفاصل الأدنى بين نهاية العلاج والتحصين']].map(([k, l, h]) => `
            <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-paper p-3"><div><div class="font-bold text-navy">${l}</div><div class="text-xs text-mute">${h}</div></div>${segmented(`rule-${k}`, lvl, st.rules[k])}</div>`).join('')}
          <div class="grid grid-cols-1 gap-2 text-xs text-mute sm:grid-cols-3"><span><b class="text-bad">إلزامي:</b> يمنع تنفيذ الإجراء</span><span><b class="text-gold-700">تحذير:</b> يسمح مع تنبيه</span><span><b>معطّل:</b> القاعدة غير مفعّلة</span></div></div>`)}
        ${section('برنامج التحصين والعيادات', 'syringe', `<div class="grid gap-4 sm:grid-cols-3">${field({ id: 'doses', label: 'عدد الحقن', type: 'number', min: 1, max: 5, value: st.vacProgram.doses })}${field({ id: 'interval', label: 'الفاصل (أيام)', type: 'number', min: 1, value: st.vacProgram.intervalDays })}${field({ id: 'vacDelayDays', label: 'مهلة العلاج ← التحصين', type: 'number', min: 0, value: st.vacDelayDays })}</div>
          <ul class="mt-4 divide-y divide-line text-sm">${st.clinics.map((c) => `<li class="flex flex-wrap justify-between gap-2 py-2"><b class="text-navy">${esc(c.name)}</b><span class="text-mute">${c.doctors.map(esc).join('، ')}</span></li>`).join('')}</ul>
          <div class="mt-3 text-xs text-mute">وسائل الدفع: ${st.paymentMethods.join(' · ')}</div>`)}
      </form>
      <div class="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-bad/40 bg-bad-100/50 p-4"><div><b class="text-bad">بيانات العرض التجريبي</b><p class="text-sm text-mute">إعادة توليد كل البيانات التجريبية وإلغاء التعديلات المحلية.</p></div><button class="btn btn-danger" id="reset">${icon('rotate-ccw')} إعادة التعيين</button></div>`;
    document.getElementById('set-f').addEventListener('submit', (e) => {
      e.preventDefault(); const f = formData(e.target);
      Object.assign(st, { tenant: f.tenant, price: +f.price, stayMonths: +f.stayMonths, deposit: +f.deposit, depositEnabled: f.depositEnabled === '1', deliveryFee: +f.deliveryFee, vaccineCost: +f.vaccineCost, vacDelayDays: +f.vacDelayDays });
      Object.assign(st.season, { name: f.sname, capacity: +f.capacity, start: f.sstart, end: f.send });
      st.vacProgram = { doses: +f.doses, intervalDays: +f.interval };
      st.rules = { intakeExam: f['rule-intakeExam'], capacity: f['rule-capacity'], vacDelay: f['rule-vacDelay'] };
      log('تحديث إعدادات المقيض'); persist(); toast('تم حفظ إعدادات المقيض'); render();
    });
    document.getElementById('reset').addEventListener('click', () => confirmBox({ title: 'إعادة تعيين البيانات', message: 'سيتم حذف كل التعديلات واستعادة البيانات التجريبية الأصلية. هل تريد المتابعة؟', okText: 'إعادة التعيين', tone: 'danger',
      onOk: () => { const id = me.id; db = D.reset(); me = staff(id) || db.staff[0]; toast('تمت استعادة البيانات التجريبية'); render(); } }));
  }

  /* =========================================================
     Démarrage
     ========================================================= */
  const sess = D.session.get();
  if (sess) { const u = staff(sess.id); if (u && u.active) me = u; }
  render();
})();
