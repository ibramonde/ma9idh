/* ============================================================
   مِربَط · Composants UI réutilisables
   (modal, toast, confirmation, badges, tableau paginé/triable…)
   ============================================================ */
(function () {
  'use strict';

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = new Intl.NumberFormat('en-US');
  const money = (n) => `${nf.format(Math.round(n || 0))} <span class="text-[0.8em] font-medium opacity-70">ر.ق</span>`;
  const moneyTxt = (n) => `${nf.format(Math.round(n || 0))} ر.ق`;
  const num = (n) => nf.format(Math.round(n || 0));
  const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const date = (s) => { if (!s) return '—'; const d = new Date(s); return `${d.getDate()} ${AR_MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
  const dateShort = (s) => { if (!s) return '—'; const d = new Date(s); return `${d.getDate()} ${AR_MONTHS[d.getMonth()]}`; };
  const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

  const icons = () => { if (window.lucide) window.lucide.createIcons({ attrs: { 'stroke-width': 1.75 } }); };
  const icon = (name, cls = 'size-4') => `<i data-lucide="${name}" class="${cls}"></i>`;

  /* ---------- Badges d'état ---------- */
  const TONES = {
    ok: 'bg-ok-100 text-ok ring-ok/20',
    bad: 'bg-bad-100 text-bad ring-bad/20',
    warn: 'bg-gold-100 text-gold-700 ring-gold/30',
    info: 'bg-navy-50 text-navy-700 ring-navy-700/15',
    mute: 'bg-paper text-mute ring-line',
    gold: 'bg-gold text-navy ring-gold',
  };
  const badge = (text, tone = 'mute', ic) => `<span class="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ring-inset ${TONES[tone] || TONES.mute}">${ic ? icon(ic, 'size-3') : ''}${esc(text)}</span>`;
  const healthBadge = (h) => badge(h, h === 'سليم' ? 'ok' : h === 'تحت العلاج' ? 'bad' : 'warn', h === 'سليم' ? 'check' : h === 'تحت العلاج' ? 'stethoscope' : 'search');

  /* ---------- Barre de progression ---------- */
  const progress = (pct, tone = 'navy') => {
    const colors = { navy: 'bg-navy-700', gold: 'bg-gold', ok: 'bg-ok', bad: 'bg-bad' };
    return `<div class="h-2 w-full overflow-hidden rounded-full bg-line/70"><div class="h-full rounded-full ${colors[tone] || colors.navy} transition-all" style="width:${Math.max(0, Math.min(100, pct))}%"></div></div>`;
  };

  /* ---------- Toasts ---------- */
  function toast(msg, tone = 'ok') {
    const host = document.getElementById('toasts');
    if (!host) return;
    const el = document.createElement('div');
    const toneCls = tone === 'bad' ? 'border-bad/40' : tone === 'warn' ? 'border-gold' : 'border-ok/40';
    const ic = tone === 'bad' ? 'circle-alert' : tone === 'warn' ? 'triangle-alert' : 'circle-check';
    const icCls = tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-gold-700' : 'text-ok';
    el.className = `toast pointer-events-auto flex items-start gap-3 rounded-xl border-s-4 ${toneCls} bg-white px-4 py-3 text-sm text-ink shadow-lg shadow-navy/10`;
    el.innerHTML = `${icon(ic, 'size-5 shrink-0 ' + icCls)}<div class="leading-relaxed">${msg}</div>`;
    host.appendChild(el);
    icons();
    setTimeout(() => { el.classList.add('toast-out'); setTimeout(() => el.remove(), 300); }, 3600);
  }

  /* ---------- Modal ---------- */
  let modalOnClose = null;
  function modal({ title, body, footer = '', size = 'md', onMount, onClose }) {
    const root = document.getElementById('modal-root');
    const widths = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-6xl' };
    root.innerHTML = `
      <div class="modal-backdrop fixed inset-0 z-40 flex items-end justify-center bg-navy-900/60 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" data-close>
        <div role="dialog" aria-modal="true" aria-labelledby="modal-title" class="modal-panel flex max-h-[92vh] w-full ${widths[size]} flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
          <div class="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
            <h3 id="modal-title" class="text-lg font-extrabold text-navy">${title}</h3>
            <button type="button" class="btn-icon" data-close aria-label="إغلاق">${icon('x', 'size-5')}</button>
          </div>
          <div class="modal-body overflow-y-auto px-5 py-5">${body}</div>
          ${footer ? `<div class="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-paper/60 px-5 py-3">${footer}</div>` : ''}
        </div>
      </div>`;
    modalOnClose = onClose || null;
    const backdrop = root.firstElementChild;
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop || e.target.closest('button[data-close]')) closeModal();
    });
    icons();
    const first = root.querySelector('input:not([type=hidden]),select,textarea');
    if (first) setTimeout(() => first.focus(), 50);
    if (onMount) onMount(root);
    return root;
  }
  function closeModal() {
    const root = document.getElementById('modal-root');
    if (root) root.innerHTML = '';
    if (modalOnClose) { const f = modalOnClose; modalOnClose = null; f(); }
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  /* Confirmation intégrée (les dialogues natifs sont bloqués dans certains cadres) */
  function confirmBox({ title = 'تأكيد', message, okText = 'تأكيد', tone = 'primary', onOk }) {
    modal({
      title, size: 'sm',
      body: `<p class="leading-relaxed text-ink">${message}</p>`,
      footer: `<button class="btn btn-ghost" data-close>إلغاء</button><button class="btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}" id="confirm-ok">${okText}</button>`,
      onMount: (r) => r.querySelector('#confirm-ok').addEventListener('click', () => { closeModal(); onOk && onOk(); }),
    });
  }

  /* ---------- Champs de formulaire ---------- */
  const field = ({ id, label, type = 'text', value = '', required, options, placeholder = '', hint = '', min, max, step, cls = '' }) => {
    let control;
    if (type === 'select') {
      control = `<select id="${id}" name="${id}" class="input" ${required ? 'required' : ''}>${options.map((o) => {
        const v = typeof o === 'object' ? o.value : o; const l = typeof o === 'object' ? o.label : o;
        return `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`;
      }).join('')}</select>`;
    } else if (type === 'textarea') {
      control = `<textarea id="${id}" name="${id}" rows="3" class="input" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`;
    } else {
      control = `<input id="${id}" name="${id}" type="${type}" class="input" value="${esc(value)}" placeholder="${esc(placeholder)}" ${required ? 'required' : ''} ${min != null ? `min="${min}"` : ''} ${max != null ? `max="${max}"` : ''} ${step != null ? `step="${step}"` : ''}>`;
    }
    return `<label class="flex flex-col gap-1.5 ${cls}" for="${id}"><span class="text-sm font-bold text-navy">${label}${required ? ' <span class="text-bad">*</span>' : ''}</span>${control}${hint ? `<span class="text-xs text-mute">${hint}</span>` : ''}</label>`;
  };
  const formData = (form) => Object.fromEntries(new FormData(form).entries());

  /* ---------- Tableau paginé, triable, filtrable ---------- */
  /* columns: [{key, label, render(row), sort(row) , cls}] */
  function dataTable(container, { columns, rows, pageSize = 12, onRow, empty = 'لا توجد بيانات', id = 'tbl', minW = 'min-w-[640px]' }) {
    const state = { page: 1, sortKey: null, dir: 1 };
    function draw() {
      let data = rows.slice();
      if (state.sortKey) {
        const col = columns.find((c) => c.key === state.sortKey);
        const get = col.sort || ((r) => r[col.key]);
        data.sort((a, b) => { const x = get(a), y = get(b); return (x > y ? 1 : x < y ? -1 : 0) * state.dir; });
      }
      const pages = Math.max(1, Math.ceil(data.length / pageSize));
      state.page = Math.min(state.page, pages);
      const slice = data.slice((state.page - 1) * pageSize, state.page * pageSize);
      container.innerHTML = `
        <div class="overflow-x-auto">
          <table class="w-full ${minW} border-separate border-spacing-0 text-sm" id="${id}">
            <thead><tr>${columns.map((c) => `
              <th scope="col" class="sticky top-0 border-b border-line bg-paper px-3 py-2.5 text-start text-xs font-bold text-mute ${c.cls || ''}">
                ${c.nosort ? esc(c.label) : `<button type="button" class="inline-flex items-center gap-1 hover:text-navy" data-sort="${c.key}">${esc(c.label)}${state.sortKey === c.key ? icon(state.dir === 1 ? 'arrow-up' : 'arrow-down', 'size-3') : icon('arrow-up-down', 'size-3 opacity-40')}</button>`}
              </th>`).join('')}</tr></thead>
            <tbody>${slice.length ? slice.map((r, i) => `
              <tr class="${onRow ? 'cursor-pointer' : ''} group" data-row="${(state.page - 1) * pageSize + i}">
                ${columns.map((c) => `<td class="border-b border-line/70 px-3 py-2.5 align-middle tabular-nums group-hover:bg-gold-50 ${c.cls || ''}">${c.render ? c.render(r) : esc(r[c.key])}</td>`).join('')}
              </tr>`).join('') : `<tr><td colspan="${columns.length}" class="px-3 py-10 text-center text-mute">${empty}</td></tr>`}
            </tbody>
          </table>
        </div>
        <div class="flex flex-wrap items-center justify-between gap-2 px-1 pt-3 text-xs text-mute">
          <span>${num(data.length)} سجل · صفحة ${state.page} من ${pages}</span>
          <div class="flex items-center gap-1">
            <button class="btn-icon" data-pg="prev" ${state.page === 1 ? 'disabled' : ''} aria-label="السابق">${icon('chevron-right')}</button>
            <button class="btn-icon" data-pg="next" ${state.page === pages ? 'disabled' : ''} aria-label="التالي">${icon('chevron-left')}</button>
          </div>
        </div>`;
      container.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => {
        const k = b.dataset.sort; if (state.sortKey === k) state.dir *= -1; else { state.sortKey = k; state.dir = 1; } draw();
      }));
      container.querySelector('[data-pg=prev]').addEventListener('click', () => { state.page--; draw(); });
      container.querySelector('[data-pg=next]').addEventListener('click', () => { state.page++; draw(); });
      if (onRow) container.querySelectorAll('tbody tr[data-row]').forEach((tr) => tr.addEventListener('click', (e) => {
        if (e.target.closest('button,a,input,select')) return;
        const idx = +tr.dataset.row; onRow(state.sortKey ? sorted()[idx] : rows[idx]);
      }));
      icons();
    }
    function sorted() {
      const col = columns.find((c) => c.key === state.sortKey); const get = col.sort || ((r) => r[col.key]);
      return rows.slice().sort((a, b) => { const x = get(a), y = get(b); return (x > y ? 1 : x < y ? -1 : 0) * state.dir; });
    }
    draw();
    return { redraw: (newRows) => { if (newRows) rows = newRows; draw(); }, getRows: () => (state.sortKey ? sorted() : rows) };
  }

  /* ---------- Export CSV (compatible Excel, UTF-8 BOM) ---------- */
  function exportCSV(filename, columns, rows) {
    const clean = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [columns.map((c) => clean(c.label)).join(',')]
      .concat(rows.map((r) => columns.map((c) => clean(c.text ? c.text(r) : r[c.key])).join(','))).join('\r\n');
    try {
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      toast(`تم تجهيز الملف <b>${esc(filename)}</b>`);
    } catch (e) { toast('تعذّر تصدير الملف في هذا المتصفح', 'bad'); }
  }

  /* ---------- Carte KPI ---------- */
  const kpi = ({ label, value, sub = '', ic, tone = 'navy' }) => {
    const tones = { navy: 'bg-navy text-gold', ok: 'bg-ok-100 text-ok', bad: 'bg-bad-100 text-bad', gold: 'bg-gold-100 text-gold-700' };
    return `<div class="flex items-start gap-3 rounded-2xl border border-line bg-white p-4">
      <span class="grid size-10 shrink-0 place-items-center rounded-xl ${tones[tone]}">${icon(ic, 'size-5')}</span>
      <div class="min-w-0"><div class="text-xs font-bold text-mute">${label}</div><div class="mt-0.5 text-xl font-extrabold text-navy tabular-nums">${value}</div>${sub ? `<div class="mt-0.5 text-xs text-mute">${sub}</div>` : ''}</div>
    </div>`;
  };

  /* ---------- Segmented control ---------- */
  const segmented = (name, options, value) => `<div class="inline-flex flex-wrap rounded-xl bg-paper p-1 ring-1 ring-line" role="radiogroup">${options.map((o) => `
    <label class="cursor-pointer"><input type="radio" class="peer sr-only" name="${name}" value="${o.value}" ${o.value === value ? 'checked' : ''}>
    <span class="block rounded-lg px-3 py-1.5 text-xs font-bold text-mute transition peer-checked:bg-white peer-checked:text-navy peer-checked:shadow-sm peer-focus-visible:ring-2 peer-focus-visible:ring-gold">${o.label}</span></label>`).join('')}</div>`;

  window.UI = { esc, money, moneyTxt, num, date, dateShort, daysBetween, icon, icons, badge, healthBadge, progress, toast, modal, closeModal, confirmBox, field, formData, dataTable, exportCSV, kpi, segmented, AR_MONTHS };
})();
