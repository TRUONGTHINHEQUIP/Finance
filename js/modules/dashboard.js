// js/modules/dashboard.js
import { supabase } from '../core/config.js';
import { fmtNum, fmtVND, todayStr, esc } from '../core/utils.js';

export async function render(container, profile, isStale = () => false) {
  container.innerHTML = `
    <div class="page-head">
      <div><h1>Tổng quan</h1><div class="sub">Bức tranh nhanh về quy mô tài sản công ty đang có</div></div>
    </div>
    <div class="loading">Đang tải...</div>
  `;

  const today = todayStr();
  const [{ data: cats }, { data: summaryRows }, { data: arrivals }, { data: departures }] = await Promise.all([
    supabase.from('categories').select('*'),
    supabase.from('asset_summary').select('*'),
    supabase.from('transfer_notes').select('transfer_note_items(category_id, sl_xuat, sl_thuc_nhan)')
      .eq('to_location_type', 'du_an').eq('status', 'chinh_thuc').lte('ngay_ky', today),
    supabase.from('transfer_notes').select('transfer_note_items(category_id, sl_xuat, sl_thuc_nhan)')
      .eq('from_location_type', 'du_an').eq('status', 'chinh_thuc').lte('ngay_ky', today),
  ]);
  if (isStale()) return;
  const catList = cats ?? [];

  const deployedByCategory = {};
  (arrivals ?? []).forEach(n => n.transfer_note_items.forEach(it => {
    deployedByCategory[it.category_id] = (deployedByCategory[it.category_id] ?? 0) + Number(it.sl_thuc_nhan ?? it.sl_xuat);
  }));
  (departures ?? []).forEach(n => n.transfer_note_items.forEach(it => {
    deployedByCategory[it.category_id] = (deployedByCategory[it.category_id] ?? 0) - Number(it.sl_thuc_nhan ?? it.sl_xuat);
  }));

  const khoQtyByCategory = (categoryId) => (summaryRows ?? [])
    .filter(r => r.category_id === categoryId && r.status === 'kho').reduce((s, r) => s + r.qty, 0);

  let totalKhoValue = 0, totalDeployedValue = 0;
  const perCategory = catList.map(c => {
    const khoQty = khoQtyByCategory(c.id);
    const deployedQty = Math.max(deployedByCategory[c.id] ?? 0, 0);
    const khoValue = khoQty * (c.ref_value ?? 0);
    const deployedValue = deployedQty * (c.ref_value ?? 0);
    totalKhoValue += khoValue;
    totalDeployedValue += deployedValue;
    return { cat: c, khoQty, deployedQty, khoValue, deployedValue };
  });

  const grandTotal = totalKhoValue + totalDeployedValue;
  const khoPct = grandTotal > 0 ? Math.round((totalKhoValue / grandTotal) * 100) : 0;
  const deployedPct = 100 - khoPct;

  const top5Deployed = perCategory
    .filter(r => r.deployedValue > 0)
    .sort((a, b) => b.deployedValue - a.deployedValue)
    .slice(0, 5);

  container.querySelector('.page-head').insertAdjacentHTML('afterend', `
    <div class="stat-row" style="grid-template-columns:1.4fr 1fr; align-items:stretch;">
      <div class="stat-card" style="display:flex; flex-direction:column; justify-content:center;">
        <div class="lbl">Tổng giá trị tài sản sở hữu (tại kho + tại dự án)</div>
        <div class="val" style="font-size:2.1rem;">${fmtVND(grandTotal)}</div>
        <div style="margin-top:10px; font-size:.82rem; color:var(--ink-soft);">
          Tại kho: <b style="color:var(--ink);">${fmtVND(totalKhoValue)}</b> &nbsp;·&nbsp;
          Đang tại dự án: <b style="color:var(--ink);">${fmtVND(totalDeployedValue)}</b>
        </div>
      </div>
      <div class="stat-card" style="display:flex; align-items:center; gap:18px;">
        <div style="width:120px; height:120px; border-radius:50%; flex-shrink:0;
             background:conic-gradient(var(--red) 0% ${deployedPct}%, var(--gray-tint) ${deployedPct}% 100%);"></div>
        <div style="font-size:.85rem;">
          <div style="margin-bottom:8px;"><span style="display:inline-block; width:10px; height:10px; background:var(--red); border-radius:2px; margin-right:6px;"></span>Đang cho thuê: <b>${deployedPct}%</b></div>
          <div><span style="display:inline-block; width:10px; height:10px; background:var(--gray-tint); border:1px solid var(--line); border-radius:2px; margin-right:6px;"></span>Tại kho: <b>${khoPct}%</b></div>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>Top 5 chủng loại giá trị lớn nhất đang nằm ngoài công trình</h3></div>
      <div class="panel-body" style="padding:0">
        <table>
          <thead><tr><th>Chủng loại</th><th>ĐVT</th><th class="num">Số lượng đang tại dự án</th><th class="num">Giá trị</th></tr></thead>
          <tbody>${top5Deployed.map(r => `<tr>
            <td><b style="color:var(--red-dark);">${esc(r.cat.name)}</b></td>
            <td>${esc(r.cat.unit)}</td>
            <td class="num">${fmtNum(r.deployedQty)}</td>
            <td class="num">${fmtVND(r.deployedValue)}</td>
          </tr>`).join('') || '<tr><td colspan="4" class="empty-state">Chưa có tài sản nào đang tại dự án</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `);
  container.querySelector('.loading')?.remove();
}
