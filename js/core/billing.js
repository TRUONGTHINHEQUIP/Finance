// js/core/billing.js
// Tính bảng kê thuê định kỳ. Theo dõi cả lúc tài sản ĐẾN dự án và lúc RỜI dự án
// (dù về kho hay sang thẳng dự án khác) - tự động ngừng cộng tiền từ ngày rời đi.
// Mỗi dòng phát sinh/giảm đều giữ lại đúng mã phiếu (PGN) liên quan để đối chiếu.
// Vận chuyển: gộp theo LOẠI XE (xe của công ty) - số chuyến + tổng phí mỗi loại.

// Vận chuyển: chỉ tính phiếu dùng XE CÔNG TY (company_vehicle_id có giá trị) — gộp
// theo từng xe cụ thể (biển số), không phải theo loại xe chung chung. Xe thuê ngoài
// không đưa vào đây vì đó là chi phí bên thuê tự trả trực tiếp cho nhà xe, không
// phải chi phí công ty bỏ ra.

import { supabase } from './config.js';
import { daysBetween } from './utils.js';

export async function computeStatement(projectId, periodStart, periodEnd) {
  const periodDays = daysBetween(periodStart, periodEnd) + 1;

  const { data: arrivals, error: arrErr } = await supabase
    .from('transfer_notes')
    .select('id, ngay_ky, code, transport_fee, company_vehicle_id, transfer_note_items(category_id, sl_xuat, sl_thuc_nhan)')
    .eq('to_location_type', 'du_an').eq('to_location_id', projectId)
    .eq('status', 'chinh_thuc').lte('ngay_ky', periodEnd);
  if (arrErr) throw arrErr;

  const { data: departures, error: depErr } = await supabase
    .from('transfer_notes')
    .select('id, ngay_ky, code, transfer_note_items(category_id, sl_xuat, sl_thuc_nhan)')
    .eq('from_location_type', 'du_an').eq('from_location_id', projectId)
    .eq('status', 'chinh_thuc').lte('ngay_ky', periodEnd);
  if (depErr) throw depErr;

  const events = {};
  for (const note of arrivals ?? []) {
    for (const item of note.transfer_note_items) {
      const qty = item.sl_thuc_nhan ?? item.sl_xuat;
      if (!qty) continue;
      (events[item.category_id] ??= []).push({ ngay: note.ngay_ky, delta: qty, code: note.code });
    }
  }
  for (const note of departures ?? []) {
    for (const item of note.transfer_note_items) {
      const qty = item.sl_thuc_nhan ?? item.sl_xuat;
      if (!qty) continue;
      (events[item.category_id] ??= []).push({ ngay: note.ngay_ky, delta: -qty, code: note.code });
    }
  }

  const lines = [];
  let rentalSubtotal = 0;

  for (const [categoryId, evts] of Object.entries(events)) {
    evts.sort((a, b) => a.ngay.localeCompare(b.ngay));

    const { data: rate } = await supabase.rpc('fn_lookup_rate', {
      p_project_id: projectId, p_category_id: categoryId, p_date: periodEnd,
    });
    const dailyRate = rate ?? 0;

    let tonDauKy = 0;
    for (const e of evts) { if (e.ngay < periodStart) tonDauKy += e.delta; }

    if (tonDauKy !== 0) {
      const amount = tonDauKy * periodDays * dailyRate;
      lines.push({ category_id: categoryId, source_type: 'ton_dau_ky', ngay: periodStart,
        so_ngay: periodDays, so_luong: tonDauKy, don_gia: dailyRate, thanh_tien: amount, note_code: null });
      rentalSubtotal += amount;
    }

    const inPeriod = evts.filter(e => e.ngay >= periodStart && e.ngay <= periodEnd);
    for (const e of inPeriod) {
      const soNgay = daysBetween(e.ngay, periodEnd) + 1;
      const amount = e.delta * soNgay * dailyRate;
      lines.push({
        category_id: categoryId,
        source_type: e.delta > 0 ? 'phat_sinh_thue' : 'giam_trong_ky',
        ngay: e.ngay, so_ngay: soNgay, so_luong: e.delta, don_gia: dailyRate, thanh_tien: amount,
        note_code: e.code,
      });
      rentalSubtotal += amount;
    }
  }

  // Vận chuyển — CHỈ tính phiếu dùng xe công ty (có company_vehicle_id), gộp theo
  // TỪNG XE (biển số cụ thể): số chuyến + tổng phí mỗi xe, GIỮ LẠI chi tiết từng
  // chuyến (ngày, mã PGN, đơn giá) để in ra chứng minh được với khách hàng.
  const transportByVehicle = {};
  (arrivals ?? [])
    .filter(n => n.transport_fee && n.company_vehicle_id && n.ngay_ky >= periodStart && n.ngay_ky <= periodEnd)
    .forEach(n => {
      const key = n.company_vehicle_id;
      if (!transportByVehicle[key]) transportByVehicle[key] = { company_vehicle_id: n.company_vehicle_id, soChuyen: 0, thanhTien: 0, trips: [] };
      transportByVehicle[key].soChuyen += 1;
      transportByVehicle[key].thanhTien += Number(n.transport_fee);
      transportByVehicle[key].trips.push({ ngay: n.ngay_ky, code: n.code, fee: Number(n.transport_fee) });
    });
  const transportItems = Object.values(transportByVehicle);
  const transportSubtotal = transportItems.reduce((s, t) => s + t.thanhTien, 0);

  return { periodStart, periodEnd, periodDays, lines, rentalSubtotal, transportItems, transportSubtotal };
}

export async function saveStatement(billingPeriodId, projectId, computed, vatRate = 8, adjustment = null, close = false) {
  const adjustmentAmount = adjustment?.amount ?? 0;
  const tongPhatSinh = computed.rentalSubtotal + computed.transportSubtotal + adjustmentAmount;
  const vatAmount = tongPhatSinh * (vatRate / 100);
  const total = tongPhatSinh + vatAmount;

  const { data: statement, error } = await supabase.from('billing_statements').insert({
    billing_period_id: billingPeriodId,
    project_id: projectId,
    rental_subtotal: computed.rentalSubtotal,
    transport_subtotal: computed.transportSubtotal,
    transport_detail: computed.transportItems,
    adjustment_note: adjustment?.note ?? null,
    adjustment_amount: adjustmentAmount,
    tong_phat_sinh: tongPhatSinh,
    vat_rate: vatRate,
    vat_amount: vatAmount,
    total,
    status: close ? 'closed' : 'draft',
    closed_at: close ? new Date().toISOString() : null,
  }).select().single();
  if (error) throw error;

  const linesWithStatementId = computed.lines.map(l => ({ ...l, statement_id: statement.id }));
  const { error: linesError } = await supabase.from('billing_statement_lines').insert(linesWithStatementId);
  if (linesError) throw linesError;

  return statement;
}

export async function findClosedStatement(projectId, periodStart, periodEnd) {
  const { data } = await supabase.from('billing_statements')
    .select('*, billing_periods!inner(period_start, period_end)')
    .eq('project_id', projectId).eq('status', 'closed')
    .eq('billing_periods.period_start', periodStart).eq('billing_periods.period_end', periodEnd)
    .maybeSingle();
  return data ?? null;
}

export async function getPendingAdjustments(projectId) {
  const { data, error } = await supabase.from('billing_adjustments')
    .select('*').eq('project_id', projectId).eq('applied', false).order('created_at');
  if (error) throw error;
  return data ?? [];
}

export async function markAdjustmentsApplied(adjustmentIds, statementId) {
  if (adjustmentIds.length === 0) return;
  const { error } = await supabase.from('billing_adjustments')
    .update({ applied: true, statement_id: statementId })
    .in('id', adjustmentIds);
  if (error) throw error;
}

export async function createAdjustment(projectId, reason, amount, createdBy) {
  const { error } = await supabase.from('billing_adjustments').insert({
    project_id: projectId, reason, amount, created_by: createdBy, applied: false,
  });
  if (error) throw error;
}
