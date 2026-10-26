// Webhook de compra (Stripe). Ao confirmar o pagamento, cria o usuario,
// envia o convite por e-mail e libera o acesso. Ao cancelar ou falhar, bloqueia.
//
// Secrets necessarios (supabase secrets set ...):
//   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SITE_URL
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY ja existem dentro das Edge Functions.

import Stripe from 'https://esm.sh/stripe@16?target=denonext';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' });
const segredoWebhook = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;
const siteUrl = Deno.env.get('SITE_URL')!;

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

async function definirStatusPorCliente(idCliente: string, status: 'ativa' | 'inativa' | 'cancelada') {
  const { error } = await admin
    .from('assinaturas')
    .update({ status, atualizado_em: new Date().toISOString() })
    .eq('id_externo', idCliente);
  if (error) throw error;
}

async function liberarCompra(sessao: Stripe.Checkout.Session) {
  const email = sessao.customer_details?.email ?? sessao.customer_email;
  if (!email) throw new Error('Checkout sem e-mail do cliente');

  const nome = sessao.customer_details?.name ?? email.split('@')[0];
  const idCliente = typeof sessao.customer === 'string' ? sessao.customer : sessao.customer?.id ?? null;

  let { data: userId, error } = await admin.rpc('user_id_por_email', { p_email: email });
  if (error) throw error;

  if (!userId) {
    const convite = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: siteUrl,
      data: { nome },
    });
    if (convite.error) throw convite.error;
    userId = convite.data.user.id;
  }

  const { error: erroAssinatura } = await admin.from('assinaturas').upsert({
    user_id: userId,
    status: 'ativa',
    plano: sessao.mode === 'subscription' ? 'mensal' : 'vitalicio',
    provedor: 'stripe',
    id_externo: idCliente,
    valido_ate: null,
    atualizado_em: new Date().toISOString(),
  });
  if (erroAssinatura) throw erroAssinatura;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Metodo nao permitido', { status: 405 });

  const assinatura = req.headers.get('stripe-signature');
  if (!assinatura) return new Response('Sem assinatura', { status: 400 });

  const corpo = await req.text();
  let evento: Stripe.Event;
  try {
    evento = await stripe.webhooks.constructEventAsync(corpo, assinatura, segredoWebhook);
  } catch (e) {
    console.error('Assinatura invalida', e);
    return new Response('Assinatura invalida', { status: 400 });
  }

  try {
    switch (evento.type) {
      case 'checkout.session.completed': {
        const sessao = evento.data.object as Stripe.Checkout.Session;
        if (sessao.payment_status === 'paid' || sessao.payment_status === 'no_payment_required') {
          await liberarCompra(sessao);
        }
        break;
      }
      case 'checkout.session.async_payment_succeeded': {
        await liberarCompra(evento.data.object as Stripe.Checkout.Session);
        break;
      }
      case 'invoice.paid': {
        const fatura = evento.data.object as Stripe.Invoice;
        if (typeof fatura.customer === 'string') await definirStatusPorCliente(fatura.customer, 'ativa');
        break;
      }
      case 'invoice.payment_failed': {
        const fatura = evento.data.object as Stripe.Invoice;
        if (typeof fatura.customer === 'string') await definirStatusPorCliente(fatura.customer, 'inativa');
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = evento.data.object as Stripe.Subscription;
        if (typeof sub.customer === 'string') await definirStatusPorCliente(sub.customer, 'cancelada');
        break;
      }
      default:
        break;
    }
  } catch (e) {
    console.error('Erro ao processar evento', evento.type, e);
    return new Response('Erro interno', { status: 500 });
  }

  return new Response(JSON.stringify({ recebido: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
