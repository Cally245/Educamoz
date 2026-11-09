/** User-facing errors avoid exposing provider internals or identifying accounts. */
export function authErrorMessage(error) {
  switch (error?.code) {
    case 'invalid_credentials': return 'Email ou palavra-passe incorretos. Verifica os dados e tenta novamente.';
    case 'email_not_confirmed': return 'Confirma o teu email antes de iniciares sessão.';
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit': return 'Demasiadas tentativas. Aguarda um pouco e tenta novamente.';
    case 'weak_password': return 'Escolhe uma palavra-passe mais segura, com pelo menos 6 caracteres.';
    case 'signup_disabled': return 'O registo está temporariamente indisponível.';
    case 'email_address_invalid': return 'Verifica o endereço de email introduzido.';
    default: return 'Não foi possível continuar. Verifica a ligação e tenta novamente.';
  }
}

export async function submitCredentials(client, {mode, email, password, redirectTo}) {
  if (!client) throw new Error('auth_not_configured');
  const credentials = {email: email.trim(), password};
  const result = mode === 'login'
    ? await client.auth.signInWithPassword(credentials)
    : await client.auth.signUp({...credentials, options: {emailRedirectTo: redirectTo}});
  if (result.error) throw result.error;
  return result.data;
}
