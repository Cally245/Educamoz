import { createClient } from '@supabase/supabase-js';
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase = url && key ? createClient(url, key) : null;
export function readLocal(key, fallback) { try { const v = localStorage.getItem('educamoz_'+key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } }
export function writeLocal(key, value) { try { localStorage.setItem('educamoz_'+key, JSON.stringify(value)); } catch { /* storage can be unavailable */ } }
export const subjects = [
 {name:'Matemática',detail:'Números, equações e muito mais',icon:'∑',color:'blue'},
 {name:'Português',detail:'Interpretação, gramática e escrita',icon:'Aa',color:'orange'},
 {name:'Biologia',detail:'A vida e os seus processos',icon:'✳',color:'green'},
 {name:'Química',detail:'A matéria e as suas transformações',icon:'⌬',color:'purple'},
 {name:'Física',detail:'Compreender o mundo à tua volta',icon:'⚛',color:'red'},
 {name:'História',detail:'Conhecer o passado e o presente',icon:'◎',color:'yellow'}
];
