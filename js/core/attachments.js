// js/core/attachments.js
// File đính kèm thật — dùng Supabase Storage (bucket "attachments", để Public).
// Không dùng Cloudflare R2 để tránh phải thêm Edge Function/CLI.

import { supabase } from './config.js';

const BUCKET = 'attachments';

export async function uploadAttachment(transferNoteId, file, uploaderId) {
  const safeName = file.name.replace(/[^\w.\-]/g, '_');
  const path = `transfer-notes/${transferNoteId}/${Date.now()}-${safeName}`;

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file);
  if (uploadError) throw uploadError;

  const file_type = file.type === 'application/pdf' ? 'pdf_scan' : 'photo';
  const { error: dbError } = await supabase.from('transfer_note_attachments').insert({
    transfer_note_id: transferNoteId, file_type, r2_key: path, uploaded_by: uploaderId,
  });
  if (dbError) throw dbError;
}

export async function renderAttachmentRow(transferNoteId) {
  const { data, error } = await supabase
    .from('transfer_note_attachments')
    .select('*')
    .eq('transfer_note_id', transferNoteId);

  const chips = (!error && data ? data : []).map(a => {
    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(a.r2_key);
    const icon = a.file_type === 'pdf_scan' ? '📎' : '📷';
    const label = a.file_type === 'pdf_scan' ? 'Phiếu ký (scan)' : 'Ảnh giao nhận';
    return `<a class="attach-chip" href="${pub.publicUrl}" target="_blank" rel="noopener">${icon} ${label}</a>`;
  });

  return `<div class="attach-row">
    ${chips.join('')}
    <label class="attach-chip" style="cursor:pointer;">+ Thêm file
      <input type="file" data-upload-input="${transferNoteId}" style="display:none;" multiple accept=".pdf,image/*">
    </label>
  </div>`;
}

// onUploaded gọi lại sau khi upload xong, để trang tự tải lại danh sách file mới nhất
export function bindAttachmentEvents(container, uploaderId, onUploaded) {
  container.querySelectorAll('[data-upload-input]').forEach(input => {
    input.addEventListener('change', async (e) => {
      const noteId = input.dataset.uploadInput;
      const files = Array.from(e.target.files);
      for (const file of files) {
        try { await uploadAttachment(noteId, file, uploaderId); }
        catch (err) { alert('Lỗi tải file lên: ' + err.message + '\n\nKiểm tra đã tạo bucket "attachments" trên Supabase Storage chưa.'); }
      }
      if (onUploaded) onUploaded();
    });
  });
}
