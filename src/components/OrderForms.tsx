"use client";

import { ActionForm, Submit } from "./Form.tsx";
import { markDeliveredAction, markPaidAction, markShippedAction, shippingAction, startPaymentAction } from "@/app/actions.ts";
import type { Order } from "@/lib/auctions.ts";

export function AddressForm({ order }: { order: Order }) {
  return (
    <ActionForm action={shippingAction}>
      <input type="hidden" name="order_id" value={order.id} />
      <div className="two">
        <label>Full name<input name="name" autoComplete="name" defaultValue={order.ship_name ?? ""} required /></label>
        <label>Phone<input name="phone" type="tel" autoComplete="tel" defaultValue={order.ship_phone ?? ""} required /></label>
      </div>
      <label>Address line 1<input name="line1" autoComplete="address-line1" defaultValue={order.ship_line1 ?? ""} required /></label>
      <label>Address line 2 <span className="hint">Optional</span><input name="line2" autoComplete="address-line2" defaultValue={order.ship_line2 ?? ""} /></label>
      <div className="two">
        <label>City / town<input name="city" autoComplete="address-level2" defaultValue={order.ship_city ?? ""} required /></label>
        <label>State / region<input name="region" autoComplete="address-level1" defaultValue={order.ship_region ?? ""} required /></label>
      </div>
      <div className="two">
        <label>Postal code <span className="hint">Optional</span><input name="postal" autoComplete="postal-code" defaultValue={order.ship_postal ?? ""} /></label>
        <label>Country<input name="country" autoComplete="country-name" defaultValue={order.ship_country ?? ""} required /></label>
      </div>
      <div><Submit>{order.ship_line1 ? "Update address" : "Save address"}</Submit></div>
    </ActionForm>
  );
}

export function MarkPaidForm({ orderId }: { orderId: number }) {
  return (
    <ActionForm action={markPaidAction}>
      <input type="hidden" name="order_id" value={orderId} />
      <p className="small muted" style={{ margin: 0 }}>
        Once you've received the winner's payment, confirm it here so you can ship.
      </p>
      <div><Submit>Confirm payment received</Submit></div>
    </ActionForm>
  );
}

export function ShipForm({ orderId }: { orderId: number }) {
  return (
    <ActionForm action={markShippedAction}>
      <input type="hidden" name="order_id" value={orderId} />
      <div className="two">
        <label>Carrier / courier<input name="carrier" placeholder="e.g. DHL, local courier" required /></label>
        <label>Tracking number <span className="hint">Optional</span><input name="tracking" /></label>
      </div>
      <div><Submit>Mark as shipped</Submit></div>
    </ActionForm>
  );
}

export function DeliveredForm({ orderId }: { orderId: number }) {
  return (
    <ActionForm action={markDeliveredAction}>
      <input type="hidden" name="order_id" value={orderId} />
      <div><Submit>I received the item</Submit></div>
    </ActionForm>
  );
}

export function PayForm({ orderId, providers }: { orderId: number; providers: { id: string; label: string }[] }) {
  return (
    <ActionForm action={startPaymentAction}>
      <input type="hidden" name="order_id" value={orderId} />
      <p className="small muted" style={{ margin: 0 }}>You&apos;ll be taken to a secure checkout and brought back here after paying.</p>
      <div className="row">
        {providers.map((p, i) => (
          <button key={p.id} name="provider" value={p.id} className={i === 0 ? "btn primary" : "btn"}>
            {p.label}
          </button>
        ))}
      </div>
    </ActionForm>
  );
}
