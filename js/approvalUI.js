// js/core/approvalUI.js
// Component dùng chung cho mọi luồng "Kho/người tạo nhập tạm -> người khác xác nhận".
// Hiện dùng cho phiếu giao nhận (giaonhan.js); thiết kế đủ tổng quát để tái dùng
// cho điều chuyển kho-kho hoặc các luồng duyệt khác sau này.

import { fmtDate, esc } from './utils.js';

// note: { id, code, ngay_ky, status, late_flag, items: [{id, label, unit, sl_xuat, sl_thuc_nhan, tinh_trang}], meta, signInfo }
export function renderApprovalCard(note) {
  const badge = note.status === 'tam'
    ? '<span class="badge tam">Nhập tạm — chờ xác nhận</span>'
    : note.late_flag
      ? '<span class="badge tre">Chính thức — xác nhận trễ</span>'
      : '<span class="badge chinh">Chính thức</span>';

  const itemRows = note.items.map((it, i) => {
    const thucNhanCell = note.status === 'tam'
      ? `<input type="number" data-qty="${note.id}:${it.id}" value="${it.sl_xuat}">`
      : `${it.sl_thuc_nhan}${it.sl_thuc_nhan < it.sl_xuat ? ` <span style="color:var(--red-dark);font-size:.74rem;">(thiếu ${it.sl_xuat - it.sl_thuc_nhan})</span>` : ''}`;
    return `<tr>
      <td>${esc(it.label)}</td><td>${esc(it.unit)}</td>
      <td class="num">${it.sl_xuat}</td><td class="num">${thucNhanCell}</td>
      <td>${esc(it.tinh_trang || (note.status === 'tam' ? 'Chờ xác nhận' : ''))}</td>
    </tr>`;
  }).join('');

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
    ${confirmBlock}
    <div class="approval-sign">${note.signInfo || ''}</div>
    <div id="attach-${note.id}"></div>
  </div>`;
}

// Gắn sự kiện "Xác nhận toàn bộ phiếu" — onConfirm(noteId, itemUpdates[]) do module gọi thực hiện update DB
export function bindApprovalConfirm(container, notes, onConfirm) {
  container.querySelectorAll('[data-confirm]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const noteId = btn.dataset.confirm;
      const note = notes.find(n => n.id === noteId);
      const updates = note.items.map(it => {
        const input = container.querySelector(`[data-qty="${noteId}:${it.id}"]`);
        const val = parseFloat(input.value) || it.sl_xuat;
        return { itemId: it.id, sl_thuc_nhan: val, thieu: val < it.sl_xuat };
      });
      btn.disabled = true;
      btn.textContent = 'Đang xác nhận...';
      await onConfirm(noteId, updates);
    });
  });
}
