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
    const [{ data: proj }, { data: cats }] = await Promise.all([
      supabase.from('projects').select('*').order('name'),
      supabase.from('categories').select('*').order('sort_order', { ascending: true, nullsFirst: false }).order('name'),
    ]);
    if (isStale()) return;
    partners = p ?? []; projects = proj ?? []; categories = cats ?? [];
    renderList();
  }

  // Trước đây hàm này hỏi database riêng cho TỪNG chủng loại (tới ~40 lần hỏi
  // tuần tự cho 20 chủng loại) -> rất chậm. Giờ chỉ hỏi 1-2 lần duy nhất
  // (toàn bộ giá khung của khách hàng, toàn bộ giá riêng của dự án nếu có),
  // rồi tự ghép trong trình duyệt.
  async function getRateTable(partner, project) {
    const today = todayStr();

    const { data: baseRates } = await supabase.from('partner_rates')
      .select('category_id, daily_rate, effective_from')
      .eq('partner_id', partner.id)
      .lte('effective_from', today)
      .order('effective_from', { ascending: false });

    const baseRateMap = {};
    (baseRates ?? []).forEach(r => {
      if (!(r.category_id in baseRateMap)) baseRateMap[r.category_id] = r.daily_rate;
    });

    let overrideMap = {};
    if (project) {
      const { data: overrides } = await supabase.from('project_rate_overrides')
        .select('category_id, daily_rate, effective_from')
        .eq('project_id', project.id)
        .lte('effective_from', today)
        .order('effective_from', { ascending: false });
      (overrides ?? []).forEach(r => {
        if (!(r.category_id in overrideMap)) overrideMap[r.category_id] = r.daily_rate;
      });
    }

    return categories.map(cat => {
      const isOverride = cat.id in overrideMap;
      const rate = isOverride ? overrideMap[cat.id] : (baseRateMap[cat.id] ?? null);
      return { id: cat.id, name: cat.name, unit: cat.unit, rate, isOverride };
    });
  }

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

  // Lấy toàn bộ giá của 1 đối tác trong 2 lần hỏi (giá khung + giá riêng mọi dự án)
  async function loadRateData(partner, projs) {
    const today = todayStr();
    const ids = projs.map(p => p.id);
    const [{ data: base }, { data: ovr }] = await Promise.all([
      supabase.from('partner_rates').select('category_id, daily_rate, effective_from')
        .eq('partner_id', partner.id).lte('effective_from', today).order('effective_from', { ascending: false }),
      ids.length
        ? supabase.from('project_rate_overrides').select('project_id, category_id, daily_rate, effective_from')
            .in('project_id', ids).lte('effective_from', today).order('effective_from', { ascending: false })
        : Promise.resolve({ data: [] }),
    ]);
    const baseMap = {}, ovrMap = {};
    (base ?? []).forEach(r => { if (!(r.category_id in baseMap)) baseMap[r.category_id] = r.daily_rate; });
    (ovr ?? []).forEach(r => {
      ovrMap[r.project_id] ??= {};
      if (!(r.category_id in ovrMap[r.project_id])) ovrMap[r.project_id][r.category_id] = r.daily_rate;
    });
    return { baseMap, ovrMap };
  }

  function openDetailModal(partner, openKey = null) {
    const projs = projects.filter(pr => pr.partner_id === partner.id);
    const catsSorted = [...categories].sort((a, b) =>
      (a.group_id ?? '').localeCompare(b.group_id ?? '') || (a.sort_order ?? 9999) - (b.sort_order ?? 9999) || a.name.localeCompare(b.name));

    const bodyHtml = `
      <div style="font-size:.85rem; color:var(--ink-soft); line-height:1.8; margin-bottom:16px;">
        Địa chỉ: ${esc(partner.address ?? '—')}<br>
        MST: ${esc(partner.mst ?? '—')}<br>
        Hợp đồng: ${esc(partner.hop_dong_so ?? '—')} ${partner.hop_dong_ngay ? '— ký ngày ' + fmtDate(partner.hop_dong_ngay) : ''}<br>
        Kỳ chốt bill: ngày ${partner.billing_cutoff_day} hằng tháng
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:8px;">
        <b>Dự án &amp; bảng giá <span style="font-weight:400; color:var(--ink-soft); font-size:.8rem;">(bấm vào dòng để xem giá)</span></b>
        <div style="display:flex; gap:8px;">
          <button class="btn secondary small" id="dNewProject">+ Tạo dự án mới</button>
          <button class="btn small" id="dNewRate">+ Tạo báo giá mặc định</button>
        </div>
      </div>
      <div class="panel"><div class="panel-body" style="padding:0">
        <table id="projTable"><tbody><tr><td class="loading" colspan="4">Đang tải...</td></tr></tbody></table>
      </div></div>
    `;

    const dialog = openModal({ title: partner.name, bodyHtml, footerHtml: '', wide: true });
    dialog.querySelector('#dNewRate').addEventListener('click', () => openRateModal(partner));
    dialog.querySelector('#dNewProject').addEventListener('click', () => openNewProjectModal(partner));

    loadRateData(partner, projs).then(({ baseMap, ovrMap }) => {
      const items = [
        { key: 'default', label: 'Bảng giá mặc định', sub: 'Giá khung áp dụng cho mọi dự án', project: null, ovr: {} },
        ...projs.map(pr => ({ key: pr.id, label: pr.name, sub: pr.code ?? '', project: pr, ovr: ovrMap[pr.id] ?? {} })),
      ];
      const baseCount = Object.keys(baseMap).length;

      const rowsHtml = items.map((it, i) => {
        const nOvr = Object.keys(it.ovr).length;
        const nPriced = it.project ? new Set([...Object.keys(baseMap), ...Object.keys(it.ovr)]).size : baseCount;
        return `<tr class="proj-row" data-key="${it.key}" style="cursor:pointer;">
          <td style="width:42px; color:var(--ink-soft);">${i === 0 ? '📋' : i}</td>
          <td><b style="color:var(--red-dark);">${esc(it.label)}</b>${it.sub ? `<div style="font-size:.74rem; color:var(--ink-soft);">${esc(it.sub)}</div>` : ''}</td>
          <td class="num">${nPriced}/${categories.length} chủng loại có giá${nOvr ? ` · <span style="color:var(--red-dark); font-weight:600;">${nOvr} giá riêng</span>` : ''}</td>
          <td style="width:30px; text-align:center; color:var(--ink-soft);" class="chev">▸</td>
        </tr>
        <tr class="price-row" data-for="${it.key}" style="display:none;"><td colspan="4" style="padding:0; background:#FCFBF9;"></td></tr>`;
      }).join('');

      const table = dialog.querySelector('#projTable');
      table.innerHTML = `<thead><tr><th>#</th><th>Dự án</th><th class="num">Tình trạng giá</th><th></th></tr></thead><tbody>${rowsHtml}</tbody>`;

      function buildPriceHtml(it) {
        let lastGroup = null;
        const rows = catsSorted.map(c => {
          const isOvr = c.id in it.ovr;
          const rate = isOvr ? it.ovr[c.id] : (baseMap[c.id] ?? null);
          let head = '';
          if (c.group_id !== lastGroup) {
            lastGroup = c.group_id;
            head = `<tr><td colspan="3" style="background:var(--gray-tint); font-weight:600; font-size:.76rem; color:var(--ink-soft);">NHÓM ${esc(c.group_id ?? '')}</td></tr>`;
          }
          return head + `<tr><td>${esc(c.name)}</td><td>${esc(c.unit)}</td>
            <td class="num" style="${isOvr ? 'color:var(--red-dark); font-weight:600;' : ''}">${rate != null ? fmtVND(rate) + (isOvr ? ' *' : '') : '<span style="color:var(--ink-soft);">— chưa có giá —</span>'}</td></tr>`;
        }).join('');
        return `<div style="padding:10px 14px 14px;">
          <div style="max-height:340px; overflow-y:auto; border:1px solid var(--line); border-radius:6px; background:#fff;">
            <table><thead><tr><th>Chủng loại</th><th>ĐVT</th><th class="num">Đơn giá/ngày</th></tr></thead><tbody>${rows}</tbody></table>
          </div>
          ${Object.keys(it.ovr).length ? '<div class="note-box" style="margin:8px 0 0;">* Đơn giá riêng cho dự án này, khác giá khung mặc định.</div>' : ''}
          ${it.project ? `<button class="btn secondary small" data-set-rate="${it.key}" style="margin-top:10px;">+ Đặt giá riêng cho dự án này</button>` : ''}
        </div>`;
      }

      function toggle(key) {
        const it = items.find(x => x.key === key);
        const priceRow = table.querySelector(`.price-row[data-for="${key}"]`);
        const headRow = table.querySelector(`.proj-row[data-key="${key}"]`);
        const willOpen = priceRow.style.display === 'none';
        // chỉ mở 1 dự án một lúc cho gọn
        table.querySelectorAll('.price-row').forEach(r => r.style.display = 'none');
        table.querySelectorAll('.proj-row').forEach(r => { r.style.background = ''; r.querySelector('.chev').textContent = '▸'; });
        if (!willOpen) return;
        priceRow.style.display = '';
        headRow.style.background = 'var(--red-tint)';
        headRow.querySelector('.chev').textContent = '▾';
        priceRow.firstElementChild.innerHTML = buildPriceHtml(it);
        const btn = priceRow.querySelector('[data-set-rate]');
        if (btn) btn.addEventListener('click', () => openRateModal(partner, it.project));
        headRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }

      table.querySelectorAll('.proj-row').forEach(tr => tr.addEventListener('click', () => toggle(tr.dataset.key)));
      if (openKey) toggle(openKey);
    });
  }

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
      openDetailModal(partner);
    });
  }

  async function openRateModal(partner, project = null) {
    const isProjectRate = !!project;
    const projsOfPartner = projects.filter(pr => pr.partner_id === partner.id);
    // Giá nền hiện hành: giá khung của đối tác, nếu là dự án thì đè thêm giá riêng đã có
    const { baseMap, ovrMap } = await loadRateData(partner, projsOfPartner);
    const current = {};
    categories.forEach(c => {
      const o = isProjectRate ? ovrMap[project.id]?.[c.id] : undefined;
      current[c.id] = o ?? baseMap[c.id] ?? null;
    });
    const catsSorted = [...categories].sort((a, b) =>
      (a.group_id ?? '').localeCompare(b.group_id ?? '') || (a.sort_order ?? 9999) - (b.sort_order ?? 9999) || a.name.localeCompare(b.name));

    const bodyHtml = `
      <div class="info-box">${isProjectRate
        ? `Các ô đã điền sẵn <b>giá khung mặc định</b> của <b>${esc(partner.name)}</b> làm nền. Chỉ <b>sửa ô nào cần giá riêng</b> cho dự án <b>${esc(project.name)}</b>; ô để nguyên sẽ tiếp tục dùng giá khung.`
        : `Các ô đã điền sẵn giá mặc định hiện hành. Chỉ sửa ô nào cần đổi giá; ô để nguyên sẽ giữ nguyên. Áp dụng cho toàn bộ dự án của <b>${esc(partner.name)}</b>, trừ dự án có giá riêng.`}</div>
      <div class="field-row">
        <div class="field"><label>Ngày hiệu lực</label><input type="date" id="rDate" value="${todayStr()}"></div>
        ${isProjectRate ? `<div class="field"><label>Lý do đổi giá riêng</label><input type="text" id="rReason" placeholder="VD: Thương lượng riêng theo hợp đồng dự án"></div>` : ''}
      </div>
      <div style="max-height:320px; overflow-y:auto; border:1px solid var(--line); border-radius:6px;">
        <table>
          <thead><tr><th>Chủng loại</th><th>ĐVT</th><th class="num" style="width:140px;">Đơn giá/ngày</th></tr></thead>
          <tbody>${catsSorted.map(c => `<tr><td>${esc(c.name)}</td><td>${esc(c.unit)}</td>
            <td><input type="number" data-rate-cat="${c.id}" data-orig="${current[c.id] ?? ''}" value="${current[c.id] ?? ''}" placeholder="—" style="width:120px;"></td></tr>`).join('')}</tbody>
        </table>
      </div>
      <div id="rChanged" style="font-size:.78rem; color:var(--ink-soft); margin-top:8px;">Chưa thay đổi ô nào.</div>
    `;
    const footerHtml = `<button class="btn secondary" id="rCancel">Hủy</button><button class="btn" id="rSubmit">Lưu báo giá</button>`;
    const dialog = openModal({ title: isProjectRate ? `Đặt giá riêng — ${project.name}` : `Tạo báo giá mặc định — ${partner.name}`, bodyHtml, footerHtml, wide: true });

    const isChanged = (inp) => {
      const v = parseFloat(inp.value);
      const o = inp.dataset.orig === '' ? NaN : parseFloat(inp.dataset.orig);
      return !isNaN(v) && v > 0 && v !== o;
    };
    dialog.querySelectorAll('[data-rate-cat]').forEach(inp => inp.addEventListener('input', () => {
      const changed = dialog.querySelectorAll('[data-rate-cat]');
      let n = 0;
      changed.forEach(i => { const c = isChanged(i); i.style.borderColor = c ? 'var(--red)' : ''; i.style.fontWeight = c ? '600' : ''; if (c) n++; });
      dialog.querySelector('#rChanged').innerHTML = n ? `Đã thay đổi <b style="color:var(--red-dark);">${n}</b> chủng loại (ô viền đỏ).` : 'Chưa thay đổi ô nào.';
    }));

    dialog.querySelector('#rCancel').addEventListener('click', closeModal);
    dialog.querySelector('#rSubmit').addEventListener('click', async () => {
      const effective_from = dialog.querySelector('#rDate').value;
      const reason = isProjectRate ? (dialog.querySelector('#rReason').value.trim() || 'Đơn giá riêng thiết lập qua giao diện') : 'Báo giá thiết lập qua giao diện';
      const rows = [];
      dialog.querySelectorAll('[data-rate-cat]').forEach(inp => {
        if (!isChanged(inp)) return; // ô giữ nguyên -> không lưu, tiếp tục dùng giá nền
        const val = parseFloat(inp.value);
        rows.push(isProjectRate
          ? { project_id: project.id, category_id: inp.dataset.rateCat, daily_rate: val, effective_from, reason, approved_by: profile.id }
          : { partner_id: partner.id, category_id: inp.dataset.rateCat, daily_rate: val, effective_from, reason });
      });
      if (rows.length === 0) { alert('Chưa có ô nào thay đổi so với giá nền.'); return; }

      const { error } = isProjectRate
        ? await supabase.from('project_rate_overrides').upsert(rows, { onConflict: 'project_id,category_id,effective_from' })
        : await supabase.from('partner_rates').upsert(rows, { onConflict: 'partner_id,category_id,effective_from' });
      if (error) { alert('Lỗi lưu báo giá: ' + error.message); return; }
      closeModal();
      alert(`Đã lưu ${rows.length} dòng đơn giá thay đổi.`);
      openDetailModal(partner, isProjectRate ? project.id : 'default');
    });
  }

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

  container.querySelector('#btnNewPartner').addEventListener('click', openNewPartnerModal);
  await loadAll();
}
