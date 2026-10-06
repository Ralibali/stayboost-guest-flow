import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { EngineUnit } from "@/lib/booking-offer";
import type { Lang } from "@/lib/boka-i18n";
import { unitAmenityLabel, unitDisplayImages } from "../../supabase/functions/_shared/unit-content";

const labels = {
  sv: {
    details: "Se alla bilder och läs mer",
    gallery: "Bilder på boendet",
    previous: "Föregående bild",
    next: "Nästa bild",
    amenities: "Alla bekvämligheter",
    image: "Bild",
    of: "av",
  },
  en: {
    details: "See all photos and details",
    gallery: "Accommodation photos",
    previous: "Previous photo",
    next: "Next photo",
    amenities: "All amenities",
    image: "Photo",
    of: "of",
  },
  de: {
    details: "Alle Bilder und Details ansehen",
    gallery: "Bilder der Unterkunft",
    previous: "Vorheriges Bild",
    next: "Nächstes Bild",
    amenities: "Alle Ausstattungsmerkmale",
    image: "Bild",
    of: "von",
  },
  da: {
    details: "Se alle billeder og læs mere",
    gallery: "Billeder af overnatningsstedet",
    previous: "Forrige billede",
    next: "Næste billede",
    amenities: "Alle faciliteter",
    image: "Billede",
    of: "af",
  },
  no: {
    details: "Se alle bilder og les mer",
    gallery: "Bilder av overnattingsstedet",
    previous: "Forrige bilde",
    next: "Neste bilde",
    amenities: "Alle fasiliteter",
    image: "Bilde",
    of: "av",
  },
};

export function UnitDetails({ unit, lang }: { unit: EngineUnit; lang: Lang }) {
  const [index, setIndex] = useState(0);
  const images = unitDisplayImages(unit);
  const selected = Math.min(index, Math.max(0, images.length - 1));
  const image = images[selected];
  const text = labels[lang];
  const move = (delta: number) => setIndex((selected + delta + images.length) % images.length);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="w-full border-t px-4 py-3 text-left text-[12px] font-semibold text-[#2F5948] underline underline-offset-4"
        >
          {text.details}
        </button>
      </DialogTrigger>
      <DialogContent
        className="max-h-[90dvh] max-w-2xl overflow-y-auto rounded-[24px] bg-white p-5 sm:p-7"
        aria-describedby={unit.description ? `unit-description-${unit.id}` : undefined}
      >
        <DialogTitle className="pr-7 font-[Fraunces] text-2xl leading-snug">
          {unit.name}
        </DialogTitle>
        {image && (
          <div
            role="group"
            aria-roledescription="carousel"
            aria-label={text.gallery}
            tabIndex={0}
            className="rounded-xl outline-offset-4"
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                move(-1);
              }
              if (event.key === "ArrowRight") {
                event.preventDefault();
                move(1);
              }
              if (event.key === "Home") {
                event.preventDefault();
                setIndex(0);
              }
              if (event.key === "End") {
                event.preventDefault();
                setIndex(images.length - 1);
              }
            }}
          >
            <img
              src={image.url}
              alt={image.altText || `${unit.name} · ${text.image} ${selected + 1}`}
              className="max-h-[50dvh] w-full rounded-xl bg-[#F4F2ED] object-contain"
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <button
                type="button"
                disabled={images.length < 2}
                onClick={() => move(-1)}
                aria-label={text.previous}
                className="rounded-full border p-2 disabled:opacity-30"
              >
                <ChevronLeft size={18} />
              </button>
              <span aria-live="polite" aria-atomic="true" className="text-[12px]">
                {text.image} {selected + 1} {text.of} {images.length}
              </span>
              <button
                type="button"
                disabled={images.length < 2}
                onClick={() => move(1)}
                aria-label={text.next}
                className="rounded-full border p-2 disabled:opacity-30"
              >
                <ChevronRight size={18} />
              </button>
            </div>
            {images.length > 1 && (
              <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
                {images.map((item, position) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setIndex(position)}
                    aria-label={`${text.image} ${position + 1} ${text.of} ${images.length}`}
                    aria-pressed={position === selected}
                    className={`shrink-0 rounded-lg border-2 p-0.5 ${position === selected ? "border-[#2F5948]" : "border-transparent"}`}
                  >
                    <img
                      src={item.url}
                      alt=""
                      loading="lazy"
                      className="h-14 w-20 rounded-md object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {unit.description && (
          <DialogDescription
            id={`unit-description-${unit.id}`}
            className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-[#17231D]"
          >
            {unit.description}
          </DialogDescription>
        )}
        {unit.amenities.length > 0 && (
          <section>
            <h3 className="text-[14px] font-bold">{text.amenities}</h3>
            <ul className="mt-2 flex flex-wrap gap-2">
              {unit.amenities.map((amenity, position) => (
                <li
                  key={`${amenity}-${position}`}
                  className="rounded-full bg-[#E9F0EC] px-3 py-1.5 text-[12px]"
                >
                  {unitAmenityLabel(amenity, lang)}
                </li>
              ))}
            </ul>
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}
