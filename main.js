// js/main.js
// Điểm vào duy nhất của SPA — index.html chỉ load đúng file này.

import { requireAuth } from './core/auth.js';
import { initShell } from './core/shell.js';

const profile = await requireAuth();
if (profile) {
  initShell(profile);
}
