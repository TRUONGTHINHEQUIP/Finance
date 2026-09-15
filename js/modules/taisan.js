// js/modules/taisan.js
import { supabase } from '../core/config.js';
import { fmtNum, fmtVND, todayStr, esc } from '../core/utils.js';
import { openModal, closeModal } from '../core/modal.js';

export async function render(container, profile, isStale = () => false) {
  container.innerHTML = `
    <div class="page-head">
      <div><h1>Tài sản</h1><div class="sub">Tồn theo chủng loại, vị trí, và giá trị</div></div>
      <button class="btn" id="btnAddAsset">+ Thêm tài sản</button>
    </div>
    <div class="toolbar">
      <select id="filterGroup"><option value="">Tất cả nhóm hàng</option></select>
      <select id="filterCategory"><option value="">Tất cả chủng loại</option></select>
      <select id="filterStatus">
        <option value="">Tất cả trạng thái</option>
        <option value="kho">Tại kho</option>
        <option value="tai_du_an">Tại dự án</option>
        <option value="can_bao_tri">Cần bảo trì</option>
      </select>
      <input type="text" id="filterText" placeholder="Tìm theo tên chủng loại...">
    </div>
    <div id="categorySummary"></div>
    <div class="panel"><div class="panel-body" style="padding:0"><table id="assetTable"><tbody><tr><td class="loading">Đang tải...</td></tr></tbody></table></div></div>
  `;

  let allRows = [];

  const [{ data: groups }, { data: categories }, { data: warehouses }, { data: projects }] = await Promise.all([
    supabase.from('groups').select('*').order('id'),
    supabase.from('categories').select('*').order('name'),
    supabase.from('warehouses').select('*').order('name'),
    supabase.from('projects').select('*').eq('status', 'active').order('name'),
  ]);
  if (isStale()) return;

  container.querySelector('#filterGroup').innerHTML = '<option value="">Tất cả nhóm hàng</option>' +
    (groups ?? []).map(g => `<option value="${g.id}">${g.id} — ${g.name}</option>`).join('');
  container.querySelector('#filterCategory').innerHTML = '<option value="">Tất cả chủng loại</option>' +
    (categories ?? []).map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');

  function openAddAssetModal() {
    const bodyHtml = `
      <div class="info-box">"Tồn kho ban đầu" dùng khi khai báo tài sản đã có sẵn lúc bắt đầu dùng phần mềm. "Đầu tư mới" dùng khi mua thêm thiết bị — có thể nhập kho hoặc chuyển thẳng ra dự án cho thuê.</div>
      <div class="field"><label>Nguồn gốc</label>
        <select id="aSource">
          <option value="kho_init">Tồn kho ban đầu (khởi tạo hệ thống)</option>
          <option value="new_to_kho">Đầu tư mới — nhập vào kho</option>
          <option value="new_to_project">Đầu tư mới — chuyển thẳng đến dự án cho thuê</option>
        </select>
      </div>
      <div class="field-row">
        <div class="field"><label>Chủng loại</label><select id="aCategory">${(categories ?? []).map(c => `<option value="${c.id}" data-refvalue="${c.ref_value}">${esc(c.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Số lượng</label><input type="number" id="aQty" value="1" min="1"></div>
      </div>
      <div class="field" id="aWarehouseField">
        <label>Nhập vào kho</label>
        <select id="aWarehouse">${(warehouses ?? []).map(w => `<option value="${w.id}">${esc(w.name)}</option>`).join('')}</select>
      </div>
      <div class="field" id="aProjectField" style="display:none;">
        <label>Chuyển đến dự án</label>
        <select id="aProject">${(projects ?? []).map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
      </div>
      <div class="field-row">
        <div class="field"><label>Giá trị mua (mỗi đơn vị)</label><input type="number" id="aValue" value="${categories?.[0]?.ref_value ?? ''}"></div>
        <div class="field"><label>Ngày mua / ghi nhận</label><input type="date" id="aDate" value="${todayStr()}"></div>
      </div>
      <div id="aError" class="error-box" style="display:none;"></div>
    `;
    const footerHtml = `<button class="btn secondary" id="aCancel">Hủy</button><button class="btn" id="aSubmit">Thêm tài sản</button>`;
    const dialog = openModal({ title: 'Thêm tài sản', bodyHtml, footerHtml });

    function syncFields() {
      const source = dialog.querySelector('#aSource').value;
      dialog.querySelector('#aWarehouseField').style.display = source === 'new_to_project' ? 'none' : 'block';
      dialog.querySelector('#aProjectField').style.display = source === 'new_to_project' ? 'block' : 'none';
    }
    dialog.querySelector('#aSource').addEventListener('change', syncFields);
    dialog.querySelector('#aCategory').addEventListener('change', (e) => {
      const refValue = e.target.selectedOptions[0].dataset.refvalue;
      dialog.querySelector('#aValue').value = refValue;
    });

    dialog.querySelector('#aCancel').addEventListener('click', closeModal);
    dialog.querySelector('#aSubmit').addEventListener('click', async () => {
      const source = dialog.querySelector('#aSource').value;
      const category_id = dialog.querySelector('#aCategory').value;
      const qty = parseInt(dialog.querySelector('#aQty').value) || 0;
      const purchase_value = parseFloat(dialog.querySelector('#aValue').value) || 0;
      const purchase_date = dialog.querySelector('#aDate').value;
      const errBox = dialog.querySelector('#aError');
      errBox.style.display = 'none';

      if (qty < 1) { errBox.textContent = 'Số lượng phải lớn hơn 0.'; errBox.style.display = 'block'; return; }

      const category = categories.find(c => c.id === category_id);
      const status = source === 'new_to_project' ? 'tai_du_an' : 'kho';
      const warehouse_id = source === 'new_to_project' ? null : dialog.querySelector('#aWarehouse').value;
      const project_id = source === 'new_to_project' ? dialog.querySelector('#aProject').value : null;
      const source_note = source === 'kho_init' ? `Tồn kho ban đầu — khởi tạo ngày ${purchase_date}`
        : source === 'new_to_kho' ? `Đầu tư mới, nhập kho ngày ${purchase_date}`
        : `Đầu tư mới, chuyển thẳng đến dự án ngày ${purchase_date}`;

      const submitBtn = dialog.querySelector('#aSubmit');
      submitBtn.disabled = true; submitBtn.textContent = 'Đang tạo...';

      try {
        const { count } = await supabase.from('asset_units')
          .select('id', { count: 'exact', head: true }).eq('category_id', category_id);
        let startSeq = (count ?? 0) + 1;

        const rows = [];
        for (let i = 0; i < qty; i++) {
          rows.push({
            asset_code: `${category.code}-${String(startSeq + i).padStart(5, '0')}`,
            category_id, status, warehouse_id, project_id,
            source: 'mua_moi', source_note, purchase_value, purchase_date,
            created_by: profile.id,
          });
        }
        const { error } = await supabase.from('asset_units').insert(rows);
        if (error) throw error;

        closeModal();
        await loadAssets();
        renderTable();
      } catch (err) {
        errBox.textContent = 'Lỗi: ' + err.message;
        errBox.style.display = 'block';
        submitBtn.disabled = false; submitBtn.textContent = 'Thêm tài sản';
      }
    });
  }
  container.querySelector('#btnAddAsset').addEventListener('click', openAddAssetModal);

  async function loadAssets() {
    const { data: rows, error } = await supabase.from('asset_summary').select('*');
    if (isStale()) return;

    if (error) {
      container.querySelector('#assetTable').innerHTML = `<tr><td class="error-box">${error.message}</td></tr>`;
      return;
    }

    allRows = (rows ?? []).map(r => {
      const category = categories.find(c => c.id === r.category_id);
      const loc = r.status === 'tai_du_an' ? 'Tại dự án — ' + (projects.find(p => p.id === r.project_id)?.name ?? '(?)')
        : r.status === 'kho' ? 'Tại kho — ' + (warehouses.find(w => w.id === r.warehouse_id)?.name ?? '(?)')
        : 'Cần bảo trì';
      return {
        category, category_id: r.category_id, status: r.status,
        warehouse_id: r.warehouse_id, project_id: r.project_id, loc, qty: r.qty,
        key: r.category_id + '|' + r.status + '|' + (r.warehouse_id ?? '') + '|' + (r.project_id ?? ''),
      };
    });
  }

  function renderCategorySummary(catF) {
    const el = container.querySelector('#categorySummary');
    if (!catF) { el.innerHTML = ''; return; }

    const catRows = allRows.filter(r => r.category_id === catF);
    const category = categories.find(c => c.id === catF);
    const totalQty = catRows.reduce((s, r) => s + r.qty, 0);
    const atKho = catRows.filter(r => r.status === 'kho').reduce((s, r) => s + r.qty, 0);
    const atProjectRows = catRows.filter(r => r.status === 'tai_du_an');
    const atProjectTotal = atProjectRows.reduce((s, r) => s + r.qty, 0);
    const atBaoTri = catRows.filter(r => r.status === 'can_bao_tri').reduce((s, r) => s + r.qty, 0);

    const projectLines = atProjectRows
      .sort((a, b) => b.qty - a.qty)
      .map(r => `<div>${esc(r.loc.replace('Tại dự án — ', ''))}: <b>${fmtNum(r.qty)}</b> ${esc(category?.unit ?? '')}</div>`)
      .join('');

    el.innerHTML = `
      <div class="info-box" style="margin-bottom:14px;">
        <b>${esc(category?.name ?? '')}</b> — Tổng công ty: <b>${fmtNum(totalQty)}</b> ${esc(category?.unit ?? '')}
        &nbsp;·&nbsp; Tại kho: <b>${fmtNum(atKho)}</b>
        &nbsp;·&nbsp; Tại dự án: <b>${fmtNum(atProjectTotal)}</b> (${atProjectRows.length} dự án)
        ${atBaoTri ? `&nbsp;·&nbsp; Cần bảo trì: <b>${fmtNum(atBaoTri)}</b>` : ''}
        ${projectLines ? `<div style="margin-top:8px; display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:2px 16px; font-size:.83rem;">${projectLines}</div>` : ''}
      </div>`;
  }

  function renderTable() {
    const groupF = container.querySelector('#filterGroup').value;
    const catF = container.querySelector('#filterCategory').value;
    const statusF = container.querySelector('#filterStatus').value;
    const textF = container.querySelector('#filterText').value.trim().toLowerCase();

    const rows = allRows.filter(r => {
      if (groupF && r.category?.group_id !== groupF) return false;
      if (catF && r.category_id !== catF) return false;
      if (statusF && r.status !== statusF) return false;
      if (textF && !r.category?.name?.toLowerCase().includes(textF)) return false;
      return true;
    });

    renderCategorySummary(catF);

    let grandTotal = 0;
    const body = rows.map(r => {
      const thanhTien = r.qty * (r.category?.ref_value ?? 0);
      grandTotal += thanhTien;
      const badge = r.status === 'can_bao_tri' ? '<span class="badge tam">Cần bảo trì</span>'
        : r.status === 'tai_du_an' ? '<span class="badge chinh">Đang thuê</span>'
        : '<span class="badge chinh">Sẵn sàng</span>';
      return `<tr data-open-row="${r.key}" style="cursor:pointer;">
        <td>${r.category?.group_id ?? ''}</td>
        <td>${esc(r.category?.name ?? '(?)')}</td>
        <td>${esc(r.category?.unit ?? '')}</td>
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

    container.querySelectorAll('[data-open-row]').forEach(tr => {
      tr.addEventListener('click', () => openDetailModal(rows.find(r => r.key === tr.dataset.openRow)));
    });
  }

  async function openDetailModal(row) {
    let q = supabase.from('asset_units')
      .select('id, asset_code, purchase_date, purchase_value, source_note')
      .eq('category_id', row.category_id).eq('status', row.status)
      .order('asset_code').limit(2000);
    if (row.warehouse_id) q = q.eq('warehouse_id', row.warehouse_id);
    if (row.project_id) q = q.eq('project_id', row.project_id);

    const { data: items, error } = await q;
    if (error) { alert('Lỗi tải chi tiết: ' + error.message); return; }

    const rowsHtml = (items ?? []).map(a => `<tr>
      <td>${esc(a.asset_code)}</td>
      <td>${a.purchase_date ? new Date(a.purchase_date).toLocaleDateString('vi-VN') : '—'}</td>
      <td class="num">${fmtVND(a.purchase_value ?? 0)}</td>
      <td style="font-size:.78rem; color:var(--ink-soft);">${esc(a.source_note ?? '—')}</td>
    </tr>`).join('');

    const bodyHtml = `
      <div style="font-size:.85rem; color:var(--ink-soft); margin-bottom:12px;">
        ${esc(row.category?.name ?? '(?)')} · ${esc(row.loc)} · ${(items ?? []).length} đơn vị
      </div>
      <div style="max-height:400px; overflow-y:auto;">
        <table>
          <thead><tr><th>Mã tài sản</th><th>Ngày mua/nhập</th><th class="num">Giá trị mua</th><th>Nguồn gốc</th></tr></thead>
          <tbody>${rowsHtml || '<tr><td colspan="4" class="empty-state">Không có dữ liệu</td></tr>'}</tbody>
        </table>
      </div>
    `;
    openModal({ title: `Chi tiết tài sản — ${row.category?.name ?? ''}`, bodyHtml, footerHtml: '', wide: true });
  }

  ['filterGroup', 'filterCategory', 'filterStatus', 'filterText'].forEach(id =>
    container.querySelector('#' + id).addEventListener('input', renderTable));

  await loadAssets();
  renderTable();
}
