// js/core/approvalUI.js
// Component dùng chung cho mọi luồng "Kho/người tạo nhập tạm -> người khác xác nhận".
// Hỗ trợ thêm: khai báo dòng PHÁT SINH KHI NHẬN (chủng loại không có trong phiếu gốc,
// hoặc nhận nhiều hơn xuất) — phục vụ xử lý trả dư / quy đổi quy cách ở module gọi.

import { fmtDate, esc } from './utils.js';

// note: { id, code, ngay_ky, status, late_flag, items: [{id, label, unit, sl_xuat, sl_thuc_nhan, tinh_trang}],
//         meta, signInfo, categoryOptions: [{id, name, unit}] (chỉ cần khi status='tam') }
export function renderApprovalCard(note) {
  const badge = note.status === 'tam'
    ? '<span class="badge tam">Nhập tạm — chờ xác nhận</span>'
    : note.late_flag
      ? '<span class="badge tre">Chính thức — xác nhận trễ</span>'
      : '<span class="badge chinh">Chính thức</span>';

  const itemRows = note.items.map((it, i) => {
    const thucNhanCell = note.status === 'tam'
      ? `<input type="number" data-qty="${note.id}:${it.id}" value="${it.sl_xuat}">`
      : `${it.sl_thuc_nhan}${it.sl_thuc_nhan < it.sl_xuat ? ` <span style="color:var(--red-dark);font-size:.74rem;">(thiếu ${it.sl_xuat - it.sl_thuc_nhan})</span>` : it.sl_thuc_nhan > it.sl_xuat ? ` <span style="color:var(--green);font-size:.74rem;">(dư ${it.sl_thuc_nhan - it.sl_xuat})</span>` : ''}`;
    return `<tr>
      <td>${esc(it.label)}</td><td>${esc(it.unit)}</td>
      <td class="num">${it.sl_xuat}</td><td class="num">${thucNhanCell}</td>
      <td>${esc(it.tinh_trang || (note.status === 'tam' ? 'Chờ xác nhận' : ''))}</td>
    </tr>`;
  }).join('');

  const extraRowSection = note.status === 'tam' && note.categoryOptions ? `
    <div class="approval-extra" id="extra-${note.id}">
      <div class="approval-extra-list" id="extra-list-${note.id}"></div>
      <div style="display:flex; gap:8px; padding:8px 16px; align-items:center;">
        <select class="extra-cat" data-extra-cat="${note.id}" style="flex:1;">
          ${note.categoryOptions.map(c => `<option value="${c.id}" data-unit="${esc(c.unit)}">${esc(c.name)}</option>`).join('')}
        </select>
        <input type="number" class="extra-qty" data-extra-qty="${note.id}" value="1" min="1" style="width:90px;">
        <button class="btn secondary small" type="button" data-add-extra="${note.id}">+ Dòng phát sinh khi nhận</button>
      </div>
    </div>` : '';

  const confirmBlock = note.status === 'tam'
    ? `<div class="approval-confirm-row"><button class="btn small" data-confirm="${note.id}">Xác nhận toàn bộ phiếu</button></div>`
    : '';

  return `<div class="approval-card" data-note="${note.id}">
    <div class="approval-top">
      <div><div class="code">${esc(note.code)}</div><div class="meta">${esc(note.meta)} · Ngày ${fmtDate(note.ngay_ky)}</div></div>
      ${badge}
    </div>
    <table>
      <thead><tr><th>Tên hàng</th><th>ĐVT</th><th class="num">SL xuất</th><th class="num">SL thực nhận</th><th>Tình trạng</th></tr></thead>
      <tbody>${itemRows}</tbody>
    </table>
    ${extraRowSection}
    ${confirmBlock}
    <div class="approval-sign">${note.signInfo || ''}</div>
    <div id="attach-${note.id}"></div>
  </div>`;
}

// Gắn sự kiện "+ Dòng phát sinh khi nhận" — cho khai báo chủng loại/số lượng nhận thêm
// ngoài phiếu gốc (VD nhận nhầm quy cách, nhận dư không thuộc phiếu ban đầu).
export function bindExtraItemEvents(container, notes) {
  const extraState = {}; // noteId -> [{category_id, qty, label, unit}]
  notes.forEach(n => { extraState[n.id] = []; });

  function renderExtraList(noteId) {
    const list = container.querySelector(`#extra-list-${noteId}`);
    if (!list) return;
    list.innerHTML = extraState[noteId].map((e, idx) => `
      <div class="item-mini-row"><span>+ ${esc(e.label)} — ${e.qty} ${esc(e.unit)} <i>(phát sinh khi nhận)</i></span>
      <button class="btn secondary small" data-remove-extra="${noteId}:${idx}" style="padding:2px 8px;">Xóa</button></div>
    `).join('');
    list.querySelectorAll('[data-remove-extra]').forEach(b => {
      b.addEventListener('click', () => {
        const [nId, idx] = b.dataset.removeExtra.split(':');
        extraState[nId].splice(parseInt(idx), 1);
        renderExtraList(nId);
      });
    });
  }

  container.querySelectorAll('[data-add-extra]').forEach(btn => {
    btn.addEventListener('click', () => {
      const noteId = btn.dataset.addExtra;
      const catSel = container.querySelector(`[data-extra-cat="${noteId}"]`);
      const qtyInput = container.querySelector(`[data-extra-qty="${noteId}"]`);
      const qty = parseFloat(qtyInput.value) || 0;
      if (qty <= 0) return;
      extraState[noteId].push({
        category_id: catSel.value, qty,
        label: catSel.selectedOptions[0].textContent,
        unit: catSel.selectedOptions[0].dataset.unit,
      });
      renderExtraList(noteId);
    });
  });

  return extraState; // module gọi đọc trực tiếp state này lúc bấm "Xác nhận toàn bộ phiếu"
}

// Gắn sự kiện "Xác nhận toàn bộ phiếu" — onConfirm(noteId, itemUpdates[], extraItems[])
export function bindApprovalConfirm(container, notes, extraState, onConfirm) {
  container.querySelectorAll('[data-confirm]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const noteId = btn.dataset.confirm;
      const note = notes.find(n => n.id === noteId);
      const updates = note.items.map(it => {
        const input = container.querySelector(`[data-qty="${noteId}:${it.id}"]`);
        const val = parseFloat(input.value) || it.sl_xuat;
        return { itemId: it.id, category_id: it.category_id, sl_xuat: it.sl_xuat, sl_thuc_nhan: val, thieu: val < it.sl_xuat };
      });
      const extraItems = extraState[noteId] || [];

      btn.disabled = true;
      btn.textContent = 'Đang xác nhận...';
      const proceed = await onConfirm(noteId, updates, extraItems);
      if (proceed === false) { btn.disabled = false; btn.textContent = 'Xác nhận toàn bộ phiếu'; }
    });
  });
}
