import { AlertTriangle } from "lucide-react";

/** Operator-visible: Booking.com iCal is one-way poll, not two-way API sync. */
export function BookingComLagNotice({ className = "" }: { className?: string }) {
  return (
    <div
      role="status"
      className={`rounded-2xl border-2 border-amber-400 bg-amber-50 px-4 py-3.5 text-[14px] text-amber-950 ${className}`}
    >
      <p className="flex items-start gap-2 font-semibold">
        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-700" aria-hidden />
        Booking.com läser din exportkalender ungefär var 2–4:e timme
      </p>
      <p className="mt-1.5 leading-relaxed text-amber-950/85">
        Det här är iCal, inte tvåvägs API-synk. En direktbokning hos oss syns inte hos Booking.com
        förrän de pollat feeden. Under det fönstret kan samma nätter säljas två gånger. Blockera
        datum manuellt i extranätet vid risk, eller håll en check-in-buffert. Sirvoy som
        channel manager ger oftast snabbare synk.
      </p>
    </div>
  );
}
