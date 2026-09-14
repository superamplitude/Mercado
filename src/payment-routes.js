import { createMercadoPagoCheckout, createPayPalCheckout, inspectMercadoPagoPayment, capturePayPalOrder } from './payments.js';

function mpPaymentStatus(status) {
  if (status === 'approved') return 'paid';
  if (status === 'refunded' || status === 'charged_back') return 'refunded';
  if (status === 'rejected' || status === 'cancelled') return 'failed';
  return 'pending';
}

export function registerPaymentRoutes(app, { query }) {
  app.post('/api/payments/create', async (req, res, next) => {
    try {
      const orderNumber = String(req.body?.orderNumber || '').trim();
      const provider = String(req.body?.provider || '').trim();
      const orders = await query('SELECT * FROM orders WHERE order_number=? LIMIT 1', [orderNumber]);
      const order = orders[0];
      if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });
      if (order.payment_status === 'paid') return res.status(409).json({ error: 'Pedido já pago' });
      const items = await query('SELECT product_name,sku,qty,unit_price,total_price FROM order_items WHERE order_id=? ORDER BY id', [order.id]);
      let payment;
      if (provider === 'mercadopago') payment = await createMercadoPagoCheckout(order, items);
      else if (provider === 'paypal') payment = await createPayPalCheckout(order);
      else return res.status(400).json({ error: 'Meio de pagamento inválido' });
      await query('UPDATE orders SET payment_provider=?,payment_reference=? WHERE id=?', [payment.provider,payment.reference,order.id]);
      res.json(payment);
    } catch (e) { next(e); }
  });

  app.post('/api/payments/mercadopago/confirm', async (req, res, next) => {
    try {
      const paymentId = String(req.body?.paymentId || '').trim();
      if (!paymentId) return res.status(400).json({ error: 'paymentId obrigatório' });
      const payment = await inspectMercadoPagoPayment(paymentId);
      const orderNumber = payment.external_reference;
      if (!orderNumber) return res.status(400).json({ error: 'Pagamento sem referência de pedido' });
      const status = mpPaymentStatus(payment.status);
      await query("UPDATE orders SET payment_status=?,payment_provider='mercadopago',payment_reference=?,status=CASE WHEN ?='paid' AND status='pending' THEN 'paid' ELSE status END WHERE order_number=?", [status,String(payment.id),status,orderNumber]);
      res.json({ orderNumber, paymentStatus: status });
    } catch (e) { next(e); }
  });

  app.post('/api/webhooks/mercadopago', async (req, res) => {
    try {
      const paymentId = req.body?.data?.id || req.query?.['data.id'];
      if (!paymentId) return res.sendStatus(200);
      const payment = await inspectMercadoPagoPayment(paymentId);
      const orderNumber = payment.external_reference;
      if (orderNumber) {
        const status = mpPaymentStatus(payment.status);
        await query("UPDATE orders SET payment_status=?,payment_provider='mercadopago',payment_reference=?,status=CASE WHEN ?='paid' AND status='pending' THEN 'paid' ELSE status END WHERE order_number=?", [status,String(payment.id),status,orderNumber]);
      }
      res.sendStatus(200);
    } catch (e) {
      console.error('webhook mercadopago', e.message);
      res.sendStatus(200);
    }
  });

  app.post('/api/payments/paypal/capture', async (req, res, next) => {
    try {
      const paypalOrderId = String(req.body?.paypalOrderId || '').trim();
      if (!paypalOrderId) return res.status(400).json({ error: 'paypalOrderId obrigatório' });
      const capture = await capturePayPalOrder(paypalOrderId);
      const purchase = capture.purchase_units?.[0];
      const orderNumber = purchase?.custom_id || purchase?.reference_id;
      if (!orderNumber) return res.status(400).json({ error: 'PayPal sem referência de pedido' });
      const completed = capture.status === 'COMPLETED';
      await query("UPDATE orders SET payment_status=?,payment_provider='paypal',payment_reference=?,status=CASE WHEN ?=1 AND status='pending' THEN 'paid' ELSE status END WHERE order_number=?", [completed?'paid':'pending',paypalOrderId,completed?1:0,orderNumber]);
      res.json({ orderNumber, paymentStatus: completed ? 'paid' : 'pending' });
    } catch (e) { next(e); }
  });

  app.get('/api/orders/:orderNumber/status', async (req,res,next) => {
    try {
      const rows = await query('SELECT order_number,status,payment_provider,payment_status,total,created_at,updated_at FROM orders WHERE order_number=? LIMIT 1',[req.params.orderNumber]);
      if (!rows[0]) return res.status(404).json({ error:'Pedido não encontrado' });
      res.json(rows[0]);
    } catch(e){ next(e); }
  });
}
