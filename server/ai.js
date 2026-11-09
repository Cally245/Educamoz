import { createClient } from '@supabase/supabase-js';
import { generateGeminiAnswer, GeminiError } from './gemini.js';
// Keep the provider key on the server and validate each bearer token with Supabase.
const authClient = process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_ANON_KEY
  ? createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, {auth:{persistSession:false, autoRefreshToken:false}}) : null;
// Basic per-process guard; use a shared, durable limiter in a multi-instance deployment.
const requests = new Map();
export default async function aiHandler(req,res){
  if(req.method !== 'POST') { res.setHeader('Allow','POST'); return res.status(405).json({error:'Método não permitido.'}); }
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if(!message || message.length > 3000) return res.status(400).json({error:'Escreve uma pergunta com até 3000 caracteres.'});
  if(!process.env.GEMINI_API_KEY) return res.status(503).json({error:'O Professor IA ainda não está configurado. Adiciona a chave Gemini no servidor para ativar esta função.'});
  if(!authClient) return res.status(503).json({error:'A autenticação precisa de ser configurada para usar o Professor IA.'});
  const token = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
  if(!token) return res.status(401).json({error:'Inicia sessão para usar o Professor IA.'});
  try {
    const {data: authData, error} = await authClient.auth.getUser(token);
    if(error || !authData.user) return res.status(401).json({error:'A sessão expirou. Inicia sessão novamente.'});
    const now = Date.now();
    const recent = (requests.get(authData.user.id) || []).filter(t => now-t < 60000);
    if(recent.length >= 10) return res.status(429).json({error:'Atingiste o limite de pedidos. Tenta novamente dentro de um minuto.'});
    recent.push(now); requests.set(authData.user.id, recent);
    if(requests.size > 10000) for(const [id, times] of requests) if(times.every(t => now-t >= 60000)) requests.delete(id);
    const text = await generateGeminiAnswer({message, apiKey:process.env.GEMINI_API_KEY, model:process.env.GEMINI_MODEL || undefined});
    res.json({text});
  } catch (error) {
    if (error instanceof GeminiError) return res.status(error.status).json({error:error.message});
    res.status(502).json({error:'Não foi possível obter uma resposta. Tenta novamente mais tarde.'});
  }
}
