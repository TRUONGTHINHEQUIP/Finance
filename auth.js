// js/auth.js
// Xử lý đăng nhập, kiểm tra phiên, điều hướng theo vai trò (Kho/Sale/Kế toán/BGD)

import { supabase, getCurrentProfile } from './supabaseClient.js';

export async function requireAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = '/login.html';
    return null;
  }
  const profile = await getCurrentProfile();
  if (!profile || !profile.is_active) {
    await supabase.auth.signOut();
    window.location.href = '/login.html';
    return null;
  }
  return profile;
}

// Chặn trang theo vai trò, VD: requireRole(profile, ['sale', 'bgd'])
export function requireRole(profile, allowedRoles) {
  if (!allowedRoles.includes(profile.role)) {
    alert('Bạn không có quyền truy cập trang này.');
    window.location.href = '/index.html';
    return false;
  }
  return true;
}

export async function signOut() {
  await supabase.auth.signOut();
  window.location.href = '/login.html';
}

export function roleLabel(role) {
  return { kho: 'Kho', sale: 'Sale', ke_toan: 'Kế toán', bgd: 'BGD' }[role] || role;
}
