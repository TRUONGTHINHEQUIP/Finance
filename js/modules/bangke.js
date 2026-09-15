// js/modules/bangke.js
import { supabase } from '../core/config.js';
import { openModal, closeModal } from '../core/modal.js';
import { fmtVND, fmtDate, todayStr, addDaysStr, esc } from '../core/utils.js';
import { computeStatement, saveStatement, findClosedStatement, getPendingAdjustments, markAdjustmentsApplied, createAdjustment } from '../core/billing.js';

function sourceTypeLabel(type) {
  if (type === 'ton_dau_ky') return 'TỒN ĐẦU KỲ';
  if (type === 'giam_trong_ky') return 'Phát sinh giảm';
  return 'Phát sinh tăng';
}

export async function render(container, profile, isStale = () => false) {
  container.innerHTML = `
    <div class="page-head">
      <div><h1>Bảng kê</h1><div class="sub">Thuê định kỳ — tính theo ngày ký thật, sắp theo nhóm hàng A-E</div></div>
      <button class="btn" id="btnNewAdjustment">+ Tạo dòng điều chỉnh</button>
    </div>
    <div class="toolbar" style="border-bottom:1px solid var(--line); padding-bottom:14px;">
      <button class="btn small" id="subTao">Tạo bảng kê</button>
      <button class="btn secondary small" id="subLichsu">Lịch sử</button>
    </div>
    <div id="sub-tao">
      <div class="toolbar">
        <select id="bkProject"></select>
        <span style="font-size:.8rem;color:var(--ink-soft);">Từ ngày</span><input type="date" id="bkFrom">
        <span style="font-size:.8rem;color:var(--ink-soft);">Đến ngày</span><input type="date" id="bkTo">
        <button class="btn small" id="bkCalc">Tính bảng kê</button>
      </div>
      <div id="bkOutput"></div>
    </div>
    <div id="sub-lichsu" style="display:none;">
      <div class="panel"><div class="panel-body" style="padding:0"><table id="bkHistoryTable"></table></div></div>
    </div>
  `;

  const [{ data: c }, { data: p }, { data: g }, { data: cv }] = await Promise.all([
    supabase.from('categories').select('*'),
    supabase.from('projects').select('*, partners(name)').eq('status', 'active').order('name'),
    supabase.from('groups').select('*').order('id'),
    supabase.from('company_vehicles').select('*, vehicle_types(name)'),
  ]);
  if (isStale()) return;
  const categories = c ?? [], projects = p ?? [], groups = g ?? [], companyVehicles = cv ?? [];

  container.querySelector('#bkProject').innerHTML = projects.map(p => `<option value="${p.id}">${p.name} (${p.partners?.name ?? ''})</option>`).join('');
  container.querySelector('#bkFrom').value = addDaysStr(todayStr(), -30);
  container.querySelector('#bkTo').value = todayStr();

  const catById = (id) => categories.find(c => c.id === id);
  const catName = (id) => catById(id)?.name ?? '(?)';
  const vehicleLabel = (id) => {
    const v = companyVehicles.find(x => x.id === id);
    return v ? `${v.bien_so} — ${v.vehicle_types?.name ?? 'chưa rõ loại'}` : '(xe đã xóa)';
  };

  function renderHierarchicalRentalRows(lines) {
    if (lines.length === 0) return '<tr><td colspan="9" class="empty-state">Không có phiếu chính thức nào trong khoảng thời gian này</td></tr>';

    const byCategory = {};
    lines.forEach(l => { (byCategory[l.category_id] ??= []).push(l); });

    const byGroup = {};
    Object.keys(byCategory).forEach(catId => {
      const cat = catById(catId);
      const groupId = cat?.group_id ?? '?';
      (byGroup[groupId] ??= []).push(catId);
    });
    Object.values(byGroup).forEach(catIds => catIds.sort((a, b) => (catName(a)).localeCompare(catName(b))));

    let stt = 0;
    let html = '';
    groups.filter(g => byGroup[g.id]).forEach(g => {
      const catIds = byGroup[g.id];
      const groupTotal = catIds.reduce((s, catId) => s + byCategory[catId].reduce((s2, l) => s2 + l.thanh_tien, 0), 0);

      html += `<tr style="background:var(--gray-tint); font-weight:700;">
        <td colspan="7">NHÓM ${g.id} — ${esc(g.name).toUpperCase()}</td>
        <td class="num" colspan="2">${fmtVND(groupTotal)}</td>
      </tr>`;

      catIds.forEach(catId => {
        const cat = catById(catId);
        const catLines = byCategory[catId].sort((a, b) => a.ngay.localeCompare(b.ngay));
        const catTotalQty = catLines.reduce((s, l) => s + l.so_luong, 0);
        const catTotalTien = catLines.reduce((s, l) => s + l.thanh_tien, 0);
        stt++;

        html += `<tr style="font-weight:600; color:var(--red-dark);">
          <td>${stt}</td><td></td><td>${esc(cat?.name ?? '(?)')}</td><td>${esc(cat?.unit ?? '')}</td>
          <td></td><td class="num">${catTotalQty}</td><td></td>
          <td class="num">${fmtVND(catTotalTien)}</td><td></td>
        </tr>`;

        catLines.forEach(l => {
          const isGiam = l.source_type === 'giam_trong_ky';
          html += `<tr${isGiam ? ' style="color:var(--red-dark);"' : ''}>
            <td></td><td>${fmtDate(l.ngay)}</td><td style="padding-left:20px;">${sourceTypeLabel(l.source_type)}</td>
            <td></td><td class="num">${l.so_ngay}</td><td class="num">${l.so_luong}</td>
            <td class="num">${fmtVND(l.don_gia)}</td><td class="num">${fmtVND(l.thanh_tien)}</td>
            <td>${l.note_code ? esc(l.note_code) : '—'}</td>
          </tr>`;
        });
      });
    });
    return html;
  }

  function renderTransportRows(transportItems) {
    if (!transportItems || transportItems.length === 0) return ''; // không có xe công ty nào chạy trong kỳ -> không hiện Nhóm F
    const total = transportItems.reduce((s, t) => s + t.thanhTien, 0);
    const rows = transportItems.map(t => `<tr>
      <td>${esc(vehicleLabel(t.company_vehicle_id))}</td>
      <td class="num">${t.soChuyen}</td>
      <td class="num">${fmtVND(t.thanhTien / t.soChuyen)}</td>
      <td class="num">${fmtVND(t.thanhTien)}</td>
    </tr>`).join('');

    return `
      <div style="font-weight:700; margin-top:16px; background:var(--gray-tint); padding:8px 12px;">NHÓM F — VẬN CHUYỂN (xe công ty)</div>
      <table style="margin-top:0;">
        <thead><tr><th>Xe (biển số — loại xe)</th><th class="num">Số chuyến</th><th class="num">Đơn giá bình quân/chuyến</th><th class="num">Thành tiền</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="3">Tổng vận chuyển</td><td class="num">${fmtVND(total)}</td></tr></tfoot>
      </table>`;
  }

  function openNewAdjustmentModal() {
    const bodyHtml = `
      <div class="info-box">Dòng này sẽ tự động được gom vào lần tính bill KẾ TIẾP của đúng dự án được chọn — không đụng vào bill cũ đã chốt.</div>
      <div class="field"><label>Dự án</label><select id="jaProject">${projects.map(p => `<option value="${p.id}">${p.name} (${p.partners?.name ?? ''})</option>`).join('')}</select></div>
      <div class="field"><label>Lý do</label><input type="text" id="jaReason" placeholder="VD: Chứng từ điều chuyển nội bộ về trễ từ dự án X"></div>
      <div class="field"><label>Số tiền (nhập số âm nếu là khoản giảm trừ)</label><input type="number" id="jaAmount" placeholder="VD: 2500000 hoặc -2500000"></div>
    `;
    const footerHtml = `<button class="btn secondary" id="jaCancel">Hủy</button><button class="btn" id="jaSubmit">Tạo dòng điều chỉnh</button>`;
    const dialog = openModal({ title: 'Tạo dòng điều chỉnh', bodyHtml, footerHtml });

    dialog.querySelector('#jaCancel').addEventListener('click', closeModal);
    dialog.querySelector('#jaSubmit').addEventListener('click', async () => {
      const projectId = dialog.querySelector('#jaProject').value;
      const reason = dialog.querySelector('#jaReason').value.trim();
      const amount = parseFloat(dialog.querySelector('#jaAmount').value);
      if (!reason || isNaN(amount) || amount === 0) { alert('Nhập đủ lý do và số tiền khác 0.'); return; }

      try {
        await createAdjustment(projectId, reason, amount, profile.id);
        closeModal();
        alert('Đã tạo dòng điều chỉnh — sẽ tự động gom vào lần tính bill kế tiếp của dự án này.');
      } catch (e) { alert('Lỗi tạo dòng điều chỉnh: ' + e.message); }
    });
  }
  container.querySelector('#btnNewAdjustment').addEventListener('click', openNewAdjustmentModal);

  async function calc() {
    const projectId = container.querySelector('#bkProject').value;
    const from = container.querySelector('#bkFrom').value;
    const to = container.querySelector('#bkTo').value;
    if (!projectId) return;

    const output = container.querySelector('#bkOutput');
    output.innerHTML = '<div class="loading">Đang tính...</div>';

    const already = await findClosedStatement(projectId, from, to);
    if (already) {
      output.innerHTML = `<div class="error-box">Kỳ này đã CHỐT trước đó (${fmtDate(already.closed_at)}) — không tính/chốt lại được. Nếu phát hiện sai lệch, dùng "Tạo dòng điều chỉnh" cho kỳ hiện tại đang mở thay vì sửa lại kỳ này.</div>`;
      return;
    }

    let computed;
    try { computed = await computeStatement(projectId, from, to); }
    catch (e) { output.innerHTML = `<div class="error-box">Lỗi tính bảng kê: ${e.message}</div>`; return; }

    const pendingAdjustments = await getPendingAdjustments(projectId);
    const pendingSum = pendingAdjustments.reduce((s, a) => s + Number(a.amount), 0);

    const project = projects.find(p => p.id === projectId);
    const vatRate = 8;

    const rentalRows = renderHierarchicalRentalRows(computed.lines);
    const transportHtml = renderTransportRows(computed.transportItems);

    const pendingRows = pendingAdjustments.map(a => `<tr>
      <td>${fmtDate(a.created_at)}</td><td colspan="6">${esc(a.reason)}</td><td class="num">${fmtVND(a.amount)}</td>
    </tr>`).join('');

    output.innerHTML = `
      <div class="panel"><div class="panel-body">
        <h2 style="text-align:center;">BẢNG KÊ GIÁ TRỊ — THUÊ ĐỊNH KỲ</h2>
        <div style="text-align:center; font-weight:600; margin:8px 0 14px;">Dự án: ${project?.name ?? ''} · Từ ${fmtDate(from)} đến ${fmtDate(to)}</div>
        <table><thead><tr><th style="width:34px;">STT</th><th>Ngày ký</th><th>Diễn giải / Chủng loại</th><th>ĐVT</th><th class="num">Số ngày</th><th class="num">SL</th><th class="num">Đơn giá</th><th class="num">Thành tiền</th><th>Phiếu GN</th></tr></thead>
          <tbody>${rentalRows}</tbody></table>
        ${transportHtml}
        ${pendingAdjustments.length ? `
        <div style="font-weight:600; margin-top:14px; color:var(--red-dark);">Điều chỉnh gom từ trước (tự động áp dụng vào kỳ này)</div>
        <table><tbody>${pendingRows}</tbody></table>` : ''}

        <div class="field" style="margin-top:16px;">
          <label>Điều chỉnh thêm ngay bây giờ (giảm giá, hoàn tiền... nhập số âm nếu giảm trừ) — để trống nếu không có</label>
          <div class="field-row">
            <input type="text" id="bkAdjNote" placeholder="Lý do điều chỉnh">
            <input type="number" id="bkAdjAmount" placeholder="Số tiền (VD: -500000)">
          </div>
        </div>

        <table style="margin-top:10px;" id="bkTotalsTable"></table>

        <div class="note-box">Đây là bảng kê giá trị (không phải hóa đơn điện tử) — dùng làm căn cứ để Sale xuất hóa đơn thật và BGD xem thống kê.</div>
        <div style="display:flex; gap:10px;">
          <button class="btn secondary" id="bkSaveDraft">Lưu nháp</button>
          <button class="btn" id="bkClose">Chốt kỳ</button>
        </div>
      </div></div>`;

    function renderTotals() {
      const adjAmount = parseFloat(container.querySelector('#bkAdjAmount').value) || 0;
      const tongPhatSinh = computed.rentalSubtotal + computed.transportSubtotal + pendingSum + adjAmount;
      const vat = tongPhatSinh * (vatRate / 100);
      const total = tongPhatSinh + vat;
      container.querySelector('#bkTotalsTable').innerHTML = `
        <tr><td style="border:none;width:70%"></td><td style="border:none;">Tiền thuê</td><td class="num" style="border:none;">${fmtVND(computed.rentalSubtotal)}</td></tr>
        ${computed.transportSubtotal ? `<tr><td style="border:none;"></td><td style="border:none;">Vận chuyển</td><td class="num" style="border:none;">${fmtVND(computed.transportSubtotal)}</td></tr>` : ''}
        ${pendingSum ? `<tr><td style="border:none;"></td><td style="border:none;">Điều chỉnh gom từ trước</td><td class="num" style="border:none;">${fmtVND(pendingSum)}</td></tr>` : ''}
        ${adjAmount ? `<tr><td style="border:none;"></td><td style="border:none;">Điều chỉnh thêm ngay</td><td class="num" style="border:none;">${fmtVND(adjAmount)}</td></tr>` : ''}
        <tr><td style="border:none;"></td><td style="border:none;">VAT (${vatRate}%)</td><td class="num" style="border:none;">${fmtVND(vat)}</td></tr>
        <tr><td style="border:none;"></td><td style="border:none;font-weight:700;color:var(--red-dark);">Tổng thanh toán</td><td class="num" style="border:none;font-weight:700;color:var(--red-dark);">${fmtVND(total)}</td></tr>
      `;
    }
    renderTotals();
    container.querySelector('#bkAdjAmount').addEventListener('input', renderTotals);

    async function doSave(close) {
      try {
        const adjNoteManual = container.querySelector('#bkAdjNote').value.trim();
        const adjAmountManual = parseFloat(container.querySelector('#bkAdjAmount').value) || 0;

        const combinedAmount = pendingSum + adjAmountManual;
        const noteParts = pendingAdjustments.map(a => a.reason);
        if (adjNoteManual) noteParts.push(adjNoteManual);
        const adjustment = combinedAmount !== 0 || noteParts.length ? { note: noteParts.join('; ') || null, amount: combinedAmount } : null;

        const partnerId = project.partner_id;
        let { data: period } = await supabase.from('billing_periods')
          .select('*').eq('partner_id', partnerId).eq('period_start', from).eq('period_end', to).maybeSingle();
        if (!period) {
          const { data: newPeriod, error } = await supabase.from('billing_periods')
            .insert({ partner_id: partnerId, period_start: from, period_end: to }).select().single();
          if (error) throw error;
          period = newPeriod;
        }
        const statement = await saveStatement(period.id, projectId, computed, vatRate, adjustment, close);
        if (pendingAdjustments.length) await markAdjustmentsApplied(pendingAdjustments.map(a => a.id), statement.id);

        alert(close ? 'Đã chốt kỳ — không sửa/tính lại được nữa, mọi sai lệch sau này xử lý bằng dòng điều chỉnh.' : 'Đã lưu nháp.');
        loadHistory();
      } catch (e) { alert('Lỗi lưu bảng kê: ' + e.message); }
    }

    container.querySelector('#bkSaveDraft').addEventListener('click', () => doSave(false));
    container.querySelector('#bkClose').addEventListener('click', () => {
      if (confirm('Chốt kỳ nghĩa là số liệu này đã được khách hàng xác nhận và xuất hóa đơn — không sửa/tính lại được nữa. Chắc chắn chốt?')) {
        doSave(true);
      }
    });
  }

  async function loadHistory() {
    const { data, error } = await supabase.from('billing_statements')
      .select('*, projects(name)').order('created_at', { ascending: false }).limit(50);
    if (isStale()) return;
    const table = container.querySelector('#bkHistoryTable');
    if (error) { table.innerHTML = `<tr><td class="error-box">${error.message}</td></tr>`; return; }

    const rows = (data ?? []).map(s => `<tr data-open-stmt="${s.id}" style="cursor:pointer;">
      <td><b style="color:var(--red-dark);">${esc(s.projects?.name ?? '(?)')}</b></td>
      <td class="num">${fmtVND(s.tong_phat_sinh)}</td><td class="num">${fmtVND(s.vat_amount)}</td><td class="num">${fmtVND(s.total)}</td>
      <td>${s.status === 'closed' ? '<span class="badge chinh">Đã chốt</span>' : '<span class="badge tam">Nháp</span>'}</td>
      <td><span class="badge ${s.cong_no_status === 'da_thu' ? 'chinh' : s.cong_no_status === 'qua_han' ? 'tre' : 'tam'}">${s.cong_no_status.replace('_', ' ')}</span></td>
      <td>${fmtDate(s.created_at)}</td>
    </tr>`).join('');

    table.innerHTML = `<thead><tr><th>Dự án</th><th class="num">Tổng phát sinh</th><th class="num">VAT</th><th class="num">Tổng thanh toán</th><th>Trạng thái</th><th>Công nợ</th><th>Ngày tạo</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" class="empty-state">Chưa có bảng kê nào được lưu</td></tr>'}</tbody>`;

    table.querySelectorAll('[data-open-stmt]').forEach(tr => {
      tr.addEventListener('click', () => openStatementDetail((data ?? []).find(s => s.id === tr.dataset.openStmt)));
    });
  }

  async function openStatementDetail(statement) {
    const { data: lines, error } = await supabase.from('billing_statement_lines')
      .select('*').eq('statement_id', statement.id).order('ngay');
    if (error) { alert('Lỗi tải chi tiết: ' + error.message); return; }

    const rows = renderHierarchicalRentalRows(lines ?? []);

    const bodyHtml = `
      <div style="margin-bottom:10px;">${statement.status === 'closed' ? '<span class="badge chinh">Đã chốt</span>' : '<span class="badge tam">Nháp</span>'}</div>
      <table><thead><tr><th style="width:34px;">STT</th><th>Ngày ký</th><th>Diễn giải / Chủng loại</th><th>ĐVT</th><th class="num">Số ngày</th><th class="num">SL</th><th class="num">Đơn giá</th><th class="num">Thành tiền</th><th>Phiếu GN</th></tr></thead>
        <tbody>${rows}</tbody></table>
      <table style="margin-top:10px;">
        <tr><td style="border:none;width:70%"></td><td style="border:none;">Tiền thuê</td><td class="num" style="border:none;">${fmtVND(statement.rental_subtotal)}</td></tr>
        ${statement.transport_subtotal ? `<tr><td style="border:none;"></td><td style="border:none;">Vận chuyển</td><td class="num" style="border:none;">${fmtVND(statement.transport_subtotal)}</td></tr>` : ''}
        ${statement.adjustment_amount ? `<tr><td style="border:none;"></td><td style="border:none;">Điều chỉnh${statement.adjustment_note ? ' — ' + esc(statement.adjustment_note) : ''}</td><td class="num" style="border:none;">${fmtVND(statement.adjustment_amount)}</td></tr>` : ''}
        <tr><td style="border:none;"></td><td style="border:none;">VAT (${statement.vat_rate}%)</td><td class="num" style="border:none;">${fmtVND(statement.vat_amount)}</td></tr>
        <tr><td style="border:none;"></td><td style="border:none;font-weight:700;color:var(--red-dark);">Tổng thanh toán</td><td class="num" style="border:none;font-weight:700;color:var(--red-dark);">${fmtVND(statement.total)}</td></tr>
      </table>
    `;
    openModal({ title: `Bảng kê — ${statement.projects?.name ?? '(?)'}`, bodyHtml, footerHtml: '', wide: true });
  }

  container.querySelector('#subTao').addEventListener('click', () => {
    container.querySelector('#sub-tao').style.display = 'block';
    container.querySelector('#sub-lichsu').style.display = 'none';
  });
  container.querySelector('#subLichsu').addEventListener('click', () => {
    container.querySelector('#sub-tao').style.display = 'none';
    container.querySelector('#sub-lichsu').style.display = 'block';
    loadHistory();
  });
  container.querySelector('#bkCalc').addEventListener('click', calc);
}
