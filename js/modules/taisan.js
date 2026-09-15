// js/modules/taisan.js
// Tổng tài sản sở hữu (asset_units) + vị trí HIỆN TẠI tính từ chính các phiếu giao
// nhận đã xác nhận (transfer_notes) — cùng nguồn dữ liệu với Bảng kê, để "đang nằm
// ở dự án nào bao nhiêu" luôn khớp với những gì đang được tính tiền thật.
import { supabase } from '../core/config.js';
import { fmtNum, fmtVND, todayStr, esc } from '../core/utils.js';
import { openModal, closeModal } from '../core/modal.js';

export async function render(container, profile, isStale = () => false) {
  container.innerHTML = `
    <div class="page-head">
      <div><h1>Tài sản</h1><div class="sub">Tổng tài sản sở hữu và vị trí hiện tại (kho / dự án)</div></div>
      <button class="btn" id="btnAddAsset">+ Thêm tài sản</button>
    </div>
    <div class="toolbar" style="border-bottom:1px solid var(--line); padding-bottom:14px;">
      <button class="btn small" id="tabByGroup">Theo nhóm hàng</button>
      <button class="btn secondary small" id="tabByProject">Tra cứu theo dự án / khách hàng</button>
    </div>
    <div id="view-group"></div>
    <div id="view-project" style="display:none;"></div>
  `;

  const [{ data: groups }, { data: categories }, { data: partners }, { data: projects }, { data: summaryRows }] = await Promise.all([
    supabase.from('groups').select('*').order('id'),
    supabase.from('categories').select('*').order('name'),
    supabase.from('partners').select('*').order('name'),
    supabase.from('projects').select('*').eq('status', 'active').order('name'),
    supabase.from('asset_summary').select('*'), // tổng SỞ HỮU theo asset_units — dùng cho "tổng tài sản" và "cần bảo trì"
  ]);
  if (isStale()) return;

  const groupList = groups ?? [], catList = categories ?? [], partnerList = partners ?? [], projList = projects ?? [];
  const summary = summaryRows ?? [];

  const ownedQtyByCategory = (categoryId) => summary.filter(r => r.category_id === categoryId).reduce((s, r) => s + r.qty, 0);
  const baoTriQtyByCategory = (categoryId) => summary.filter(r => r.category_id === categoryId && r.status === 'can_bao_tri').reduce((s, r) => s + r.qty, 0);

  const today = todayStr();

  // Tính số lượng HIỆN TẠI đang ở từng dự án cho 1 chủng loại — dựa trên phiếu
  // giao nhận đã CHÍNH THỨC (đến trừ đi), y hệt cách billing.js tính tồn — không
  // phải dựa vào bảng khai báo tài sản riêng (asset_units) vốn không được cập
  // nhật tự động khi xác nhận phiếu.
  async function getCurrentProjectDistribution(categoryId) {
    const [{ data: arrivals }, { data: departures }] = await Promise.all([
      supabase.from('transfer_notes')
        .select('to_location_id, transfer_note_items!inner(category_id, sl_xuat, sl_thuc_nhan)')
        .eq('to_location_type', 'du_an').eq('status', 'chinh_thuc').lte('ngay_ky', today)
        .eq('transfer_note_items.category_id', categoryId),
      supabase.from('transfer_notes')
        .select('from_location_id, transfer_note_items!inner(category_id, sl_xuat, sl_thuc_nhan)')
        .eq('from_location_type', 'du_an').eq('status', 'chinh_thuc').lte('ngay_ky', today)
        .eq('transfer_note_items.category_id', categoryId),
    ]);

    const net = {};
    (arrivals ?? []).forEach(n => {
      const qty = n.transfer_note_items.reduce((s, it) => s + Number(it.sl_thuc_nhan ?? it.sl_xuat), 0);
      net[n.to_location_id] = (net[n.to_location_id] ?? 0) + qty;
    });
    (departures ?? []).forEach(n => {
      const qty = n.transfer_note_items.reduce((s, it) => s + Number(it.sl_thuc_nhan ?? it.sl_xuat), 0);
      net[n.from_location_id] = (net[n.from_location_id] ?? 0) - qty;
    });
    return Object.entries(net).filter(([, qty]) => qty > 0).map(([projectId, qty]) => ({ projectId, qty }));
  }

  // Tính toàn bộ chủng loại HIỆN TẠI đang có ở 1 dự án cụ thể — hướng ngược lại
  // của hàm trên, dùng cho tab "Tra cứu theo dự án".
  async function getCurrentCategoriesAtProject(projectId) {
    const [{ data: arrivals }, { data: departures }] = await Promise.all([
      supabase.from('transfer_notes')
        .select('transfer_note_items(category_id, sl_xuat, sl_thuc_nhan)')
        .eq('to_location_type', 'du_an').eq('to_location_id', projectId).eq('status', 'chinh_thuc').lte('ngay_ky', today),
      supabase.from('transfer_notes')
        .select('transfer_note_items(category_id, sl_xuat, sl_thuc_nhan)')
        .eq('from_location_type', 'du_an').eq('from_location_id', projectId).eq('status', 'chinh_thuc').lte('ngay_ky', today),
    ]);

    const net = {};
    (arrivals ?? []).forEach(n => n.transfer_note_items.forEach(it => {
      const qty = Number(it.sl_thuc_nhan ?? it.sl_xuat);
      net[it.category_id] = (net[it.category_id] ?? 0) + qty;
    }));
    (departures ?? []).forEach(n => n.transfer_note_items.forEach(it => {
      const qty = Number(it.sl_thuc_nhan ?? it.sl_xuat);
      net[it.category_id] = (net[it.category_id] ?? 0) - qty;
    }));
    return Object.entries(net).filter(([, qty]) => qty > 0).map(([categoryId, qty]) => ({ categoryId, qty }));
  }

  // ================= TAB 1 — THEO NHÓM HÀNG =================
  const expandedGroups = new Set();

  function renderGroupTable() {
    let rowsHtml = '';
    groupList.forEach(g => {
      const catsInGroup = catList.filter(c => c.group_id === g.id).sort((a, b) => a.name.localeCompare(b.name));
      const totalQty = catsInGroup.reduce((s, c) => s + ownedQtyByCategory(c.id), 0);
      const totalValue = catsInGroup.reduce((s, c) => s + ownedQtyByCategory(c.id) * (c.ref_value ?? 0), 0);
      const isOpen = expandedGroups.has(g.id);

      rowsHtml += `<tr data-toggle-group="${g.id}" style="cursor:pointer; background:var(--gray-tint); font-weight:600;">
        <td style="color:var(--red-dark);">${isOpen ? '▾' : '▸'}&nbsp;${g.id}</td>
        <td>${esc(g.name)}</td>
        <td class="num">${totalQty ? fmtNum(totalQty) : ''}</td>
        <td style="color:var(--ink-soft); font-weight:400;">${catsInGroup.length} chủng loại</td>
        <td class="num">${fmtVND(totalValue)}</td>
      </tr>`;

      if (isOpen) {
        catsInGroup.forEach(c => {
          const qty = ownedQtyByCategory(c.id);
          const value = qty * (c.ref_value ?? 0);
          rowsHtml += `<tr data-open-cat="${c.id}" style="cursor:pointer;">
            <td></td>
            <td style="padding-left:26px;">${esc(c.name)} <span style="color:var(--ink-soft); font-size:.78rem;">(${esc(c.unit)})</span></td>
            <td class="num">${fmtNum(qty)}</td>
            <td class="num">${fmtVND(c.ref_value)}</td>
            <td class="num">${fmtVND(value)}</td>
          </tr>`;
        });
        if (catsInGroup.length === 0) {
          rowsHtml += `<tr><td></td><td colspan="4" class="empty-state">Chưa có chủng loại nào trong nhóm này</td></tr>`;
        }
      }
    });

    container.querySelector('#view-group').innerHTML = `
      <div class="panel"><div class="panel-body" style="padding:0">
        <table>
          <thead><tr><th style="width:70px;">Nhóm</th><th>Tên</th><th class="num">Tổng SL sở hữu</th><th>Ghi chú</th><th class="num">Thành tiền</th></tr></thead>
          <tbody>${rowsHtml || '<tr><td colspan="5" class="empty-state">Chưa có nhóm hàng nào</td></tr>'}</tbody>
        </table>
      </div></div>`;

    container.querySelectorAll('[data-toggle-group]').forEach(tr => {
      tr.addEventListener('click', () => {
        const id = tr.dataset.toggleGroup;
        if (expandedGroups.has(id)) expandedGroups.delete(id); else expandedGroups.add(id);
        renderGroupTable();
      });
    });
    container.querySelectorAll('[data-open-cat]').forEach(tr => {
      tr.addEventListener('click', () => openCategoryDetailModal(catList.find(c => c.id === tr.dataset.openCat)));
    });
  }

  async function openCategoryDetailModal(category) {
    const totalOwned = ownedQtyByCategory(category.id);
    const baoTri = baoTriQtyByCategory(category.id);
    const atProjects = await getCurrentProjectDistribution(category.id);
    if (isStale()) return;

    const totalAtProjects = atProjects.reduce((s, r) => s + r.qty, 0);
    const atKho = Math.max(0, totalOwned - totalAtProjects - baoTri);
    const totalValue = totalOwned * (category.ref_value ?? 0);

    const projectRows = atProjects
      .sort((a, b) => b.qty - a.qty)
      .map((r, i) => {
        const proj = projList.find(p => p.id === r.projectId);
        const partnerName = partnerList.find(pt => pt.id === proj?.partner_id)?.name ?? '';
        return `<tr>
          <td>${i + 1}</td>
          <td>${esc(proj?.name ?? '(dự án đã xóa)')}</td>
          <td style="color:var(--ink-soft); font-size:.82rem;">${esc(partnerName)}</td>
          <td class="num">${fmtNum(r.qty)}</td>
          <td class="num">${fmtVND(r.qty * (category.ref_value ?? 0))}</td>
        </tr>`;
      }).join('');

    const bodyHtml = `
      <div style="font-size:.85rem; color:var(--ink-soft); margin-bottom:14px; line-height:1.8;">
        Đơn giá TS: <b>${fmtVND(category.ref_value)}</b>/${esc(category.unit)} &nbsp;·&nbsp;
        Tổng tài sản sở hữu: <b>${fmtNum(totalOwned)}</b> ${esc(category.unit)} (giá trị <b>${fmtVND(totalValue)}</b>)<br>
        Tại kho: <b>${fmtNum(atKho)}</b> &nbsp;·&nbsp;
        Đang tại dự án: <b>${fmtNum(totalAtProjects)}</b> (${atProjects.length} dự án) &nbsp;·&nbsp;
        Cần bảo trì: <b>${fmtNum(baoTri)}</b>
      </div>
      <b>Đang nằm tại các dự án:</b>
      <table style="margin-top:6px;">
        <thead><tr><th style="width:40px;">STT</th><th>Dự án</th><th>Khách hàng</th><th class="num">Số lượng</th><th class="num">Giá trị</th></tr></thead>
        <tbody>${projectRows || '<tr><td colspan="5" class="empty-state">Hiện không có ở dự án nào — toàn bộ đang tại kho</td></tr>'}</tbody>
      </table>
    `;
    openModal({ title: category.name, bodyHtml, footerHtml: '', wide: true });
  }

  // ================= TAB 2 — TRA CỨU THEO DỰ ÁN / KHÁCH HÀNG =================
  function renderProjectSearchView() {
    container.querySelector('#view-project').innerHTML = `
      <div class="toolbar">
        <select id="searchPartner"><option value="">Tất cả khách hàng</option>${partnerList.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
        <select id="searchProject"><option value="">— Chọn dự án —</option></select>
      </div>
      <div id="projectResult"></div>
    `;

    function refreshProjectOptions() {
      const partnerId = container.querySelector('#searchPartner').value;
      const list = partnerId ? projList.filter(p => p.partner_id === partnerId) : projList;
      container.querySelector('#searchProject').innerHTML = '<option value="">— Chọn dự án —</option>' +
        list.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    }
    refreshProjectOptions();

    container.querySelector('#searchPartner').addEventListener('change', refreshProjectOptions);
    container.querySelector('#searchProject').addEventListener('change', async (e) => {
      const projectId = e.target.value;
      const resultEl = container.querySelector('#projectResult');
      if (!projectId) { resultEl.innerHTML = ''; return; }

      resultEl.innerHTML = '<div class="loading">Đang tính từ các phiếu giao nhận...</div>';
      const items = await getCurrentCategoriesAtProject(projectId);
      if (isStale()) return;

      const project = projList.find(p => p.id === projectId);
      let totalValue = 0;
      const rows = items
        .map(it => {
          const cat = catList.find(c => c.id === it.categoryId);
          const value = it.qty * (cat?.ref_value ?? 0);
          totalValue += value;
          return { name: cat?.name ?? '(?)', unit: cat?.unit ?? '', group: cat?.group_id ?? '', qty: it.qty, value };
        })
        .sort((a, b) => b.value - a.value)
        .map((r, i) => `<tr>
          <td>${i + 1}</td><td>${r.group}</td><td>${esc(r.name)}</td><td>${esc(r.unit)}</td>
          <td class="num">${fmtNum(r.qty)}</td><td class="num">${fmtVND(r.value)}</td>
        </tr>`).join('');

      resultEl.innerHTML = `
        <div class="info-box" style="margin:14px 0;">Dự án <b>${esc(project?.name ?? '')}</b> hiện đang có <b>${items.length}</b> chủng loại, tổng giá trị tài sản đang thuê: <b>${fmtVND(totalValue)}</b></div>
        <div class="panel"><div class="panel-body" style="padding:0">
          <table>
            <thead><tr><th style="width:40px;">STT</th><th>Nhóm</th><th>Chủng loại</th><th>ĐVT</th><th class="num">Số lượng</th><th class="num">Giá trị</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="6" class="empty-state">Dự án này hiện không có tài sản nào</td></tr>'}</tbody>
          </table>
        </div></div>
      `;
    });
  }

  // ================= THÊM TÀI SẢN =================
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
        <select id="aWarehouse"><option value="">— Không cần chọn (chỉ ghi tổng sở hữu) —</option></select>
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

    supabase.from('warehouses').select('*').order('name').then(({ data: wh }) => {
      dialog.querySelector('#aWarehouse').innerHTML = (wh ?? []).map(w => `<option value="${w.id}">${esc(w.name)}</option>`).join('');
    });

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
      const warehouse_id = source === 'new_to_project' ? null : (dialog.querySelector('#aWarehouse').value || null);
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
        alert('Đã thêm tài sản — tải lại trang Tài sản để thấy tổng sở hữu cập nhật.');
      } catch (err) {
        errBox.textContent = 'Lỗi: ' + err.message;
        errBox.style.display = 'block';
        submitBtn.disabled = false; submitBtn.textContent = 'Thêm tài sản';
      }
    });
  }
  container.querySelector('#btnAddAsset').addEventListener('click', openAddAssetModal);

  container.querySelector('#tabByGroup').addEventListener('click', () => {
    container.querySelector('#view-group').style.display = 'block';
    container.querySelector('#view-project').style.display = 'none';
  });
  container.querySelector('#tabByProject').addEventListener('click', () => {
    container.querySelector('#view-group').style.display = 'none';
    container.querySelector('#view-project').style.display = 'block';
  });

  renderGroupTable();
  renderProjectSearchView();
}
