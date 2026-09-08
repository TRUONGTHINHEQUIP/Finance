// js/core/attachments.js
// Hiển thị chip file đính kèm (scan phiếu, ảnh giao nhận) cho 1 transfer_note.
// Hiện tại chỉ hiển thị placeholder — khi nối Cloudflare R2 thật, thay hàm
// openAttachment() bằng gọi Edge Function lấy signed URL rồi mở/tải file.

import { supabase } from './config.js';

export async function renderAttachmentRow(transferNoteId) {
  const { data, error } = await supabase
    .from('transfer_note_attachments')
    .select('*')
    .eq('transfer_note_id', transferNoteId);

  if (error || !data || data.length === 0) {
    return `<div class="attach-row">
      <span class="attach-chip" data-upload="${transferNoteId}">📎 Chưa có file — bấm để upload (chưa nối R2)</span>
    </div>`;
  }

  return `<div class="attach-row">
    ${data.map(a => `<span class="attach-chip" data-view="${a.r2_key}">
      ${a.file_type === 'pdf_scan' ? '📎' : '📷'} ${a.file_type === 'pdf_scan' ? 'Phiếu ký (scan)' : 'Ảnh giao nhận'}
    </span>`).join('')}
  </div>`;
}

export function bindAttachmentEvents(container) {
  container.querySelectorAll('[data-view]').forEach(chip => {
    chip.addEventListener('click', () => {
      alert('Xem trước file đính kèm chưa khả dụng — cần nối Cloudflare R2 qua Edge Function trước.');
    });
  });
  container.querySelectorAll('[data-upload]').forEach(chip => {
    chip.addEventListener('click', () => {
      alert('Upload file chưa khả dụng — cần nối Cloudflare R2 qua Edge Function trước.');
    });
  });
}
