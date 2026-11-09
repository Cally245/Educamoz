import { SYSTEM_INSTRUCTION, buildTutorContext } from './tutor.js';

export const DEFAULT_MODEL = 'gemini-flash-latest';
export const DEFAULT_TIMEOUT_MS = 30000;

// Keep calls bounded below the platform deadline; invalid settings fail back safely.
export function geminiTimeoutMs(value) {
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) return DEFAULT_TIMEOUT_MS;
  const ms = Number(value);
  return Number.isSafeInteger(ms) && ms >= 1000 && ms <= 90000 ? ms : DEFAULT_TIMEOUT_MS;
}

// Upstream error messages may echo request content. Only known, static messages
// can be logged verbatim; all other text is suppressed rather than guessed safe.
const safeProviderMessages = new Set([
  'The model is overloaded. Please try again later.',
  'The service is currently unavailable.',
  'Internal error encountered.',
  'API key not valid. Please pass a valid API key.',
  'Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential.',
  'Permission denied.',
  'Resource has been exhausted (e.g. check quota).'
]);

const safeProviderStatuses = new Set(['CANCELLED', 'UNKNOWN', 'INVALID_ARGUMENT', 'DEADLINE_EXCEEDED', 'NOT_FOUND', 'ALREADY_EXISTS', 'PERMISSION_DENIED', 'RESOURCE_EXHAUSTED', 'FAILED_PRECONDITION', 'ABORTED', 'OUT_OF_RANGE', 'UNIMPLEMENTED', 'INTERNAL', 'UNAVAILABLE', 'DATA_LOSS', 'UNAUTHENTICATED']);

export class GeminiError extends Error {
  constructor(status, message, {stage = 'gemini', upstreamStatus = null, providerStatus = null, providerMessage = null} = {}) {
    super(message);
    this.status = status;
    this.stage = stage;
    this.upstreamStatus = upstreamStatus;
    this.providerStatus = providerStatus;
    this.providerMessage = providerMessage;
  }
}

const upstreamErrors = {
  400: [503, 'O pedido ao serviço de IA foi rejeitado. Contacta a administração.'],
  401: [503, 'A autenticação do serviço de IA falhou. Contacta a administração.'],
  403: [503, 'O serviço de IA recusou o acesso. Contacta a administração.'],
  404: [503, 'O modelo de IA configurado não está disponível. Contacta a administração.'],
  408: [504, 'O serviço de IA demorou demasiado a responder. Tenta novamente.'],
  409: [502, 'O serviço de IA não conseguiu processar o pedido. Tenta novamente.'],
  413: [502, 'O pedido ao serviço de IA é demasiado grande. Tenta novamente.'],
  429: [429, 'O serviço de IA atingiu o limite de utilização. Tenta novamente mais tarde.'],
  500: [502, 'O serviço de IA encontrou um erro interno. Tenta novamente mais tarde.'],
  502: [502, 'O serviço de IA está temporariamente indisponível. Tenta novamente mais tarde.'],
  503: [503, 'O serviço de IA está temporariamente indisponível. Tenta novamente mais tarde.'],
  504: [504, 'O serviço de IA demorou demasiado a responder. Tenta novamente.']
};

/** Calls Gemini without putting the API key in the URL or exposing upstream errors. */
export async function generateGeminiAnswer({message, apiKey, model = DEFAULT_MODEL, history = [], session = null, fetchImpl = fetch, timeoutMs = geminiTimeoutMs(process.env.GEMINI_TIMEOUT_MS)}) {
  if (!apiKey) throw new GeminiError(503, 'O Professor IA ainda não está configurado.', {stage:'configuration'});
  const contents = [];
  for (const item of [...history, {role:'user', text:message}]) {
    if (!['user','model'].includes(item.role) || typeof item.text !== 'string' || !item.text.trim()) continue;
    if (!contents.length && item.role !== 'user') continue;
    const previous = contents.at(-1);
    if (previous?.role === item.role) previous.parts[0].text += '\n\n' + item.text;
    else contents.push({role:item.role, parts:[{text:item.text}]});
  }
  if (contents.length) contents[0].parts[0].text = buildTutorContext(session) + '\n\n' + contents[0].parts[0].text;
  let response;
  try {
    response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'x-goog-api-key': apiKey},
      body: JSON.stringify({
        systemInstruction: {parts: [{text: SYSTEM_INSTRUCTION}]},
        contents,
        generationConfig: {maxOutputTokens: 2048}
      }),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    throw new GeminiError(timeout ? 504 : 502, timeout ? 'O serviço de IA demorou demasiado a responder. Tenta novamente.' : 'Não foi possível contactar o serviço de IA. Tenta novamente mais tarde.', {stage:timeout ? 'gemini_timeout' : 'gemini_network'});
  }
  if (!response.ok) {
    let errorBody;
    try { errorBody = (await response.json())?.error; } catch { /* No untrusted raw response is logged. */ }
    const providerStatus = safeProviderStatuses.has(errorBody?.status) ? errorBody.status : null;
    const providerMessage = safeProviderMessages.has(errorBody?.message) ? errorBody.message : (typeof errorBody?.message === 'string' ? '[mensagem do fornecedor suprimida por privacidade]' : null);
    const [status, message] = upstreamErrors[response.status] || [502, 'O serviço de IA está temporariamente indisponível. Tenta novamente mais tarde.'];
    throw new GeminiError(status, message, {stage:'gemini_http', upstreamStatus:response.status, providerStatus, providerMessage});
  }
  let data;
  try { data = await response.json(); }
  catch { throw new GeminiError(502, 'O serviço de IA devolveu uma resposta inválida. Tenta novamente mais tarde.', {stage:'gemini_response_json'}); }
  const text = data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('').trim();
  if (!text) throw new GeminiError(502, 'O serviço de IA não devolveu uma resposta. Reformula a pergunta e tenta novamente.', {stage:'gemini_empty_response'});
  return text;
}
