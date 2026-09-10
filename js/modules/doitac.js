// js/modules/doitac.js
import { supabase } from '../core/config.js';
import { fmtDate, fmtVND, todayStr, esc } from '../core/utils.js';
import { openModal, closeModal } from '../core/modal.js';

export async function render(container, profile, isStale = () => false) {
  container.innerHTML = `
    <div class="page-head">
      <div><h1>Đối tác</h1><div class="sub">Khách hàng, dự án, và đơn giá theo cấu trúc 3 lớp</div></div>
      <button class="btn" id="btnNewPartner">+ Tạo đối tác mới</button>
    </div>
    <div id="partnerList" class="loading">Đang tải...</div>
  `;

  let categories = [], projects = [], partners = [];

  async function loadAll() {
    const { data: p, error } = await supabase.from('partners').select('*').order('name');
    if (isStale()) return;
    if (error) { container.querySelector('#partnerList').innerHTML = `<div class="error-box">${error.message}</div>`; return; }
    const { data: proj } = await supabase.from('projects').select('*').order('name');
    const { data: cats } = await supabase.from('categories').select('*').order('name');
    if (isStale()) return;
    partners = p ?? []; projects = proj ?? []; categories = cats ?? [];
    renderList();
  }

  async function getRateTable(partner, project) {
    const rows = [];
    for (const cat of categories) {
      let rate = null, isOverride = false;
      if (project) {
        const { data: override } = await supabase.from('project_rate_overrides')
          .select('daily_rate').eq('project_id', project.id).eq('category_id', cat.id)
          .lte('effective_from', todayStr()).order('effective_from', { ascending: false }).limit(1).maybeSingle();
        if (override) { rate = override.daily_rate; isOverride = true; }
      }
      if (rate === null) {
        const { data: base } = await supabase.from('partner_rates')
          .select('daily_rate').eq('partner_id', partner.id).eq('category_id', cat.id)
          .lte('effective_from', todayStr()).order('effective_from', { ascending: false }).limit(1).maybeSingle();
        rate = base?.daily_rate ?? null;
      }
      rows.push({ id: cat.id, name: cat.name, unit: cat.unit, rate, isOverride });
    }
    return rows;
  }

  // ================= LIST =================
  function renderList() {
    const rows = partners.map(p => {
      const numProjects = projects.filter(pr => pr.partner_id === p.id).length;
      return `<tr data-open-partner="${p.id}" style="cursor:pointer;">
        <td><b style="color:var(--red-dark);">${esc(p.name)}</b></td>
        <td>${esc(p.mst ?? '—')}</td>
        <td class="num">${numProjects}</td>
        <td>Ngày ${p.billing_cutoff_day} hằng tháng</td>
      </tr>`;
    }).join('');

    container.querySelector('#partnerList').innerHTML = `
      <div class="panel"><div class="panel-body" style="padding:0">
        <table>
          <thead><tr><th>Tên công ty</th><th>MST</th><th class="num">Số dự án</th><th>Kỳ chốt bill</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="4" class="empty-state">Chưa có đối tác nào — bấm "Tạo đối tác mới" ở trên.</td></tr>'}</tbody>
        </table>
      </div></div>`;

    container.querySelectorAll('[data-open-partner]').forEach(tr => {
      tr.addEventListener('click', () => openDetailModal(partners.find(p => p.id === tr.dataset.openPartner)));
    });
  }

  // ================= MODAL CHI TIẾT =================
  function openDetailModal(partner) {
    const projs = projects.filter(pr => pr.partner_id === partner.id);

    const bodyHtml = `
      <div style="font-size:.85rem; color:var(--ink-soft); line-height:1.8; margin-bottom:16px;">
        Địa chỉ: ${esc(partner.address ?? '—')}<br>
        MST: ${esc(partner.mst ?? '—')}<br>
        Hợp đồng: ${esc(partner.hop_dong_so ?? '—')} ${partner.hop_dong_ngay ? '— ký ngày ' + fmtDate(partner.hop_dong_ngay) : ''}<br>
        Kỳ chốt bill: ngày ${partner.billing_cutoff_day} hằng tháng
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <b>Dự án &amp; bảng giá</b>
        <div style="display:flex; gap:8px;">
          <button class="btn secondary small" id="dNewProject">+ Tạo dự án mới</button>
          <button class="btn small" id="dNewRate">+ Tạo báo giá mặc định</button>
        </div>
      </div>
      <div class="chips" style="margin-bottom:8px;">
        <span class="badge tam" style="cursor:pointer;" data-price="default">📋 Bảng giá mặc định</span>
        ${projs.map(pr => `<span class="badge tam" style="cursor:pointer; margin-left:6px;" data-price="${pr.id}">${esc(pr.name)}</span>`).join('')}
      </div>
      <div id="priceArea"></div>
    `;

    const dialog = openModal({ title: partner.name, bodyHtml, footerHtml: '', wide: true });

    dialog.querySelectorAll('[data-price]').forEach(chip => {
      chip.addEventListener('click', async () => {
        const key = chip.dataset.price;
        const area = dialog.querySelector('#priceArea');
        area.innerHTML = '<div class="loading">Đang tải bảng giá...</div>';

        const project = key === 'default' ? null : projs.find(x => x.id === key);
        const rows = await getRateTable(partner, project);

        area.innerHTML = `<table style="margin-top:10px;">
          <thead><tr><th>Chủng loại</th><th>ĐVT</th><th class="num">Đơn giá/ngày</th></tr></thead>
          <tbody>${rows.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.unit)}</td>
            <td class="num" style="${r.isOverride ? 'color:var(--red-dark);font-weight:600;' : ''}">${r.rate != null ? fmtVND(r.rate) + (r.isOverride ? ' *' : '') : '— chưa có giá —'}</td></tr>`).join('')}</tbody>
        </table>
        ${rows.some(r => r.isOverride) ? '<div class="note-box" style="margin-top:8px;">* Đơn giá riêng cho dự án này, khác giá khung mặc định.</div>' : ''}
        ${project ? `<button class="btn secondary small" id="dNewProjectRate" style="margin-top:10px;">+ Đặt giá riêng cho dự án này</button>` : ''}`;

        const projectRateBtn = area.querySelector('#dNewProjectRate');
        if (projectRateBtn) projectRateBtn.addEventListener('click', () => openRateModal(partner, project));
      });
    });

    dialog.querySelector('#dNewRate').addEventListener('click', () => openRateModal(partner));
    dialog.querySelector('#dNewProject').addEventListener('click', () => openNewProjectModal(partner));
  }

  // ================= TẠO DỰ ÁN MỚI (trong đúng đối tác đang xem) =================
  function openNewProjectModal(partner) {
    const bodyHtml = `
      <div class="field"><label>Tên dự án</label><input type="text" id="jName" placeholder="VD: Vega Nha Trang"></div>
      <div class="field"><label>Mã dự án</label><input type="text" id="jCode" placeholder="VD: VEGA"></div>
    `;
    const footerHtml = `<button class="btn secondary" id="jCancel">Hủy</button><button class="btn" id="jSubmit">Tạo dự án</button>`;
    const dialog = openModal({ title: `Tạo dự án mới — ${partner.name}`, bodyHtml, footerHtml });

    dialog.querySelector('#jCancel').addEventListener('click', closeModal);
    dialog.querySelector('#jSubmit').addEventListener('click', async () => {
      const name = dialog.querySelector('#jName').value.trim();
      const code = dialog.querySelector('#jCode').value.trim();
      if (!name || !code) { alert('Nhập đủ tên dự án và mã dự án.'); return; }

      const { error } = await supabase.from('projects').insert({
        partner_id: partner.id, name, code, status: 'active',
      });
      if (error) { alert('Lỗi tạo dự án: ' + error.message); return; }

      const { data: proj } = await supabase.from('projects').select('*').order('name');
      projects = proj ?? [];
      closeModal();
      openDetailModal(partner); // mở lại modal với danh sách dự án đã cập nhật
    });
  }

  // ================= TẠO ĐỐI TÁC MỚI =================
  function openNewPartnerModal() {
    const bodyHtml = `
      <div class="field"><label>Tên công ty</label><input type="text" id="pName" placeholder="CÔNG TY ..."></div>
      <div class="field"><label>Địa chỉ</label><input type="text" id="pAddress"></div>
      <div class="field-row">
        <div class="field"><label>Mã số thuế</label><input type="text" id="pMst"></div>
        <div class="field"><label>Kỳ chốt bill (ngày trong tháng)</label><input type="number" id="pCutoff" value="15" min="1" max="28"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Số hợp đồng nguyên tắc</label><input type="text" id="pHopDong"></div>
        <div class="field"><label>Ngày ký hợp đồng</label><input type="date" id="pNgayKy"></div>
      </div>
    `;
    const footerHtml = `<button class="btn secondary" id="pCancel">Hủy</button><button class="btn" id="pSubmit">Tạo đối tác</button>`;
    const dialog = openModal({ title: 'Tạo đối tác mới', bodyHtml, footerHtml });

    dialog.querySelector('#pCancel').addEventListener('click', closeModal);
    dialog.querySelector('#pSubmit').addEventListener('click', async () => {
      const name = dialog.querySelector('#pName').value.trim();
      if (!name) { alert('Nhập tên công ty.'); return; }
      const { error } = await supabase.from('partners').insert({
        name,
        address: dialog.querySelector('#pAddress').value || null,
        mst: dialog.querySelector('#pMst').value || null,
        billing_cutoff_day: parseInt(dialog.querySelector('#pCutoff').value) || 15,
        hop_dong_so: dialog.querySelector('#pHopDong').value || null,
        hop_dong_ngay: dialog.querySelector('#pNgayKy').value || null,
      });
      if (error) { alert('Lỗi tạo đối tác: ' + error.message); return; }
      closeModal();
      loadAll();
    });
  }

  // ================= TẠO BÁO GIÁ (mặc định hoặc riêng cho 1 dự án) =================
  function openRateModal(partner, project = null) {
    const isProjectRate = !!project;
    const bodyHtml = `
      <div class="info-box">${isProjectRate
        ? `Đơn giá riêng chỉ áp dụng cho dự án <b>${esc(project.name)}</b>, ghi đè giá khung mặc định của <b>${esc(partner.name)}</b>.`
        : `Bảng giá mặc định (giá khung) áp dụng cho toàn bộ dự án của <b>${esc(partner.name)}</b>, trừ khi dự án có đơn giá riêng ghi đè.`}
        Chỉ điền chủng loại nào cần đặt/đổi giá, để trống các dòng còn lại.</div>
      <div class="field-row">
        <div class="field"><label>Ngày hiệu lực</label><input type="date" id="rDate" value="${todayStr()}"></div>
        ${isProjectRate ? `<div class="field"><label>Lý do đổi giá riêng</label><input type="text" id="rReason" placeholder="VD: Thương lượng riêng theo hợp đồng dự án"></div>` : ''}
      </div>
      <div style="max-height:320px; overflow-y:auto; border:1px solid var(--line); border-radius:6px;">
        <table>
          <thead><tr><th>Chủng loại</th><th>ĐVT</th><th class="num" style="width:140px;">Đơn giá/ngày</th></tr></thead>
          <tbody>${categories.map(c => `<tr><td>${esc(c.name)}</td><td>${esc(c.unit)}</td>
            <td><input type="number" data-rate-cat="${c.id}" placeholder="—" style="width:120px;"></td></tr>`).join('')}</tbody>
        </table>
      </div>
    `;
    const footerHtml = `<button class="btn secondary" id="rCancel">Hủy</button><button class="btn" id="rSubmit">Lưu báo giá</button>`;
    const dialog = openModal({ title: isProjectRate ? `Đặt giá riêng — ${project.name}` : `Tạo báo giá mặc định — ${partner.name}`, bodyHtml, footerHtml, wide: true });

    dialog.querySelector('#rCancel').addEventListener('click', closeModal);
    dialog.querySelector('#rSubmit').addEventListener('click', async () => {
      const effective_from = dialog.querySelector('#rDate').value;
      const reason = isProjectRate ? (dialog.querySelector('#rReason').value.trim() || 'Đơn giá riêng thiết lập qua giao diện') : 'Báo giá thiết lập qua giao diện';
      const inputs = dialog.querySelectorAll('[data-rate-cat]');
      const rows = [];
      inputs.forEach(inp => {
        const val = parseFloat(inp.value);
        if (!isNaN(val) && val > 0) {
          rows.push(isProjectRate
            ? { project_id: project.id, category_id: inp.dataset.rateCat, daily_rate: val, effective_from, reason, approved_by: profile.id }
            : { partner_id: partner.id, category_id: inp.dataset.rateCat, daily_rate: val, effective_from, reason });
        }
      });
      if (rows.length === 0) { alert('Nhập ít nhất 1 đơn giá.'); return; }

      const { error } = isProjectRate
        ? await supabase.from('project_rate_overrides').upsert(rows, { onConflict: 'project_id,category_id,effective_from' })
        : await supabase.from('partner_rates').upsert(rows, { onConflict: 'partner_id,category_id,effective_from' });
      if (error) { alert('Lỗi lưu báo giá: ' + error.message); return; }
      closeModal();
      alert(`Đã lưu ${rows.length} dòng đơn giá.`);
    });
  }

  container.querySelector('#btnNewPartner').addEventListener('click', openNewPartnerModal);
  await loadAll();
}
