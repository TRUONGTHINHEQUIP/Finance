// js/modules/kehoach.js
// Sale trao đổi với từng công trình để biết KẾ HOẠCH TRẢ (thiết bị đang ở đó
// bao giờ trả về) và KẾ HOẠCH NHẬP THÊM (nếu công trình đang nhận thêm hàng).
// Mỗi dự án/chủng loại có thể có nhiều đợt (trả làm nhiều lần), sửa/xóa được
// bất cứ lúc nào. Dự án nào đang giữ hàng mà CHƯA khai báo kế hoạch trả sẽ
// được nhắc riêng để Sale đi hỏi. BGD xem bảng tổng 3 tháng tới, tự cảnh báo
// chủng loại nào sẽ không đủ hàng luân chuyển.
import { supabase } from '../core/config.js';
import { fmtNum, fmtDate, todayStr, esc } from '../core/utils.js';
import { openModal, closeModal } from '../core/modal.js';

function planTypeLabel(t) { return t === 'tra' ? 'Kế hoạch trả về' : 'Kế hoạch nhập thêm'; }

function monthBucket(offset) {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + offset);
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const iso = (x) => x.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end), label: `Tháng ${start.getMonth() + 1}/${start.getFullYear()}` };
}

export async function render(container, profile, isStale = () => false) {
  container.innerHTML = `
    <div class="page-head">
      <div><h1>Kế hoạch</h1><div class="sub">Kế hoạch trả/nhập theo từng dự án — Sale trao đổi với công trình, cập nhật bất cứ lúc nào</div></div>
    </div>
    <div class="toolbar" style="border-bottom:1px solid var(--line); padding-bottom:14px;">
      <button class="btn small" id="subCapNhat">Cập nhật kế hoạch</button>
      <button class="btn secondary small" id="subTongHop">Kế hoạch tổng (3 tháng tới)</button>
    </div>
    <div id="sub-capnhat"></div>
    <div id="sub-tonghop" style="display:none;"></div>
  `;

  const today = todayStr();
  const monthBuckets = [0, 1, 2].map(monthBucket);
  const horizonEnd = monthBuckets[2].end;

  const [{ data: cats }, { data: projects }, { data: summaryRows }, { data: arrivals }, { data: departures }, { data: forecastRows }] = await Promise.all([
    supabase.from('categories').select('*').order('name'),
    supabase.from('projects').select('*, partners(name)').eq('status', 'active').order('name'),
    supabase.from('asset_summary').select('*'),
    supabase.from('transfer_notes').select('to_location_id, transfer_note_items(category_id, sl_xuat, sl_thuc_nhan)')
      .eq('to_location_type', 'du_an').eq('status', 'chinh_thuc').lte('ngay_ky', today),
    supabase.from('transfer_notes').select('from_location_id, transfer_note_items(category_id, sl_xuat, sl_thuc_nhan)')
      .eq('from_location_type', 'du_an').eq('status', 'chinh_thuc').lte('ngay_ky', today),
    supabase.from('equipment_forecasts').select('*, projects(name)').order('expected_date'),
  ]);
  if (isStale()) return;
  const catList = cats ?? [], projList = projects ?? [], forecasts = forecastRows ?? [];

  const catById = (id) => catList.find(c => c.id === id);
  const projById = (id) => projList.find(p => p.id === id);

  // Đang triển khai tại từng dự án — y hệt cách tính ở Tài sản/Bảng kê.
  const deployed = {}; // deployed[projectId][categoryId] = qty
  function addQty(projectId, categoryId, delta) {
    (deployed[projectId] ??= {})[categoryId] = (deployed[projectId]?.[categoryId] ?? 0) + delta;
  }
  (arrivals ?? []).forEach(n => n.transfer_note_items.forEach(it => addQty(n.to_location_id, it.category_id, Number(it.sl_thuc_nhan ?? it.sl_xuat))));
  (departures ?? []).forEach(n => n.transfer_note_items.forEach(it => addQty(n.from_location_id, it.category_id, -Number(it.sl_thuc_nhan ?? it.sl_xuat))));

  const khoQtyByCategory = (categoryId) => (summaryRows ?? [])
    .filter(r => r.category_id === categoryId && r.status === 'kho').reduce((s, r) => s + r.qty, 0);

  function forecastsFor(projectId, categoryId) {
    return forecasts.filter(f => f.project_id === projectId && f.category_id === categoryId);
  }

  // ================= TAB 1 — CẬP NHẬT KẾ HOẠCH =================
  function renderCapNhatTab() {
    // Danh sách mọi cặp (dự án, chủng loại) đang có hàng > 0 tại dự án.
    const rows = [];
    Object.entries(deployed).forEach(([projectId, byCat]) => {
      Object.entries(byCat).forEach(([categoryId, qty]) => {
        if (qty <= 0) return;
        const traPlans = forecastsFor(projectId, categoryId).filter(f => f.plan_type === 'tra');
        const nhapPlans = forecastsFor(projectId, categoryId).filter(f => f.plan_type === 'nhap');
        rows.push({ projectId, categoryId, qty, traPlans, nhapPlans, hasTraPlan: traPlans.length > 0 });
      });
    });

    const missingCount = rows.filter(r => !r.hasTraPlan).length;

    container.querySelector('#sub-capnhat').innerHTML = `
      ${missingCount > 0
        ? `<div class="error-box">Có <b>${missingCount}</b> dòng thiết bị đang tại dự án CHƯA khai báo kế hoạch trả — cần trao đổi với công trình để biết dự kiến trả về lúc nào.</div>`
        : `<div class="note-box">Mọi dòng thiết bị đang tại dự án đều đã có kế hoạch trả.</div>`}
      <div class="toolbar">
        <input type="text" id="kfProjectFilter" list="kfProjectFilterList" placeholder="Lọc theo dự án...">
        <datalist id="kfProjectFilterList">${projList.map(p => `<option value="${esc(p.name)}"></option>`).join('')}</datalist>
        <label style="display:flex; align-items:center; gap:6px; font-size:.85rem; color:var(--ink-soft);">
          <input type="checkbox" id="kfOnlyMissing"> Chỉ hiện dòng chưa có kế hoạch trả
        </label>
      </div>
      <div class="panel"><div class="panel-body" style="padding:0">
        <table id="kfTable"></table>
      </div></div>
    `;

    function renderTable() {
      const filterText = container.querySelector('#kfProjectFilter').value.trim().toLowerCase();
      const onlyMissing = container.querySelector('#kfOnlyMissing').checked;

      const filtered = rows
        .filter(r => !filterText || (projById(r.projectId)?.name ?? '').toLowerCase().includes(filterText))
        .filter(r => !onlyMissing || !r.hasTraPlan)
        .sort((a, b) => (a.hasTraPlan === b.hasTraPlan ? 0 : a.hasTraPlan ? 1 : -1));

      const rowsHtml = filtered.map(r => {
        const proj = projById(r.projectId), cat = catById(r.categoryId);
        const traSum = r.traPlans.reduce((s, f) => s + Number(f.qty), 0);
        const nhapSum = r.nhapPlans.reduce((s, f) => s + Number(f.qty), 0);
        return `<tr data-open-plan="${r.projectId}|${r.categoryId}" style="cursor:pointer; ${!r.hasTraPlan ? 'background:var(--red-tint);' : ''}">
          <td><b style="color:var(--red-dark);">${esc(proj?.name ?? '(?)')}</b> <span style="color:var(--ink-soft); font-size:.78rem;">(${esc(proj?.partners?.name ?? '')})</span></td>
          <td>${esc(cat?.name ?? '(?)')}</td>
          <td class="num">${fmtNum(r.qty)} ${esc(cat?.unit ?? '')}</td>
          <td>${r.hasTraPlan ? `<span class="badge chinh">Đã có — dự kiến trả ${fmtNum(traSum)}</span>` : '<span class="badge tre">Chưa có kế hoạch trả</span>'}</td>
          <td>${nhapSum > 0 ? `<span class="badge tam">Dự kiến nhập thêm ${fmtNum(nhapSum)}</span>` : '—'}</td>
        </tr>`;
      }).join('');

      const table = container.querySelector('#kfTable');
      table.innerHTML = `<thead><tr><th>Dự án</th><th>Chủng loại</th><th class="num">Đang tại dự án</th><th>Kế hoạch trả</th><th>Kế hoạch nhập thêm</th></tr></thead>
        <tbody>${rowsHtml || '<tr><td colspan="5" class="empty-state">Không có dòng nào khớp bộ lọc</td></tr>'}</tbody>`;

      table.querySelectorAll('[data-open-plan]').forEach(tr => {
        tr.addEventListener('click', () => {
          const [projectId, categoryId] = tr.dataset.openPlan.split('|');
          openPlanModal(projectId, categoryId);
        });
      });
    }

    container.querySelector('#kfProjectFilter').addEventListener('input', renderTable);
    container.querySelector('#kfOnlyMissing').addEventListener('change', renderTable);
    renderTable();
  }

  function openPlanModal(projectId, categoryId) {
    const proj = projById(projectId), cat = catById(categoryId);
    const currentQty = deployed[projectId]?.[categoryId] ?? 0;

    function existingRowsHtml() {
      const items = forecastsFor(projectId, categoryId).sort((a, b) => a.expected_date.localeCompare(b.expected_date));
      if (items.length === 0) return '<div class="empty-state">Chưa có kế hoạch nào được khai báo cho dòng này</div>';
      return `<table style="margin-top:6px;"><thead><tr><th>Loại</th><th class="num">SL</th><th>Ngày dự kiến</th><th>Ghi chú</th><th></th></tr></thead>
        <tbody>${items.map(f => `<tr>
          <td>${f.plan_type === 'tra' ? '🔴 Trả về' : '🔵 Nhập thêm'}</td>
          <td class="num">${fmtNum(f.qty)}</td>
          <td>${fmtDate(f.expected_date)}</td>
          <td style="font-size:.78rem; color:var(--ink-soft);">${esc(f.note ?? '—')}</td>
          <td><button class="btn secondary small" data-del-plan="${f.id}">Xóa</button></td>
        </tr>`).join('')}</tbody></table>`;
    }

    const bodyHtml = `
      <div class="info-box">Đang tại dự án: <b>${fmtNum(currentQty)} ${esc(cat?.unit ?? '')}</b></div>
      <b>Các kế hoạch đã khai báo:</b>
      <div id="pmExisting">${existingRowsHtml()}</div>
      <hr style="margin:16px 0; border:none; border-top:1px solid var(--line);">
      <b>Thêm kế hoạch mới:</b>
      <div class="field-row" style="margin-top:8px;">
        <div class="field"><label>Loại kế hoạch</label>
          <select id="pmType"><option value="tra">Trả về</option><option value="nhap">Nhập thêm</option></select>
        </div>
        <div class="field"><label>Số lượng</label><input type="number" id="pmQty" placeholder="VD: 500"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Ngày dự kiến</label><input type="date" id="pmDate" value="${todayStr()}"></div>
        <div class="field"><label>Ghi chú</label><input type="text" id="pmNote" placeholder="VD: Công trình báo trả sau khi xong phần thô"></div>
      </div>
      <div id="pmError" class="error-box" style="display:none;"></div>
    `;
    const footerHtml = `<button class="btn secondary" id="pmClose">Đóng</button><button class="btn" id="pmAdd">Thêm kế hoạch</button>`;
    const dialog = openModal({ title: `${proj?.name ?? ''} — ${cat?.name ?? ''}`, bodyHtml, footerHtml, wide: true });

    function bindDeleteButtons() {
      dialog.querySelectorAll('[data-del-plan]').forEach(btn => {
        btn.addEventListener('click', async () => {
          await supabase.from('equipment_forecasts').delete().eq('id', btn.dataset.delPlan);
          const idx = forecasts.findIndex(f => f.id === btn.dataset.delPlan);
          if (idx >= 0) forecasts.splice(idx, 1);
          dialog.querySelector('#pmExisting').innerHTML = existingRowsHtml();
          bindDeleteButtons();
          renderCapNhatTab();
        });
      });
    }
    bindDeleteButtons();

    dialog.querySelector('#pmClose').addEventListener('click', () => { closeModal(); renderCapNhatTab(); });
    dialog.querySelector('#pmAdd').addEventListener('click', async () => {
      const plan_type = dialog.querySelector('#pmType').value;
      const qty = parseFloat(dialog.querySelector('#pmQty').value);
      const expected_date = dialog.querySelector('#pmDate').value;
      const note = dialog.querySelector('#pmNote').value || null;
      const errBox = dialog.querySelector('#pmError');
      errBox.style.display = 'none';

      if (isNaN(qty) || qty <= 0) { errBox.textContent = 'Nhập số lượng lớn hơn 0.'; errBox.style.display = 'block'; return; }
      if (!expected_date) { errBox.textContent = 'Chọn ngày dự kiến.'; errBox.style.display = 'block'; return; }

      const { data: newRow, error } = await supabase.from('equipment_forecasts').insert({
        project_id: projectId, category_id: categoryId, plan_type, qty, expected_date, note,
        created_by: profile.id, updated_by: profile.id,
      }).select('*, projects(name)').single();
      if (error) { errBox.textContent = 'Lỗi lưu: ' + error.message; errBox.style.display = 'block'; return; }

      forecasts.push(newRow);
      dialog.querySelector('#pmExisting').innerHTML = existingRowsHtml();
      bindDeleteButtons();
      dialog.querySelector('#pmQty').value = '';
      dialog.querySelector('#pmNote').value = '';
      renderCapNhatTab();
    });
  }

  // ================= TAB 2 — KẾ HOẠCH TỔNG (3 THÁNG TỚI) =================
  function renderTongHopTab() {
    const el = container.querySelector('#sub-tonghop');

    const inHorizon = forecasts.filter(f => f.expected_date <= horizonEnd);
    const byCategory = {};
    inHorizon.forEach(f => {
      (byCategory[f.category_id] ??= { months: [0, 0, 0] });
      const idx = monthBuckets.findIndex(m => f.expected_date >= m.start && f.expected_date <= m.end);
      if (idx < 0) return;
      byCategory[f.category_id].months[idx] += f.plan_type === 'tra' ? Number(f.qty) : -Number(f.qty);
    });

    const rows = catList
      .filter(c => byCategory[c.id])
      .map(c => {
        const kho = khoQtyByCategory(c.id);
        let running = kho;
        const monthEnds = byCategory[c.id].months.map(delta => { running += delta; return running; });
        const thieu = monthEnds.some(v => v < 0);
        return { c, kho, deltas: byCategory[c.id].months, monthEnds, thieu };
      })
      .sort((a, b) => (a.thieu === b.thieu ? 0 : a.thieu ? -1 : 1));

    const rowsHtml = rows.map(r => `<tr${r.thieu ? ' style="background:var(--red-tint);"' : ''}>
      <td>${esc(r.c.name)}</td><td>${esc(r.c.unit)}</td>
      <td class="num">${fmtNum(r.kho)}</td>
      ${r.deltas.map((d, i) => `
        <td class="num" style="${d < 0 ? 'color:var(--red-dark);' : d > 0 ? 'color:var(--green);' : ''}">${d !== 0 ? (d > 0 ? '+' : '') + fmtNum(d) : '—'}</td>
        <td class="num" style="${r.monthEnds[i] < 0 ? 'color:var(--red-dark); font-weight:700;' : ''}">${fmtNum(r.monthEnds[i])}</td>
      `).join('')}
      <td>${r.thieu ? '<span class="badge tre">Không đủ</span>' : '<span class="badge chinh">Ổn</span>'}</td>
    </tr>`).join('');

    const thieuCount = rows.filter(r => r.thieu).length;

    el.innerHTML = `
      ${thieuCount > 0
        ? `<div class="error-box">Có <b>${thieuCount}</b> chủng loại dự kiến KHÔNG ĐỦ hàng trong 3 tháng tới — cần chuẩn bị đầu tư thêm hoặc thúc đẩy thu hồi gấp từ các dự án đang giữ.</div>`
        : `<div class="note-box">Chưa có chủng loại nào cảnh báo thiếu trong 3 tháng tới, theo các kế hoạch đã khai báo hiện có.</div>`}
      <div class="panel"><div class="panel-body" style="padding:0; overflow-x:auto;">
        <table>
          <thead><tr>
            <th>Chủng loại</th><th>ĐVT</th><th class="num">Tồn kho hiện tại</th>
            ${monthBuckets.map(m => `<th class="num">${esc(m.label)}<br>Trả (+) / Nhập (-)</th><th class="num">Tồn dự báo cuối tháng</th>`).join('')}
            <th>Tình trạng</th>
          </tr></thead>
          <tbody>${rowsHtml || `<tr><td colspan="${3 + monthBuckets.length * 2 + 1}" class="empty-state">Chưa có kế hoạch nào được khai báo trong 3 tháng tới</td></tr>`}</tbody>
        </table>
      </div></div>
      <div class="note-box">Tồn kho hiện tại lấy từ tài sản đang có sẵn tại kho. "Trả (+)" làm tăng tồn kho dự báo, "Nhập (-)" (dự án nhận thêm) làm giảm — cả 2 do Sale khai báo ở tab "Cập nhật kế hoạch", càng đầy đủ dự báo càng chính xác.</div>
    `;
  }

  container.querySelector('#subCapNhat').addEventListener('click', () => {
    container.querySelector('#sub-capnhat').style.display = 'block';
    container.querySelector('#sub-tonghop').style.display = 'none';
  });
  container.querySelector('#subTongHop').addEventListener('click', () => {
    container.querySelector('#sub-capnhat').style.display = 'none';
    container.querySelector('#sub-tonghop').style.display = 'block';
    renderTongHopTab();
  });

  renderCapNhatTab();
}
