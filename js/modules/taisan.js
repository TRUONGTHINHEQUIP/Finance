// js/modules/taisan.js
import { supabase } from '../core/config.js';
import { fmtNum, fmtVND } from '../core/utils.js';

export async function render(container, profile, isStale = () => false) {
  container.innerHTML = `
    <div class="page-head">
      <div><h1>Tài sản</h1><div class="sub">Tồn theo chủng loại, vị trí, và giá trị</div></div>
    </div>
    <div class="toolbar">
      <select id="filterGroup"><option value="">Tất cả nhóm hàng</option></select>
      <select id="filterStatus">
        <option value="">Tất cả trạng thái</option>
        <option value="kho">Tại kho</option>
        <option value="tai_du_an">Tại dự án</option>
        <option value="can_bao_tri">Cần bảo trì</option>
      </select>
      <input type="text" id="filterText" placeholder="Tìm theo tên chủng loại...">
    </div>
    <div class="panel"><div class="panel-body" style="padding:0"><table id="assetTable"><tbody><tr><td class="loading">Đang tải...</td></tr></tbody></table></div></div>
  `;

  let allRows = [];

  const { data: groups } = await supabase.from('groups').select('*').order('id');
  if (isStale()) return;
  container.querySelector('#filterGroup').innerHTML = '<option value="">Tất cả nhóm hàng</option>' +
    (groups ?? []).map(g => `<option value="${g.id}">${g.id} — ${g.name}</option>`).join('');

  const { data: assets, error } = await supabase
    .from('asset_units')
    .select('status, category_id, categories(name, unit, group_id, ref_value), warehouses:warehouse_id(name), projects:project_id(name)');

  if (isStale()) return;

  if (error) {
    container.querySelector('#assetTable').innerHTML = `<tr><td class="error-box">${error.message}</td></tr>`;
    return;
  }

  const map = {};
  (assets ?? []).forEach(a => {
    const loc = a.status === 'tai_du_an' ? 'Tại dự án — ' + (a.projects?.name ?? '(?)')
      : a.status === 'kho' ? 'Tại kho — ' + (a.warehouses?.name ?? '(?)')
      : 'Cần bảo trì';
    const key = a.category_id + '|' + loc;
    if (!map[key]) map[key] = { category: a.categories, status: a.status, loc, qty: 0 };
    map[key].qty += 1;
  });
  allRows = Object.values(map);

  function renderTable() {
    const groupF = container.querySelector('#filterGroup').value;
    const statusF = container.querySelector('#filterStatus').value;
    const textF = container.querySelector('#filterText').value.trim().toLowerCase();

    const rows = allRows.filter(r => {
      if (groupF && r.category?.group_id !== groupF) return false;
      if (statusF && r.status !== statusF) return false;
      if (textF && !r.category?.name?.toLowerCase().includes(textF)) return false;
      return true;
    });

    let grandTotal = 0;
    const body = rows.map(r => {
      const thanhTien = r.qty * (r.category?.ref_value ?? 0);
      grandTotal += thanhTien;
      const badge = r.status === 'can_bao_tri' ? '<span class="badge tam">Cần bảo trì</span>'
        : r.status === 'tai_du_an' ? '<span class="badge chinh">Đang thuê</span>'
        : '<span class="badge chinh">Sẵn sàng</span>';
      return `<tr>
        <td>${r.category?.group_id ?? ''}</td>
        <td>${r.category?.name ?? '(?)'}</td>
        <td>${r.category?.unit ?? ''}</td>
        <td class="num">${fmtNum(r.qty)}</td>
        <td class="num">${fmtVND(r.category?.ref_value ?? 0)}</td>
        <td class="num">${fmtVND(thanhTien)}</td>
        <td>${r.loc}</td>
        <td>${badge}</td>
      </tr>`;
    }).join('');

    container.querySelector('#assetTable').innerHTML = `
      <thead><tr><th>Nhóm</th><th>Chủng loại</th><th>ĐVT</th><th class="num">SL</th><th class="num">Đơn giá TS</th><th class="num">Thành tiền</th><th>Vị trí</th><th>Trạng thái</th></tr></thead>
      <tbody>${body || '<tr><td colspan="8" class="empty-state">Chưa có tài sản nào khớp bộ lọc</td></tr>'}</tbody>
      <tfoot><tr><td colspan="5">Tổng giá trị (theo bộ lọc)</td><td class="num">${fmtVND(grandTotal)}</td><td colspan="2"></td></tr></tfoot>`;
  }

  ['filterGroup', 'filterStatus', 'filterText'].forEach(id =>
    container.querySelector('#' + id).addEventListener('input', renderTable));
  renderTable();
}
