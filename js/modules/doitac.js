// js/modules/doitac.js
import { supabase } from '../core/config.js';
import { fmtDate, fmtVND } from '../core/utils.js';

export async function render(container) {
  container.innerHTML = `
    <div class="page-head">
      <div><h1>Đối tác</h1><div class="sub">Khách hàng, dự án, và đơn giá theo cấu trúc 3 lớp</div></div>
    </div>
    <div id="partnerList" class="loading">Đang tải...</div>
  `;

  const { data: partners, error } = await supabase.from('partners').select('*').order('name');
  if (error) { container.querySelector('#partnerList').innerHTML = `<div class="error-box">${error.message}</div>`; return; }

  const { data: projects } = await supabase.from('projects').select('*').order('name');
  const { data: categories } = await supabase.from('categories').select('*').order('name');

  let expanded = {};

  async function getRateTable(partner, project) {
    const rows = [];
    for (const cat of categories) {
      let rate = null, isOverride = false;
      if (project) {
        const { data: override } = await supabase.from('project_rate_overrides')
          .select('daily_rate').eq('project_id', project.id).eq('category_id', cat.id)
          .lte('effective_from', new Date().toISOString().slice(0, 10))
          .order('effective_from', { ascending: false }).limit(1).maybeSingle();
        if (override) { rate = override.daily_rate; isOverride = true; }
      }
      if (rate === null) {
        const { data: base } = await supabase.from('partner_rates')
          .select('daily_rate').eq('partner_id', partner.id).eq('category_id', cat.id)
          .lte('effective_from', new Date().toISOString().slice(0, 10))
          .order('effective_from', { ascending: false }).limit(1).maybeSingle();
        rate = base?.daily_rate ?? null;
      }
      rows.push({ name: cat.name, unit: cat.unit, rate, isOverride });
    }
    return rows;
  }

  container.querySelector('#partnerList').innerHTML = partners.map(p => {
    const projs = projects.filter(pr => pr.partner_id === p.id);
    return `
    <div class="panel" style="margin-bottom:12px;" data-partner="${p.id}">
      <div class="panel-body">
        <h3 style="color:var(--red-dark); font-size:1.1rem;">${p.name}</h3>
        <div style="font-size:.8rem; color:var(--ink-soft); margin:6px 0 10px; line-height:1.7;">
          Địa chỉ: ${p.address ?? '—'}<br>MST: ${p.mst ?? '—'}<br>
          Hợp đồng: ${p.hop_dong_so ?? '—'} ${p.hop_dong_ngay ? '— ký ngày ' + fmtDate(p.hop_dong_ngay) : ''}<br>
          Kỳ chốt bill: ngày ${p.billing_cutoff_day} hằng tháng
        </div>
        <div class="chips">
          <span class="badge tam" style="cursor:pointer;" data-price="${p.id}:default">📋 Bảng giá mặc định</span>
          ${projs.map(pr => `<span class="badge tam" style="cursor:pointer; margin-left:6px;" data-price="${p.id}:${pr.id}">${pr.name}</span>`).join('')}
        </div>
        <div id="price-${p.id}"></div>
      </div>
    </div>`;
  }).join('') || '<div class="empty-state">Chưa có đối tác nào — thêm qua Supabase Table Editor.</div>';

  container.querySelectorAll('[data-price]').forEach(chip => {
    chip.addEventListener('click', async () => {
      const [partnerId, key] = chip.dataset.price.split(':');
      expanded[partnerId] = expanded[partnerId] === key ? null : key;
      const area = container.querySelector(`#price-${partnerId}`);
      if (!expanded[partnerId]) { area.innerHTML = ''; return; }
      area.innerHTML = '<div class="loading">Đang tải bảng giá...</div>';

      const partner = partners.find(x => x.id === partnerId);
      const project = key === 'default' ? null : projects.find(x => x.id === key);
      const rows = await getRateTable(partner, project);

      area.innerHTML = `<table style="margin-top:10px;">
        <thead><tr><th>Chủng loại</th><th>ĐVT</th><th class="num">Đơn giá/ngày</th></tr></thead>
        <tbody>${rows.map(r => `<tr><td>${r.name}</td><td>${r.unit}</td>
          <td class="num" style="${r.isOverride ? 'color:var(--red-dark);font-weight:600;' : ''}">${r.rate != null ? fmtVND(r.rate) + (r.isOverride ? ' *' : '') : '— chưa có giá —'}</td></tr>`).join('')}</tbody>
      </table>
      ${rows.some(r => r.isOverride) ? '<div class="note-box" style="margin-top:8px;">* Đơn giá riêng cho dự án này, khác giá khung mặc định.</div>' : ''}`;
    });
  });
}
