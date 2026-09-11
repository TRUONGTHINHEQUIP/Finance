// js/modules/giaonhan.js
import { supabase } from '../core/config.js';
import { todayStr, daysBetween, fmtDate, esc } from '../core/utils.js';
import { renderApprovalCard, bindApprovalConfirm, bindExtraItemEvents } from '../core/approvalUI.js';
import { renderAttachmentRow, bindAttachmentEvents, uploadAttachment } from '../core/attachments.js';
import { openModal, closeModal } from '../core/modal.js';

export async function render(container, profile, isStale = () => false) {
  container.innerHTML = `
    <div class="page-head">
      <div><h1>Giao nhận</h1><div class="sub">Theo dõi theo từng phiếu, xác nhận trong 3 ngày làm việc</div></div>
      <button class="btn" id="btnNewPhieu">+ Tạo phiếu giao nhận mới</button>
    </div>
    <div class="toolbar"><select id="gnFilterProject"><option value="">Tất cả dự án</option></select></div>
    <div class="note-box">Xác nhận thực nhận: mặc định bằng đúng số hàng xuất, sửa dòng nào bị lệch. Nhận thêm chủng loại không có trong phiếu gốc thì khai báo ở "Dòng phát sinh khi nhận".</div>
    <div id="phieuList" class="loading">Đang tải...</div>
  `;

  const { data: c } = await supabase.from('categories').select('*').order('name');
  const { data: p } = await supabase.from('projects').select('*').eq('status', 'active').order('name');
  const { data: w } = await supabase.from('warehouses').select('*').order('name');
  const { data: vt } = await supabase.from('vehicle_types').select('*').order('name');
  const { data: tc } = await supabase.from('transport_carriers').select('*').order('name');
  if (isStale()) return;
  const categories = c ?? [], projects = p ?? [], warehouses = w ?? [], vehicleTypes = vt ?? [], carriers = tc ?? [];

  container.querySelector('#gnFilterProject').innerHTML = '<option value="">Tất cả dự án</option>' +
    projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');

  const catName = (id) => categories.find(c => c.id === id)?.name ?? '(?)';
  const catUnit = (id) => categories.find(c => c.id === id)?.unit ?? '';

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

  async function nextAssetSeq(categoryId) {
    const { count } = await supabase.from('asset_units').select('id', { count: 'exact', head: true }).eq('category_id', categoryId);
    return (count ?? 0) + 1;
  }

  // ================= TẠO PHIẾU MỚI =================
  async function openNewPhieuModal() {
    const bodyHtml = `
      <div class="field-row">
        <div class="field"><label>Số phiếu (theo đúng số ghi trên giấy tại hiện trường)</label><input type="text" id="mCode" placeholder="VD: 0006302"></div>
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
        <div class="field"><label>Đơn vị vận chuyển</label><select id="mNhaXe"><option value="">— Chọn —</option>${carriers.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}</select></div>
        <div class="field"><label>Số xe</label><input type="text" id="mBienSo" list="mBienSoList" placeholder="50E-123.45"><datalist id="mBienSoList"></datalist></div>
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
    addRow();

    dialog.querySelector('#mNhaXe').addEventListener('change', async (e) => {
      const carrierId = e.target.value;
      const listEl = dialog.querySelector('#mBienSoList');
      listEl.innerHTML = '';
      if (!carrierId) return;
      const { data } = await supabase.from('transfer_notes').select('bien_so').eq('nha_xe_id', carrierId).not('bien_so', 'is', null);
      const uniquePlates = [...new Set((data ?? []).map(r => r.bien_so))];
      listEl.innerHTML = uniquePlates.map(plate => `<option value="${plate}"></option>`).join('');
    });

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

      let direction = 'dieu_chuyen_kho';
      if (fromType === 'kho' && toType === 'du_an') direction = 'xuat_du_an';
      else if (fromType === 'du_an' && toType === 'kho') direction = 'nhap_kho';

      const project_id = fromType === 'du_an' ? fromId : (toType === 'du_an' ? toId : null);

      const ngay_ky = dialog.querySelector('#mDate').value;
      const nguoi_giao = dialog.querySelector('#mNguoiGiao').value || null;
      const quan_ly_xuat = dialog.querySelector('#mQuanLy').value || null;
      const nha_xe_id = dialog.querySelector('#mNhaXe').value || null;
      const bien_so = dialog.querySelector('#mBienSo').value || null;
      const loai_xe_id = dialog.querySelector('#mLoaiXe').value || null;
      const code = dialog.querySelector('#mCode').value.trim();
      if (!code) { alert('Nhập số phiếu theo đúng giấy tại hiện trường.'); return; }
      const files = Array.from(dialog.querySelector('#mFiles').files);

      const submitBtn = dialog.querySelector('#mSubmit');
      submitBtn.disabled = true; submitBtn.textContent = 'Đang tạo...';

      const { data: note, error } = await supabase.from('transfer_notes').insert({
        code, direction, ngay_ky,
        from_location_type: fromType, from_location_id: fromId,
        to_location_type: toType, to_location_id: toId,
        project_id,
        nguoi_giao, quan_ly_xuat, nha_xe_id, bien_so, loai_xe_id, status: 'tam', created_by: profile.id,
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

  // ================= MODAL XỬ LÝ CHÊNH LỆCH (thiếu ở chủng loại quy đổi được) =================
  // Trả về { conversions, remainingSurplus } nếu xử lý xong, hoặc null nếu người dùng hủy hẳn (không xác nhận phiếu)
  function resolveDeficitsModal(deficits, surplusPool) {
    return new Promise((resolve) => {
      const bodyHtml = `
        <div class="error-box">Phát hiện ${deficits.length} chủng loại có thể quy đổi đang THIẾU so với số xuất — xử lý quy đổi trước khi xác nhận (hoặc bỏ qua để coi là thiếu thật).</div>
        ${deficits.map((d, idx) => `
          <div style="border:1px solid var(--line); padding:12px; border-radius:6px; margin-bottom:10px;">
            <b>${esc(d.category.name)}</b> — thiếu ${d.deficitQty} ${esc(d.category.unit)}
            <div class="field-row" style="margin-top:8px;">
              <div class="field"><label>Quy đổi từ dòng dư nào?</label>
                <select data-deficit-source="${idx}">
                  <option value="">— Không quy đổi, coi là thiếu thật —</option>
                  ${surplusPool.map((s, sIdx) => `<option value="${sIdx}">${esc(s.category.name)} (dư ${s.qty} ${esc(s.category.unit)})</option>`).join('')}
                </select>
              </div>
              <div class="field"><label>Mét dài quy đổi (nếu có)</label><input type="number" step="0.01" data-deficit-md="${idx}" placeholder="VD 40"></div>
            </div>
          </div>
        `).join('')}
      `;
      const footerHtml = `<button class="btn secondary" id="rdCancel">Hủy, không xác nhận phiếu</button><button class="btn" id="rdSubmit">Xác nhận xử lý</button>`;
      const dialog = openModal({ title: 'Xử lý chênh lệch quy cách', bodyHtml, footerHtml, wide: true });

      dialog.querySelector('#rdCancel').addEventListener('click', () => { closeModal(); resolve(null); });
      dialog.querySelector('#rdSubmit').addEventListener('click', () => {
        const conversions = [];
        const usedSurplusIdx = new Set();
        let unresolvedCount = 0;

        deficits.forEach((d, idx) => {
          const sourceSel = dialog.querySelector(`[data-deficit-source="${idx}"]`);
          const mdInput = dialog.querySelector(`[data-deficit-md="${idx}"]`);
          if (sourceSel.value === '') { unresolvedCount++; return; }
          const sIdx = parseInt(sourceSel.value);
          conversions.push({ deficit: d, surplus: surplusPool[sIdx], qtyMd: parseFloat(mdInput.value) || 0 });
          usedSurplusIdx.add(sIdx);
        });

        if (unresolvedCount > 0) {
          const ok = confirm(`Còn ${unresolvedCount} chủng loại chưa quy đổi — sẽ ghi nhận là THIẾU THẬT, không tự tạo hao hụt (Kho/Sale xử lý riêng sau). Vẫn tiếp tục xác nhận phiếu?`);
          if (!ok) return; // ở lại modal, không đóng
        }

        const remainingSurplus = surplusPool.filter((s, i) => !usedSurplusIdx.has(i));
        closeModal();
        resolve({ conversions, remainingSurplus });
      });
    });
  }

  // ================= XỬ LÝ XÁC NHẬN (dùng chung cho modal chi tiết) =================
  async function handleConfirm(note, updates, extraItems) {
    const deficits = updates.filter(u => {
      const cat = categories.find(cc => cc.id === u.category_id);
      return cat?.is_convertible && u.sl_thuc_nhan < u.sl_xuat;
    }).map(u => ({ ...u, category: categories.find(cc => cc.id === u.category_id), deficitQty: u.sl_xuat - u.sl_thuc_nhan }));

    const overshoot = updates.filter(u => u.sl_thuc_nhan > u.sl_xuat).map(u => ({
      category: categories.find(cc => cc.id === u.category_id), qty: u.sl_thuc_nhan - u.sl_xuat,
    }));
    const extraSurplus = extraItems.map(e => ({ category: categories.find(cc => cc.id === e.category_id), qty: e.qty }));
    let surplusPool = [...overshoot, ...extraSurplus];

    let conversions = [];
    if (deficits.length > 0) {
      const resolved = await resolveDeficitsModal(deficits, surplusPool);
      if (resolved === null) return false;
      conversions = resolved.conversions;
      surplusPool = resolved.remainingSurplus;
    }

    for (const u of updates) {
      await supabase.from('transfer_note_items').update({
        sl_thuc_nhan: u.sl_thuc_nhan,
        tinh_trang: u.thieu ? 'Thiếu so với phiếu xuất' : u.sl_thuc_nhan > u.sl_xuat ? 'Dư so với phiếu xuất' : 'Đúng chất lượng, mới 100%',
      }).eq('id', u.itemId);
    }

    for (const conv of conversions) {
      await supabase.from('asset_conversions').insert({
        transfer_note_item_id: conv.deficit.itemId,
        category_id_from: conv.surplus.category.id,
        category_id_to: conv.deficit.category.id,
        qty_md: conv.qtyMd,
        performed_by: profile.id,
      });
    }

    for (const s of surplusPool) {
      if (!s.category || s.qty <= 0) continue;
      const status = note.to_location_type === 'kho' ? 'kho' : note.to_location_type === 'du_an' ? 'tai_du_an' : 'kho';
      const warehouse_id = note.to_location_type === 'kho' ? note.to_location_id : null;
      const project_id = note.to_location_type === 'du_an' ? note.to_location_id : null;
      const seqStart = await nextAssetSeq(s.category.id);
      const rows = [];
      for (let i = 0; i < s.qty; i++) {
        rows.push({
          asset_code: `${s.category.code}-${String(seqStart + i).padStart(5, '0')}`,
          category_id: s.category.id, status, warehouse_id, project_id,
          source: 'phat_hien_du',
          source_note: `Trả dư khi xác nhận phiếu ${note.code} ngày ${todayStr()}`,
          created_by: profile.id,
        });
      }
      await supabase.from('asset_units').insert(rows);
    }

    await supabase.from('transfer_notes').update({
      status: 'chinh_thuc', confirmed_by: profile.id, confirmed_at: new Date().toISOString(),
    }).eq('id', note.id);

    return true;
  }

  // ================= MODAL CHI TIẾT 1 PHIẾU =================
  function openDetailModal(note) {
    const categoryOptionsForExtra = categories.map(c => ({ id: c.id, name: c.name, unit: c.unit }));

    const cardHtml = renderApprovalCard({
      id: note.id, code: note.code, ngay_ky: note.ngay_ky, status: note.status, late_flag: note.late_flag,
      meta: `${esc(resolveFrom(note))} → ${esc(resolveTo(note))}`,
      items: note.transfer_note_items.map(it => ({
        id: it.id, label: catName(it.category_id), unit: catUnit(it.category_id),
        sl_xuat: it.sl_xuat, sl_thuc_nhan: it.sl_thuc_nhan, tinh_trang: it.tinh_trang,
      })),
      categoryOptions: note.status === 'tam' ? categoryOptionsForExtra : null,
      signInfo: `<span>Người giao: <b>${esc(note.nguoi_giao ?? '—')}</b> · QL duyệt: <b>${esc(note.quan_ly_xuat ?? '—')}</b></span>
                 <span>Người nhận: <b>${esc(note.nguoi_nhan ?? '— chưa ký —')}</b></span>
                 <span>Vận chuyển: <b>${esc(carriers.find(c => c.id === note.nha_xe_id)?.name ?? note.nha_xe ?? '—')}</b> · Số xe <b>${esc(note.bien_so ?? '—')}</b> · ${esc(vehicleTypes.find(v => v.id === note.loai_xe_id)?.name ?? '—')}</span>`,
    });

    const dialog = openModal({ title: `Phiếu ${note.code}`, bodyHtml: cardHtml, footerHtml: '', wide: true });

    renderAttachmentRow(note.id).then(html => {
      const el = dialog.querySelector(`#attach-${note.id}`);
      if (el) { el.innerHTML = html; bindAttachmentEvents(dialog, profile.id, () => openDetailModal(note)); }
    });

    if (note.status === 'tam') {
      const extraState = bindExtraItemEvents(dialog, [{ id: note.id }]);
      bindApprovalConfirm(dialog, [{ id: note.id, items: note.transfer_note_items }], extraState, async (noteId, updates, extraItems) => {
        const ok = await handleConfirm(note, updates, extraItems);
        if (ok) { closeModal(); loadPhieu(); }
        return ok;
      });
    }
  }

  // ================= DANH SÁCH PHIẾU (bảng gọn, bấm vào xem chi tiết) =================
  async function loadPhieu() {
    const filterProject = container.querySelector('#gnFilterProject').value;
    let q = supabase.from('transfer_notes')
      .select('*, transfer_note_items(*)')
      .order('created_at', { ascending: false })
      .limit(50);
    if (filterProject) {
      q = q.or(`and(from_location_type.eq.du_an,from_location_id.eq.${filterProject}),and(to_location_type.eq.du_an,to_location_id.eq.${filterProject}),project_id.eq.${filterProject}`);
    }

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

    const rows = notes.map(note => {
      const badge = note.status === 'tam' ? '<span class="badge tam">Chờ xác nhận</span>'
        : note.late_flag ? '<span class="badge tre">Xác nhận trễ</span>'
        : '<span class="badge chinh">Chính thức</span>';
      const tongXuat = note.transfer_note_items.reduce((s, it) => s + Number(it.sl_xuat), 0);
      const tongThucNhan = note.status === 'tam' ? '-' : note.transfer_note_items.reduce((s, it) => s + Number(it.sl_thuc_nhan ?? 0), 0);
      return `<tr data-open-note="${note.id}" style="cursor:pointer;">
        <td><b style="color:var(--red-dark);">${esc(note.code)}</b></td>
        <td>${esc(resolveFrom(note))} → ${esc(resolveTo(note))}</td>
        <td>${fmtDate(note.ngay_ky)}</td>
        <td class="num">${tongXuat}</td>
        <td class="num">${tongThucNhan}</td>
        <td>${badge}</td>
      </tr>`;
    }).join('');

    container.querySelector('#phieuList').innerHTML = `
      <div class="panel"><div class="panel-body" style="padding:0">
        <table>
          <thead><tr><th>Số phiếu</th><th>Tuyến</th><th>Ngày ký</th><th class="num">SL xuất</th><th class="num">SL thực nhận</th><th>Trạng thái</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="6" class="empty-state">Chưa có phiếu nào khớp bộ lọc</td></tr>'}</tbody>
        </table>
      </div></div>`;

    container.querySelectorAll('[data-open-note]').forEach(tr => {
      tr.addEventListener('click', () => openDetailModal(notes.find(n => n.id === tr.dataset.openNote)));
    });
  }

  await loadPhieu();
}
