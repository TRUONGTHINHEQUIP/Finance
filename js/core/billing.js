// js/core/billing.js
// Logic tính bảng kê thuê định kỳ.
//
// THAY ĐỔI QUAN TRỌNG so với bản trước: giờ theo dõi CẢ 2 chiều —
// lúc tài sản ĐẾN dự án (cộng tiền từ ngày đó) và lúc tài sản RỜI dự án
// (dù về kho hay sang thẳng dự án khác) — TỰ ĐỘNG ngừng cộng tiền từ ngày rời đi.
// Nhờ vậy, chuyển thẳng dự án A -> dự án B tự động đúng: A ngừng tính tiền,
// B bắt đầu tính tiền, không cần quy tắc riêng cho trường hợp này.
//
// Cách tính: mỗi sự kiện (đến/đi) đóng góp ± số lượng × số ngày còn lại tới hết kỳ.
// Cộng tất cả đóng góp lại cho ra đúng số tiền thực tế theo từng khoảng thời gian
// tài sản thực sự có mặt tại dự án — không cần dựng lịch trình từng ngày.
//
// Vận chuyển: phí gắn trực tiếp trên phiếu (transfer_notes.transport_fee),
// tự động tính cho dự án là NƠI NHẬN (nơi đến) — vì nơi nhận hàng là bên trả phí.

import { supabase } from './config.js';
import { daysBetween } from './utils.js';

export async function computeStatement(projectId, periodStart, periodEnd) {
  const periodDays = daysBetween(periodStart, periodEnd) + 1;

  const { data: arrivals, error: arrErr } = await supabase
    .from('transfer_notes')
    .select('id, ngay_ky, code, transport_fee, transfer_note_items(category_id, sl_xuat, sl_thuc_nhan)')
    .eq('to_location_type', 'du_an').eq('to_location_id', projectId)
    .eq('status', 'chinh_thuc').lte('ngay_ky', periodEnd);
  if (arrErr) throw arrErr;

  const { data: departures, error: depErr } = await supabase
    .from('transfer_notes')
    .select('id, ngay_ky, code, transfer_note_items(category_id, sl_xuat, sl_thuc_nhan)')
    .eq('from_location_type', 'du_an').eq('from_location_id', projectId)
    .eq('status', 'chinh_thuc').lte('ngay_ky', periodEnd);
  if (depErr) throw depErr;

  // Gom theo chủng loại: danh sách sự kiện {ngay, delta (+đến/-đi), code}
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

    // Tồn đầu kỳ = tổng các sự kiện xảy ra TRƯỚC kỳ này (đến trừ đi)
    let tonDauKy = 0;
    for (const e of evts) { if (e.ngay < periodStart) tonDauKy += e.delta; }

    if (tonDauKy !== 0) {
      const amount = tonDauKy * periodDays * dailyRate;
      lines.push({ category_id: categoryId, source_type: 'ton_dau_ky', ngay: periodStart,
        so_ngay: periodDays, so_luong: tonDauKy, don_gia: dailyRate, thanh_tien: amount });
      rentalSubtotal += amount;
    }

    // Sự kiện TRONG kỳ — mỗi sự kiện đóng góp riêng theo đúng số ngày còn lại của nó tới hết kỳ
    const inPeriod = evts.filter(e => e.ngay >= periodStart && e.ngay <= periodEnd);
    for (const e of inPeriod) {
      const soNgay = daysBetween(e.ngay, periodEnd) + 1;
      const amount = e.delta * soNgay * dailyRate;
      lines.push({
        category_id: categoryId,
        source_type: e.delta > 0 ? 'phat_sinh_thue' : 'giam_trong_ky',
        ngay: e.ngay, so_ngay: soNgay, so_luong: e.delta, don_gia: dailyRate, thanh_tien: amount,
      });
      rentalSubtotal += amount;
    }
  }

  // Vận chuyển — cộng phí của các phiếu ký TRONG kỳ có Nơi nhận là đúng dự án này
  const transportItems = (arrivals ?? [])
    .filter(n => n.transport_fee && n.ngay_ky >= periodStart && n.ngay_ky <= periodEnd)
    .map(n => ({ ngay: n.ngay_ky, code: n.code, amount: Number(n.transport_fee) }));
  const transportSubtotal = transportItems.reduce((s, t) => s + t.amount, 0);

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

// Kiểm tra xem dự án này trong khoảng thời gian này đã có bảng kê CHỐT rồi hay chưa —
// dùng để cảnh báo trước khi tính lại, tránh chốt trùng.
// Lấy các dòng điều chỉnh đang CHỜ (chưa gom vào bill nào) của 1 dự án —
// tự động áp dụng vào lần tính bill kế tiếp, bất kể được tạo lúc nào trước đó.
export async function getPendingAdjustments(projectId) {
  const { data, error } = await supabase.from('billing_adjustments')
    .select('*').eq('project_id', projectId).eq('applied', false).order('created_at');
  if (error) throw error;
  return data ?? [];
}

// Đánh dấu các dòng điều chỉnh đã được gom vào 1 bill cụ thể — không bị tính lại ở bill sau.
export async function markAdjustmentsApplied(adjustmentIds, statementId) {
  if (adjustmentIds.length === 0) return;
  const { error } = await supabase.from('billing_adjustments')
    .update({ applied: true, statement_id: statementId })
    .in('id', adjustmentIds);
  if (error) throw error;
}

// Tạo 1 dòng điều chỉnh mới — dùng ngay khi phát hiện sai lệch, không cần chờ tới lúc tính bill.
export async function createAdjustment(projectId, reason, amount, createdBy) {
  const { error } = await supabase.from('billing_adjustments').insert({
    project_id: projectId, reason, amount, created_by: createdBy, applied: false,
  });
  if (error) throw error;
}

export async function findClosedStatement(projectId, periodStart, periodEnd) {
  const { data } = await supabase.from('billing_statements')
    .select('*, billing_periods!inner(period_start, period_end)')
    .eq('project_id', projectId).eq('status', 'closed')
    .eq('billing_periods.period_start', periodStart).eq('billing_periods.period_end', periodEnd)
    .maybeSingle();
  return data ?? null;
}
