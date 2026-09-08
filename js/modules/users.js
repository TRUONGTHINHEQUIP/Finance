// js/modules/users.js
// Chỉ admin thấy được mục này (đã lọc ở core/shell.js), kiểm tra lại ở đây cho chắc.
//
// Cách tạo user mới: dùng auth.signUp() — thao tác công khai, chỉ cần anon key,
// không cần service_role key / Edge Function. Điểm mấu chốt: gọi qua 1 client
// Supabase TẠM RIÊNG (persistSession:false) để không ghi đè phiên đăng nhập
// hiện tại của admin trong trình duyệt — nếu gọi trên "supabase" client chính,
// trình duyệt sẽ tự chuyển sang đăng nhập làm user mới đó thay vì vẫn là admin.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '../core/config.js';
import { requireRole, roleLabel } from '../core/auth.js';
import { openModal, closeModal } from '../core/modal.js';

export async function render(container, profile) {
  if (!requireRole(profile, ['admin'])) {
    container.innerHTML = `<div class="error-box">Chỉ Admin mới truy cập được mục này.</div>`;
    return;
  }

  container.innerHTML = `
    <div class="page-head">
      <div><h1>Người dùng</h1><div class="sub">Thêm tài khoản mới và phân quyền theo vai trò</div></div>
      <button class="btn" id="btnNewUser">+ Thêm người dùng</button>
    </div>
    <div class="panel"><div class="panel-body" style="padding:0"><table id="userTable"><tbody><tr><td class="loading">Đang tải...</td></tr></tbody></table></div></div>
  `;

  async function loadUsers() {
    const { data, error } = await supabase.from('profiles').select('*').order('full_name');
    const table = container.querySelector('#userTable');
    if (error) { table.innerHTML = `<tr><td class="error-box">${error.message}</td></tr>`; return; }

    const rows = (data ?? []).map(u => `<tr>
      <td>${u.full_name}</td>
      <td>${u.email ?? '—'}</td>
      <td><span class="badge tam">${roleLabel(u.role)}</span></td>
      <td>${u.is_active ? '<span class="badge chinh">Hoạt động</span>' : '<span class="badge tre">Đã khóa</span>'}</td>
      <td><button class="btn secondary small" data-edit="${u.id}">Sửa</button></td>
    </tr>`).join('');

    table.innerHTML = `<thead><tr><th>Họ tên</th><th>Email</th><th>Vai trò</th><th>Trạng thái</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" class="empty-state">Chưa có người dùng nào</td></tr>'}</tbody>`;

    table.querySelectorAll('[data-edit]').forEach(btn => {
      btn.addEventListener('click', () => openEditModal(data.find(u => u.id === btn.dataset.edit)));
    });
  }

  function openNewUserModal() {
    const bodyHtml = `
      <div class="info-box">Người dùng mới đăng nhập ngay bằng email + mật khẩu này — không cần xác nhận email nếu mục "Confirm email" đang tắt trong Supabase Authentication settings.</div>
      <div class="field"><label>Họ tên</label><input type="text" id="uName"></div>
      <div class="field"><label>Email</label><input type="email" id="uEmail"></div>
      <div class="field"><label>Mật khẩu tạm thời</label><input type="text" id="uPassword" placeholder="Ít nhất 6 ký tự"></div>
      <div class="field"><label>Vai trò</label>
        <select id="uRole">
          <option value="kho">Kho</option>
          <option value="sale">Sale</option>
          <option value="ke_toan">Kế toán</option>
          <option value="bgd">BGD</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      <div id="uError" class="error-box" style="display:none;"></div>
    `;
    const footerHtml = `<button class="btn secondary" id="uCancel">Hủy</button><button class="btn" id="uSubmit">Tạo tài khoản</button>`;
    const dialog = openModal({ title: 'Thêm người dùng mới', bodyHtml, footerHtml });

    dialog.querySelector('#uCancel').addEventListener('click', closeModal);
    dialog.querySelector('#uSubmit').addEventListener('click', async () => {
      const full_name = dialog.querySelector('#uName').value.trim();
      const email = dialog.querySelector('#uEmail').value.trim();
      const password = dialog.querySelector('#uPassword').value;
      const role = dialog.querySelector('#uRole').value;
      const errBox = dialog.querySelector('#uError');
      errBox.style.display = 'none';

      if (!full_name || !email || !password || password.length < 6) {
        errBox.textContent = 'Điền đủ thông tin, mật khẩu tối thiểu 6 ký tự.';
        errBox.style.display = 'block';
        return;
      }

      const submitBtn = dialog.querySelector('#uSubmit');
      submitBtn.disabled = true; submitBtn.textContent = 'Đang tạo...';

      try {
        // Kết nối TẠM RIÊNG — không dùng chung với phiên đăng nhập admin hiện tại
        const tempClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data: signUpData, error: signUpError } = await tempClient.auth.signUp({ email, password });
        if (signUpError) throw signUpError;

        // Insert profile bằng client CHÍNH (vẫn đang đăng nhập là admin) — RLS yêu cầu
        // đúng người gọi phải có role admin mới insert được vào bảng profiles.
        const { error: profileError } = await supabase.from('profiles').insert({
          id: signUpData.user.id, full_name, role, email, is_active: true,
        });
        if (profileError) throw profileError;

        closeModal();
        loadUsers();
      } catch (err) {
        errBox.textContent = 'Lỗi: ' + err.message;
        errBox.style.display = 'block';
        submitBtn.disabled = false; submitBtn.textContent = 'Tạo tài khoản';
      }
    });
  }

  function openEditModal(user) {
    const bodyHtml = `
      <div class="field"><label>Họ tên</label><input type="text" id="eName" value="${user.full_name}"></div>
      <div class="field"><label>Vai trò</label>
        <select id="eRole">
          ${['kho', 'sale', 'ke_toan', 'bgd', 'admin'].map(r => `<option value="${r}" ${r === user.role ? 'selected' : ''}>${roleLabel(r)}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>Trạng thái</label>
        <select id="eActive">
          <option value="true" ${user.is_active ? 'selected' : ''}>Hoạt động</option>
          <option value="false" ${!user.is_active ? 'selected' : ''}>Khóa tài khoản</option>
        </select>
      </div>
    `;
    const footerHtml = `<button class="btn secondary" id="eCancel">Hủy</button><button class="btn" id="eSubmit">Lưu thay đổi</button>`;
    const dialog = openModal({ title: `Sửa người dùng — ${user.full_name}`, bodyHtml, footerHtml });

    dialog.querySelector('#eCancel').addEventListener('click', closeModal);
    dialog.querySelector('#eSubmit').addEventListener('click', async () => {
      const { error } = await supabase.from('profiles').update({
        full_name: dialog.querySelector('#eName').value,
        role: dialog.querySelector('#eRole').value,
        is_active: dialog.querySelector('#eActive').value === 'true',
      }).eq('id', user.id);
      if (error) { alert('Lỗi cập nhật: ' + error.message); return; }
      closeModal();
      loadUsers();
    });
  }

  container.querySelector('#btnNewUser').addEventListener('click', openNewUserModal);
  await loadUsers();
}
