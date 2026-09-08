// js/core/shell.js
// Sidebar dùng chung + hash routing. main.js chỉ cần gọi initShell(profile).
// Mỗi module trong js/modules/ export 1 hàm render(container, profile) duy nhất.

import { roleLabel, signOut } from './auth.js';

const ROUTES = {
  '':         { module: 'dashboard', label: 'Tổng quan' },
  'taisan':   { module: 'taisan',    label: 'Tài sản' },
  'doitac':   { module: 'doitac',    label: 'Đối tác' },
  'giaonhan': { module: 'giaonhan',  label: 'Giao nhận' },
  'bangke':   { module: 'bangke',    label: 'Bảng kê' },
  'haohut':   { module: 'haohut',    label: 'Hao hụt' },
};

function currentRouteKey() {
  const hash = window.location.hash.replace(/^#\/?/, '');
  return ROUTES[hash] ? hash : '';
}

function renderSidebar(profile, activeKey) {
  const navHtml = Object.entries(ROUTES).map(([key, r]) =>
    `<a href="#/${key}" data-route="${key}" class="${key === activeKey ? 'active' : ''}">${r.label}</a>`
  ).join('');

  document.getElementById('sidebar').innerHTML = `
    <div class="brand">
      <div class="name">TRƯỜNG THỊNH</div>
      <div class="tag">Quản lý tài sản thiết bị</div>
    </div>
    <nav class="nav">${navHtml}</nav>
    <div class="sidebar-foot">
      <div class="who">${profile.full_name} · ${roleLabel(profile.role)}</div>
      <button id="btnSignOut">Đăng xuất</button>
    </div>
  `;
  document.getElementById('btnSignOut').addEventListener('click', signOut);
}

async function loadRoute(profile) {
  const key = currentRouteKey();
  const route = ROUTES[key];
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading">Đang tải...</div>';

  document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('active', a.dataset.route === key));

  try {
    const mod = await import(`../modules/${route.module}.js`);
    await mod.render(content, profile);
  } catch (err) {
    console.error(err);
    content.innerHTML = `<div class="error-box">Lỗi tải trang "${route.label}": ${err.message}</div>`;
  }
}

export function initShell(profile) {
  renderSidebar(profile, currentRouteKey());
  window.addEventListener('hashchange', () => loadRoute(profile));
  loadRoute(profile);
}
