// js/modules/kehoach.js
// "Kế hoạch tổng" mở trước (cho BGD), sắp theo Nhóm A-E. Tab "Cập nhật kế hoạch"
// dành cho Sale: chọn 1 dự án -> bảng lưới kiểu Excel, hiện ĐỦ mọi chủng loại
// (không chỉ cái đang có), có cột "Tổng dự án cần" (Sale hỏi công trình rồi
// điền vào) để biết đã cấp được bao nhiêu %, rồi mới lên kế hoạch nhập thêm/trả
// bớt theo từng mốc "Tháng X - 2 tuần đầu/sau".
import { supabase } from '../core/config.js';
import { fmtNum, todayStr, esc } from '../core/utils.js';
import { openModal, closeModal } from '../core/modal.js';

function isoDate(d) { return d.toISOString().slice(0, 10); }

// 3 tháng tới, mỗi tháng chia 2 nửa (1-15 và 16-cuối tháng) — nhãn theo tháng
// cho dễ hình dung hơn số tuần ISO.
function monthHalfBuckets(numMonths = 3) {
  const today = new Date();
  const buckets = [];
  for (let m = 0; m < numMonths; m++) {
    const base = new Date(today.getFullYear(), today.getMonth() + m, 1);
    const year = base.getFullYear(), month = base.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    buckets.push({ start: isoDate(new Date(year, month, 1)), end: isoDate(new Date(year, month, 15)), label: `Tháng ${month + 1} — 2 tuần đầu` });
    buckets.push({ start: isoDate(new Date(year, month, 16)), end: isoDate(new Date(year, month, daysInMonth)), label: `Tháng ${month + 1} — 2 tuần sau` });
  }
  return buckets;
}

export async function render(container, profile, isStale = () => false) {
  container.innerHTML = `
    <div class="page-head">
      <div><h1>Kế hoạch</h1><div class="sub">Kế hoạch trả/nhập theo từng dự án — Sale trao đổi với công trình, cập nhật bất cứ lúc nào</div></div>
    </div>
    <div class="toolbar" style="border-bottom:1px solid var(--line); padding-bottom:14px;">
      <button class="btn small" id="subTongHop">Kế hoạch tổng (3 tháng tới)</button>
      <button class="btn secondary small" id="subCapNhat">Cập nhật kế hoạch</button>
    </div>
    <div id="sub-tonghop"></div>
    <div id="sub-capnhat" style="display:none;"></div>
  `;

  const today = todayStr();
  const buckets = monthHalfBuckets(3);
  const horizonEnd = buckets[buckets.length - 1].end;

  const [{ data: cats }, { data: groups }, { data: projects }, { data: summaryRows }, { data: arrivals }, { data: departures }, { data: forecastRows }, { data: needRows }] = await Promise.all([
    supabase.from('categories').select('*').order('group_id').order('sort_order'),
    supabase.from('groups').select('*').order('id'),
    supabase.from('projects').select('*, partners(name)').eq('status', 'active').order('name'),
    supabase.from('asset_summary').select('*'),
    supabase.from('transfer_notes').select('to_location_id, transfer_note_items(category_id, sl_xuat, sl_thuc_nhan)')
      .eq('to_location_type', 'du_an').eq('status', 'chinh_thuc').lte('ngay_ky', today),
    supabase.from('transfer_notes').select('from_location_id, transfer_note_items(category_id, sl_xuat, sl_thuc_nhan)')
      .eq('from_location_type', 'du_an').eq('status', 'chinh_thuc').lte('ngay_ky', today),
    supabase.from('equipment_forecasts').select('*'),
    supabase.from('project_equipment_needs').select('*'),
  ]);
  if (isStale()) return;
  const catList = cats ?? [], groupList = groups ?? [], projList = projects ?? [];
  let forecasts = forecastRows ?? [];
  let needs = needRows ?? [];

  const catById = (id) => catList.find(c => c.id === id);
  const projById = (id) => projList.find(p => p.id === id);

  const deployed = {};
  function addQty(projectId, categoryId, delta) {
    (deployed[projectId] ??= {})[categoryId] = (deployed[projectId]?.[categoryId] ?? 0) + delta;
  }
  (arrivals ?? []).forEach(n => n.transfer_note_items.forEach(it => addQty(n.to_location_id, it.category_id, Number(it.sl_thuc_nhan ?? it.sl_xuat))));
  (departures ?? []).forEach(n => n.transfer_note_items.forEach(it => addQty(n.from_location_id, it.category_id, -Number(it.sl_thuc_nhan ?? it.sl_xuat))));

  const khoQtyByCategory = (categoryId) => (summaryRows ?? [])
    .filter(r => r.category_id === categoryId && r.status === 'kho').reduce((s, r) => s + r.qty, 0);

  function forecastsFor(projectId, categoryId, planType) {
    return forecasts.filter(f => f.project_id === projectId && f.category_id === categoryId && f.plan_type === planType);
  }
  function bucketSum(projectId, categoryId, planType, bucket) {
    return forecastsFor(projectId, categoryId, planType)
      .filter(f => f.expected_date >= bucket.start && f.expected_date <= bucket.end)
      .reduce((s, f) => s + Number(f.qty), 0);
  }
  function needFor(projectId, categoryId) {
    return needs.find(n => n.project_id === projectId && n.category_id === categoryId);
  }

  // ================= TAB "KẾ HOẠCH TỔNG" — sắp theo Nhóm A-E =================
  function renderTongHopTab() {
    const el = container.querySelector('#sub-tonghop');

    const byCategory = {};
    forecasts.filter(f => f.expected_date <= horizonEnd).forEach(f => {
      (byCategory[f.category_id] ??= { cols: Array(buckets.length).fill(0) });
      const idx = buckets.findIndex(b => f.expected_date >= b.start && f.expected_date <= b.end);
      if (idx < 0) return;
      byCategory[f.category_id].cols[idx] += f.plan_type === 'tra' ? Number(f.qty) : -Number(f.qty);
    });

    const byGroup = {};
    catList.filter(c => byCategory[c.id]).forEach(c => {
      const kho = khoQtyByCategory(c.id);
      let running = kho;
      const ends = byCategory[c.id].cols.map(delta => { running += delta; return running; });
      const thieu = ends.some(v => v < 0);
      (byGroup[c.group_id] ??= []).push({ c, kho, deltas: byCategory[c.id].cols, ends, thieu });
    });
    Object.values(byGroup).forEach(list => list.sort((a, b) => a.c.sort_order - b.c.sort_order));

    let bodyHtml = '';
    let thieuCount = 0;
    groupList.filter(g => byGroup[g.id]).forEach(g => {
      bodyHtml += `<tr style="background:var(--gray-tint); font-weight:700;"><td colspan="${3 + buckets.length * 2 + 1}">NHÓM ${g.id} — ${esc(g.name).toUpperCase()}</td></tr>`;
      byGroup[g.id].forEach(r => {
        if (r.thieu) thieuCount++;
        bodyHtml += `<tr${r.thieu ? ' style="background:var(--red-tint);"' : ''}>
          <td>${esc(r.c.name)}</td><td>${esc(r.c.unit)}</td>
          <td class="num">${fmtNum(r.kho)}</td>
          ${r.deltas.map((d, i) => `
            <td class="num" style="${d < 0 ? 'color:var(--red-dark);' : d > 0 ? 'color:var(--green);' : ''}">${d !== 0 ? (d > 0 ? '+' : '') + fmtNum(d) : '—'}</td>
            <td class="num" style="${r.ends[i] < 0 ? 'color:var(--red-dark); font-weight:700;' : ''}">${fmtNum(r.ends[i])}</td>
          `).join('')}
          <td>${r.thieu ? '<span class="badge tre">Không đủ</span>' : '<span class="badge chinh">Ổn</span>'}</td>
        </tr>`;
      });
    });

    el.innerHTML = `
      ${thieuCount > 0
        ? `<div class="error-box">Có <b>${thieuCount}</b> chủng loại dự kiến KHÔNG ĐỦ hàng trong 3 tháng tới — cần chuẩn bị đầu tư thêm hoặc thúc đẩy thu hồi gấp từ các dự án đang giữ.</div>`
        : `<div class="note-box">Chưa có chủng loại nào cảnh báo thiếu trong 3 tháng tới, theo các kế hoạch đã khai báo hiện có.</div>`}
      <div class="panel"><div class="panel-body" style="padding:0; overflow-x:auto;">
        <table>
          <thead><tr>
            <th>Chủng loại</th><th>ĐVT</th><th class="num">Tồn kho hiện tại</th>
            ${buckets.map(b => `<th class="num">${esc(b.label)}<br>Trả (+) / Nhập (-)</th><th class="num">Tồn dự báo</th>`).join('')}
            <th>Tình trạng</th>
          </tr></thead>
          <tbody>${bodyHtml || `<tr><td colspan="${3 + buckets.length * 2 + 1}" class="empty-state">Chưa có kế hoạch nào được khai báo</td></tr>`}</tbody>
        </table>
      </div></div>
      <div class="note-box">Tồn kho hiện tại lấy từ tài sản đang có sẵn tại kho. "Trả (+)" làm tăng tồn kho dự báo, "Nhập (-)" (dự án nhận thêm) làm giảm — cả 2 do Sale khai báo ở tab "Cập nhật kế hoạch".</div>
    `;
  }

  function renderCapNhatTab() { renderProjectList(); }

  function renderProjectList() {
    const el = container.querySelector('#sub-capnhat');

    const projectStats = projList.map(p => {
      const catsWithNeed = catList.filter(c => (needFor(p.id, c.id)?.total_needed_qty ?? 0) > 0 || (deployed[p.id]?.[c.id] ?? 0) > 0);
      const missing = catsWithNeed.filter(c => forecastsFor(p.id, c.id, 'tra').length === 0 && (deployed[p.id]?.[c.id] ?? 0) > 0).length;
      return { p, totalCats: catsWithNeed.length, missing };
    });

    el.innerHTML = `
      <div class="toolbar"><input type="text" id="plProjectFilter" placeholder="Lọc theo tên dự án..."></div>
      <div class="panel"><div class="panel-body" style="padding:0">
        <table id="plTable">
          <thead><tr><th>Dự án</th><th>Khách hàng</th><th class="num">Số hạng mục đang theo dõi</th><th>Kế hoạch trả</th></tr></thead>
          <tbody></tbody>
        </table>
      </div></div>
    `;

    function draw() {
      const text = el.querySelector('#plProjectFilter').value.trim().toLowerCase();
      const filtered = projectStats.filter(s => !text || s.p.name.toLowerCase().includes(text));
      el.querySelector('#plTable tbody').innerHTML = filtered.map(s => `<tr data-open-project="${s.p.id}" style="cursor:pointer;">
        <td><b style="color:var(--red-dark);">${esc(s.p.name)}</b></td>
        <td>${esc(s.p.partners?.name ?? '')}</td>
        <td class="num">${s.totalCats}</td>
        <td>${s.missing > 0 ? `<span class="badge tre">Thiếu ${s.missing} hạng mục chưa có kế hoạch</span>` : '<span class="badge chinh">Đầy đủ</span>'}</td>
      </tr>`).join('') || '<tr><td colspan="4" class="empty-state">Không có dự án nào khớp</td></tr>';

      el.querySelectorAll('[data-open-project]').forEach(tr =>
        tr.addEventListener('click', () => renderProjectGrid(tr.dataset.openProject)));
    }
    el.querySelector('#plProjectFilter').addEventListener('input', draw);
    draw();
  }

  function renderProjectGrid(projectId) {
    const el = container.querySelector('#sub-capnhat');
    const proj = projById(projectId);

    // Hiện ĐỦ mọi chủng loại trong hệ thống — không chỉ cái đang có tại dự án —
    // vì dự án có thể cần thêm loại chưa từng cấp.
    const byGroup = {};
    catList.forEach(cat => { (byGroup[cat.group_id] ??= []).push(cat); });
    Object.values(byGroup).forEach(list => list.sort((a, b) => a.sort_order - b.sort_order));

    function buildGrid() {
      let stt = 0;
      let bodyHtml = '';
      groupList.filter(g => byGroup[g.id]).forEach(g => {
        bodyHtml += `<tr style="background:var(--gray-tint); font-weight:700;"><td colspan="${5 + buckets.length * 2}">NHÓM ${g.id} — ${esc(g.name).toUpperCase()}</td></tr>`;
        byGroup[g.id].forEach(cat => {
          stt++;
          const qty = deployed[projectId]?.[cat.id] ?? 0;
          const need = needFor(projectId, cat.id)?.total_needed_qty ?? 0;
          const pct = need > 0 ? Math.round((qty / need) * 100) : null;

          const nhapCells = buckets.map(b => {
            const v = bucketSum(projectId, cat.id, 'nhap', b);
            return `<td><input type="number" class="grid-cell" data-project="${projectId}" data-category="${cat.id}" data-plantype="nhap" data-bstart="${b.start}" data-bend="${b.end}" value="${v || ''}" style="width:64px; padding:4px;"></td>`;
          }).join('');
          const traCells = buckets.map(b => {
            const v = bucketSum(projectId, cat.id, 'tra', b);
            return `<td><input type="number" class="grid-cell" data-project="${projectId}" data-category="${cat.id}" data-plantype="tra" data-bstart="${b.start}" data-bend="${b.end}" value="${v || ''}" style="width:64px; padding:4px;"></td>`;
          }).join('');

          bodyHtml += `<tr>
            <td>${stt}</td>
            <td>${esc(cat.name)} <button class="btn secondary small" data-quick-nhap="${cat.id}" style="margin-left:4px;">⚡Chia đều nhập</button><button class="btn secondary small" data-quick-tra="${cat.id}" style="margin-left:2px;">⚡Chia đều trả</button></td>
            <td><input type="number" class="need-cell" data-project="${projectId}" data-category="${cat.id}" value="${need || ''}" placeholder="—" style="width:80px; padding:4px;"></td>
            <td class="num">${fmtNum(qty)} ${esc(cat.unit)}</td>
            <td class="num">${pct === null ? '—' : `<span style="${pct < 100 ? 'color:var(--red-dark);' : 'color:var(--green);'} font-weight:600;">${pct}%</span>`}</td>
            ${nhapCells}${traCells}
          </tr>`;
        });
      });
      return bodyHtml;
    }

    el.innerHTML = `
      <button class="btn secondary small" id="backToList" style="margin-bottom:12px;">← Quay lại danh sách dự án</button>
      <h2 style="margin-bottom:4px;">${esc(proj?.name ?? '')}</h2>
      <div class="sub" style="margin-bottom:14px;">${esc(proj?.partners?.name ?? '')} · Điền "Tổng dự án cần" trước để biết đã cấp bao nhiêu %, rồi lên kế hoạch nhập/trả cho phần còn thiếu hoặc dư</div>
      <div class="panel"><div class="panel-body" style="padding:0; overflow-x:auto;">
        <table>
          <thead>
            <tr>
              <th rowspan="2">STT</th><th rowspan="2">Hạng mục</th>
              <th rowspan="2">Tổng dự án cần</th><th rowspan="2">Tồn tại dự án</th><th rowspan="2">Đã cấp</th>
              <th colspan="${buckets.length}" style="text-align:center;">KẾ HOẠCH NHẬP THÊM</th>
              <th colspan="${buckets.length}" style="text-align:center;">KẾ HOẠCH TRẢ VỀ</th>
            </tr>
            <tr>${buckets.map(b => `<th class="num" style="font-size:.66rem;">${esc(b.label)}</th>`).join('')}${buckets.map(b => `<th class="num" style="font-size:.66rem;">${esc(b.label)}</th>`).join('')}</tr>
          </thead>
          <tbody>${buildGrid()}</tbody>
        </table>
      </div></div>
    `;

    el.querySelector('#backToList').addEventListener('click', renderProjectList);

    el.querySelectorAll('.need-cell').forEach(input => {
      input.addEventListener('change', async () => {
        const { project, category } = input.dataset;
        const total_needed_qty = parseFloat(input.value) || 0;
        const existing = needFor(project, category);
        if (existing) {
          await supabase.from('project_equipment_needs').update({ total_needed_qty, updated_by: profile.id, updated_at: new Date().toISOString() }).eq('id', existing.id);
          existing.total_needed_qty = total_needed_qty;
        } else {
          const { data: newRow, error } = await supabase.from('project_equipment_needs').insert({
            project_id: project, category_id: category, total_needed_qty, updated_by: profile.id,
          }).select().single();
          if (!error) needs.push(newRow);
        }
        el.innerHTML = ''; // buộc vẽ lại để cập nhật % đã cấp
        renderProjectGrid(projectId);
      });
    });

    async function saveCell(input) {
      const { project, category, plantype, bstart, bend } = input.dataset;
      const qty = parseFloat(input.value);

      const toDelete = forecastsFor(project, category, plantype).filter(f => f.expected_date >= bstart && f.expected_date <= bend);
      if (toDelete.length) {
        await supabase.from('equipment_forecasts').delete().in('id', toDelete.map(f => f.id));
        forecasts = forecasts.filter(f => !toDelete.some(d => d.id === f.id));
      }
      if (!isNaN(qty) && qty > 0) {
        const { data: newRow, error } = await supabase.from('equipment_forecasts').insert({
          project_id: project, category_id: category, plan_type: plantype, qty, expected_date: bstart,
          created_by: profile.id, updated_by: profile.id,
        }).select().single();
        if (error) { alert('Lỗi lưu: ' + error.message); return; }
        forecasts.push(newRow);
      }
    }
    el.querySelectorAll('.grid-cell').forEach(input => input.addEventListener('change', () => saveCell(input)));

    function openQuickFillModal(categoryId, planType) {
      const cat = catById(categoryId);
      const bodyHtml = `
        <div class="field"><label>Tổng số lượng</label><input type="number" id="qfTotal" placeholder="VD: 5000"></div>
        <div class="field-row">
          <div class="field"><label>Từ ngày</label><input type="date" id="qfFrom" value="${todayStr()}"></div>
          <div class="field"><label>Đến ngày</label><input type="date" id="qfTo" value="${horizonEnd}"></div>
        </div>
        <div class="note-box">Số lượng sẽ được chia đều vào các mốc nằm trong khoảng ngày này (đè lên số đang có sẵn) — sau khi chia xong vẫn sửa tay từng ô lại được nếu không muốn chia đều tăm tắp.</div>
        <div id="qfError" class="error-box" style="display:none;"></div>
      `;
      const footerHtml = `<button class="btn secondary" id="qfCancel">Hủy</button><button class="btn" id="qfSubmit">Chia đều</button>`;
      const dialog = openModal({ title: `Chia đều — ${cat?.name ?? ''} (${planType === 'tra' ? 'Trả về' : 'Nhập thêm'})`, bodyHtml, footerHtml });

      dialog.querySelector('#qfCancel').addEventListener('click', closeModal);
      dialog.querySelector('#qfSubmit').addEventListener('click', async () => {
        const total = parseFloat(dialog.querySelector('#qfTotal').value);
        const from = dialog.querySelector('#qfFrom').value;
        const to = dialog.querySelector('#qfTo').value;
        const errBox = dialog.querySelector('#qfError');
        errBox.style.display = 'none';

        if (isNaN(total) || total <= 0) { errBox.textContent = 'Nhập tổng số lượng lớn hơn 0.'; errBox.style.display = 'block'; return; }
        const coveredBuckets = buckets.filter(b => b.start <= to && b.end >= from);
        if (coveredBuckets.length === 0) { errBox.textContent = 'Khoảng ngày này không rơi vào mốc nào — kiểm tra lại Từ ngày/Đến ngày.'; errBox.style.display = 'block'; return; }

        const per = Math.round(total / coveredBuckets.length);
        let remaining = total;
        for (let i = 0; i < coveredBuckets.length; i++) {
          const b = coveredBuckets[i];
          const qty = i === coveredBuckets.length - 1 ? remaining : per;
          remaining -= qty;

          const toDelete = forecastsFor(projectId, categoryId, planType).filter(f => f.expected_date >= b.start && f.expected_date <= b.end);
          if (toDelete.length) {
            await supabase.from('equipment_forecasts').delete().in('id', toDelete.map(f => f.id));
            forecasts = forecasts.filter(f => !toDelete.some(d => d.id === f.id));
          }
          if (qty > 0) {
            const { data: newRow, error } = await supabase.from('equipment_forecasts').insert({
              project_id: projectId, category_id: categoryId, plan_type: planType, qty, expected_date: b.start,
              created_by: profile.id, updated_by: profile.id,
            }).select().single();
            if (error) { errBox.textContent = 'Lỗi lưu: ' + error.message; errBox.style.display = 'block'; return; }
            forecasts.push(newRow);
          }
        }
        closeModal();
        renderProjectGrid(projectId);
      });
    }

    el.querySelectorAll('[data-quick-nhap]').forEach(btn => btn.addEventListener('click', () => openQuickFillModal(btn.dataset.quickNhap, 'nhap')));
    el.querySelectorAll('[data-quick-tra]').forEach(btn => btn.addEventListener('click', () => openQuickFillModal(btn.dataset.quickTra, 'tra')));
  }

  container.querySelector('#subTongHop').addEventListener('click', () => {
    container.querySelector('#sub-tonghop').style.display = 'block';
    container.querySelector('#sub-capnhat').style.display = 'none';
    renderTongHopTab();
  });
  container.querySelector('#subCapNhat').addEventListener('click', () => {
    container.querySelector('#sub-tonghop').style.display = 'none';
    container.querySelector('#sub-capnhat').style.display = 'block';
    renderCapNhatTab();
  });

  renderTongHopTab();
}
