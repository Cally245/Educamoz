const DEFAULT_MODEL = 'gemini-flash-latest';
const SYSTEM_INSTRUCTION = 'És um professor paciente para estudantes moçambicanos. Responde em português claro, explica passo a passo e incentiva o pensamento autónomo. Não inventes factos.';

export class GeminiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Calls Gemini without putting the API key in the URL or exposing upstream errors. */
export async function generateGeminiAnswer({message, apiKey, model = DEFAULT_MODEL, fetchImpl = fetch}) {
  if (!apiKey) throw new GeminiError(503, 'O Professor IA ainda não está configurado.');
  let response;
  try {
    response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'x-goog-api-key': apiKey},
      body: JSON.stringify({
        systemInstruction: {parts: [{text: SYSTEM_INSTRUCTION}]},
        contents: [{role: 'user', parts: [{text: message}]}]
      }),
      signal: AbortSignal.timeout(30000)
    });
  } catch {
    throw new GeminiError(502, 'Não foi possível contactar o serviço de IA. Tenta novamente mais tarde.');
  }
  if (!response.ok) {
    if (response.status === 429) throw new GeminiError(429, 'O serviço de IA atingiu o limite de utilização. Tenta novamente mais tarde.');
    if ([400, 401, 403].includes(response.status)) throw new GeminiError(503, 'A configuração do serviço de IA foi rejeitada. Contacta a administração.');
    if (response.status === 404) throw new GeminiError(503, 'O modelo de IA configurado não está disponível. Contacta a administração.');
    throw new GeminiError(502, 'O serviço de IA está temporariamente indisponível. Tenta novamente mais tarde.');
  }
  let data;
  try { data = await response.json(); }
  catch { throw new GeminiError(502, 'O serviço de IA devolveu uma resposta inválida. Tenta novamente mais tarde.'); }
  const text = data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('').trim();
  if (!text) throw new GeminiError(502, 'O serviço de IA não devolveu uma resposta. Reformula a pergunta e tenta novamente.');
  return text;
}
