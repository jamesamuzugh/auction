"use client";

import { ActionForm, Submit } from "./Form.tsx";
import { partnerAdminAction } from "@/app/actions.ts";

export function AddPartnerForm() {
  return (
    <ActionForm action={partnerAdminAction} className="row">
      <input name="email" type="email" placeholder="Rider's account email" aria-label="Rider's account email" required style={{ flex: "1 1 200px", width: "auto" }} />
      <input name="company" placeholder="Delivery company" aria-label="Delivery company" required style={{ flex: "1 1 160px", width: "auto" }} />
      <Submit className="btn">Add delivery partner</Submit>
    </ActionForm>
  );
}

export function RemovePartnerButton({ id }: { id: number }) {
  return (
    <ActionForm action={partnerAdminAction} className="inline">
      <input type="hidden" name="op" value="remove" />
      <input type="hidden" name="id" value={id} />
      <Submit className="btn">Remove</Submit>
    </ActionForm>
  );
}
