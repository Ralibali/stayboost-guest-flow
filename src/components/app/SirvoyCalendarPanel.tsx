import { useEffect, useRef, useState } from "react";
import { supabase, type Booking } from "@/lib/supabase";
import {
  formatSirvoyDecimal,
  matchingSirvoyValues,
  type SirvoyCalendarValues,
} from "@/lib/sirvoy-calendar";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

type SourceDetail = {
  record: { id: string; source_row: number; fields: string[] };
  headers: string[];
  filename: string;
};

export function SirvoyCalendarPanel({
  booking,
  values,
}: {
  booking: Booking;
  values?: SirvoyCalendarValues | null;
}) {
  const source = matchingSirvoyValues(booking, values);
  const [detail, setDetail] = useState<SourceDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    const current = generation;
    setDetail(null);
    setLoading(false);
    setError("");
    return () => {
      current.current++;
    };
  }, [
    booking.id,
    booking.property_id,
    booking.source_accommodation_record_id,
    booking.source_booking_record_id,
  ]);

  const showOriginal = async (kind: "accommodation" | "booking") => {
    if (!supabase || !source) return;
    const ticket = ++generation.current;
    const recordId =
      kind === "accommodation"
        ? source.source_accommodation_record_id
        : source.source_booking_record_id;
    const filename =
      kind === "accommodation" ? source.accommodation_filename : source.booking_filename;
    const row = kind === "accommodation" ? source.accommodation_row : source.booking_row;
    setDetail(null);
    setLoading(true);
    setError("");
    try {
      const result = await supabase.functions.invoke("sirvoy-records", {
        body: { action: "detail", propertyId: booking.property_id, recordId },
      });
      const data = result.data as SourceDetail | null;
      if (
        result.error ||
        !data ||
        data.record?.id !== recordId ||
        data.filename !== filename ||
        data.record.source_row !== row ||
        !Array.isArray(data.headers) ||
        !Array.isArray(data.record.fields) ||
        data.headers.length !== data.record.fields.length
      ) {
        throw new Error("source_unavailable");
      }
      if (ticket === generation.current) setDetail(data);
    } catch {
      if (ticket === generation.current)
        setError("Originalraden kunde inte hämtas. Försök igen om en stund.");
    } finally {
      if (ticket === generation.current) setLoading(false);
    }
  };

  return (
    <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <h3 className="text-sm font-semibold">Sirvoy · bokning i kalendern</h3>
      <p className="text-xs text-amber-950/80">
        Beloppen nedan är uppgifter från originalexporten. Betalning är inte avstämd i StayBoost.
        Automatiska gästmeddelanden är avstängda.
      </p>
      {source ? (
        <>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt>Boendets belopp i exporten</dt>
              <dd className="font-semibold">{formatSirvoyDecimal(source.accommodation_amount)}</dd>
            </div>
            <div>
              <dt>Hela bokningens belopp i exporten</dt>
              <dd className="font-semibold">{formatSirvoyDecimal(source.booking_total)}</dd>
            </div>
            <div>
              <dt>Fältet ”Paid” i originalet</dt>
              <dd className="whitespace-pre-wrap font-semibold">
                {source.booking_paid_raw === null || source.booking_paid_raw === ""
                  ? "Tomt"
                  : source.booking_paid_raw}
              </dd>
            </div>
            <div>
              <dt>Valuta</dt>
              <dd>{source.currency ?? "Inte verifierad i källunderlaget"}</dd>
            </div>
          </dl>
          <p className="text-xs">
            Fältet ”Paid” är ett råvärde från Sirvoy och bekräftar inte en betalning i StayBoost.
          </p>
          <div className="space-y-2 border-t border-amber-200 pt-3 text-xs">
            <p>
              Bokningsreferens {source.source_booking_ref} · rum {source.source_room_ref}
            </p>
            {(["accommodation", "booking"] as const).map((kind) => (
              <div key={kind}>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void showOriginal(kind)}
                  className="text-left font-semibold underline disabled:opacity-40"
                >
                  Visa {kind === "accommodation" ? "boendets" : "bokningens"} originalrad
                </button>
                <p className="break-words">
                  {kind === "accommodation"
                    ? source.accommodation_filename
                    : source.booking_filename}{" "}
                  · datarad{" "}
                  {kind === "accommodation" ? source.accommodation_row : source.booking_row}
                </p>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p role="alert" className="text-sm">
          Källbeloppen kunde inte hämtas. Läs in bokningen igen. Betalningsavstämning och
          gästutskick är fortsatt avstängda.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <Dialog
        open={loading || detail !== null}
        onOpenChange={(open) => {
          if (!open) {
            generation.current++;
            setDetail(null);
            setLoading(false);
          }
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogTitle className="pr-6">
            {detail
              ? `${detail.filename}, datarad ${detail.record.source_row}`
              : "Hämtar originalraden…"}
          </DialogTitle>
          <DialogDescription>
            Ursprungliga fält från den bevarade Sirvoy-exporten. Tomma fält visas som ”tomt”.
          </DialogDescription>
          {detail && (
            <dl className="divide-y divide-line">
              {detail.headers.map((header, index) => (
                <div key={index} className="grid gap-1 py-2 text-sm sm:grid-cols-3">
                  <dt className="font-semibold">{header || `Kolumn ${index + 1} (utan rubrik)`}</dt>
                  <dd className="whitespace-pre-wrap break-words sm:col-span-2">
                    {detail.record.fields[index] || <span className="text-ink/40">tomt</span>}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
