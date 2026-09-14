// js/modules/haohut.js
import { supabase } from '../core/config.js';
import { fmtVND, fmtDate, esc } from '../core/utils.js';
import { openModal, closeModal } from '../core/modal.js';

export async function render(container, profile, isStale = () => false) {
  container.innerHTML = `
    <div class="page-head">
      <div><h1>Hao hụt</h1><div class="sub">Bảng kê theo đợt, độc lập với bảng kê thuê định kỳ — Sale tự quyết % thương lượng</div></div>
      <button class="btn" id="btnNew">+ Lập đợt hao hụt mới</button>
    </div>
    <div class="panel" id="newForm" style="display:none; margin-bottom:18px;">
      <div class="panel-body">
        <div class="form-row">
          <div><label>Dự án</label><select id="fProject"></select></div>
          <div><label>Chủng loại</label><select id="fCategory"></select></div>
          <div><label>Số lượng hư hỏng</label><input type="number" id="fQty" value="1" min="1"></div>
        </div>
        <div class="form-row">
          <div><label>% thương lượng (trên đơn giá tham chiếu)</label><input type="number" id="fPct" value="80" min="0" max="100"></div>
          <div><label>Ghi chú</label><input type="text" id="fNote" placeholder="VD: Hư hỏng một phần, thương lượng theo thực tế"></div>
          <div style="display:flex; align-items:flex-end;"><button class="btn" id="fSubmit">Lập đợt</button></div>
        </div>
      </div>
    </div>
    <div id="list" class="loading">Đang tải...</div>
  `;

  // Hỏi song song thay vì nối tiếp — giảm thời gian tải ban đầu
  const [{ data: c }, { data: p }] = await Promise.all([
    supabase.from('categories').select('*').order('name'),
    supabase.from('projects').select('*').eq('status', 'active').order('name'),
  ]);
  if (isStale()) return;
  const categories = c ?? [], projects = p ?? [];

  container.querySelector('#fProject').innerHTML = projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  container.querySelector('#fCategory').innerHTML = categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

  const catName = (id) => categories.find(c => c.id === id)?.name ?? '(?)';
  const catUnit = (id) => categories.find(c => c.id === id)?.unit ?? '';
  const projName = (id) => projects.find(p => p.id === id)?.name ?? '(?)';
  const statusLabel = (s) => s === 'dong_y' ? 'Đồng ý' : s === 'tranh_chap' ? 'Tranh chấp' : 'Chờ phản hồi';
  const statusBadgeClass = (s) => s === 'dong_y' ? 'chinh' : s === 'tranh_chap' ? 'tre' : 'tam';

  let statements = [];

  async function loadList() {
    const { data, error } = await supabase.from('hao_hut_statements').select('*').order('created_at', { ascending: false });
    if (isStale()) return;
    const list = container.querySelector('#list');
    if (error) { list.innerHTML = `<div class="error-box">${error.message}</div>`; return; }
    statements = data ?? [];

    const rows = statements.map(h => `<tr data-open-hh="${h.id}" style="cursor:pointer;">
      <td><b style="color:var(--red-dark);">${esc(projName(h.project_id))}</b></td>
      <td>Đợt ${h.dot_number}</td>
      <td>${esc(catName(h.category_id))}</td>
      <td class="num">${fmtVND(h.total)}</td>
      <td><span class="badge ${statusBadgeClass(h.customer_response_status)}">${statusLabel(h.customer_response_status)}</span></td>
      <td>${h.cong_no_status.replace('_', ' ')}</td>
    </tr>`).join('');

    list.innerHTML = `
      <div class="panel"><div class="panel-body" style="padding:0">
        <table>
          <thead><tr><th>Dự án</th><th>Đợt</th><th>Chủng loại</th><th class="num">Tổng tiền</th><th>Phản hồi KH</th><th>Công nợ</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="6" class="empty-state">Chưa có đợt hao hụt nào</td></tr>'}</tbody>
        </table>
      </div></div>`;

    list.querySelectorAll('[data-open-hh]').forEach(tr => {
      tr.addEventListener('click', () => openDetailModal(statements.find(s => s.id === tr.dataset.openHh)));
    });
  }

  function openDetailModal(h) {
    const bodyHtml = `
      <table>
        <tr><td>${esc(catName(h.category_id))} — ${h.qty} ${esc(catUnit(h.category_id))} — thương lượng ${h.negotiated_pct}% đơn giá tham chiếu (${fmtVND(h.ref_price)})</td><td class="num">${fmtVND(h.amount)}</td></tr>
        <tr><td>VAT (${h.vat_rate}%)</td><td class="num">${fmtVND(h.vat_amount)}</td></tr>
        <tr style="font-weight:600;"><td>Tổng</td><td class="num">${fmtVND(h.total)}</td></tr>
      </table>
      ${h.note ? `<div class="note-box">Ghi chú: ${esc(h.note)}</div>` : ''}
      <div style="font-size:.82rem; color:var(--ink-soft); margin-top:12px; line-height:1.8;">
        Hạn phản hồi: ${fmtDate(h.response_deadline)}<br>
        Phản hồi khách hàng: <span class="badge ${statusBadgeClass(h.customer_response_status)}">${statusLabel(h.customer_response_status)}</span><br>
        Công nợ: ${h.cong_no_status.replace('_', ' ')}
      </div>
    `;
    openModal({ title: `${projName(h.project_id)} — Đợt ${h.dot_number}`, bodyHtml, footerHtml: '' });
  }

  container.querySelector('#btnNew').addEventListener('click', () => {
    const f = container.querySelector('#newForm');
    f.style.display = f.style.display === 'none' ? 'block' : 'none';
  });

  container.querySelector('#fSubmit').addEventListener('click', async () => {
    const project_id = container.querySelector('#fProject').value;
    const category_id = container.querySelector('#fCategory').value;
    const qty = parseFloat(container.querySelector('#fQty').value) || 1;
    const pct = parseFloat(container.querySelector('#fPct').value) || 0;
    const note = container.querySelector('#fNote').value || null;

    const cat = categories.find(c => c.id === category_id);
    const refPrice = cat.ref_value;
    const amount = qty * refPrice * (pct / 100);
    const vatRate = 10;
    const vatAmount = amount * (vatRate / 100);
    const total = amount + vatAmount;

    const { count } = await supabase.from('hao_hut_statements')
      .select('id', { count: 'exact', head: true }).eq('project_id', project_id);
    const dotNumber = (count ?? 0) + 1;

    const deadline = new Date(); deadline.setDate(deadline.getDate() + 5);

    const { error } = await supabase.from('hao_hut_statements').insert({
      project_id, dot_number: dotNumber, category_id, qty,
      ref_price: refPrice, negotiated_pct: pct, amount,
      vat_rate: vatRate, vat_amount: vatAmount, total, note,
      response_deadline: deadline.toISOString().slice(0, 10),
      created_by: profile.id,
    });
    if (error) { alert('Lỗi lập đợt hao hụt: ' + error.message); return; }

    container.querySelector('#newForm').style.display = 'none';
    loadList();
  });

  await loadList();
}
