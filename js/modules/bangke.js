// js/modules/bangke.js
import { supabase } from '../core/config.js';
import { openModal } from '../core/modal.js';
import { fmtVND, fmtDate, todayStr, addDaysStr, esc } from '../core/utils.js';
import { computeStatement, saveStatement, findClosedStatement, getPendingAdjustments, markAdjustmentsApplied, createAdjustment } from '../core/billing.js';
import { closeModal } from '../core/modal.js';

function sourceTypeLabel(type) {
  if (type === 'ton_dau_ky') return 'TỒN ĐẦU KỲ';
  if (type === 'giam_trong_ky') return 'Rời đi trong kỳ';
  return 'Phát Sinh Thuê';
}

export async function render(container, profile, isStale = () => false) {
  container.innerHTML = `
    <div class="page-head">
      <div><h1>Bảng kê</h1><div class="sub">Thuê định kỳ — tính theo ngày ký thật, tồn đầu kỳ + phát sinh thuê</div></div>
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

  const { data: c } = await supabase.from('categories').select('*');
  const { data: p } = await supabase.from('projects').select('*, partners(name)').eq('status', 'active').order('name');
  if (isStale()) return;
  const categories = c ?? [], projects = p ?? [];

  container.querySelector('#bkProject').innerHTML = projects.map(p => `<option value="${p.id}">${p.name} (${p.partners?.name ?? ''})</option>`).join('');
  container.querySelector('#bkFrom').value = addDaysStr(todayStr(), -30);
  container.querySelector('#bkTo').value = todayStr();

  const catName = (id) => categories.find(c => c.id === id)?.name ?? '(?)';

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

    const rentalRows = computed.lines.map(l => `<tr${l.source_type === 'giam_trong_ky' ? ' style="color:var(--red-dark);"' : ''}>
      <td>${fmtDate(l.ngay)}</td>
      <td>${sourceTypeLabel(l.source_type)}</td>
      <td>${catName(l.category_id)}</td>
      <td class="num">${l.so_ngay}</td><td class="num">${l.so_luong}</td>
      <td class="num">${fmtVND(l.don_gia)}</td><td class="num">${fmtVND(l.thanh_tien)}</td>
    </tr>`).join('') || '<tr><td colspan="7" class="empty-state">Không có phiếu chính thức nào trong khoảng thời gian này</td></tr>';

    const transportRows = computed.transportItems.map(t => `<tr>
      <td>${fmtDate(t.ngay)}</td><td colspan="5">Chuyến xe theo phiếu ${t.code}</td><td class="num">${fmtVND(t.amount)}</td>
    </tr>`).join('');

    const pendingRows = pendingAdjustments.map(a => `<tr>
      <td>${fmtDate(a.created_at)}</td><td colspan="5">${esc(a.reason)}</td><td class="num">${fmtVND(a.amount)}</td>
    </tr>`).join('');

    output.innerHTML = `
      <div class="panel"><div class="panel-body">
        <h2 style="text-align:center;">BẢNG KÊ GIÁ TRỊ — THUÊ ĐỊNH KỲ</h2>
        <div style="text-align:center; font-weight:600; margin:8px 0 14px;">Dự án: ${project?.name ?? ''} · Từ ${fmtDate(from)} đến ${fmtDate(to)}</div>
        <table><thead><tr><th>Ngày ký</th><th>Diễn giải</th><th>Chủng loại</th><th class="num">Số ngày</th><th class="num">SL</th><th class="num">Đơn giá</th><th class="num">Thành tiền</th></tr></thead>
          <tbody>${rentalRows}</tbody></table>
        ${computed.transportItems.length ? `
        <div style="font-weight:600; margin-top:14px; color:var(--red-dark);">Vận chuyển</div>
        <table><tbody>${transportRows}</tbody></table>` : ''}
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

    const rows = (lines ?? []).map(l => `<tr${l.source_type === 'giam_trong_ky' ? ' style="color:var(--red-dark);"' : ''}>
      <td>${fmtDate(l.ngay)}</td>
      <td>${sourceTypeLabel(l.source_type)}</td>
      <td>${esc(catName(l.category_id))}</td>
      <td class="num">${l.so_ngay}</td><td class="num">${l.so_luong}</td>
      <td class="num">${fmtVND(l.don_gia)}</td><td class="num">${fmtVND(l.thanh_tien)}</td>
    </tr>`).join('') || '<tr><td colspan="7" class="empty-state">Không có dòng chi tiết</td></tr>';

    const bodyHtml = `
      <div style="margin-bottom:10px;">${statement.status === 'closed' ? '<span class="badge chinh">Đã chốt</span>' : '<span class="badge tam">Nháp</span>'}</div>
      <table><thead><tr><th>Ngày ký</th><th>Diễn giải</th><th>Chủng loại</th><th class="num">Số ngày</th><th class="num">SL</th><th class="num">Đơn giá</th><th class="num">Thành tiền</th></tr></thead>
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
