import { createHmac, timingSafeEqual } from 'node:crypto'
import { razorpayKeys, readJson, send } from '../_lib/http.js'

/**
 * POST /api/razorpay/verify
 *
 * Confirms a payment really came from Razorpay. Checkout hands the browser an
 * order id, a payment id and a signature; only someone holding the key secret
 * can produce that signature, so a forged "payment succeeded" fails here.
 *
 * Body:  { razorpay_order_id, razorpay_payment_id, razorpay_signature }
 * Reply: { verified: true, paymentId } or 400 { verified: false }
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' })

  const keys = razorpayKeys()
  if (!keys) return send(res, 500, { error: 'Payments are not configured on the server.' })

  let body
  try {
    body = await readJson(req)
  } catch {
    return send(res, 400, { verified: false })
  }

  const orderId = String(body.razorpay_order_id ?? '')
  const paymentId = String(body.razorpay_payment_id ?? '')
  const signature = String(body.razorpay_signature ?? '')
  if (!orderId || !paymentId || !signature) return send(res, 400, { verified: false })

  const expected = createHmac('sha256', keys.keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex')

  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  const verified = a.length === b.length && timingSafeEqual(a, b)

  return send(res, verified ? 200 : 400, verified ? { verified, paymentId } : { verified })
}
