import test from 'node:test';
import assert from 'node:assert/strict';
import {generateGeminiAnswer, GeminiError} from '../server/gemini.js';

test('uses the requested model and sends the key only in a header', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = {url, options};
    return {ok:true, json:async()=>({candidates:[{content:{parts:[{text:'Olá!'}]}}]})};
  };
  const text = await generateGeminiAnswer({message:'Explica IA',apiKey:'test-key',fetchImpl});
  assert.equal(text,'Olá!');
  assert.equal(request.url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent');
  assert.equal(request.options.headers['x-goog-api-key'],'test-key');
  assert.ok(!request.url.includes('test-key'));
  assert.match(JSON.parse(request.options.body).contents[0].parts[0].text,/Explica IA/);
});
test('honours an explicitly configured model', async () => {
  let url;
  await generateGeminiAnswer({message:'Olá',apiKey:'key',model:'other-model',fetchImpl:async value=>{url=value;return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:'resposta'}]}}]})}}});
  assert.match(url,/other-model:generateContent$/);
});
test('provider errors are translated without leaking response contents', async () => {
  for (const [upstream,expected] of [[400,503],[401,503],[403,503],[404,503],[429,429],[500,502]]) {
    await assert.rejects(generateGeminiAnswer({message:'Olá',apiKey:'key',fetchImpl:async()=>({ok:false,status:upstream,json:async()=>({error:'secret upstream details'})})}), error=>error instanceof GeminiError && error.status===expected && !error.message.includes('secret'));
  }
});
test('handles blocked or invalid responses and unavailable network', async () => {
  for (const fetchImpl of [async()=>({ok:true,json:async()=>({candidates:[]})}),async()=>({ok:true,json:async()=>{throw new Error('bad JSON')}}),async()=>{throw new Error('network')}]) {
    await assert.rejects(generateGeminiAnswer({message:'Olá',apiKey:'key',fetchImpl}),error=>error instanceof GeminiError && error.status===502);
  }
});
