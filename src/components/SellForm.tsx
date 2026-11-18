"use client";

import { useState } from "react";
import { ActionForm, Submit } from "./Form.tsx";
import { createAuctionAction } from "@/app/actions.ts";
import { CURRENCY } from "@/lib/money.ts";
import { GHANA_REGIONS, SIZES } from "@/lib/places.ts";

const DURATIONS = [
  { v: "3600000", l: "1 hour" },
  { v: "86400000", l: "1 day" },
  { v: "259200000", l: "3 days" },
  { v: "432000000", l: "5 days" },
  { v: "604800000", l: "7 days" },
  { v: "864000000", l: "10 days" },
  { v: "custom", l: "Pick an end date and time" },
];

export default function SellForm({ categories, conditions }: { categories: string[]; conditions: string[] }) {
  const [duration, setDuration] = useState("604800000");
  const [endsAtMs, setEndsAtMs] = useState("");

  // Convert the chosen length or local date/time to a UTC timestamp just before submitting.
  const onSubmitCapture = (e: React.FormEvent<HTMLFormElement>) => {
    const f = e.currentTarget;
    let ms: number;
    if (duration === "custom") {
      const local = (f.elements.namedItem("ends_local") as HTMLInputElement).value;
      ms = local ? new Date(local).getTime() : NaN;
    } else {
      ms = Date.now() + Number(duration);
    }
    const hidden = f.elements.namedItem("ends_at_ms") as HTMLInputElement;
    hidden.value = Number.isFinite(ms) ? String(ms) : "";
    setEndsAtMs(hidden.value);
  };

  return (
    <ActionForm action={createAuctionAction} onSubmitCapture={onSubmitCapture}>
      <label>
        Title
        <input name="title" maxLength={120} placeholder="e.g. iPhone 12, 128GB, minor scratches" required />
      </label>
      <label>
        Description
        <span className="hint">Describe the condition honestly: wear, faults, what's included.</span>
        <textarea name="description" maxLength={5000} required />
      </label>
      <div className="two">
        <label>
          Category
          <select name="category" defaultValue="Other">
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          Condition
          <select name="condition" defaultValue="Used - Good">
            {conditions.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>
      <fieldset className="choices">
        <legend>Size, for pricing delivery</legend>
        {SIZES.map((s) => (
          <label key={s.value} className="choice">
            <input type="radio" name="size" value={s.value} defaultChecked={s.value === "medium"} required /> <strong>{s.label}</strong>{" "}
            <span className="muted small">{s.hint}</span>
          </label>
        ))}
      </fieldset>
      <div className="two">
        <label>
          Collection city or town
          <span className="hint">Where the delivery partner picks it up</span>
          <input name="pickup_city" placeholder="e.g. Kumasi" required />
        </label>
        <label>
          Region
          <span className="hint">&nbsp;</span>
          <select name="pickup_region" defaultValue="" required>
            <option value="" disabled>Choose one</option>
            {GHANA_REGIONS.map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
      </div>
      <label>
        Photo
        <span className="hint">JPG, PNG or WebP, up to 5 MB</span>
        <input name="image" type="file" accept="image/jpeg,image/png,image/webp,image/gif" />
      </label>
      <div className="two">
        <label>
          Starting bid ({CURRENCY})
          <input name="starting_bid" inputMode="decimal" placeholder="50.00" required />
        </label>
        <label>
          Minimum bid increment ({CURRENCY})
          <span className="hint">Each new bid must beat the last by at least this</span>
          <input name="min_increment" inputMode="decimal" placeholder="5.00" required />
        </label>
      </div>
      <label>
        Auction length
        <select value={duration} onChange={(e) => setDuration(e.target.value)}>
          {DURATIONS.map((d) => (
            <option key={d.v} value={d.v}>
              {d.l}
            </option>
          ))}
        </select>
      </label>
      {duration === "custom" && (
        <label>
          Ends at
          <span className="hint">In your local time</span>
          <input name="ends_local" type="datetime-local" required />
        </label>
      )}
      <input type="hidden" name="ends_at_ms" defaultValue={endsAtMs} />
      <div>
        <Submit>Start auction</Submit>
      </div>
    </ActionForm>
  );
}
