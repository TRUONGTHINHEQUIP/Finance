// js/modules/dashboard.js
import { supabase } from '../core/config.js';
import { fmtNum } from '../core/utils.js';

export async function render(container, profile, isStale = () => false) {
  container.innerHTML = `
    <div class="page-head">
      <div><h1>Tổng quan</h1><div class="sub">Vị trí tài sản, phiếu chờ xác nhận, và tình trạng bảo trì</div></div>
    </div>
    <div class="stat-row" id="statRow"><div class="loading">Đang tải...</div></div>
    <div class="panel">
      <div class="panel-head"><h3>Vị trí tài sản theo chủng loại</h3></div>
      <div class="panel-body" style="padding:0"><table id="posTable"><tbody><tr><td class="loading">Đang tải...</td></tr></tbody></table></div>
    </div>
  `;

  const { data: assets, error } = await supabase
    .from('asset_units')
    .select('id, status, category_id, warehouses:warehouse_id(name), projects:project_id(name)');

  if (error) {
    if (isStale()) return;
    container.querySelector('#statRow').innerHTML = `<div class="error-box">Lỗi tải dữ liệu: ${error.message}</div>`;
    return;
  }

  const total = assets.length;
  const taiKho = assets.filter(a => a.status === 'kho').length;
  const taiDuAn = assets.filter(a => a.status === 'tai_du_an').length;

  const { count: pendingCount } = await supabase
    .from('transfer_notes')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'tam');

  if (isStale()) return;

  container.querySelector('#statRow').innerHTML = `
    <div class="stat-card"><div class="lbl">Tổng tài sản</div><div class="val">${fmtNum(total)}</div></div>
    <div class="stat-card"><div class="lbl">Tại kho</div><div class="val">${fmtNum(taiKho)}</div></div>
    <div class="stat-card"><div class="lbl">Tại dự án</div><div class="val">${fmtNum(taiDuAn)}</div></div>
    <div class="stat-card"><div class="lbl">Phiếu chờ xác nhận</div><div class="val">${pendingCount ?? 0}</div></div>
  `;

  const groups = {};
  assets.forEach(a => {
    let key;
    if (a.status === 'tai_du_an') key = 'Dự án — ' + (a.projects?.name ?? '(?)');
    else if (a.status === 'kho') key = 'Kho — ' + (a.warehouses?.name ?? '(?)');
    else if (a.status === 'can_bao_tri') key = 'Cần bảo trì';
    else key = a.status;
    groups[key] = (groups[key] || 0) + 1;
  });
  const rows = Object.entries(groups).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `<tr><td>${k}</td><td class="num">${fmtNum(v)}</td></tr>`).join('');

  container.querySelector('#posTable').innerHTML = `
    <thead><tr><th>Vị trí</th><th class="num">Số lượng</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="2" class="empty-state">Chưa có tài sản nào trong hệ thống</td></tr>'}</tbody>`;
}
