// js/modules/bangke.js
import { supabase } from '../core/config.js';
import { fmtVND, fmtDate, todayStr, addDaysStr } from '../core/utils.js';
import { computeStatement, saveStatement } from '../core/billing.js';

export async function render(container, profile, isStale = () => false) {
  container.innerHTML = `
    <div class="page-head">
      <div><h1>Bảng kê</h1><div class="sub">Thuê định kỳ — tính theo ngày ký thật, tồn đầu kỳ + phát sinh thuê</div></div>
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

  async function calc() {
    const projectId = container.querySelector('#bkProject').value;
    const from = container.querySelector('#bkFrom').value;
    const to = container.querySelector('#bkTo').value;
    if (!projectId) return;

    const output = container.querySelector('#bkOutput');
    output.innerHTML = '<div class="loading">Đang tính...</div>';

    let computed;
    try { computed = await computeStatement(projectId, from, to); }
    catch (e) { output.innerHTML = `<div class="error-box">Lỗi tính bảng kê: ${e.message}</div>`; return; }

    const project = projects.find(p => p.id === projectId);
    const vatRate = 8;
    const vat = computed.rentalSubtotal * (vatRate / 100);
    const total = computed.rentalSubtotal + vat;

    const rows = computed.lines.map(l => `<tr>
      <td>${fmtDate(l.ngay)}</td>
      <td>${l.source_type === 'ton_dau_ky' ? 'TỒN ĐẦU KỲ' : 'Phát Sinh Thuê'}</td>
      <td>${catName(l.category_id)}</td>
      <td class="num">${l.so_ngay}</td><td class="num">${l.so_luong}</td>
      <td class="num">${fmtVND(l.don_gia)}</td><td class="num">${fmtVND(l.thanh_tien)}</td>
    </tr>`).join('') || '<tr><td colspan="7" class="empty-state">Không có phiếu chính thức nào trong khoảng thời gian này</td></tr>';

    output.innerHTML = `
      <div class="panel"><div class="panel-body">
        <h2 style="text-align:center;">BẢNG KÊ GIÁ TRỊ — THUÊ ĐỊNH KỲ</h2>
        <div style="text-align:center; font-weight:600; margin:8px 0 14px;">Dự án: ${project?.name ?? ''} · Từ ${fmtDate(from)} đến ${fmtDate(to)}</div>
        <table><thead><tr><th>Ngày ký</th><th>Diễn giải</th><th>Chủng loại</th><th class="num">Số ngày</th><th class="num">SL</th><th class="num">Đơn giá</th><th class="num">Thành tiền</th></tr></thead>
          <tbody>${rows}</tbody></table>
        <table style="margin-top:10px;">
          <tr><td style="border:none;width:70%"></td><td style="border:none;">Tiền thuê</td><td class="num" style="border:none;">${fmtVND(computed.rentalSubtotal)}</td></tr>
          <tr><td style="border:none;"></td><td style="border:none;">VAT (${vatRate}%)</td><td class="num" style="border:none;">${fmtVND(vat)}</td></tr>
          <tr><td style="border:none;"></td><td style="border:none;font-weight:700;color:var(--red-dark);">Tổng thanh toán</td><td class="num" style="border:none;font-weight:700;color:var(--red-dark);">${fmtVND(total)}</td></tr>
        </table>
        <div class="note-box">Đây là bảng kê giá trị (không phải hóa đơn điện tử) — dùng làm căn cứ để Sale xuất hóa đơn thật và BGD xem thống kê.</div>
        <button class="btn small" id="bkSave">Lưu vào lịch sử</button>
      </div></div>`;

    container.querySelector('#bkSave').addEventListener('click', async () => {
      try {
        const partnerId = project.partner_id;
        let { data: period } = await supabase.from('billing_periods')
          .select('*').eq('partner_id', partnerId).eq('period_start', from).eq('period_end', to).maybeSingle();
        if (!period) {
          const { data: newPeriod, error } = await supabase.from('billing_periods')
            .insert({ partner_id: partnerId, period_start: from, period_end: to }).select().single();
          if (error) throw error;
          period = newPeriod;
        }
        await saveStatement(period.id, projectId, computed, 0, vatRate);
        alert('Đã lưu bảng kê.');
        loadHistory();
      } catch (e) { alert('Lỗi lưu bảng kê: ' + e.message); }
    });
  }

  async function loadHistory() {
    const { data, error } = await supabase.from('billing_statements')
      .select('*, projects(name)').order('created_at', { ascending: false }).limit(50);
    const table = container.querySelector('#bkHistoryTable');
    if (error) { table.innerHTML = `<tr><td class="error-box">${error.message}</td></tr>`; return; }

    const rows = (data ?? []).map(s => `<tr>
      <td>${s.projects?.name ?? '(?)'}</td>
      <td class="num">${fmtVND(s.tong_phat_sinh)}</td><td class="num">${fmtVND(s.vat_amount)}</td><td class="num">${fmtVND(s.total)}</td>
      <td><span class="badge ${s.cong_no_status === 'da_thu' ? 'chinh' : s.cong_no_status === 'qua_han' ? 'tre' : 'tam'}">${s.cong_no_status.replace('_', ' ')}</span></td>
      <td>${fmtDate(s.created_at)}</td>
    </tr>`).join('');

    table.innerHTML = `<thead><tr><th>Dự án</th><th class="num">Tổng phát sinh</th><th class="num">VAT</th><th class="num">Tổng thanh toán</th><th>Công nợ</th><th>Ngày tạo</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" class="empty-state">Chưa có bảng kê nào được lưu</td></tr>'}</tbody>`;
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
