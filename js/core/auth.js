// js/core/auth.js

import { supabase, getCurrentProfile } from './config.js';

export async function requireAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = 'login.html';
    return null;
  }
  const profile = await getCurrentProfile();
  if (!profile || !profile.is_active) {
    await supabase.auth.signOut();
    window.location.href = 'login.html';
    return null;
  }
  return profile;
}

export function requireRole(profile, allowedRoles) {
  if (!allowedRoles.includes(profile.role)) {
    alert('Bạn không có quyền truy cập mục này.');
    return false;
  }
  return true;
}

export async function signOut() {
  await supabase.auth.signOut();
  window.location.href = 'login.html';
}

export function roleLabel(role) {
  return { kho: 'Kho', sale: 'Sale', ke_toan: 'Kế toán', bgd: 'BGD', admin: 'Admin' }[role] || role;
}
