// js/modules/users.js
// Chi admin - quan ly tai khoan nguoi dung. Sale duoc gan 1 khach hang phu trach
// (assigned_partner_id) - RLS se tu gioi han Sale do chi thay dung du lieu khach do.
import { supabase } from '../core/config.js';
import { requireRole, roleLabel } from '../core/auth.js';
import { openModal, closeModal } from '../core/modal.js';
import { esc } from '../core/utils.js';

const SUPABASE_URL = 'https://shgorgwdphqyxdfwufvu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNoZ29yZ3dkcGhxeXhkZnd1ZnZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2NjMwMDgsImV4cCI6MjEwNDIzOTAwOH0.OdUuwrmC_Uc3pEL8pKHR9r_uvQIX_0-3Q5IT81I-XNw';

const ROLES = ['kho', 'sale', 'ke_toan', 'bgd', 'admin'];

export async function render(container, profile, isStale = () => false) {
  if (!requireRole(profile, ['admin'])) {
    container.innerHTML = `<div class="error-box">Chỉ Admin mới truy cập được mục này.</div>`;
    return;
  }

  container.innerHTML = `
    <div class="page-head">
      <div><h1>Người dùng</h1><div class="sub">Tài khoản đăng nhập — Sale được gán theo đúng 1 khách hàng phụ trách</div></div>
      <button class="btn" id="btnNewUser">+ Thêm người dùng</button>
    </div>
    <div class="panel"><div class="panel-body" style="padding:0"><table id="userTable"><tbody><tr><td class="loading">Đang tải...</td></tr></tbody></table></div></div>
  `;

  const { data: pt } = await supabase.from('partners').select('*').order('name');
  if (isStale()) return;
  const partnerList = pt ?? [];

  async function loadUsers() {
    const { data, error } = await supabase.from('profiles').select('*, partners:assigned_partner_id(name)').order('full_name');
    if (isStale()) return;
    const table = container.querySelector('#userTable');
    if (error) { table.innerHTML = `<tr><td class="error-box">${error.message}</td></tr>`; return; }

    const rows = (data ?? []).map(u => `<tr>
      <td><b>${esc(u.full_name ?? '(chưa đặt tên)')}</b></td>
      <td>${esc(u.email ?? '')}</td>
      <td>${esc(roleLabel(u.role))}</td>
      <td>${u.role === 'sale' ? esc(u.partners?.name ?? '— chưa gán —') : '—'}</td>
      <td><button class="btn secondary small" data-edit-user="${u.id}">Sửa</button></td>
    </tr>`).join('');

    table.innerHTML = `<thead><tr><th>Họ tên</th><th>Email</th><th>Vai trò</th><th>Khách hàng phụ trách</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" class="empty-state">Chưa có người dùng nào</td></tr>'}</tbody>`;

    table.querySelectorAll('[data-edit-user]').forEach(btn =>
      btn.addEventListener('click', () => openUserModal((data ?? []).find(u => u.id === btn.dataset.editUser))));
  }

  function partnerOptionsHtml(selectedId) {
    return '<option value="">— Chưa gán —</option>' +
      partnerList.map(p => `<option value="${p.id}" ${p.id === selectedId ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  }

  function openUserModal(existing) {
    const isNew = !existing;
    const bodyHtml = `
      <div class="field"><label>Họ tên</label><input type="text" id="uFullName" value="${esc(existing?.full_name ?? '')}"></div>
      <div class="field"><label>Email</label><input type="email" id="uEmail" value="${esc(existing?.email ?? '')}" ${isNew ? '' : 'disabled'}></div>
      ${isNew ? `<div class="field"><label>Mật khẩu tạm</label><input type="text" id="uPassword" placeholder="Ít nhất 6 ký tự"></div>` : ''}
      <div class="field"><label>Vai trò</label>
        <select id="uRole">${ROLES.map(r => `<option value="${r}" ${existing?.role === r ? 'selected' : ''}>${esc(roleLabel(r))}</option>`).join('')}</select>
      </div>
      <div class="field" id="uPartnerField" style="display:${existing?.role === 'sale' ? 'block' : 'none'};">
        <label>Khách hàng phụ trách</label>
        <select id="uPartner">${partnerOptionsHtml(existing?.assigned_partner_id)}</select>
        <div class="note-box" style="margin-top:6px;">Sale chỉ thấy và thao tác được dữ liệu (dự án, phiếu, bảng kê, hao hụt, giá) của đúng khách hàng được gán ở đây.</div>
      </div>
      <div id="uError" class="error-box" style="display:none;"></div>
    `;
    const footerHtml = `<button class="btn secondary" id="uCancel">Hủy</button><button class="btn" id="uSubmit">${isNew ? 'Tạo tài khoản' : 'Lưu thay đổi'}</button>`;
    const dialog = openModal({ title: isNew ? 'Thêm người dùng' : `Sửa — ${existing.full_name ?? existing.email}`, bodyHtml, footerHtml });

    dialog.querySelector('#uRole').addEventListener('change', (e) => {
      dialog.querySelector('#uPartnerField').style.display = e.target.value === 'sale' ? 'block' : 'none';
    });

    dialog.querySelector('#uCancel').addEventListener('click', closeModal);
    dialog.querySelector('#uSubmit').addEventListener('click', async () => {
      const full_name = dialog.querySelector('#uFullName').value.trim();
      const role = dialog.querySelector('#uRole').value;
      const assigned_partner_id = role === 'sale' ? (dialog.querySelector('#uPartner').value || null) : null;
      const errBox = dialog.querySelector('#uError');
      errBox.style.display = 'none';

      if (!full_name) { errBox.textContent = 'Nhập họ tên.'; errBox.style.display = 'block'; return; }

      const submitBtn = dialog.querySelector('#uSubmit');
      submitBtn.disabled = true; submitBtn.textContent = 'Đang lưu...';

      try {
        if (isNew) {
          const email = dialog.querySelector('#uEmail').value.trim();
          const password = dialog.querySelector('#uPassword').value;
          if (!email || !password || password.length < 6) throw new Error('Nhập đủ email và mật khẩu (ít nhất 6 ký tự).');

          const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
          const tempClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
          const { data: signUpData, error: signUpError } = await tempClient.auth.signUp({ email, password });
          if (signUpError) throw signUpError;
          const newUserId = signUpData.user?.id;
          if (!newUserId) throw new Error('Không lấy được ID tài khoản vừa tạo.');

          const { error: profileError } = await supabase.from('profiles').insert({
            id: newUserId, full_name, email, role, assigned_partner_id,
          });
          if (profileError) throw profileError;
        } else {
          const { error: updateError } = await supabase.from('profiles')
            .update({ full_name, role, assigned_partner_id }).eq('id', existing.id);
          if (updateError) throw updateError;
        }

        closeModal();
        loadUsers();
      } catch (err) {
        errBox.textContent = 'Lỗi: ' + err.message;
        errBox.style.display = 'block';
        submitBtn.disabled = false; submitBtn.textContent = isNew ? 'Tạo tài khoản' : 'Lưu thay đổi';
      }
    });
  }

  container.querySelector('#btnNewUser').addEventListener('click', () => openUserModal(null));
  await loadUsers();
}
