"use client";

import { useEffect, useRef, useState } from "react";
import { ActionForm, Submit } from "./Form.tsx";
import { partnerDeliverAction } from "@/app/actions.ts";

/** What a delivery partner fills in at the door: the winner's code, or their signature. */
export default function DeliverForm({ orderId, codeLocked }: { orderId: number; codeLocked: boolean }) {
  const [method, setMethod] = useState<"code" | "signature">(codeLocked ? "signature" : "code");
  const [signature, setSignature] = useState("");
  return (
    <ActionForm action={partnerDeliverAction}>
      <input type="hidden" name="order_id" value={orderId} />
      <input type="hidden" name="method" value={method} />
      <fieldset className="choices">
        <legend>Proof of delivery</legend>
        <label className="choice">
          <input type="radio" checked={method === "code"} disabled={codeLocked} onChange={() => setMethod("code")} /> Winner&apos;s 6-digit delivery code
        </label>
        <label className="choice">
          <input type="radio" checked={method === "signature"} onChange={() => setMethod("signature")} /> Recipient&apos;s signature
        </label>
      </fieldset>
      {codeLocked && <div className="msg err">Too many wrong codes were entered. Take a signature instead.</div>}
      <label>
        Received by
        <input name="recipient" placeholder="Name of the person who took the parcel" required />
      </label>
      {method === "code" ? (
        <label>
          Delivery code
          <input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" placeholder="••••••" required className="code-input" />
        </label>
      ) : (
        <>
          <SignaturePad onChange={setSignature} />
          <input type="hidden" name="signature" value={signature} />
        </>
      )}
      <div><Submit>Confirm delivery</Submit></div>
    </ActionForm>
  );
}

function SignaturePad({ onChange }: { onChange: (dataUrl: string) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const c = ref.current!;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio;
    c.height = c.offsetHeight * ratio;
    const ctx = c.getContext("2d")!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#111";
  }, []);

  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  const down = (e: React.PointerEvent) => {
    drawing.current = true;
    ref.current!.setPointerCapture(e.pointerId);
    const ctx = ref.current!.getContext("2d")!;
    ctx.beginPath();
    ctx.moveTo(...pos(e));
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const ctx = ref.current!.getContext("2d")!;
    ctx.lineTo(...pos(e));
    ctx.stroke();
    if (empty) setEmpty(false);
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    onChange(ref.current!.toDataURL("image/png"));
  };
  const clear = () => {
    const c = ref.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setEmpty(true);
    onChange("");
  };

  return (
    <div className="sigwrap">
      <div className="spread small"><strong>Signature</strong><button type="button" className="btn link" onClick={clear}>Clear</button></div>
      <canvas ref={ref} className="sigpad" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} aria-label="Sign here" />
      {empty && <div className="small muted">Ask the recipient to sign in the box.</div>}
    </div>
  );
}
