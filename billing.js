// js/billing.js
// Logic tính bảng kê thuê định kỳ — đúng nguyên tắc đã chốt:
//   - Tính theo ngày ký thật (transfer_notes.ngay_ky), không phải ngày nhập hệ thống
//   - Dùng số liệu tốt nhất hiện có (sl_thuc_nhan nếu đã có, không thì sl_xuat)
//   - TỒN ĐẦU KỲ: phiếu ký trước period_start -> tính đủ periodDays
//   - PHÁT SINH THUÊ: phiếu ký trong kỳ -> tính từ ngay_ky đến period_end
//   - Giá tra theo fn_lookup_rate (3 lớp: override dự án > giá khung khách hàng)

import { supabase } from './supabaseClient.js';

function daysBetween(a, b) {
  return Math.floor((new Date(b) - new Date(a)) / 86400000);
}

// Tính toán 1 bảng kê cho 1 dự án trong khoảng [periodStart, periodEnd]
// Trả về cấu trúc sẵn sàng để render hoặc lưu vào billing_statements/lines
export async function computeStatement(projectId, periodStart, periodEnd) {
  const periodDays = daysBetween(periodStart, periodEnd) + 1;

  // Lấy toàn bộ phiếu XUẤT ĐÃ CHÍNH THỨC cho dự án này, ký trước hoặc trong kỳ
  const { data: notes, error } = await supabase
    .from('transfer_notes')
    .select('id, ngay_ky, code, transfer_note_items(category_id, sl_xuat, sl_thuc_nhan)')
    .eq('project_id', projectId)
    .eq('direction', 'xuat_du_an')
    .eq('status', 'chinh_thuc')
    .lte('ngay_ky', periodEnd);

  if (error) throw error;

  // Gom theo category: tách tồn đầu kỳ vs phát sinh thuê
  const byCategory = {};
  for (const note of notes) {
    for (const item of note.transfer_note_items) {
      const qty = item.sl_thuc_nhan ?? item.sl_xuat; // luôn dùng số liệu tốt nhất hiện có
      if (!qty) continue;
      if (!byCategory[item.category_id]) byCategory[item.category_id] = { tonDauKy: 0, phatSinh: [] };
      if (note.ngay_ky < periodStart) {
        byCategory[item.category_id].tonDauKy += qty;
      } else {
        byCategory[item.category_id].phatSinh.push({ ngay: note.ngay_ky, qty, noteId: note.id, code: note.code });
      }
    }
  }

  const lines = [];
  let rentalSubtotal = 0;

  for (const [categoryId, b] of Object.entries(byCategory)) {
    const { data: rate } = await supabase.rpc('fn_lookup_rate', {
      p_project_id: projectId, p_category_id: categoryId, p_date: periodEnd,
    });
    const dailyRate = rate ?? 0;

    if (b.tonDauKy > 0) {
      const amount = b.tonDauKy * periodDays * dailyRate;
      lines.push({ category_id: categoryId, source_type: 'ton_dau_ky', ngay: periodStart,
        so_ngay: periodDays, so_luong: b.tonDauKy, don_gia: dailyRate, thanh_tien: amount });
      rentalSubtotal += amount;
    }
    for (const ps of b.phatSinh) {
      const soNgay = daysBetween(ps.ngay, periodEnd) + 1;
      const amount = ps.qty * soNgay * dailyRate;
      lines.push({ category_id: categoryId, source_type: 'phat_sinh_thue', ngay: ps.ngay,
        so_ngay: soNgay, so_luong: ps.qty, don_gia: dailyRate, thanh_tien: amount,
        transfer_note_id: ps.noteId });
      rentalSubtotal += amount;
    }
  }

  return { periodStart, periodEnd, periodDays, lines, rentalSubtotal };
}

// Lưu bảng kê đã tính vào DB (gọi sau khi Kế toán xác nhận số liệu đúng)
export async function saveStatement(billingPeriodId, projectId, computed, transportSubtotal = 0, vatRate = 8) {
  const tongPhatSinh = computed.rentalSubtotal + transportSubtotal;
  const vatAmount = tongPhatSinh * (vatRate / 100);
  const total = tongPhatSinh + vatAmount;

  const { data: statement, error } = await supabase.from('billing_statements').insert({
    billing_period_id: billingPeriodId,
    project_id: projectId,
    rental_subtotal: computed.rentalSubtotal,
    transport_subtotal: transportSubtotal,
    tong_phat_sinh: tongPhatSinh,
    vat_rate: vatRate,
    vat_amount: vatAmount,
    total,
  }).select().single();
  if (error) throw error;

  const linesWithStatementId = computed.lines.map(l => ({ ...l, statement_id: statement.id }));
  const { error: linesError } = await supabase.from('billing_statement_lines').insert(linesWithStatementId);
  if (linesError) throw linesError;

  return statement;
}
