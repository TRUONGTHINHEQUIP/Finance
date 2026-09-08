// js/core/utils.js
// Hàm tiện ích dùng chung — mọi module import từ đây, không viết lặp lại.

export function fmtVND(n) {
  return Math.round(n || 0).toLocaleString('vi-VN') + ' đ';
}

export function fmtNum(n) {
  return Math.round(n || 0).toLocaleString('vi-VN');
}

export function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('vi-VN');
}

export function daysBetween(a, b) {
  return Math.floor((new Date(b) - new Date(a)) / 86400000);
}

export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysStr(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export function uid(prefix) {
  return prefix + '-' + Math.random().toString(36).slice(2, 7).toUpperCase();
}

// Escape chuỗi trước khi render vào HTML — tránh rủi ro injection từ dữ liệu người dùng nhập
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
