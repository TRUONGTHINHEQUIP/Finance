// js/core/shell.js
// Topbar + sidebar (nhóm mục) + hash routing. main.js chỉ cần gọi initShell(profile).
// Mỗi module trong js/modules/ export 1 hàm render(container, profile) duy nhất.

import { roleLabel, signOut } from './auth.js';

const ROUTE_GROUPS = [
  {
    label: 'Tổng quan',
    routes: [{ key: '', module: 'dashboard', label: 'Tổng quan', icon: '◈' }],
  },
  {
    label: 'Nghiệp vụ',
    routes: [
      { key: 'taisan', module: 'taisan', label: 'Tài sản', icon: '▤' },
      { key: 'doitac', module: 'doitac', label: 'Đối tác', icon: '◫' },
      { key: 'giaonhan', module: 'giaonhan', label: 'Giao nhận', icon: '⇄' },
      { key: 'bangke', module: 'bangke', label: 'Bảng kê', icon: '▦' },
      { key: 'haohut', module: 'haohut', label: 'Hao hụt', icon: '⚠' },
    ],
  },
  {
    label: 'Quản trị',
    adminOnly: true,
    routes: [{ key: 'users', module: 'users', label: 'Người dùng', icon: '⚙' }],
  },
];

function allRoutes() {
  return ROUTE_GROUPS.flatMap(g => g.routes);
}

function currentRouteKey() {
  const hash = window.location.hash.replace(/^#\/?/, '');
  return allRoutes().some(r => r.key === hash) ? hash : '';
}

function renderTopbar(profile) {
  document.getElementById('topbar').innerHTML = `
    <div class="brand"><span class="dot"></span><span class="name">TRƯỜNG THỊNH</span></div>
    <div class="user">
      <span>${profile.full_name}</span>
      <span class="role-chip">${roleLabel(profile.role)}</span>
      <button id="btnSignOut">Đăng xuất</button>
    </div>
  `;
  document.getElementById('btnSignOut').addEventListener('click', signOut);
}

function renderSidebar(profile, activeKey) {
  const groupsHtml = ROUTE_GROUPS
    .filter(g => !g.adminOnly || profile.role === 'admin')
    .map(g => `
      <div class="group-label">${g.label}</div>
      <nav class="nav">
        ${g.routes.map(r => `<a href="#/${r.key}" data-route="${r.key}" class="${r.key === activeKey ? 'active' : ''}">
          <span class="ico">${r.icon}</span>${r.label}
        </a>`).join('')}
      </nav>
    `).join('');

  document.getElementById('sidebar').innerHTML = groupsHtml;
}

let renderToken = 0;

async function loadRoute(profile) {
  const myToken = ++renderToken;
  const isStale = () => myToken !== renderToken;

  const key = currentRouteKey();
  const route = allRoutes().find(r => r.key === key);
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading">Đang tải...</div>';

  document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('active', a.dataset.route === key));

  try {
    const mod = await import(`../modules/${route.module}.js`);
    if (isStale()) return; // đã chuyển sang trang khác trong lúc chờ import module
    await mod.render(content, profile, isStale);
  } catch (err) {
    if (isStale()) return; // đã chuyển trang, không cần báo lỗi nữa
    console.error(err);
    content.innerHTML = `<div class="error-box">Lỗi tải trang "${route.label}": ${err.message}</div>`;
  }
}

export function initShell(profile) {
  renderTopbar(profile);
  renderSidebar(profile, currentRouteKey());
  window.addEventListener('hashchange', () => loadRoute(profile));
  loadRoute(profile);
}
