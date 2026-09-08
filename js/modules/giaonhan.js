// js/modules/giaonhan.js
import { supabase } from '../core/config.js';
import { todayStr, daysBetween, esc } from '../core/utils.js';
import { renderApprovalCard, bindApprovalConfirm } from '../core/approvalUI.js';
import { renderAttachmentRow, bindAttachmentEvents } from '../core/attachments.js';

export async function render(container, profile) {
  container.innerHTML = `
    <div class="page-head">
      <div><h1>Giao nhận</h1><div class="sub">Kho nhập tạm → xác nhận thực nhận trong 3 ngày làm việc → chính thức</div></div>
      <button class="btn" id="btnNewPhieu">+ Tạo phiếu xuất mới</button>
    </div>

    <div class="panel" id="newForm" style="display:none; margin-bottom:18px;">
      <div class="panel-body">
        <div class="form-row">
          <div><label>Nơi nhập (dự án)</label><select id="npProject"></select></div>
          <div><label>Ngày ký phiếu</label><input type="date" id="npDate"></div>
          <div><label>Tài xế / Nhà xe</label><input type="text" id="npDriver" placeholder="Tên tài xế / nhà xe"></div>
        </div>
        <div class="form-row" style="grid-template-columns:2fr 1fr auto;">
          <select id="npCatSel"></select>
          <input type="number" id="npQtySel" value="100" min="1">
          <button class="btn secondary small" id="npAddItem">+ Thêm dòng</button>
        </div>
        <div id="npItemList"></div>
        <div style="margin-top:12px;">
          <button class="btn small" id="npSubmit">Kho ghi nhận tạm</button>
          <button class="btn secondary small" id="npCancel">Hủy</button>
        </div>
      </div>
    </div>

    <div class="toolbar"><select id="gnFilterProject"><option value="">Tất cả dự án</option></select></div>
    <div class="note-box">Xác nhận thực nhận: mặc định bằng đúng số hàng xuất, chỉ sửa dòng nào bị lệch, rồi bấm "Xác nhận toàn bộ phiếu".</div>

    <div id="phieuList" class="loading">Đang tải...</div>
  `;

  let categories = [], projects = [], pendingItems = [];

  const { data: c } = await supabase.from('categories').select('*').order('name');
  const { data: p } = await supabase.from('projects').select('*').eq('status', 'active').order('name');
  categories = c ?? []; projects = p ?? [];

  container.querySelector('#npProject').innerHTML = projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  container.querySelector('#npCatSel').innerHTML = categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  container.querySelector('#gnFilterProject').innerHTML = '<option value="">Tất cả dự án</option>' +
    projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  container.querySelector('#npDate').value = todayStr();

  const catName = (id) => categories.find(c => c.id === id)?.name ?? '(?)';
  const catUnit = (id) => categories.find(c => c.id === id)?.unit ?? '';
  const projName = (id) => projects.find(p => p.id === id)?.name ?? '(?)';

  function renderPendingItems() {
    container.querySelector('#npItemList').innerHTML = pendingItems.map((it, idx) =>
      `<div style="display:flex; justify-content:space-between; padding:6px 10px; background:var(--gray-tint); margin-bottom:4px; font-size:.82rem;">
        <span>${catName(it.category_id)} — ${it.sl_xuat} ${catUnit(it.category_id)}</span>
        <button class="btn secondary small" data-remove="${idx}" style="padding:2px 8px;">Xóa</button>
      </div>`
    ).join('');
    container.querySelectorAll('[data-remove]').forEach(b =>
      b.addEventListener('click', () => { pendingItems.splice(parseInt(b.dataset.remove), 1); renderPendingItems(); }));
  }

  container.querySelector('#btnNewPhieu').addEventListener('click', () => {
    pendingItems = []; renderPendingItems();
    const form = container.querySelector('#newForm');
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
  });
  container.querySelector('#npCancel').addEventListener('click', () => { container.querySelector('#newForm').style.display = 'none'; });
  container.querySelector('#npAddItem').addEventListener('click', () => {
    const category_id = container.querySelector('#npCatSel').value;
    const sl_xuat = parseFloat(container.querySelector('#npQtySel').value) || 1;
    pendingItems.push({ category_id, sl_xuat });
    renderPendingItems();
  });

  container.querySelector('#npSubmit').addEventListener('click', async () => {
    if (pendingItems.length === 0) { alert('Thêm ít nhất 1 dòng hàng.'); return; }
    const project_id = container.querySelector('#npProject').value;
    const ngay_ky = container.querySelector('#npDate').value;
    const tai_xe = container.querySelector('#npDriver').value || null;
    const code = 'PGN-' + Date.now().toString().slice(-8);

    const { data: note, error } = await supabase.from('transfer_notes').insert({
      code, direction: 'xuat_du_an', project_id, ngay_ky, tai_xe, status: 'tam', created_by: profile.id,
    }).select().single();
    if (error) { alert('Lỗi tạo phiếu: ' + error.message); return; }

    const items = pendingItems.map(it => ({ transfer_note_id: note.id, category_id: it.category_id, sl_xuat: it.sl_xuat }));
    const { error: itemsError } = await supabase.from('transfer_note_items').insert(items);
    if (itemsError) { alert('Lỗi thêm dòng hàng: ' + itemsError.message); return; }

    pendingItems = [];
    container.querySelector('#newForm').style.display = 'none';
    loadPhieu();
  });

  container.querySelector('#gnFilterProject').addEventListener('change', loadPhieu);

  async function loadPhieu() {
    const filterProject = container.querySelector('#gnFilterProject').value;
    let q = supabase.from('transfer_notes')
      .select('*, transfer_note_items(*)')
      .eq('direction', 'xuat_du_an')
      .order('created_at', { ascending: false })
      .limit(50);
    if (filterProject) q = q.eq('project_id', filterProject);

    const { data: notes, error } = await q;
    if (error) { container.querySelector('#phieuList').innerHTML = `<div class="error-box">${error.message}</div>`; return; }

    // Fallback 3 ngày làm việc — client-side cho demo; hệ thống thật nên chạy bằng
    // Supabase Edge Function + cron để không phụ thuộc việc có ai mở trang hay không.
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

    const cards = notes.map(note => renderApprovalCard({
      id: note.id, code: note.code, ngay_ky: note.ngay_ky, status: note.status, late_flag: note.late_flag,
      meta: `Nơi nhập: ${esc(projName(note.project_id))}`,
      items: note.transfer_note_items.map(it => ({
        id: it.id, label: catName(it.category_id), unit: catUnit(it.category_id),
        sl_xuat: it.sl_xuat, sl_thuc_nhan: it.sl_thuc_nhan, tinh_trang: it.tinh_trang,
      })),
      signInfo: `<span>Người giao: <b>${esc(note.nguoi_giao ?? '—')}</b> · QL duyệt: <b>${esc(note.quan_ly_xuat ?? '—')}</b></span>
                 <span>Người nhận: <b>${esc(note.nguoi_nhan ?? '— chưa ký —')}</b></span>
                 <span>Vận chuyển: <b>${esc(note.tai_xe ?? '—')}</b></span>`,
    })).join('');

    container.querySelector('#phieuList').innerHTML = cards || '<div class="empty-state">Chưa có phiếu nào khớp bộ lọc</div>';

    // Nạp file đính kèm cho từng phiếu
    for (const note of notes) {
      const el = container.querySelector(`#attach-${note.id}`);
      if (el) el.innerHTML = await renderAttachmentRow(note.id);
    }
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
