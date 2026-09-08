// js/modules/haohut.js
import { supabase } from '../core/config.js';
import { fmtVND, fmtDate } from '../core/utils.js';

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

  const { data: c } = await supabase.from('categories').select('*').order('name');
  const { data: p } = await supabase.from('projects').select('*').eq('status', 'active').order('name');
  if (isStale()) return;
  const categories = c ?? [], projects = p ?? [];

  container.querySelector('#fProject').innerHTML = projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  container.querySelector('#fCategory').innerHTML = categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

  const catName = (id) => categories.find(c => c.id === id)?.name ?? '(?)';
  const projName = (id) => projects.find(p => p.id === id)?.name ?? '(?)';

  async function loadList() {
    const { data, error } = await supabase.from('hao_hut_statements').select('*').order('created_at', { ascending: false });
    if (isStale()) return;
    const list = container.querySelector('#list');
    if (error) { list.innerHTML = `<div class="error-box">${error.message}</div>`; return; }

    list.innerHTML = (data ?? []).map(h => {
      const statusBadge = h.customer_response_status === 'dong_y' ? '<span class="badge chinh">Đồng ý</span>'
        : h.customer_response_status === 'tranh_chap' ? '<span class="badge tre">Tranh chấp — chuyển BGD</span>'
        : '<span class="badge tam">Chờ phản hồi</span>';
      return `<div class="panel" style="margin-bottom:12px;">
        <div class="panel-head"><h3>${projName(h.project_id)} — Đợt ${h.dot_number}</h3>${statusBadge}</div>
        <div class="panel-body">
          <table>
            <tr><td>${catName(h.category_id)} — ${h.qty} — thương lượng ${h.negotiated_pct}% đơn giá tham chiếu</td><td class="num">${fmtVND(h.amount)}</td></tr>
            <tr><td>VAT (${h.vat_rate}%)</td><td class="num">${fmtVND(h.vat_amount)}</td></tr>
            <tr style="font-weight:600;"><td>Tổng</td><td class="num">${fmtVND(h.total)}</td></tr>
          </table>
          ${h.note ? `<div class="note-box" style="margin-top:10px;">Ghi chú: ${h.note}</div>` : ''}
          <div style="font-size:.78rem; color:var(--ink-soft); margin-top:8px;">
            Hạn phản hồi: ${fmtDate(h.response_deadline)} · Công nợ: ${h.cong_no_status.replace('_', ' ')}
          </div>
        </div>
      </div>`;
    }).join('') || '<div class="empty-state">Chưa có đợt hao hụt nào</div>';
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
