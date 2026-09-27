/* ============================================================
   مِربَط · MAQIDH — Données de démonstration & stockage
   Toutes les données sont générées localement (démo).
   ============================================================ */
(function () {
  'use strict';

  const DB_KEY = 'mirbat-db-v1';
  const SESSION_KEY = 'mirbat-session';

  /* ---------- Modules & profils (slide 14 : الموظفون والصلاحيات) ---------- */
  const MODULES = [
    { key: 'birds',     label: 'الطيور',    icon: 'bird' },
    { key: 'health',    label: 'الصحة',     icon: 'heart-pulse' },
    { key: 'finance',   label: 'المالية',   icon: 'wallet' },
    { key: 'inventory', label: 'المخزون',   icon: 'package' },
    { key: 'delivery',  label: 'التوصيل',   icon: 'truck' },
    { key: 'bookings',  label: 'الحجوزات',  icon: 'calendar-check' },
  ];

  const ROLES = [
    { key: 'admin',     label: 'المشرف / المدير',  perms: ['birds', 'health', 'finance', 'inventory', 'delivery', 'bookings'], admin: true },
    { key: 'accountant',label: 'المحاسب',          perms: ['finance'] },
    { key: 'vet',       label: 'الممرض / الطبيب',  perms: ['birds', 'health'] },
    { key: 'reception', label: 'موظف الاستقبال',   perms: ['birds', 'bookings'] },
    { key: 'driver',    label: 'السائق',           perms: ['delivery'] },
    { key: 'feeder',    label: 'عامل التغذية',     perms: ['birds', 'inventory'] },
  ];

  const STAFF = [
    { id: 1, name: 'حمد بن سالم المري',   username: 'admin',     password: 'admin123', role: 'admin',      phone: '+974 5512 3401', active: true },
    { id: 2, name: 'مريم الكواري',         username: 'comptable', password: 'compta123', role: 'accountant', phone: '+974 5512 3402', active: true },
    { id: 3, name: 'د. سالم النعيمي',      username: 'docteur',   password: 'vet123',   role: 'vet',        phone: '+974 5512 3403', active: true },
    { id: 4, name: 'عبدالله الهاجري',      username: 'accueil',   password: 'accueil123', role: 'reception', phone: '+974 5512 3404', active: true },
    { id: 5, name: 'راشد الدوسري',         username: 'chauffeur', password: 'drive123', role: 'driver',     phone: '+974 5512 3405', active: true },
    { id: 6, name: 'مبارك الشمري',         username: 'soigneur',  password: 'feed123',  role: 'feeder',     phone: '+974 5512 3406', active: true },
    { id: 7, name: 'ناصر العطية',          username: 'chauffeur2',password: 'drive123', role: 'driver',     phone: '+974 5512 3407', active: true },
    { id: 8, name: 'د. نورة المهندي',      username: 'docteur2',  password: 'vet123',   role: 'vet',        phone: '+974 5512 3408', active: true },
  ];

  /* ---------- Générateur pseudo-aléatoire déterministe ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const pad = (n, l = 4) => String(n).padStart(l, '0');
  const iso = (d) => {
    const x = new Date(d);
    return `${x.getFullYear()}-${pad(x.getMonth() + 1, 2)}-${pad(x.getDate(), 2)}`;
  };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const addMonths = (d, n) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; };
  const todayISO = () => iso(new Date());

  function seed() {
    const R = mulberry32(2026);
    const pick = (arr) => arr[Math.floor(R() * arr.length)];
    const between = (a, b) => a + Math.floor(R() * (b - a + 1));

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const year = today.getFullYear();
    const seasonStart = new Date(year, 2, 1);   // 1 mars
    const seasonEnd = new Date(year, 9, 31);    // 31 octobre

    const settings = {
      tenant: 'مقيض الوكرة',
      season: { name: `موسم ${year}`, start: iso(seasonStart), end: iso(seasonEnd), capacity: 500, active: true },
      price: 3500, deposit: 1000, depositEnabled: true, stayMonths: 7,
      deliveryFee: 200, vaccineCost: 150,
      vacProgram: { doses: 2, intervalDays: 21 },
      vacDelayDays: 14,
      rules: { intakeExam: 'mandatory', capacity: 'warning', vacDelay: 'warning' },
      paymentMethods: ['نقداً', 'تحويل بنكي', 'بطاقة'],
      clinics: [
        { name: 'مستشفى سوق واقف للصقور', doctors: ['د. سالم النعيمي', 'د. خليفة الكبيسي'] },
        { name: 'عيادة الريان البيطرية', doctors: ['د. نورة المهندي'] },
        { name: 'عيادة المقيض الداخلية', doctors: ['د. سالم النعيمي', 'د. نورة المهندي'] },
      ],
      species: ['صقر حر', 'صقر شاهين', 'صقر جير', 'جير شاهين', 'جير حر', 'وكري'],
    };

    /* Propriétaires */
    const first = ['محمد', 'خالد', 'عبدالله', 'حمد', 'سعود', 'ناصر', 'جاسم', 'فهد', 'علي', 'سلطان', 'راشد', 'مبارك', 'تميم', 'فيصل', 'عبدالرحمن', 'يوسف', 'منصور', 'ماجد', 'غانم', 'حمد'];
    const fam = ['آل ثاني', 'المري', 'الكواري', 'الهاجري', 'النعيمي', 'السليطي', 'العطية', 'المهندي', 'الكعبي', 'الدوسري', 'الشمري', 'المناعي', 'الخليفي', 'البوعينين', 'الكبيسي', 'السويدي'];
    const areas = ['الدوحة', 'الوكرة', 'الريان', 'الخور', 'أم صلال', 'الشمال', 'لوسيل', 'الشحانية'];
    const nats = ['قطري', 'قطري', 'قطري', 'سعودي', 'إماراتي', 'كويتي', 'بحريني'];
    const owners = [];
    for (let i = 1; i <= 128; i++) {
      owners.push({
        id: i,
        name: `${pick(first)} ${pick(first)} ${pick(fam)}`,
        area: pick(areas),
        phone: `+974 ${between(3000, 7799)} ${between(1000, 9999)}`,
        email: `owner${pad(i, 3)}@mail.qa`,
        qid: `2${between(80, 99)}${between(10000000, 99999999)}`,
        nationality: pick(nats),
        vip: R() < 0.12,
        active: true,
        seasons: between(1, 5),
      });
    }

    /* Oiseaux */
    const birds = [], payments = [], treatments = [], deliveries = [], bookings = [];
    const diseases = ['التهاب الجهاز التنفسي', 'الأسبرجلس', 'الكوكسيديا', 'تورم القدم (Bumblefoot)', 'ديدان معوية', 'جرح في الجناح', 'التريكوموناس'];
    const meds = ['إنروفلوكساسين', 'إيتراكونازول', 'ميترونيدازول', 'مضاد التهاب', 'فيتامينات', 'مرهم موضعي'];
    let receipt = 1, treatId = 1, delivId = 1;

    const addPayment = (p) => { payments.push({ id: receipt, receipt: `RC-${pad(receipt, 5)}`, method: pick(settings.paymentMethods), ...p }); receipt++; };

    const TOTAL_ACTIVE = 342, TOTAL_EXITED = 22;
    for (let i = 1; i <= TOTAL_ACTIVE + TOTAL_EXITED; i++) {
      const ownerId = between(1, owners.length);
      let entry = addDays(seasonStart, between(0, 88));
      if (i > TOTAL_ACTIVE - 6 && i <= TOTAL_ACTIVE) entry = addDays(today, -between(0, 6));
      if (entry > today) entry.setTime(addDays(today, -between(5, 60)).getTime());
      const end = addMonths(entry, settings.stayMonths);
      const exited = i > TOTAL_ACTIVE;
      const exitDate = exited ? addDays(entry, between(90, 170)) : null;
      const r = R();
      const health = exited ? 'سليم' : r < 0.08 ? 'تحت العلاج' : r < 0.13 ? 'يحتاج فحص' : 'سليم';
      const w0 = between(780, 1350);
      const weights = [];
      const refDate = exitDate && exitDate < today ? exitDate : today;
      for (let d = new Date(entry); d <= refDate; d = addDays(d, 14)) {
        weights.push({ date: iso(d), g: Math.round(w0 + (R() - 0.45) * 40 + weights.length * 3) });
      }
      const vaccines = [];
      if (R() < 0.95) {
        const d1 = addDays(entry, between(5, 12));
        if (d1 <= today) {
          vaccines.push({ dose: 1, name: 'لقاح نيوكاسل (PMV-1)', date: iso(d1), clinic: settings.clinics[2].name, cost: settings.vaccineCost });
          const d2 = addDays(d1, settings.vacProgram.intervalDays);
          if (d2 <= today && R() < 0.84) vaccines.push({ dose: 2, name: 'لقاح نيوكاسل (PMV-1)', date: iso(d2), clinic: settings.clinics[2].name, cost: settings.vaccineCost });
        }
      }
      const price = R() < 0.08 ? 3000 : settings.price;
      const ring = `QA-${pad(i)}`;
      const bird = {
        id: i, ring, ownerId,
        species: pick(settings.species),
        sex: R() < 0.7 ? 'أنثى' : 'ذكر',
        age: between(1, 9),
        passport: `QFP-${between(10000, 99999)}`,
        chip: `634${between(100000000, 999999999)}${between(100, 999)}`,
        cites: R() < 0.7 ? `QA/${String(year).slice(2)}/${between(1000, 9999)}` : '',
        entryDate: iso(entry), endDate: iso(end),
        exitDate: exitDate ? iso(exitDate) : null,
        status: exited ? 'exited' : 'active',
        health, weights, vaccines, price,
        molt: between(10, 95),
        fromClinic: R() < 0.4,
        intakeExam: { done: true, result: 'سليم', date: iso(entry) },
        staffId: pick([6, 3, 8]),
        stayId: `M-${pad(i)}`,
      };
      birds.push(bird);

      // Réservation initiale (convertie en séjour)
      const bDate = addDays(entry, -between(3, 20));
      bookings.push({ id: `R-${pad(i)}`, birdId: i, ownerId, ring, species: bird.species, date: iso(bDate), arrival: iso(entry), time: pick(['09:00', '10:30', '16:00', '17:30']), deposit: settings.deposit, status: 'checked_in' });

      // Paiements
      addPayment({ birdId: i, ownerId, date: iso(bDate), amount: settings.deposit, type: 'عربون' });
      const pr = R();
      if (pr < 0.84) addPayment({ birdId: i, ownerId, date: iso(entry), amount: price - settings.deposit, type: 'دفعة استلام' });
      else if (pr < 0.94) addPayment({ birdId: i, ownerId, date: iso(entry), amount: 1500, type: 'دفعة استلام' });

      // Vaccins réglés par la plupart des propriétaires
      if (vaccines.length && R() < 0.8) addPayment({ birdId: i, ownerId, date: vaccines[vaccines.length - 1].date, amount: vaccines.length * settings.vaccineCost, type: 'تحصين' });

      // Traitements
      if (health === 'تحت العلاج' || R() < 0.1) {
        const tDate = addDays(entry, between(15, 120));
        const td = tDate > today ? addDays(today, -between(1, 6)) : tDate;
        const ongoing = health === 'تحت العلاج';
        const clinic = pick(settings.clinics);
        const cost = between(3, 18) * 50;
        treatments.push({
          id: treatId++, birdId: i, disease: pick(diseases), date: iso(ongoing ? addDays(today, -between(1, 6)) : td),
          clinic: clinic.name, doctor: pick(clinic.doctors), meds: `${pick(meds)} + ${pick(meds)}`,
          days: between(5, 14), cost, status: ongoing ? 'جاري' : 'منتهي', paid: !ongoing && R() < 0.6,
        });
      }

      // Livraisons
      if (R() < 0.12) {
        deliveries.push({
          id: delivId++, birdId: i, ownerId, direction: 'دخول', address: `${owners[ownerId - 1].area} — منطقة ${between(10, 90)}، شارع ${between(100, 999)}`,
          date: iso(entry), time: '09:00', driverId: pick([5, 7]), status: 'تمت', fee: settings.deliveryFee,
        });
      }
    }

    // Livraisons à venir (sorties proches)
    const soon = birds.filter((b) => b.status === 'active').slice(0, 9);
    soon.forEach((b, k) => {
      deliveries.push({
        id: delivId++, birdId: b.id, ownerId: b.ownerId, direction: k % 3 === 0 ? 'دخول' : 'خروج',
        address: `${owners[b.ownerId - 1].area} — منطقة ${between(10, 90)}، شارع ${between(100, 999)}`,
        date: iso(addDays(today, k < 3 ? 0 : between(1, 6))), time: pick(['08:30', '10:00', '15:30', '17:00']),
        driverId: k === 8 ? null : pick([5, 7]), status: k < 1 ? 'تمت' : 'معلّقة', fee: settings.deliveryFee,
      });
    });
    deliveries.push({ id: delivId++, birdId: soon[2].id, ownerId: soon[2].ownerId, direction: 'خروج', address: 'الخور — منطقة 74، شارع 210', date: iso(addDays(today, -2)), time: '16:00', driverId: 7, status: 'لم تتم', fee: settings.deliveryFee });

    // Réservations en attente
    for (let k = 1; k <= 11; k++) {
      const ownerId = between(1, owners.length);
      const n = TOTAL_ACTIVE + TOTAL_EXITED + k;
      bookings.push({
        id: `R-${pad(n)}`, birdId: null, ownerId, ring: `QA-${pad(n)}`, species: pick(settings.species),
        date: iso(addDays(today, -between(1, 12))), arrival: iso(addDays(today, between(-1, 12))),
        time: pick(['09:00', '10:30', '16:00']), deposit: k % 4 === 0 ? 0 : settings.deposit, status: 'pending',
      });
      if (k % 4 !== 0) addPayment({ birdId: null, bookingId: `R-${pad(n)}`, ownerId, date: iso(addDays(today, -between(1, 10))), amount: settings.deposit, type: 'عربون' });
    }
    bookings.push({ id: `R-${pad(900)}`, birdId: null, ownerId: 12, ring: 'QA-0900', species: 'صقر حر', date: iso(addDays(today, -20)), arrival: iso(addDays(today, -8)), time: '10:00', deposit: 1000, status: 'rejected', reason: 'نتيجة فحص الاستلام: إصابة معدية' });

    // Paiements de traitements soldés
    treatments.filter((t) => t.paid).forEach((t) => addPayment({ birdId: t.birdId, ownerId: birds[t.birdId - 1].ownerId, date: t.date, amount: t.cost, type: 'علاج' }));

    /* Stock, proies, fournisseurs */
    const suppliers = [
      { id: 1, name: 'مزرعة الشمال للدواجن', phone: '+974 4401 2201', starred: true, items: 'سيقان الدجاج، الصيصان' },
      { id: 2, name: 'مؤسسة الصقّار للأعلاف', phone: '+974 4401 2202', starred: false, items: 'أعلاف، فيتامينات' },
      { id: 3, name: 'حمام الوكرة', phone: '+974 4401 2203', starred: true, items: 'فريس (حمام)' },
      { id: 4, name: 'شركة الخليج للتبريد', phone: '+974 4401 2204', starred: false, items: 'الصيصان المجمدة' },
    ];
    const items = [
      { id: 1, name: 'الأعلاف', unit: 'كغ', qty: 420, min: 300, max: 1500, unitCost: 18 },
      { id: 2, name: 'سيقان الدجاج', unit: 'كغ', qty: 190, min: 250, max: 900, unitCost: 14 },
      { id: 3, name: 'الصيصان', unit: 'حبة', qty: 5200, min: 3000, max: 12000, unitCost: 1.2 },
      { id: 4, name: 'الفريس (حمام)', unit: 'حبة', qty: 0, min: 60, max: 400, unitCost: 22, prey: true },
    ];
    const purchases = [], consumption = [];
    let purId = 1;
    for (let m = 0; m < 7; m++) {
      const d = addDays(seasonStart, m * 30 + 2);
      if (d > today) break;
      purchases.push({ id: purId++, date: iso(d), supplierId: 2, itemId: 1, qty: 600, unitPrice: 18 });
      purchases.push({ id: purId++, date: iso(addDays(d, 5)), supplierId: 1, itemId: 2, qty: 400, unitPrice: 14 });
      purchases.push({ id: purId++, date: iso(addDays(d, 8)), supplierId: 4, itemId: 3, qty: 6000, unitPrice: 1.2 });
      purchases.push({ id: purId++, date: iso(addDays(d, 12)), supplierId: 3, itemId: 4, qty: 120, unitPrice: 22 });
    }
    const preyBought = purchases.filter((p) => p.itemId === 4).reduce((s, p) => s + p.qty, 0);
    const preyLeft = 74;
    items[3].qty = preyLeft;
    for (let k = 14; k >= 0; k--) {
      const d = iso(addDays(today, -k));
      consumption.push({ date: d, itemId: 1, qty: between(34, 48) });
      consumption.push({ date: d, itemId: 3, qty: between(300, 420) });
    }
    consumption.push({ date: iso(addDays(today, -1)), itemId: 4, qty: preyBought - preyLeft });

    /* Dépenses saisies manuellement (salaires, exploitation, abonnement) */
    const expenses = [];
    let expId = 1;
    for (let m = 0; m < 7; m++) {
      const d = addDays(seasonStart, m * 30 + 27);
      if (d > today) break;
      expenses.push({ id: expId++, date: iso(d), category: 'الرواتب', amount: 38000, note: 'رواتب الموظفين الشهرية' });
      expenses.push({ id: expId++, date: iso(addDays(d, -10)), category: 'مصاريف التشغيل', amount: between(14, 22) * 1000, note: 'كهرباء وتكييف وصيانة' });
      expenses.push({ id: expId++, date: iso(addDays(d, -20)), category: 'اشتراك المنصة', amount: 8500, note: 'اشتراك مِربَط الشهري' });
    }

    const audit = [
      { ts: new Date(addDays(today, -1).setHours(9, 12)).toISOString(), user: 'عبدالله الهاجري', action: `استلام الطائر ${birds[40].ring} وفتح الإقامة ${birds[40].stayId}` },
      { ts: new Date(addDays(today, -1).setHours(11, 3)).toISOString(), user: 'د. سالم النعيمي', action: `تسجيل علاج للطائر ${birds[7].ring}` },
      { ts: new Date(addDays(today, -1).setHours(13, 40)).toISOString(), user: 'مريم الكواري', action: 'تسجيل دفعة RC-00210 بمبلغ 2,500 ر.ق' },
      { ts: new Date(addDays(today, 0).setHours(8, 5)).toISOString(), user: 'مبارك الشمري', action: 'تسجيل استهلاك يومي: الأعلاف 41 كغ' },
    ];

    return {
      version: 1, settings, roles: ROLES.map((r) => ({ ...r, perms: [...r.perms] })), staff: STAFF.map((s) => ({ ...s })),
      owners, birds, bookings, payments, treatments, deliveries, suppliers, items, purchases, consumption, expenses, audit,
    };
  }

  /* ---------- Stockage (localStorage protégé) ---------- */
  function safeGet(store, key) { try { return store.getItem(key); } catch (e) { return null; } }
  function safeSet(store, key, val) { try { store.setItem(key, val); } catch (e) { /* stockage indisponible */ } }
  function safeDel(store, key) { try { store.removeItem(key); } catch (e) { /* ignore */ } }
  const ls = (() => { try { return window.localStorage; } catch (e) { return null; } })();
  const ss = (() => { try { return window.sessionStorage; } catch (e) { return null; } })();

  let db = null;
  function load() {
    const raw = ls && safeGet(ls, DB_KEY);
    if (raw) { try { db = JSON.parse(raw); } catch (e) { db = null; } }
    if (!db || db.version !== 1) { db = seed(); save(); }
    return db;
  }
  function save() { if (ls) safeSet(ls, DB_KEY, JSON.stringify(db)); }
  function reset() { db = seed(); save(); return db; }

  window.MirbatData = {
    MODULES, ROLES, DB_KEY,
    load, save, reset,
    get db() { return db; },
    session: {
      get() { const v = ss && safeGet(ss, SESSION_KEY); try { return v ? JSON.parse(v) : null; } catch (e) { return null; } },
      set(v) { if (ss) safeSet(ss, SESSION_KEY, JSON.stringify(v)); },
      clear() { if (ss) safeDel(ss, SESSION_KEY); },
    },
    util: { iso, addDays, addMonths, todayISO, pad },
  };
})();
