import { quoteLines } from '../../src/lib/pricing.js'
import { razorpayKeys, readJson, send } from '../_lib/http.js'

/**
 * POST /api/razorpay/order
 *
 * Creates a Razorpay order for the basket. The amount is worked out HERE from
 * slug, size and quantity — any price the browser might send is ignored — so a
 * customer cannot change what they are charged.
 *
 * Body: { reference, lines: [{ slug, size, quantity }], customer: { name,
 *         email, phone, address, address2, city, state, pin } }
 * Reply: { keyId, orderId, amount, currency }   (amount in paise)
 *
 * There is no order database yet, so the order reference, items and delivery
 * address are written into the Razorpay order's notes. Every paid order can be
 * read, with what to ship and where, in the Razorpay dashboard.
 */

const MAX_QTY = 50
const MAX_LINES = 30

/** Razorpay allows 15 notes of up to 256 characters each. */
const note = (value) => String(value ?? '').trim().slice(0, 256)

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' })

  const keys = razorpayKeys()
  if (!keys) return send(res, 500, { error: 'Payments are not configured on the server.' })

  let body
  try {
    body = await readJson(req)
  } catch {
    return send(res, 400, { error: 'Invalid request.' })
  }

  const reference = typeof body.reference === 'string' ? body.reference.slice(0, 40) : ''
  const rawLines = Array.isArray(body.lines) ? body.lines.slice(0, MAX_LINES) : []
  const lines = rawLines
    .map((l) => ({
      slug: typeof l?.slug === 'string' ? l.slug : '',
      size: typeof l?.size === 'string' ? l.size : null,
      quantity: Math.floor(Number(l?.quantity)),
    }))
    .filter((l) => l.slug && l.quantity >= 1 && l.quantity <= MAX_QTY)

  const quote = quoteLines(lines)
  if (!reference || quote.items.length === 0 || quote.items.some((i) => i.unitPrice <= 0)) {
    return send(res, 400, { error: 'That basket could not be priced. Please refresh and try again.' })
  }

  const amount = Math.round(quote.total * 100)
  const c = body.customer ?? {}
  const items = quote.items
    .map((i) => `${i.quantity} x ${i.product.name}${i.size ? ` (${i.size})` : ''}`)
    .join('; ')

  const allNotes = {
    reference: note(reference),
    name: note(c.name),
    phone: note(c.phone),
    email: note(c.email),
    address: note([c.address, c.address2].filter(Boolean).join(', ')),
    city_state_pin: note(`${c.city ?? ''}, ${c.state ?? ''} ${c.pin ?? ''}`),
    items: note(items),
    items_more: note(items.slice(256)),
    subtotal: note(quote.subtotal.toFixed(2)),
    delivery: note(quote.delivery.toFixed(2)),
  }
  const notes = Object.fromEntries(Object.entries(allNotes).filter(([, v]) => v))

  try {
    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`${keys.keyId}:${keys.keySecret}`).toString('base64')}`,
      },
      body: JSON.stringify({ amount, currency: 'INR', receipt: reference, notes }),
    })
    const data = await response.json()
    if (!response.ok) {
      console.error('Razorpay order failed', response.status, data?.error)
      return send(res, 502, { error: 'The payment service could not start this payment.' })
    }
    return send(res, 200, {
      keyId: keys.keyId,
      orderId: data.id,
      amount: data.amount,
      currency: data.currency,
    })
  } catch (error) {
    console.error('Razorpay order error', error)
    return send(res, 502, { error: 'The payment service could not be reached.' })
  }
}
