import express from 'express';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'node:url';
const app = express();
app.use(express.json({limit:'16kb'}));
// Keep the provider key on the server and validate each bearer token with Supabase.
const authClient = process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_ANON_KEY
  ? createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, {auth:{persistSession:false, autoRefreshToken:false}}) : null;
// Basic per-process guard; use a shared, durable limiter in a multi-instance deployment.
const requests = new Map();
app.post('/api/ai', async (req,res)=>{
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if(!message || message.length > 3000) return res.status(400).json({error:'Escreve uma pergunta com até 3000 caracteres.'});
  if(!process.env.GEMINI_API_KEY) return res.status(503).json({error:'O Professor IA ainda não está configurado. Adiciona a chave Gemini no servidor para ativar esta função.'});
  if(!authClient) return res.status(503).json({error:'A autenticação precisa de ser configurada para usar o Professor IA.'});
  const token = req.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if(!token) return res.status(401).json({error:'Inicia sessão para usar o Professor IA.'});
  try {
    const {data: authData, error} = await authClient.auth.getUser(token);
    if(error || !authData.user) return res.status(401).json({error:'A sessão expirou. Inicia sessão novamente.'});
    const now = Date.now();
    const recent = (requests.get(authData.user.id) || []).filter(t => now-t < 60000);
    if(recent.length >= 10) return res.status(429).json({error:'Atingiste o limite de pedidos. Tenta novamente dentro de um minuto.'});
    recent.push(now); requests.set(authData.user.id, recent);
    if(requests.size > 10000) for(const [id, times] of requests) if(times.every(t => now-t >= 60000)) requests.delete(id);
    const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({systemInstruction:{parts:[{text:'És um professor paciente para estudantes moçambicanos. Responde em português claro, explica passo a passo e incentiva o pensamento autónomo. Não inventes factos.'}]},contents:[{role:'user',parts:[{text:message}]}]})});
    const data = await response.json();
    if(!response.ok) throw new Error('provider');
    const text = data.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('');
    if(!text) throw new Error('empty');
    res.json({text});
  } catch { res.status(502).json({error:'Não foi possível obter uma resposta. Tenta novamente mais tarde.'}); }
});
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
app.use(express.static(path.join(root,'dist')));
app.get('*',(req,res)=>res.sendFile(path.join(root,'dist','index.html')));
app.listen(process.env.PORT || 3001,'0.0.0.0',()=>console.log('EducaMoz server ready'));
