"use client";

import { ActionForm, Submit } from "./Form.tsx";
import {
  adminMarkPaidAction,
  acceptItemAction,
  adminConfirmDeliveryAction,
  markShippedAction,
  openDisputeAction,
  resolveDisputeAction,
  respondDisputeAction,
  shippingAction,
  startPaymentAction,
} from "@/app/actions.ts";
import type { Order } from "@/lib/auctions.ts";
import { GHANA_REGIONS } from "@/lib/places.ts";

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
        <label>
          Region
          <select name="region" autoComplete="address-level1" defaultValue={order.ship_region ?? ""} required>
            <option value="" disabled>Choose one</option>
            {GHANA_REGIONS.map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
      </div>
      <div className="two">
        <label>Postal code <span className="hint">Optional</span><input name="postal" autoComplete="postal-code" defaultValue={order.ship_postal ?? ""} /></label>
        <label>Country<input name="country" autoComplete="country-name" defaultValue={order.ship_country ?? "Ghana"} required /></label>
      </div>
      <p className="small muted" style={{ margin: 0 }}>Delivery is priced from your city and region and the item&apos;s size. You&apos;ll see the price before you pay.</p>
      <div><Submit>{order.ship_line1 ? "Update address" : "Save address"}</Submit></div>
    </ActionForm>
  );
}


export function ShipForm({ orderId, partners }: { orderId: number; partners: { id: number; label: string }[] }) {
  if (partners.length === 0)
    return <p className="muted" style={{ margin: 0 }}>No delivery partners are set up yet. Bidwell will add them shortly.</p>;
  return (
    <ActionForm action={markShippedAction}>
      <input type="hidden" name="order_id" value={orderId} />
      <p className="small muted" style={{ margin: 0 }}>
        Hand the item to a Bidwell delivery partner. They confirm delivery with the winner&apos;s delivery code or signature.
      </p>
      <div className="two">
        <label>
          Delivery partner
          <select name="courier_id" defaultValue="" required>
            <option value="" disabled>Choose one</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </label>
        <label>Tracking number <span className="hint">Optional</span><input name="tracking" /></label>
      </div>
      <div><Submit>Hand over for delivery</Submit></div>
    </ActionForm>
  );
}

export function AcceptForm({ orderId }: { orderId: number }) {
  return (
    <ActionForm action={acceptItemAction}>
      <input type="hidden" name="order_id" value={orderId} />
      <div><Submit>The item is in good condition and as described</Submit></div>
    </ActionForm>
  );
}

export function AdminDeliveryForm({ orderId }: { orderId: number }) {
  return (
    <ActionForm action={adminConfirmDeliveryAction} className="row">
      <input type="hidden" name="order_id" value={orderId} />
      <input name="note" placeholder="e.g. rider phoned in signed slip #4412" aria-label="How delivery was confirmed" style={{ flex: "1 1 220px", width: "auto" }} required />
      <Submit className="btn">Confirm delivery</Submit>
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

export function DisputeForm({ orderId, reasons }: { orderId: number; reasons: string[] }) {
  return (
    <ActionForm action={openDisputeAction}>
      <input type="hidden" name="order_id" value={orderId} />
      <label>
        What went wrong?
        <select name="reason" defaultValue="" required>
          <option value="" disabled>Choose one</option>
          {reasons.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </label>
      <label>
        Details
        <span className="hint">What you expected, what you got, and anything the seller told you. Photos can be sent to support.</span>
        <textarea name="details" minLength={10} maxLength={4000} required />
      </label>
      <div><Submit className="btn danger">Report a problem</Submit></div>
    </ActionForm>
  );
}

export function RespondForm({ orderId, disputeId }: { orderId: number; disputeId: number }) {
  return (
    <ActionForm action={respondDisputeAction}>
      <input type="hidden" name="order_id" value={orderId} />
      <input type="hidden" name="dispute_id" value={disputeId} />
      <label>
        Your side
        <span className="hint">Explain what you sent and include proof such as a courier receipt number.</span>
        <textarea name="response" maxLength={4000} required />
      </label>
      <div><Submit>Send response</Submit></div>
    </ActionForm>
  );
}

export function ResolveForm({ orderId, disputeId, canResume }: { orderId: number; disputeId: number; canResume: boolean }) {
  return (
    <ActionForm action={resolveDisputeAction}>
      <input type="hidden" name="order_id" value={orderId} />
      <input type="hidden" name="dispute_id" value={disputeId} />
      <fieldset className="choices">
        <legend>Decision</legend>
        <label className="choice"><input type="radio" name="outcome" value="refund" required /> Refund the winner in full</label>
        <label className="choice"><input type="radio" name="outcome" value="release" /> Pay the seller now</label>
        {canResume && (
          <label className="choice"><input type="radio" name="outcome" value="resume" /> Close the report and let the order continue</label>
        )}
      </fieldset>
      <label>
        Note to both sides
        <textarea name="note" required />
      </label>
      <div><Submit>Record decision</Submit></div>
    </ActionForm>
  );
}

export function AdminMarkPaidForm({ orderId }: { orderId: number }) {
  return (
    <ActionForm action={adminMarkPaidAction} className="row">
      <input type="hidden" name="order_id" value={orderId} />
      <input name="note" placeholder="e.g. bank transfer ref 1234" aria-label="Payment note" style={{ flex: "1 1 180px", width: "auto" }} />
      <Submit className="btn">Record payment</Submit>
    </ActionForm>
  );
}
