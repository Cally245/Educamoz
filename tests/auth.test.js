import test from 'node:test';
import assert from 'node:assert/strict';
import {authErrorMessage, submitCredentials} from '../src/auth.js';

test('login forwards credentials and returns the session', async () => {
  let received;
  const client = {auth:{signInWithPassword: async value => {received=value;return {data:{session:{user:{id:'1'}}},error:null}}}};
  const data = await submitCredentials(client,{mode:'login',email:' test@example.org ',password:'pass'});
  assert.deepEqual(received,{email:'test@example.org',password:'pass'});
  assert.equal(data.session.user.id,'1');
});
test('registration includes the confirmation redirect', async () => {
  let received;
  const client = {auth:{signUp: async value => {received=value;return {data:{session:null},error:null}}}};
  await submitCredentials(client,{mode:'register',email:'test@example.org',password:'pass123',redirectTo:'https://example.org/auth'});
  assert.equal(received.options.emailRedirectTo,'https://example.org/auth');
});
test('authentication errors are propagated and mapped without provider details', async () => {
  const error = {code:'invalid_credentials',message:'internal detail'};
  const client = {auth:{signInWithPassword:async()=>({error})}};
  await assert.rejects(submitCredentials(client,{mode:'login',email:'a@b.co',password:'bad'}), e => e === error);
  assert.match(authErrorMessage(error),/incorretos/);
  assert.doesNotMatch(authErrorMessage({message:'internal detail'}),/internal detail/);
});
test('unconfigured authentication is rejected', async () => {
  await assert.rejects(submitCredentials(null,{mode:'login'}),/auth_not_configured/);
});
