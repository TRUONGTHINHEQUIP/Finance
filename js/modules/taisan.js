// js/modules/taisan.js
// 3 lop dieu huong, dung cau truc bang gia that cua cong ty:
// Nhom A-E (level 1) -> danh sach chung loai trong nhom (level 2) ->
// bang phan bo 1 chung loai theo tung vi tri/du an (level 3).
import { supabase } from '../core/config.js';
import { fmtNum, fmtVND, todayStr, esc } from '../core/utils.js';
import { openModal, closeModal } from '../core/modal.js';

export async function render(container, profile, isStale = () => false) {
  container.innerHTML = `
    <div class="page-head">
      <div><h1>Tài sản</h1><div class="sub">Theo nhóm hàng — bấm vào xem chủng loại, bấm chủng loại xem đang nằm ở dự án nào</div></div>
      <button class="btn" id="btnAddAsset">+ Thêm tài sản</button>
    </div>
    <div class="panel"><div class="panel-body" style="padding:0"><table id="groupTable"><tbody><tr><td class="loading">Đang tải...</td></tr></tbody></table></div></div>
  `;

  const [{ data: groups }, { data: categories }, { data: warehouses }, { data: projects }, { data: summaryRows }] = await Promise.all([
    supabase.from('groups').select('*').order('id'),
    supabase.from('categories').select('*').order('name'),
    supabase.from('warehouses').select('*').order('name'),
    supabase.from('projects').select('*').eq('status', 'active').order('name'),
    supabase.from('asset_summary').select('*'),
  ]);
  if (isStale()) return;

  const groupList = groups ?? [], catList = categories ?? [], whList = warehouses ?? [], projList = projects ?? [];
  const summary = summaryRows ?? [];

  const qtyByCategory = (categoryId) => summary.filter(r => r.category_id === categoryId).reduce((s, r) => s + r.qty, 0);
  const rowsForCategory = (categoryId) => summary.filter(r => r.category_id === categoryId);

  function locLabel(r) {
    if (r.status === 'tai_du_an') return 'Tại dự án — ' + (projList.find(p => p.id === r.project_id)?.name ?? '(?)');
    if (r.status === 'kho') return 'Tại kho — ' + (whList.find(w => w.id === r.warehouse_id)?.name ?? '(?)');
    return 'Cần bảo trì';
  }

  function renderGroupTable() {
    const rows = groupList.map(g => {
      const catsInGroup = catList.filter(c => c.group_id === g.id);
      const totalQty = catsInGroup.reduce((s, c) => s + qtyByCategory(c.id), 0);
      const totalValue = catsInGroup.reduce((s, c) => s + qtyByCategory(c.id) * (c.ref_value ?? 0), 0);
      return `<tr data-open-group="${g.id}" style="cursor:pointer;">
        <td><b style="color:var(--red-dark);">${g.id}</b></td>
        <td>${esc(g.name)}</td>
        <td class="num">${catsInGroup.length}</td>
        <td class="num">${fmtNum(totalQty)}</td>
        <td class="num">${fmtVND(totalValue)}</td>
      </tr>`;
    }).join('');

    container.querySelector('#groupTable').innerHTML = `
      <thead><tr><th style="width:60px;">Nhóm</th><th>Tên nhóm</th><th class="num">Số chủng loại</th><th class="num">Tổng số lượng</th><th class="num">Tổng giá trị</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" class="empty-state">Chưa có nhóm hàng nào</td></tr>'}</tbody>`;

    container.querySelectorAll('[data-open-group]').forEach(tr => {
      tr.addEventListener('click', () => openGroupModal(groupList.find(g => g.id === tr.dataset.openGroup)));
    });
  }

  function openGroupModal(group) {
    const cats = catList.filter(c => c.group_id === group.id).sort((a, b) => a.name.localeCompare(b.name));

    const rows = cats.map((c, i) => {
      const qty = qtyByCategory(c.id);
      const value = qty * (c.ref_value ?? 0);
      return `<tr data-open-cat="${c.id}" style="cursor:pointer;">
        <td>${i + 1}</td>
        <td>${esc(c.name)}</td>
        <td>${esc(c.unit)}</td>
        <td class="num">${fmtVND(c.ref_value)}</td>
        <td class="num">${fmtNum(qty)}</td>
        <td class="num">${fmtVND(value)}</td>
      </tr>`;
    }).join('');

    const bodyHtml = `
      <table>
        <thead><tr><th style="width:40px;">STT</th><th>Tên thiết bị &amp; quy cách</th><th>ĐVT</th><th class="num">Trị giá TS</th><th class="num">Tổng SL</th><th class="num">Thành tiền</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6" class="empty-state">Chưa có chủng loại nào trong nhóm này</td></tr>'}</tbody>
      </table>
    `;
    const dialog = openModal({ title: `${group.id} — ${group.name}`, bodyHtml, footerHtml: '', wide: true });

    dialog.querySelectorAll('[data-open-cat]').forEach(tr => {
      tr.addEventListener('click', () => openCategoryDetailModal(catList.find(c => c.id === tr.dataset.openCat)));
    });
  }

  function openCategoryDetailModal(category) {
    const rows = rowsForCategory(category.id).sort((a, b) => {
      const order = { kho: 0, tai_du_an: 1, can_bao_tri: 2 };
      if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
      return b.qty - a.qty;
    });

    const totalQty = rows.reduce((s, r) => s + r.qty, 0);
    const totalValue = totalQty * (category.ref_value ?? 0);

    const lineRows = rows.map((r, i) => `<tr>
      <td>${i + 1}</td>
      <td>${esc(locLabel(r))}</td>
      <td>${esc(category.unit)}</td>
      <td class="num">${fmtNum(r.qty)}</td>
      <td class="num">${fmtVND(r.qty * (category.ref_value ?? 0))}</td>
    </tr>`).join('');

    const bodyHtml = `
      <div style="font-size:.85rem; color:var(--ink-soft); margin-bottom:14px;">
        Đơn giá TS: <b>${fmtVND(category.ref_value)}</b>/${esc(category.unit)} &nbsp;·&nbsp;
        Tổng toàn công ty: <b>${fmtNum(totalQty)}</b> ${esc(category.unit)} &nbsp;·&nbsp;
        Tổng giá trị: <b>${fmtVND(totalValue)}</b>
      </div>
      <table>
        <thead><tr><th style="width:40px;">STT</th><th>Vị trí</th><th>ĐVT</th><th class="num">Số lượng</th><th class="num">Thành tiền</th></tr></thead>
        <tbody>${lineRows || '<tr><td colspan="5" class="empty-state">Chưa có tài sản nào thuộc chủng loại này</td></tr>'}</tbody>
        <tfoot><tr><td colspan="3">Tổng cộng</td><td class="num">${fmtNum(totalQty)}</td><td class="num">${fmtVND(totalValue)}</td></tr></tfoot>
      </table>
    `;
    openModal({ title: category.name, bodyHtml, footerHtml: '', wide: true });
  }

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
        <div class="field"><label>Chủng loại</label><select id="aCategory">${catList.map(c => `<option value="${c.id}" data-refvalue="${c.ref_value}">${esc(c.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Số lượng</label><input type="number" id="aQty" value="1" min="1"></div>
      </div>
      <div class="field" id="aWarehouseField">
        <label>Nhập vào kho</label>
        <select id="aWarehouse">${whList.map(w => `<option value="${w.id}">${esc(w.name)}</option>`).join('')}</select>
      </div>
      <div class="field" id="aProjectField" style="display:none;">
        <label>Chuyển đến dự án</label>
        <select id="aProject">${projList.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
      </div>
      <div class="field-row">
        <div class="field"><label>Giá trị mua (mỗi đơn vị)</label><input type="number" id="aValue" value="${catList[0]?.ref_value ?? ''}"></div>
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
      dialog.querySelector('#aValue').value = e.target.selectedOptions[0].dataset.refvalue;
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

      const category = catList.find(c => c.id === category_id);
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
        alert('Đã thêm tài sản — tải lại trang Tài sản để thấy số liệu cập nhật.');
      } catch (err) {
        errBox.textContent = 'Lỗi: ' + err.message;
        errBox.style.display = 'block';
        submitBtn.disabled = false; submitBtn.textContent = 'Thêm tài sản';
      }
    });
  }
  container.querySelector('#btnAddAsset').addEventListener('click', openAddAssetModal);

  renderGroupTable();
}
