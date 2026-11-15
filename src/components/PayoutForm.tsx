"use client";

import { useState } from "react";
import { ActionForm, Submit } from "./Form.tsx";
import { savePayoutAccountAction } from "@/app/actions.ts";
import type { Bank } from "@/lib/payments/types.ts";

export default function PayoutForm({
  banks,
  current,
}: {
  banks: Bank[];
  current: { method: "bank" | "mobile_money"; bank_code: string; account_number: string; account_name: string } | null;
}) {
  const [method, setMethod] = useState<"bank" | "mobile_money">(current?.method ?? "mobile_money");
  const options = banks.filter((b) => b.type === method);
  const saved = current?.method === method ? options.find((b) => b.code === current.bank_code) : undefined;
  return (
    <ActionForm action={savePayoutAccountAction}>
      <fieldset className="choices">
        <legend>Pay me by</legend>
        <label className="choice">
          <input type="radio" name="method" value="mobile_money" checked={method === "mobile_money"} onChange={() => setMethod("mobile_money")} />
          Mobile money
        </label>
        <label className="choice">
          <input type="radio" name="method" value="bank" checked={method === "bank"} onChange={() => setMethod("bank")} />
          Bank account
        </label>
      </fieldset>
      <label>
        {method === "bank" ? "Bank" : "Network"}
        <select name="bank" key={method} defaultValue={saved ? `${saved.code}|${saved.name}` : ""} required>
          <option value="" disabled>Choose one</option>
          {options.map((b) => (
            <option key={b.code} value={`${b.code}|${b.name}`}>{b.name}</option>
          ))}
        </select>
      </label>
      <div className="two">
        <label>
          {method === "bank" ? "Account number" : "Mobile money number"}
          <input name="account_number" inputMode="numeric" defaultValue={current?.account_number ?? ""} required />
        </label>
        <label>
          Name on the account
          <input name="account_name" defaultValue={current?.account_name ?? ""} required />
        </label>
      </div>
      <div><Submit>Save payout details</Submit></div>
    </ActionForm>
  );
}
