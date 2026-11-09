import { createClient } from '@supabase/supabase-js';
import { generateGeminiAnswer, GeminiError, DEFAULT_MODEL } from './gemini.js';
import { randomUUID } from 'node:crypto';
import { boundedHistory } from './tutor.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createAiHandler({url=process.env.VITE_SUPABASE_URL, key=process.env.VITE_SUPABASE_ANON_KEY, apiKey=process.env.GEMINI_API_KEY, model=process.env.GEMINI_MODEL, clientFactory=createClient, generate=generateGeminiAnswer, logger=event=>console.info(JSON.stringify(event))}={}) {
  const authClient = url && key ? clientFactory(url, key, {auth:{persistSession:false,autoRefreshToken:false}}) : null;
  return async function aiHandler(req,res){
  const requestId = randomUUID();
  const started = Date.now();
  let stage = 'validation';
  let providerError = null;
  let geminiStarted = null;
  const configuredModel = model || DEFAULT_MODEL;
  const safeModel = typeof configuredModel === 'string' && /^[a-zA-Z0-9._-]{1,100}$/.test(configuredModel) ? configuredModel : '[modelo inválido]';
  res.setHeader('X-Request-Id', requestId);
  try {
  if(req.method !== 'POST') { res.setHeader('Allow','POST'); return res.status(405).json({error:'Método não permitido.'}); }
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  const sessionId = req.body?.sessionId ?? null;
  if(!message || message.length > 3000) return res.status(400).json({error:'Escreve uma pergunta com até 3000 caracteres.'});
  if(sessionId !== null && (typeof sessionId !== 'string' || !uuidPattern.test(sessionId))) return res.status(400).json({error:'A aula selecionada é inválida.'});
  stage = 'configuration';
  if(!apiKey) return res.status(503).json({error:'O Professor IA ainda não está configurado.'});
  if(!authClient) return res.status(503).json({error:'A autenticação precisa de ser configurada para usar o Professor IA.'});
  stage = 'authentication';
  const token = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
  if(!token) return res.status(401).json({error:'Inicia sessão para usar o Professor IA.'});
  try {
    stage = 'authentication';
    const {data:authData,error:authError} = await authClient.auth.getUser(token);
    if(authError || !authData.user) return res.status(401).json({error:'A sessão expirou. Inicia sessão novamente.'});
    // Forward the student's token, never a service-role key. RLS applies to every query.
    const db = clientFactory(url, key, {global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}});
    stage = 'session';
    let session = null;
    if(sessionId){
      const {data,error} = await db.from('tutor_sessions').select('id,grade,subject,topic,goal,mode,archived').eq('id',sessionId).eq('user_id',authData.user.id).maybeSingle();
      if(error) throw error;
      if(!data || data.archived) return res.status(404).json({error:'A aula não está disponível.'});
      session = data;
    }
    stage = 'history';
    let historyQuery = db.from('chat_messages').select('role,content,created_at').eq('user_id',authData.user.id);
    historyQuery = sessionId ? historyQuery.eq('session_id',sessionId) : historyQuery.is('session_id',null);
    const {data:history,error:historyError} = await historyQuery.order('created_at',{ascending:false}).limit(12);
    if(historyError) throw historyError;
    stage = 'quota';
    const {data:quota,error:quotaError} = await db.rpc('reserve_tutor_request');
    if(quotaError || !quota || typeof quota.allowed !== 'boolean') return res.status(503).json({error:'O controlo de utilização está indisponível. Tenta novamente mais tarde.'});
    if(!quota.allowed) return res.status(429).json({error:quota.reason === 'daily' ? 'Atingiste o limite diário de mensagens do teu plano. Tenta amanhã (UTC).' : 'Muitas mensagens em pouco tempo. Aguarda um minuto e tenta novamente.'});
    stage = 'gemini';
    geminiStarted = Date.now();
    const text = await generate({message, apiKey, model:model || undefined, session, history:boundedHistory((history||[]).reverse(),message)});
    stage = 'complete';
    res.json({text, usage:{plan:quota.plan, remaining:quota.remaining, limit:quota.limit}});
  } catch (error) {
    if(error instanceof GeminiError) {
      providerError = error;
      stage = error.stage;
      return res.status(error.status).json({error:error.message});
    }
    res.status(502).json({error:'Não foi possível obter uma resposta. Tenta novamente mais tarde.'});
  }
  } finally {
    // Never log request bodies, user identifiers, credentials or arbitrary upstream text.
    const event = {event:'ai_request', requestId, stage, httpStatus:res.statusCode, model:safeModel, durationMs:Date.now()-started};
    if(geminiStarted !== null) event.geminiDurationMs = Date.now()-geminiStarted;
    if(providerError?.upstreamStatus != null) event.geminiHttpStatus = providerError.upstreamStatus;
    if(providerError?.providerStatus) event.geminiStatus = providerError.providerStatus;
    if(providerError?.providerMessage) event.geminiMessage = providerError.providerMessage;
    try { logger(event); } catch { /* Logging must not break the response. */ }
  }
  };
}

export default createAiHandler();
