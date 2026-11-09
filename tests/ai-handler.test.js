import test from 'node:test';
import assert from 'node:assert/strict';
import {createAiHandler} from '../server/ai.js';

function response(){return {statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v},status(code){this.statusCode=code;return this},json(body){this.body=body;return this}}}
function fixture({session,quota={allowed:true,plan:'free',limit:20,remaining:19},history=[]}={}) {
  const calls=[]; let generated=0;
  const db={from(table){calls.push(['from',table]);const b={select(){return b},eq(k,v){calls.push(['eq',table,k,v]);return b},is(k,v){calls.push(['is',table,k,v]);return b},maybeSingle:async()=>({data:session,error:null}),order(){return b},limit:async()=>({data:history,error:null})};return b},rpc:async(name)=>{calls.push(['rpc',name]);return {data:quota,error:null}}};
  let n=0;const clientFactory=()=>++n===1?{auth:{getUser:async()=>({data:{user:{id:'student-a'}},error:null})}}:db;
  const handler=createAiHandler({url:'https://example.test',key:'public',apiKey:'server-key',clientFactory,generate:async()=>{generated++;return 'Resposta'}});
  return {handler,calls,get generated(){return generated}};
}
const validSession='12345678-1234-4234-8234-123456789abc';
test('quota reached blocks the model before any provider call',async()=>{
  const f=fixture({session:{id:validSession},quota:{allowed:false,reason:'daily'}}),res=response();
  await f.handler({method:'POST',headers:{authorization:'Bearer token'},body:{message:'Frações',sessionId:validSession}},res);
  assert.equal(res.statusCode,429);assert.equal(f.generated,0);
});
test('a missing or other-user session is rejected before history and provider calls',async()=>{
  const f=fixture({session:null}),res=response();
  await f.handler({method:'POST',headers:{authorization:'Bearer token'},body:{message:'Olá',sessionId:validSession}},res);
  assert.equal(res.statusCode,404);assert.equal(f.generated,0);assert.ok(!f.calls.some(c=>c[1]==='chat_messages'));assert.ok(f.calls.some(c=>c[1]==='tutor_sessions'&&c[2]==='user_id'&&c[3]==='student-a'));
});
test('valid requests are scoped to the authenticated user and reserve quota',async()=>{
  const f=fixture({session:{id:validSession,mode:'lesson'}}),res=response();
  await f.handler({method:'POST',headers:{authorization:'Bearer token'},body:{message:'Frações',sessionId:validSession}},res);
  assert.equal(res.statusCode,200);assert.equal(res.body.text,'Resposta');assert.equal(f.generated,1);
  assert.ok(f.calls.some(c=>c[1]==='chat_messages'&&c[2]==='user_id'&&c[3]==='student-a'));
  assert.ok(f.calls.some(c=>c[0]==='rpc'&&c[1]==='reserve_tutor_request'));
});
