// js/modules/giaonhan.js
import { supabase } from '../core/config.js';
import { todayStr, daysBetween, esc } from '../core/utils.js';
import { renderApprovalCard, bindApprovalConfirm } from '../core/approvalUI.js';
import { renderAttachmentRow, bindAttachmentEvents } from '../core/attachments.js';
import { openModal, closeModal } from '../core/modal.js';

export async function render(container, profile, isStale = () => false) {
  container.innerHTML = `
    <div class="page-head">
      <div><h1>Giao nhận</h1><div class="sub">Theo dõi theo từng phiếu, xác nhận trong 3 ngày làm việc</div></div>
      <button class="btn" id="btnNewPhieu">+ Tạo phiếu giao nhận mới</button>
    </div>
    <div class="toolbar"><select id="gnFilterProject"><option value="">Tất cả dự án</option></select></div>
    <div class="note-box">Xác nhận thực nhận: mặc định bằng đúng số hàng xuất, chỉ sửa dòng nào bị lệch, rồi bấm "Xác nhận toàn bộ phiếu".</div>
    <div id="phieuList" class="loading">Đang tải...</div>
  `;

  const { data: c } = await supabase.from('categories').select('*').order('name');
  const { data: p } = await supabase.from('projects').select('*').eq('status', 'active').order('name');
  const { data: w } = await supabase.from('warehouses').select('*').order('name');
  const { data: vt } = await supabase.from('vehicle_types').select('*').order('name');
  if (isStale()) return;
  const categories = c ?? [], projects = p ?? [], warehouses = w ?? [], vehicleTypes = vt ?? [];

  container.querySelector('#gnFilterProject').innerHTML = '<option value="">Tất cả dự án</option>' +
    projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');

  const catName = (id) => categories.find(c => c.id === id)?.name ?? '(?)';
  const catUnit = (id) => categories.find(c => c.id === id)?.unit ?? '';
  const projName = (id) => projects.find(p => p.id === id)?.name ?? '(?)';

  container.querySelector('#btnNewPhieu').addEventListener('click', () => openNewPhieuModal());
  container.querySelector('#gnFilterProject').addEventListener('change', loadPhieu);

  async function nextCode() {
    const { count } = await supabase.from('transfer_notes').select('id', { count: 'exact', head: true });
    return 'PGN-' + String((count ?? 0) + 1).padStart(6, '0');
  }

  async function openNewPhieuModal() {
    let pendingItems = [];
    const previewCode = await nextCode();

    const bodyHtml = `
      <div class="field-row">
        <div class="field"><label>Số phiếu (tự động)</label><input type="text" value="${previewCode}" disabled></div>
        <div class="field"><label>Ngày ký phiếu</label><input type="date" id="mDate" value="${todayStr()}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Nơi xuất (kho)</label><select id="mWarehouse">${warehouses.map(w => `<option value="${w.id}">${w.name}</option>`).join('')}</select></div>
        <div class="field"><label>Nơi nhập (dự án)</label><select id="mProject">${projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}</select></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Người giao (Kho)</label><input type="text" id="mNguoiGiao" placeholder="Tên nhân viên kho"></div>
        <div class="field"><label>Quản lý duyệt (bên xuất)</label><input type="text" id="mQuanLy" placeholder="Tên quản lý kho"></div>
      </div>
      <div class="field-row" style="grid-template-columns:1fr 1fr 1fr;">
        <div class="field"><label>Đơn vị vận chuyển</label><input type="text" id="mNhaXe" placeholder="Tên nhà xe"></div>
        <div class="field"><label>Số xe</label><input type="text" id="mBienSo" placeholder="50E-123.45"></div>
        <div class="field"><label>Loại xe</label><select id="mLoaiXe"><option value="">— Chọn —</option>${vehicleTypes.map(v => `<option value="${v.id}">${v.name}</option>`).join('')}</select></div>
      </div>

      <div class="field">
        <label>Dòng hàng</label>
        <div class="field-row" style="grid-template-columns:2fr 1fr auto; align-items:end;">
          <select id="mCatSel">${categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}</select>
          <input type="number" id="mQtySel" value="100" min="1">
          <button class="btn secondary small" id="mAddItem" type="button">+ Thêm</button>
        </div>
        <table style="margin-top:10px;">
          <thead><tr><th style="width:40px;">STT</th><th>Tên hàng &amp; quy cách</th><th>ĐVT</th><th class="num">SL hàng xuất</th><th></th></tr></thead>
          <tbody id="mItemList"></tbody>
        </table>
      </div>
    `;

    const footerHtml = `
      <button class="btn secondary" id="mCancel">Hủy</button>
      <button class="btn" id="mSubmit">Kho ghi nhận tạm</button>
    `;

    const dialog = openModal({ title: 'Tạo phiếu giao nhận mới', bodyHtml, footerHtml, wide: true });

    function renderItems() {
      dialog.querySelector('#mItemList').innerHTML = pendingItems.map((it, idx) => `<tr>
        <td>${idx + 1}</td>
        <td>${catName(it.category_id)}</td>
        <td>${catUnit(it.category_id)}</td>
        <td class="num">${it.sl_xuat}</td>
        <td><button class="btn secondary small" data-remove="${idx}" style="padding:2px 8px;">Xóa</button></td>
      </tr>`).join('') || '<tr><td colspan="5" class="empty-state">Chưa có dòng hàng nào</td></tr>';
      dialog.querySelectorAll('[data-remove]').forEach(b =>
        b.addEventListener('click', () => { pendingItems.splice(parseInt(b.dataset.remove), 1); renderItems(); }));
    }
    renderItems();

    dialog.querySelector('#mAddItem').addEventListener('click', () => {
      const category_id = dialog.querySelector('#mCatSel').value;
      const sl_xuat = parseFloat(dialog.querySelector('#mQtySel').value) || 1;
      pendingItems.push({ category_id, sl_xuat });
      renderItems();
    });

    dialog.querySelector('#mCancel').addEventListener('click', closeModal);

    dialog.querySelector('#mSubmit').addEventListener('click', async () => {
      if (pendingItems.length === 0) { alert('Thêm ít nhất 1 dòng hàng.'); return; }

      const from_warehouse_id = dialog.querySelector('#mWarehouse').value;
      const project_id = dialog.querySelector('#mProject').value;
      const ngay_ky = dialog.querySelector('#mDate').value;
      const nguoi_giao = dialog.querySelector('#mNguoiGiao').value || null;
      const quan_ly_xuat = dialog.querySelector('#mQuanLy').value || null;
      const nha_xe = dialog.querySelector('#mNhaXe').value || null;
      const bien_so = dialog.querySelector('#mBienSo').value || null;
      const loai_xe_id = dialog.querySelector('#mLoaiXe').value || null;
      const code = await nextCode();

      const { data: note, error } = await supabase.from('transfer_notes').insert({
        code, direction: 'xuat_du_an', from_warehouse_id, project_id, ngay_ky,
        nguoi_giao, quan_ly_xuat, nha_xe, bien_so, loai_xe_id, status: 'tam', created_by: profile.id,
      }).select().single();
      if (error) { alert('Lỗi tạo phiếu: ' + error.message); return; }

      const items = pendingItems.map(it => ({ transfer_note_id: note.id, category_id: it.category_id, sl_xuat: it.sl_xuat }));
      const { error: itemsError } = await supabase.from('transfer_note_items').insert(items);
      if (itemsError) { alert('Lỗi thêm dòng hàng: ' + itemsError.message); return; }

      closeModal();
      loadPhieu();
    });
  }

  async function loadPhieu() {
    const filterProject = container.querySelector('#gnFilterProject').value;
    let q = supabase.from('transfer_notes')
      .select('*, transfer_note_items(*)')
      .eq('direction', 'xuat_du_an')
      .order('created_at', { ascending: false })
      .limit(50);
    if (filterProject) q = q.eq('project_id', filterProject);

    const { data: notes, error } = await q;
    if (isStale()) return;
    if (error) { container.querySelector('#phieuList').innerHTML = `<div class="error-box">${error.message}</div>`; return; }

    for (const note of notes) {
      if (note.status === 'tam' && daysBetween(note.ngay_ky, new Date()) > 3) {
        await Promise.all(note.transfer_note_items.map(it =>
          supabase.from('transfer_note_items').update({ sl_thuc_nhan: it.sl_xuat, tinh_trang: 'Đúng chất lượng, mới 100%' }).eq('id', it.id)
        ));
        await supabase.from('transfer_notes').update({ status: 'chinh_thuc', late_flag: true, confirmed_at: new Date().toISOString() }).eq('id', note.id);
        note.status = 'chinh_thuc'; note.late_flag = true;
        note.transfer_note_items = note.transfer_note_items.map(it => ({ ...it, sl_thuc_nhan: it.sl_xuat }));
      }
    }

    if (isStale()) return;

    const cards = notes.map(note => renderApprovalCard({
      id: note.id, code: note.code, ngay_ky: note.ngay_ky, status: note.status, late_flag: note.late_flag,
      meta: `Nơi nhập: ${esc(projName(note.project_id))}`,
      items: note.transfer_note_items.map(it => ({
        id: it.id, label: catName(it.category_id), unit: catUnit(it.category_id),
        sl_xuat: it.sl_xuat, sl_thuc_nhan: it.sl_thuc_nhan, tinh_trang: it.tinh_trang,
      })),
      signInfo: `<span>Người giao: <b>${esc(note.nguoi_giao ?? '—')}</b> · QL duyệt: <b>${esc(note.quan_ly_xuat ?? '—')}</b></span>
                 <span>Người nhận: <b>${esc(note.nguoi_nhan ?? '— chưa ký —')}</b></span>
                 <span>Vận chuyển: <b>${esc(note.nha_xe ?? '—')}</b> · Số xe <b>${esc(note.bien_so ?? '—')}</b> · ${esc(vehicleTypes.find(v => v.id === note.loai_xe_id)?.name ?? '—')}</span>`,
    })).join('');

    container.querySelector('#phieuList').innerHTML = cards || '<div class="empty-state">Chưa có phiếu nào khớp bộ lọc</div>';

    for (const note of notes) {
      const el = container.querySelector(`#attach-${note.id}`);
      if (el) el.innerHTML = await renderAttachmentRow(note.id);
    }
    if (isStale()) return;
    bindAttachmentEvents(container);

    bindApprovalConfirm(container, notes.map(n => ({ id: n.id, items: n.transfer_note_items })), async (noteId, updates) => {
      for (const u of updates) {
        await supabase.from('transfer_note_items').update({
          sl_thuc_nhan: u.sl_thuc_nhan,
          tinh_trang: u.thieu ? 'Thiếu so với phiếu xuất' : 'Đúng chất lượng, mới 100%',
        }).eq('id', u.itemId);
      }
      await supabase.from('transfer_notes').update({
        status: 'chinh_thuc', confirmed_by: profile.id, confirmed_at: new Date().toISOString(),
      }).eq('id', noteId);
      loadPhieu();
    });
  }

  await loadPhieu();
}
