import 'dotenv/config';

const appUrl = (process.env.APP_URL || 'https://mercado.superamplitude.com').replace(/\/$/, '');

async function parseOrThrow(response, provider) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body?.message || body?.error_description || body?.error || `HTTP ${response.status}`;
    throw new Error(`${provider}: ${detail}`);
  }
  return body;
}

export async function createMercadoPagoCheckout(order, items) {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) throw new Error('Mercado Pago não configurado');

  const mpItems = items.map(item => ({
    id: item.sku,
    title: String(item.product_name || item.name || 'Produto').slice(0, 250),
    quantity: Number(item.qty),
    currency_id: 'BRL',
    unit_price: Number(item.unit_price)
  }));

  if (Number(order.delivery_fee) > 0) {
    mpItems.push({ id: 'delivery', title: 'Taxa de entrega', quantity: 1, currency_id: 'BRL', unit_price: Number(order.delivery_fee) });
  }

  const payload = {
    items: mpItems,
    external_reference: order.order_number,
    statement_descriptor: 'MERCADO',
    payer: {
      name: order.customer_name || undefined,
      email: order.customer_email || undefined
    },
    back_urls: {
      success: `${appUrl}/pagamento.html?provider=mercadopago&status=success&order=${encodeURIComponent(order.order_number)}`,
      pending: `${appUrl}/pagamento.html?provider=mercadopago&status=pending&order=${encodeURIComponent(order.order_number)}`,
      failure: `${appUrl}/pagamento.html?provider=mercadopago&status=failure&order=${encodeURIComponent(order.order_number)}`
    },
    auto_return: 'approved'
  };

  const webhookUrl = process.env.MERCADOPAGO_WEBHOOK_URL;
  if (webhookUrl) payload.notification_url = webhookUrl;

  const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const body = await parseOrThrow(response, 'Mercado Pago');
  return { provider: 'mercadopago', reference: body.id, checkoutUrl: body.init_point || body.sandbox_init_point };
}

async function paypalAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !secret) throw new Error('PayPal não configurado');
  const base = process.env.PAYPAL_BASE_URL || 'https://api-m.paypal.com';
  const response = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  const body = await parseOrThrow(response, 'PayPal OAuth');
  return { token: body.access_token, base };
}

export async function createPayPalCheckout(order) {
  const { token, base } = await paypalAccessToken();
  const response = await fetch(`${base}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'paypal-request-id': `mercado-${order.order_number}`.slice(0, 108)
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: order.order_number,
        custom_id: order.order_number,
        description: `Pedido ${order.order_number}`,
        amount: { currency_code: 'BRL', value: Number(order.total).toFixed(2) }
      }],
      payment_source: undefined,
      application_context: {
        brand_name: process.env.STORE_NAME || 'Mercado SuperAmplitude',
        landing_page: 'LOGIN',
        user_action: 'PAY_NOW',
        return_url: `${appUrl}/pagamento.html?provider=paypal&status=return&order=${encodeURIComponent(order.order_number)}`,
        cancel_url: `${appUrl}/pagamento.html?provider=paypal&status=cancel&order=${encodeURIComponent(order.order_number)}`
      }
    })
  });
  const body = await parseOrThrow(response, 'PayPal');
  const approve = (body.links || []).find(link => link.rel === 'payer-action' || link.rel === 'approve');
  return { provider: 'paypal', reference: body.id, checkoutUrl: approve?.href || null };
}

export async function inspectMercadoPagoPayment(paymentId) {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) throw new Error('Mercado Pago não configurado');
  const response = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  return parseOrThrow(response, 'Mercado Pago');
}

export async function capturePayPalOrder(paypalOrderId) {
  const { token, base } = await paypalAccessToken();
  const response = await fetch(`${base}/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: '{}'
  });
  return parseOrThrow(response, 'PayPal');
}
