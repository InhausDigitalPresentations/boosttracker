/* ==========================================================================
   UTILS.JS — shared formatting / calculation / UI helpers
   ========================================================================== */

window.Utils = (function () {

  // ---- formatting -----------------------------------------------------------
  function formatCurrency(n) {
    const num = Number(n) || 0;
    // AED has no native Intl currency symbol in most locales, so we format the
    // number and prefix it manually to guarantee a clean "AED 1,234" look.
    return 'AED ' + num.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }

  function formatDate(dateStr) {
    if (!dateStr) return '—';
    const [y, m, d] = dateStr.split('-').map(Number);
    if (!y || !m || !d) return dateStr;
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function monthLabel(monthStr) {
    if (!monthStr) return '—';
    const [y, m] = monthStr.split('-').map(Number);
    const dt = new Date(y, m - 1, 1);
    return dt.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  function todayStr() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  // ---- calculations -----------------------------------------------------------
  function calcEndDate(startDate, durationDays) {
    if (!startDate || !durationDays) return startDate || '';
    const [y, m, d] = startDate.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + (Number(durationDays) - 1));
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  }

  function calcAllocated(boosts) {
    return boosts.reduce((sum, b) => sum + Number(b.budget || 0), 0);
  }

  function calcRemaining(monthlyBudget, allocated) {
    return Number(monthlyBudget || 0) - Number(allocated || 0);
  }

  const PENDING_STATUSES = ['To Do', 'In Progress'];

  function calcPendingTasks(boosts) {
    return boosts.filter((b) => PENDING_STATUSES.includes(b.status)).length;
  }

  function progressPercent(allocated, monthlyBudget) {
    if (!monthlyBudget || monthlyBudget <= 0) return allocated > 0 ? 100 : 0;
    return Math.max(0, Math.min(100, (allocated / monthlyBudget) * 100));
  }

  // ---- status / priority / invoice badges -----------------------------------
  const STATUS_COLORS = {
    'To Do': 'grey',
    'In Progress': 'orange',
    'Boosted': 'accent',
    'Completed': 'green',
    'Cancelled': 'red',
  };

  const INVOICE_COLORS = {
    'Pending': 'grey',
    'Invoiced': 'orange',
    'Paid': 'green',
  };

  function statusBadgeClass(status) {
    return 'badge badge-' + (STATUS_COLORS[status] || 'grey');
  }

  function invoiceBadgeClass(status) {
    return 'badge badge-' + (INVOICE_COLORS[status] || 'grey');
  }

  function priorityBadgeClass(priority) {
    return priority === 'Urgent' ? 'badge badge-red' : 'badge badge-grey';
  }

  // ---- small dom helpers ------------------------------------------------------
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach((k) => {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach((c) => node.appendChild(c));
    return node;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function toast(message, type) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const t = document.createElement('div');
    t.className = 'toast toast-' + (type || 'default');
    t.textContent = message;
    container.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 250);
    }, 2600);
  }

  function initials(name) {
    if (!name) return '?';
    return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
  }

  return {
    formatCurrency, formatDate, monthLabel, todayStr,
    calcEndDate, calcAllocated, calcRemaining, calcPendingTasks, progressPercent,
    statusBadgeClass, invoiceBadgeClass, priorityBadgeClass,
    STATUS_COLORS, INVOICE_COLORS,
    el, escapeHtml, toast, initials,
  };
})();
