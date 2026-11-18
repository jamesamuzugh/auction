"use client";

import { useState } from "react";
import { ActionForm, Submit } from "./Form.tsx";
import { confirmPhoneAction, deliveryRatesAction, reviewIdAction, sendPhoneCodeAction, submitIdAction } from "@/app/actions.ts";

export function SendCodeForm({ phone, again }: { phone: string; again: boolean }) {
  return (
    <ActionForm action={sendPhoneCodeAction}>
      <label>
        Mobile number
        <span className="hint">We&apos;ll text you a 6-digit code. Standard Ghana numbers like 024 123 4567 work as they are.</span>
        <input name="phone" type="tel" autoComplete="tel" inputMode="tel" defaultValue={phone} placeholder="024 123 4567" required />
      </label>
      <div><Submit className={again ? "btn" : "btn primary"}>{again ? "Send a new code" : "Text me a code"}</Submit></div>
    </ActionForm>
  );
}

export function ConfirmCodeForm({ phone }: { phone: string }) {
  return (
    <ActionForm action={confirmPhoneAction}>
      <label>
        Code sent to {phone}
        <input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" placeholder="••••••" required className="code-input" />
      </label>
      <div><Submit>Confirm number</Submit></div>
    </ActionForm>
  );
}

const DOCS = [
  { value: "ghana_card", label: "Ghana Card", back: true },
  { value: "passport", label: "Passport", back: false },
  { value: "drivers_licence", label: "Driver's licence", back: true },
  { value: "voter_id", label: "Voter ID", back: true },
];

export function IdForm({ name }: { name: string }) {
  const [doc, setDoc] = useState("ghana_card");
  const back = DOCS.find((d) => d.value === doc)?.back ?? true;
  return (
    <ActionForm action={submitIdAction}>
      <div className="two">
        <label>
          Type of ID
          <select name="doc_type" value={doc} onChange={(e) => setDoc(e.target.value)}>
            {DOCS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
        </label>
        <label>
          ID number
          <input name="doc_number" placeholder={doc === "ghana_card" ? "GHA-123456789-0" : "As printed on the ID"} required />
        </label>
      </div>
      <div className="two">
        <label>Full name as on the ID<input name="full_name" defaultValue={name} required /></label>
        <label>Date of birth<input name="dob" type="date" required /></label>
      </div>
      <label>
        Front of the ID
        <span className="hint">A clear photo with all four corners showing and no glare</span>
        <input name="front" type="file" accept="image/*" capture="environment" required />
      </label>
      {back && (
        <label>
          Back of the ID
          <input name="back" type="file" accept="image/*" capture="environment" required />
        </label>
      )}
      <label>
        Selfie holding the ID
        <span className="hint">Your face and the ID&apos;s photo side both clearly visible</span>
        <input name="selfie" type="file" accept="image/*" capture="user" required />
      </label>
      <p className="small muted" style={{ margin: 0 }}>
        Only Bidwell staff see these photos. We use them to confirm you are who you say you are, and never show them to buyers or sellers.
      </p>
      <div><Submit>Send for checking</Submit></div>
    </ActionForm>
  );
}

export function ReviewIdForm({ checkId }: { checkId: number }) {
  return (
    <ActionForm action={reviewIdAction}>
      <input type="hidden" name="check_id" value={checkId} />
      <label>
        Note
        <span className="hint">Required when rejecting. The member sees it, so say what to fix.</span>
        <input name="reason" placeholder="e.g. The selfie is blurry, please retake it in good light" />
      </label>
      <div className="row">
        <label className="choice"><input type="radio" name="decision" value="approve" required /> Approve: details and photos match</label>
        <label className="choice"><input type="radio" name="decision" value="reject" /> Reject</label>
      </div>
      <div><Submit>Save decision</Submit></div>
    </ActionForm>
  );
}

export function DeliveryRatesForm({
  sizes,
  bands,
  rates,
  currency,
}: {
  sizes: { value: string; label: string; hint: string }[];
  bands: { value: string; label: string }[];
  rates: Record<string, Record<string, number>>;
  currency: string;
}) {
  return (
    <ActionForm action={deliveryRatesAction}>
      <div className="table-wrap">
        <table className="list rates">
          <thead>
            <tr><th>Size ({currency})</th>{bands.map((b) => <th key={b.value}>{b.label}</th>)}</tr>
          </thead>
          <tbody>
            {sizes.map((s) => (
              <tr key={s.value}>
                <td><strong>{s.label}</strong><div className="small muted">{s.hint}</div></td>
                {bands.map((b) => (
                  <td key={b.value}>
                    <input
                      name={`rate_${s.value}_${b.value}`}
                      inputMode="decimal"
                      aria-label={`${s.label}, ${b.label}`}
                      defaultValue={(rates[s.value][b.value] / 100).toFixed(2)}
                      required
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div><Submit>Save delivery prices</Submit></div>
    </ActionForm>
  );
}
