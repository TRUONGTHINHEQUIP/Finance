// js/core/attachments.js
// File đính kèm thật — lưu trên Cloudflare R2, qua 1 Worker trung gian (không dùng
// Supabase Storage nữa vì lượng truy xuất nhiều, R2 miễn phí băng thông tải xuống).
//
// CẦN ĐIỀN: WORKER_URL bên dưới, lấy từ Cloudflare sau khi deploy Worker
// (xem file cloudflare-worker-files.js + hướng dẫn deploy đi kèm).

import { supabase } from './config.js';

const WORKER_URL = 'https://ttequip-files.mute-mode-18d8.workers.dev';

export async function uploadAttachment(transferNoteId, file, uploaderId) {
  const safeName = file.name.replace(/[^\w.\-]/g, '_');
  const key = `transfer-notes/${transferNoteId}/${Date.now()}-${safeName}`;

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Phiên đăng nhập đã hết, tải lại trang và đăng nhập lại.');

  const res = await fetch(`${WORKER_URL}/${key}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': file.type || 'application/octet-stream',
    },
    body: file,
  });
  if (!res.ok) throw new Error('Upload thất bại (' + res.status + '): ' + (await res.text()));

  const file_type = file.type === 'application/pdf' ? 'pdf_scan' : 'photo';
  const { error: dbError } = await supabase.from('transfer_note_attachments').insert({
    transfer_note_id: transferNoteId, file_type, r2_key: key, uploaded_by: uploaderId,
  });
  if (dbError) throw dbError;
}

export async function renderAttachmentRow(transferNoteId) {
  const { data, error } = await supabase
    .from('transfer_note_attachments')
    .select('*')
    .eq('transfer_note_id', transferNoteId);

  const chips = (!error && data ? data : []).map(a => {
    const icon = a.file_type === 'pdf_scan' ? '📎' : '📷';
    const label = a.file_type === 'pdf_scan' ? 'Phiếu ký (scan)' : 'Ảnh giao nhận';
    return `<span class="attach-chip" data-view-key="${a.r2_key}">${icon} ${label}</span>`;
  });

  return `<div class="attach-row">
    ${chips.join('')}
    <label class="attach-chip" style="cursor:pointer;">+ Thêm file
      <input type="file" data-upload-input="${transferNoteId}" style="display:none;" multiple accept=".pdf,image/*">
    </label>
  </div>`;
}

// Xem file — KHÔNG dùng link <a href> thường vì trình duyệt không gửi kèm thông
// tin đăng nhập khi mở link trực tiếp. Phải tự tải file kèm token rồi mới mở ra,
// để Worker xác nhận đúng người trong công ty mới xem được.
async function viewAttachment(key) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { alert('Phiên đăng nhập đã hết, tải lại trang và đăng nhập lại.'); return; }

  try {
    const res = await fetch(`${WORKER_URL}/${key}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) throw new Error('Không xem được file (' + res.status + ')');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  } catch (err) {
    alert('Lỗi mở file: ' + err.message);
  }
}

export function bindAttachmentEvents(container, uploaderId, onUploaded) {
  container.querySelectorAll('[data-view-key]').forEach(chip => {
    chip.addEventListener('click', () => viewAttachment(chip.dataset.viewKey));
  });
  container.querySelectorAll('[data-upload-input]').forEach(input => {
    input.addEventListener('change', async (e) => {
      const noteId = input.dataset.uploadInput;
      const files = Array.from(e.target.files);
      for (const file of files) {
        try { await uploadAttachment(noteId, file, uploaderId); }
        catch (err) { alert('Lỗi tải file lên: ' + err.message); }
      }
      if (onUploaded) onUploaded();
    });
  });
}
