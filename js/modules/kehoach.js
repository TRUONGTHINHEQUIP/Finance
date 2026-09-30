// js/modules/kehoach.js
// Mặc định mở "Kế hoạch tổng" trước (cho BGD xem ngay). Tab "Cập nhật kế hoạch"
// dành cho Sale: chọn 1 dự án -> hiện bảng lưới kiểu Excel, mỗi hàng 1 hạng mục
// (sắp theo Nhóm A-E), cột "Tồn tại dự án" + nhiều cột Nhập/Trả chia theo từng
// 2 tuần. Sale gõ thẳng số vào từng ô, hoặc dùng "Chia đều" khi công trình chỉ
// báo chung chung (VD "trả trong tháng 9") để tự rải đều vào các cột liên quan.
import { supabase } from '../core/config.js';
import { fmtNum, fmtDate, todayStr, esc } from '../core/utils.js';
import { openModal, closeModal } from '../core/modal.js';

function isoDate(d) { return d.toISOString().slice(0, 10); }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function isoWeekNumber(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}
function mondayOf(d) { const x = new Date(d); const day = x.getDay(); x.setDate(x.getDate() - ((day + 6) % 7)); x.setHours(0, 0, 0, 0); return x; }

function biweekBuckets(n = 6) {
  const startMonday = mondayOf(new Date());
  return Array.from({ length: n }, (_, i) => {
    const start = addDays(startMonday, i * 14);
    const end = addDays(start, 13);
    const w1 = isoWeekNumber(start), w2 = isoWeekNumber(end);
    return { start: isoDate(start), end: isoDate(end), label: `Tuần ${w1}-${w2}` };
  });
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
  const buckets = biweekBuckets(6);
  const horizonEnd = buckets[buckets.length - 1].end;

  const [{ data: cats }, { data: groups }, { data: projects }, { data: summaryRows }, { data: arrivals }, { data: departures }, { data: forecastRows }] = await Promise.all([
    supabase.from('categories').select('*').order('name'),
    supabase.from('groups').select('*').order('id'),
    supabase.from('projects').select('*, partners(name)').eq('status', 'active').order('name'),
    supabase.from('asset_summary').select('*'),
    supabase.from('transfer_notes').select('to_location_id, transfer_note_items(category_id, sl_xuat, sl_thuc_nhan)')
      .eq('to_location_type', 'du_an').eq('status', 'chinh_thuc').lte('ngay_ky', today),
    supabase.from('transfer_notes').select('from_location_id, transfer_note_items(category_id, sl_xuat, sl_thuc_nhan)')
      .eq('from_location_type', 'du_an').eq('status', 'chinh_thuc').lte('ngay_ky', today),
    supabase.from('equipment_forecasts').select('*'),
  ]);
  if (isStale()) return;
  const catList = cats ?? [], groupList = groups ?? [], projList = projects ?? [];
  let forecasts = forecastRows ?? [];

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

  function renderTongHopTab() {
    const el = container.querySelector('#sub-tonghop');

    const byCategory = {};
    forecasts.filter(f => f.expected_date <= horizonEnd).forEach(f => {
      (byCategory[f.category_id] ??= { cols: Array(buckets.length).fill(0) });
      const idx = buckets.findIndex(b => f.expected_date >= b.start && f.expected_date <= b.end);
      if (idx < 0) return;
      byCategory[f.category_id].cols[idx] += f.plan_type === 'tra' ? Number(f.qty) : -Number(f.qty);
    });

    const rows = catList
      .filter(c => byCategory[c.id])
      .map(c => {
        const kho = khoQtyByCategory(c.id);
        let running = kho;
        const ends = byCategory[c.id].cols.map(delta => { running += delta; return running; });
        const thieu = ends.some(v => v < 0);
        return { c, kho, deltas: byCategory[c.id].cols, ends, thieu };
      })
      .sort((a, b) => (a.thieu === b.thieu ? 0 : a.thieu ? -1 : 1));

    const rowsHtml = rows.map(r => `<tr${r.thieu ? ' style="background:var(--red-tint);"' : ''}>
      <td>${esc(r.c.name)}</td><td>${esc(r.c.unit)}</td>
      <td class="num">${fmtNum(r.kho)}</td>
      ${r.deltas.map((d, i) => `
        <td class="num" style="${d < 0 ? 'color:var(--red-dark);' : d > 0 ? 'color:var(--green);' : ''}">${d !== 0 ? (d > 0 ? '+' : '') + fmtNum(d) : '—'}</td>
        <td class="num" style="${r.ends[i] < 0 ? 'color:var(--red-dark); font-weight:700;' : ''}">${fmtNum(r.ends[i])}</td>
      `).join('')}
      <td>${r.thieu ? '<span class="badge tre">Không đủ</span>' : '<span class="badge chinh">Ổn</span>'}</td>
    </tr>`).join('');

    const thieuCount = rows.filter(r => r.thieu).length;

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
          <tbody>${rowsHtml || `<tr><td colspan="${3 + buckets.length * 2 + 1}" class="empty-state">Chưa có kế hoạch nào được khai báo</td></tr>`}</tbody>
        </table>
      </div></div>
      <div class="note-box">Tồn kho hiện tại lấy từ tài sản đang có sẵn tại kho. "Trả (+)" làm tăng tồn kho dự báo, "Nhập (-)" (dự án nhận thêm) làm giảm — cả 2 do Sale khai báo ở tab "Cập nhật kế hoạch".</div>
    `;
  }

  function renderCapNhatTab() { renderProjectList(); }

  function renderProjectList() {
    const el = container.querySelector('#sub-capnhat');

    const projectStats = projList.map(p => {
      const cats = Object.entries(deployed[p.id] ?? {}).filter(([, qty]) => qty > 0);
      const missing = cats.filter(([categoryId]) => forecastsFor(p.id, categoryId, 'tra').length === 0).length;
      return { p, totalCats: cats.length, missing };
    }).filter(s => s.totalCats > 0);

    el.innerHTML = `
      <div class="toolbar">
        <input type="text" id="plProjectFilter" placeholder="Lọc theo tên dự án...">
      </div>
      <div class="panel"><div class="panel-body" style="padding:0">
        <table id="plTable">
          <thead><tr><th>Dự án</th><th>Khách hàng</th><th class="num">Số hạng mục đang có</th><th>Kế hoạch trả</th></tr></thead>
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
    const catsInProject = Object.entries(deployed[projectId] ?? {}).filter(([, qty]) => qty > 0).map(([categoryId, qty]) => ({ cat: catById(categoryId), qty }));

    const byGroup = {};
    catsInProject.forEach(row => { (byGroup[row.cat?.group_id ?? '?'] ??= []).push(row); });
    Object.values(byGroup).forEach(list => list.sort((a, b) => a.cat.name.localeCompare(b.cat.name)));

    function buildGrid() {
      let stt = 0;
      let bodyHtml = '';
      groupList.filter(g => byGroup[g.id]).forEach(g => {
        bodyHtml += `<tr style="background:var(--gray-tint); font-weight:700;"><td colspan="${3 + buckets.length * 2}">NHÓM ${g.id} — ${esc(g.name).toUpperCase()}</td></tr>`;
        byGroup[g.id].forEach(({ cat, qty }) => {
          stt++;
          const nhapCells = buckets.map(b => {
            const v = bucketSum(projectId, cat.id, 'nhap', b);
            return `<td><input type="number" class="grid-cell" data-project="${projectId}" data-category="${cat.id}" data-plantype="nhap" data-bstart="${b.start}" data-bend="${b.end}" value="${v || ''}" style="width:70px; padding:4px;"></td>`;
          }).join('');
          const traCells = buckets.map(b => {
            const v = bucketSum(projectId, cat.id, 'tra', b);
            return `<td><input type="number" class="grid-cell" data-project="${projectId}" data-category="${cat.id}" data-plantype="tra" data-bstart="${b.start}" data-bend="${b.end}" value="${v || ''}" style="width:70px; padding:4px;"></td>`;
          }).join('');
          bodyHtml += `<tr>
            <td>${stt}</td>
            <td>${esc(cat.name)} <button class="btn secondary small" data-quick-nhap="${cat.id}" style="margin-left:4px;">⚡Chia đều nhập</button><button class="btn secondary small" data-quick-tra="${cat.id}" style="margin-left:2px;">⚡Chia đều trả</button></td>
            <td class="num">${fmtNum(qty)} ${esc(cat.unit)}</td>
            ${nhapCells}${traCells}
          </tr>`;
        });
      });
      return bodyHtml;
    }

    el.innerHTML = `
      <button class="btn secondary small" id="backToList" style="margin-bottom:12px;">← Quay lại danh sách dự án</button>
      <h2 style="margin-bottom:4px;">${esc(proj?.name ?? '')}</h2>
      <div class="sub" style="margin-bottom:14px;">${esc(proj?.partners?.name ?? '')} · Gõ trực tiếp số lượng vào từng ô, hoặc bấm "Chia đều" khi công trình chỉ báo mốc chung chung</div>
      <div class="panel"><div class="panel-body" style="padding:0; overflow-x:auto;">
        <table>
          <thead>
            <tr>
              <th rowspan="2">STT</th><th rowspan="2">Hạng mục</th><th rowspan="2">Tồn tại dự án</th>
              <th colspan="${buckets.length}" style="text-align:center;">KẾ HOẠCH NHẬP THÊM</th>
              <th colspan="${buckets.length}" style="text-align:center;">KẾ HOẠCH TRẢ VỀ</th>
            </tr>
            <tr>${buckets.map(b => `<th class="num" style="font-size:.68rem;">${esc(b.label)}</th>`).join('')}${buckets.map(b => `<th class="num" style="font-size:.68rem;">${esc(b.label)}</th>`).join('')}</tr>
          </thead>
          <tbody>${buildGrid()}</tbody>
        </table>
      </div></div>
    `;

    el.querySelector('#backToList').addEventListener('click', renderProjectList);

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

    el.querySelectorAll('.grid-cell').forEach(input => {
      input.addEventListener('change', () => saveCell(input));
    });

    function openQuickFillModal(categoryId, planType) {
      const cat = catById(categoryId);
      const bodyHtml = `
        <div class="field"><label>Tổng số lượng</label><input type="number" id="qfTotal" placeholder="VD: 5000"></div>
        <div class="field-row">
          <div class="field"><label>Từ ngày</label><input type="date" id="qfFrom" value="${todayStr()}"></div>
          <div class="field"><label>Đến ngày</label><input type="date" id="qfTo" value="${horizonEnd}"></div>
        </div>
        <div class="note-box">Số lượng sẽ được chia đều vào các cột 2-tuần nằm trong khoảng ngày này (đè lên số đang có sẵn ở các cột đó) — sau khi chia xong vẫn sửa tay từng ô lại được nếu không muốn chia đều tăm tắp.</div>
        <div id="qfError" class="error-box" style="display:none;"></div>
      `;
      const footerHtml = `<button class="btn secondary" id="qfCancel">Hủy</button><button class="btn" id="qfSubmit">Chia đều vào các cột</button>`;
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
        if (coveredBuckets.length === 0) { errBox.textContent = 'Khoảng ngày này không rơi vào cột nào — kiểm tra lại Từ ngày/Đến ngày.'; errBox.style.display = 'block'; return; }

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
