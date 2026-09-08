// js/core/config.js
// Cấu hình kết nối Supabase duy nhất cho toàn bộ app.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

export const SUPABASE_URL = 'https://shgorgwdphqyxdfwufvu.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNoZ29yZ3dkcGhxeXhkZnd1ZnZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2NjMwMDgsImV4cCI6MjEwNDIzOTAwOH0.OdUuwrmC_Uc3pEL8pKHR9r_uvQIX_0-3Q5IT81I-XNw';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function getCurrentProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();
  if (error) { console.error('getCurrentProfile', error); return null; }
  return data;
}
