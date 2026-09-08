// js/core/modal.js
// Modal popup dùng chung — theo đúng mẫu "Trình tờ trình phê duyệt" của app VELA HSTC.

let currentOverlay = null;

export function openModal({ title, bodyHtml, footerHtml, onMount, wide = false }) {
  closeModal();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-dialog ${wide ? 'wide' : ''}">
      <div class="modal-head">
        <h3>${title}</h3>
        <button class="modal-close" aria-label="Đóng">&times;</button>
      </div>
      <div class="modal-body">${bodyHtml}</div>
      ${footerHtml ? `<div class="modal-foot">${footerHtml}</div>` : ''}
    </div>
  `;
  document.body.appendChild(overlay);
  currentOverlay = overlay;

  overlay.querySelector('.modal-close').addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  document.addEventListener('keydown', escHandler);

  if (onMount) onMount(overlay.querySelector('.modal-dialog'));
  return overlay;
}

function escHandler(e) {
  if (e.key === 'Escape') closeModal();
}

export function closeModal() {
  if (currentOverlay) {
    currentOverlay.remove();
    currentOverlay = null;
    document.removeEventListener('keydown', escHandler);
  }
}
