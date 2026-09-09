// js/modules/giaonhan.js
import { supabase } from '../core/config.js';
import { todayStr, daysBetween, esc } from '../core/utils.js';
import { renderApprovalCard, bindApprovalConfirm } from '../core/approvalUI.js';
import { renderAttachmentRow, bindAttachmentEvents, uploadAttachment } from '../core/attachments.js';
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

  // Nơi xuất / Nơi nhập giờ độc lập — mỗi bên có thể là Kho hoặc Dự án, không cố định.
  function locationOptions() {
    return `
      <optgroup label="Kho">${warehouses.map(w => `<option value="kho:${w.id}">${w.name}</option>`).join('')}</optgroup>
      <optgroup label="Dự án">${projects.map(p => `<option value="du_an:${p.id}">${p.name}</option>`).join('')}</optgroup>
    `;
  }
  function locationName(type, id) {
    if (type === 'kho') return warehouses.find(w => w.id === id)?.name ?? '(?)';
    if (type === 'du_an') return projects.find(p => p.id === id)?.name ?? '(?)';
    return '(?)';
  }
  // Tương thích ngược với phiếu cũ (trước khi có cột location tổng quát)
  function resolveFrom(note) {
    if (note.from_location_type) return locationName(note.from_location_type, note.from_location_id);
    if (note.from_warehouse_id) return warehouses.find(w => w.id === note.from_warehouse_id)?.name ?? '(?)';
    return '(?)';
  }
  function resolveTo(note) {
    if (note.to_location_type) return locationName(note.to_location_type, note.to_location_id);
    if (note.project_id) return projects.find(p => p.id === note.project_id)?.name ?? '(?)';
    return '(?)';
  }

  container.querySelector('#btnNewPhieu').addEventListener('click', () => openNewPhieuModal());
  container.querySelector('#gnFilterProject').addEventListener('change', loadPhieu);

  async function nextCode() {
    const { count } = await supabase.from('transfer_notes').select('id', { count: 'exact', head: true });
    return 'PGN-' + String((count ?? 0) + 1).padStart(6, '0');
  }

  async function openNewPhieuModal() {
    const previewCode = await nextCode();

    const bodyHtml = `
      <div class="field-row">
        <div class="field"><label>Số phiếu (tự động)</label><input type="text" value="${previewCode}" disabled></div>
        <div class="field"><label>Ngày ký phiếu</label><input type="date" id="mDate" value="${todayStr()}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Nơi xuất</label><select id="mFrom">${locationOptions()}</select></div>
        <div class="field"><label>Nơi nhập</label><select id="mTo">${locationOptions()}</select></div>
      </div>
      <div class="note-box" style="margin-top:0;">Nơi xuất/nhập có thể là Kho hoặc Dự án tùy tình huống — VD dự án trả hàng về thì Nơi xuất chọn Dự án, Nơi nhập chọn Kho.</div>
      <div class="field-row">
        <div class="field"><label>Người giao (bên xuất)</label><input type="text" id="mNguoiGiao" placeholder="Tên người giao"></div>
        <div class="field"><label>Quản lý duyệt (bên xuất)</label><input type="text" id="mQuanLy" placeholder="Tên quản lý"></div>
      </div>
      <div class="field-row" style="grid-template-columns:1fr 1fr 1fr;">
        <div class="field"><label>Đơn vị vận chuyển</label><input type="text" id="mNhaXe" placeholder="Tên nhà xe"></div>
        <div class="field"><label>Số xe</label><input type="text" id="mBienSo" placeholder="50E-123.45"></div>
        <div class="field"><label>Loại xe</label><select id="mLoaiXe"><option value="">— Chọn —</option>${vehicleTypes.map(v => `<option value="${v.id}">${v.name}</option>`).join('')}</select></div>
      </div>

      <div class="field">
        <label>Dòng hàng</label>
        <table style="margin-top:6px;">
          <thead><tr><th style="width:40px;">STT</th><th>Tên hàng &amp; quy cách</th><th style="width:90px;">ĐVT</th><th class="num" style="width:130px;">SL hàng xuất</th><th style="width:50px;"></th></tr></thead>
          <tbody id="mItemRows"></tbody>
        </table>
        <button class="btn secondary small" id="mAddRow" type="button" style="margin-top:8px;">+ Thêm dòng</button>
      </div>

      <div class="field">
        <label>File đính kèm (phiếu ký scan, ảnh giao nhận)</label>
        <input type="file" id="mFiles" multiple accept=".pdf,image/*">
      </div>
    `;

    const footerHtml = `
      <button class="btn secondary" id="mCancel">Hủy</button>
      <button class="btn" id="mSubmit">Kho ghi nhận tạm</button>
    `;

    const dialog = openModal({ title: 'Tạo phiếu giao nhận mới', bodyHtml, footerHtml, wide: true });

    function addRow() {
      const tbody = dialog.querySelector('#mItemRows');
      const row = document.createElement('tr');
      row.innerHTML = `
        <td class="stt"></td>
        <td><select class="row-cat">${categories.map(c => `<option value="${c.id}" data-unit="${c.unit}">${c.name}</option>`).join('')}</select></td>
        <td class="row-unit">${categories[0]?.unit ?? ''}</td>
        <td><input type="number" class="row-qty" value="100" min="1"></td>
        <td><button class="btn secondary small row-remove" type="button" style="padding:2px 8px;">Xóa</button></td>
      `;
      tbody.appendChild(row);

      row.querySelector('.row-cat').addEventListener('change', (e) => {
        row.querySelector('.row-unit').textContent = e.target.selectedOptions[0].dataset.unit;
      });
      row.querySelector('.row-remove').addEventListener('click', () => { row.remove(); renumberRows(); });
      renumberRows();
    }

    function renumberRows() {
      dialog.querySelectorAll('#mItemRows tr').forEach((row, idx) => {
        row.querySelector('.stt').textContent = idx + 1;
      });
    }

    dialog.querySelector('#mAddRow').addEventListener('click', addRow);
    addRow(); // sẵn 1 dòng đầu tiên cho tiện nhập ngay

    dialog.querySelector('#mCancel').addEventListener('click', closeModal);

    dialog.querySelector('#mSubmit').addEventListener('click', async () => {
      const rows = Array.from(dialog.querySelectorAll('#mItemRows tr')).map(row => ({
        category_id: row.querySelector('.row-cat').value,
        sl_xuat: parseFloat(row.querySelector('.row-qty').value) || 0,
      })).filter(r => r.sl_xuat > 0);

      if (rows.length === 0) { alert('Thêm ít nhất 1 dòng hàng có số lượng hợp lệ.'); return; }

      const [fromType, fromId] = dialog.querySelector('#mFrom').value.split(':');
      const [toType, toId] = dialog.querySelector('#mTo').value.split(':');
      if (fromType === toType && fromId === toId) { alert('Nơi xuất và Nơi nhập không được trùng nhau.'); return; }

      // direction chỉ dùng để phân loại/lọc thô — logic tính bill dựa vào project_id, không dựa vào direction
      let direction = 'dieu_chuyen_kho';
      if (fromType === 'kho' && toType === 'du_an') direction = 'xuat_du_an';
      else if (fromType === 'du_an' && toType === 'kho') direction = 'nhap_kho';

      // project_id vẫn giữ để phần tính bill (billing.js) hoạt động không đổi —
      // lấy đúng bên nào là dự án (nếu cả 2 bên đều là dự án, đây là hạn chế cần bàn thêm sau)
      const project_id = fromType === 'du_an' ? fromId : (toType === 'du_an' ? toId : null);

      const ngay_ky = dialog.querySelector('#mDate').value;
      const nguoi_giao = dialog.querySelector('#mNguoiGiao').value || null;
      const quan_ly_xuat = dialog.querySelector('#mQuanLy').value || null;
      const nha_xe = dialog.querySelector('#mNhaXe').value || null;
      const bien_so = dialog.querySelector('#mBienSo').value || null;
      const loai_xe_id = dialog.querySelector('#mLoaiXe').value || null;
      const files = Array.from(dialog.querySelector('#mFiles').files);
      const code = await nextCode();

      const submitBtn = dialog.querySelector('#mSubmit');
      submitBtn.disabled = true; submitBtn.textContent = 'Đang tạo...';

      const { data: note, error } = await supabase.from('transfer_notes').insert({
        code, direction, ngay_ky,
        from_location_type: fromType, from_location_id: fromId,
        to_location_type: toType, to_location_id: toId,
        project_id,
        nguoi_giao, quan_ly_xuat, nha_xe, bien_so, loai_xe_id, status: 'tam', created_by: profile.id,
      }).select().single();
      if (error) { alert('Lỗi tạo phiếu: ' + error.message); submitBtn.disabled = false; submitBtn.textContent = 'Kho ghi nhận tạm'; return; }

      const items = rows.map(r => ({ transfer_note_id: note.id, category_id: r.category_id, sl_xuat: r.sl_xuat }));
      const { error: itemsError } = await supabase.from('transfer_note_items').insert(items);
      if (itemsError) { alert('Lỗi thêm dòng hàng: ' + itemsError.message); submitBtn.disabled = false; submitBtn.textContent = 'Kho ghi nhận tạm'; return; }

      for (const file of files) {
        try { await uploadAttachment(note.id, file, profile.id); }
        catch (err) { alert('Tạo phiếu thành công nhưng lỗi tải file đính kèm: ' + err.message); }
      }

      closeModal();
      loadPhieu();
    });
  }

  async function loadPhieu() {
    const filterProject = container.querySelector('#gnFilterProject').value;
    let q = supabase.from('transfer_notes')
      .select('*, transfer_note_items(*)')
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
      meta: `${esc(resolveFrom(note))} → ${esc(resolveTo(note))}`,
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
    bindAttachmentEvents(container, profile.id, loadPhieu);

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
