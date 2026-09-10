// js/modules/danhmuc.js
// Chỉ admin — khai báo dữ liệu đầu vào dùng chung: tên thiết bị (categories) và loại xe.

import { supabase } from '../core/config.js';
import { requireRole } from '../core/auth.js';
import { openModal, closeModal } from '../core/modal.js';
import { fmtVND } from '../core/utils.js';

export async function render(container, profile, isStale = () => false) {
  if (!requireRole(profile, ['admin'])) {
    container.innerHTML = `<div class="error-box">Chỉ Admin mới truy cập được mục này.</div>`;
    return;
  }

  container.innerHTML = `
    <div class="page-head">
      <div><h1>Danh mục</h1><div class="sub">Tên thiết bị và loại xe dùng chung cho phiếu giao nhận</div></div>
    </div>

    <div class="panel" style="margin-bottom:18px;">
      <div class="panel-head"><h3>Tên thiết bị &amp; quy cách</h3><button class="btn small" id="btnNewCat">+ Thêm thiết bị</button></div>
      <div class="panel-body" style="padding:0"><table id="catTable"><tbody><tr><td class="loading">Đang tải...</td></tr></tbody></table></div>
    </div>

    <div class="panel" style="margin-bottom:18px;">
      <div class="panel-head"><h3>Loại xe vận chuyển</h3><button class="btn small" id="btnNewVehicle">+ Thêm loại xe</button></div>
      <div class="panel-body" style="padding:0"><table id="vehicleTable"><tbody><tr><td class="loading">Đang tải...</td></tr></tbody></table></div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>Đơn vị vận chuyển (nhà xe)</h3><button class="btn small" id="btnNewCarrier">+ Thêm đơn vị vận chuyển</button></div>
      <div class="panel-body" style="padding:0"><table id="carrierTable"><tbody><tr><td class="loading">Đang tải...</td></tr></tbody></table></div>
    </div>
  `;

  const { data: groups } = await supabase.from('groups').select('*').order('id');
  if (isStale()) return;

  async function loadCategories() {
    const { data, error } = await supabase.from('categories').select('*').order('name');
    if (isStale()) return;
    const table = container.querySelector('#catTable');
    if (error) { table.innerHTML = `<tr><td class="error-box">${error.message}</td></tr>`; return; }

    const rows = (data ?? []).map(c => `<tr>
      <td>${c.group_id}</td><td>${c.name}</td><td>${c.unit}</td>
      <td class="num">${fmtVND(c.ref_value)}</td>
      <td>${c.is_convertible ? '<span class="badge chinh">Có</span>' : '—'}</td>
      <td><button class="btn secondary small" data-edit-cat="${c.id}">Sửa</button></td>
    </tr>`).join('');

    table.innerHTML = `<thead><tr><th>Nhóm</th><th>Tên thiết bị &amp; quy cách</th><th>ĐVT</th><th class="num">Trị giá TS</th><th>Quy đổi</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" class="empty-state">Chưa có thiết bị nào</td></tr>'}</tbody>`;

    table.querySelectorAll('[data-edit-cat]').forEach(btn =>
      btn.addEventListener('click', () => openCatModal(data.find(c => c.id === btn.dataset.editCat))));
  }

  function openCatModal(existing) {
    const isNew = !existing;
    const bodyHtml = `
      <div class="field"><label>Nhóm hàng</label>
        <select id="cGroup">${(groups ?? []).map(g => `<option value="${g.id}" ${existing?.group_id === g.id ? 'selected' : ''}>${g.id} — ${g.name}</option>`).join('')}</select>
      </div>
      <div class="field"><label>Tên thiết bị &amp; quy cách</label><input type="text" id="cName" value="${existing?.name ?? ''}" placeholder="VD: Chống Nêm D48.3x2.0, L=1500 CĐ"></div>
      <div class="field-row">
        <div class="field"><label>Đơn vị tính</label><input type="text" id="cUnit" value="${existing?.unit ?? ''}" placeholder="Cây / Cái / Thanh..."></div>
        <div class="field"><label>Trị giá thiết bị (đơn giá đền bù tham chiếu)</label><input type="number" id="cRefValue" value="${existing?.ref_value ?? ''}"></div>
      </div>
      <div class="field"><label><input type="checkbox" id="cConvertible" ${existing?.is_convertible ? 'checked' : ''} style="width:auto; margin-right:6px;">Cho phép quy đổi quy cách khi trả (xà gồ/thép hộp)</label></div>
    `;
    const footerHtml = `<button class="btn secondary" id="cCancel">Hủy</button><button class="btn" id="cSubmit">${isNew ? 'Thêm thiết bị' : 'Lưu thay đổi'}</button>`;
    const dialog = openModal({ title: isNew ? 'Thêm thiết bị mới' : `Sửa — ${existing.name}`, bodyHtml, footerHtml });

    dialog.querySelector('#cCancel').addEventListener('click', closeModal);
    dialog.querySelector('#cSubmit').addEventListener('click', async () => {
      const payload = {
        group_id: dialog.querySelector('#cGroup').value,
        name: dialog.querySelector('#cName').value.trim(),
        unit: dialog.querySelector('#cUnit').value.trim(),
        ref_value: parseFloat(dialog.querySelector('#cRefValue').value) || 0,
        is_convertible: dialog.querySelector('#cConvertible').checked,
      };
      if (!payload.name || !payload.unit) { alert('Nhập đủ tên thiết bị và đơn vị tính.'); return; }

      const { error } = isNew
        ? await supabase.from('categories').insert(payload)
        : await supabase.from('categories').update(payload).eq('id', existing.id);
      if (error) { alert('Lỗi lưu: ' + error.message); return; }
      closeModal();
      loadCategories();
    });
  }

  async function loadVehicleTypes() {
    const { data, error } = await supabase.from('vehicle_types').select('*').order('name');
    if (isStale()) return;
    const table = container.querySelector('#vehicleTable');
    if (error) { table.innerHTML = `<tr><td class="error-box">${error.message}</td></tr>`; return; }

    const rows = (data ?? []).map(v => `<tr><td>${v.name}</td>
      <td><button class="btn secondary small" data-del-vehicle="${v.id}">Xóa</button></td></tr>`).join('');
    table.innerHTML = `<thead><tr><th>Loại xe</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="2" class="empty-state">Chưa có loại xe nào</td></tr>'}</tbody>`;

    table.querySelectorAll('[data-del-vehicle]').forEach(btn =>
      btn.addEventListener('click', async () => {
        if (!confirm('Xóa loại xe này?')) return;
        await supabase.from('vehicle_types').delete().eq('id', btn.dataset.delVehicle);
        loadVehicleTypes();
      }));
  }

  function openVehicleModal() {
    const bodyHtml = `<div class="field"><label>Tên loại xe</label><input type="text" id="vName" placeholder="VD: Xe thùng 9m"></div>`;
    const footerHtml = `<button class="btn secondary" id="vCancel">Hủy</button><button class="btn" id="vSubmit">Thêm</button>`;
    const dialog = openModal({ title: 'Thêm loại xe', bodyHtml, footerHtml });

    dialog.querySelector('#vCancel').addEventListener('click', closeModal);
    dialog.querySelector('#vSubmit').addEventListener('click', async () => {
      const name = dialog.querySelector('#vName').value.trim();
      if (!name) { alert('Nhập tên loại xe.'); return; }
      const { error } = await supabase.from('vehicle_types').insert({ name });
      if (error) { alert('Lỗi lưu: ' + error.message); return; }
      closeModal();
      loadVehicleTypes();
    });
  }

  async function loadCarriers() {
    const { data, error } = await supabase.from('transport_carriers').select('*').order('name');
    if (isStale()) return;
    const table = container.querySelector('#carrierTable');
    if (error) { table.innerHTML = `<tr><td class="error-box">${error.message}</td></tr>`; return; }

    const rows = (data ?? []).map(c => `<tr><td>${c.name}</td>
      <td><button class="btn secondary small" data-del-carrier="${c.id}">Xóa</button></td></tr>`).join('');
    table.innerHTML = `<thead><tr><th>Đơn vị vận chuyển</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="2" class="empty-state">Chưa có đơn vị vận chuyển nào</td></tr>'}</tbody>`;

    table.querySelectorAll('[data-del-carrier]').forEach(btn =>
      btn.addEventListener('click', async () => {
        if (!confirm('Xóa đơn vị vận chuyển này?')) return;
        await supabase.from('transport_carriers').delete().eq('id', btn.dataset.delCarrier);
        loadCarriers();
      }));
  }

  function openCarrierModal() {
    const bodyHtml = `<div class="field"><label>Tên đơn vị vận chuyển</label><input type="text" id="crName" placeholder="VD: Tân Thịnh"></div>`;
    const footerHtml = `<button class="btn secondary" id="crCancel">Hủy</button><button class="btn" id="crSubmit">Thêm</button>`;
    const dialog = openModal({ title: 'Thêm đơn vị vận chuyển', bodyHtml, footerHtml });

    dialog.querySelector('#crCancel').addEventListener('click', closeModal);
    dialog.querySelector('#crSubmit').addEventListener('click', async () => {
      const name = dialog.querySelector('#crName').value.trim();
      if (!name) { alert('Nhập tên đơn vị vận chuyển.'); return; }
      const { error } = await supabase.from('transport_carriers').insert({ name });
      if (error) { alert('Lỗi lưu: ' + error.message); return; }
      closeModal();
      loadCarriers();
    });
  }

  container.querySelector('#btnNewCat').addEventListener('click', () => openCatModal(null));
  container.querySelector('#btnNewVehicle').addEventListener('click', openVehicleModal);
  container.querySelector('#btnNewCarrier').addEventListener('click', openCarrierModal);

  await loadCategories();
  await loadVehicleTypes();
  await loadCarriers();
}
