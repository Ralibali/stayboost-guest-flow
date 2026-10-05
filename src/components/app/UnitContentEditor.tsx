import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { supabase, type Unit } from "@/lib/supabase";
import { SUPABASE_URL } from "@/lib/supabase-config";
import { sanitizedHttpsUrl } from "../../../supabase/functions/_shared/public-links";
import { saveUnitContentDraft, unitContentSnapshot } from "@/lib/unit-content-save";
import {
  CONTENT_LANGUAGES,
  MAX_GALLERY_IMAGES,
  isUnitGallery,
  isUnitTranslations,
  unitImageUrl,
  type ContentLanguage,
  type UnitGalleryImage,
  type UnitTranslations,
} from "../../../supabase/functions/_shared/unit-content";

const languageNames: Record<ContentLanguage, string> = {
  sv: "Svenska",
  en: "Engelska",
  de: "Tyska",
  da: "Danska",
  no: "Norska",
};
const extensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

export function UnitContentEditor({ unit, onSaved }: { unit: Unit; onSaved: () => void }) {
  const [translations, setTranslations] = useState<UnitTranslations>(() => ({
    ...unit.content_translations,
    sv: unit.content_translations?.sv ?? { name: unit.name, description: unit.description },
  }));
  const [gallery, setGallery] = useState<UnitGalleryImage[]>(unit.gallery ?? []);
  const [fallbackImage, setFallbackImage] = useState(unit.image_url ?? "");
  const [language, setLanguage] = useState<ContentLanguage>("sv");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const original = useRef(unitContentSnapshot(unit));
  const pendingPaths = useRef(new Set<string>());
  const input = useRef<HTMLInputElement>(null);
  const current = translations[language];

  const changed = () => {
    setDirty(true);
    setSaved(false);
    setError(null);
  };
  const patchText = (field: "name" | "description", value: string) => {
    setTranslations((old) => ({
      ...old,
      [language]: { name: "", description: null, ...old[language], [field]: value },
    }));
    changed();
  };

  const upload = async (files: File[]) => {
    if (!supabase || !files.length) return;
    setError(null);
    if (gallery.length + files.length > MAX_GALLERY_IMAGES) {
      setError("Galleriet får innehålla högst 100 bilder.");
      return;
    }
    if (files.some((file) => !extensions[file.type] || file.size > 6 * 1024 * 1024)) {
      setError("Välj JPG, PNG, WebP eller AVIF. Varje bild får vara högst 6 MB.");
      return;
    }
    setBusy(true);
    try {
      for (const file of files) {
        const id = crypto.randomUUID();
        const path = `${unit.property_id}/${unit.id}/${id}.${extensions[file.type]}`;
        const { error: uploadError } = await supabase.storage
          .from("unit-images")
          .upload(path, file, { cacheControl: "31536000", upsert: false });
        if (uploadError) throw uploadError;
        pendingPaths.current.add(path);
        setGallery((old) => [...old, { id, storage_path: path, alt_text: "" }]);
        changed();
      }
    } catch {
      setError("Alla bilder kunde inte laddas upp. De uppladdade bilderna finns kvar i utkastet.");
    } finally {
      setBusy(false);
    }
  };

  const move = (index: number, direction: number) => {
    setGallery((old) => {
      const next = [...old];
      [next[index], next[index + direction]] = [next[index + direction], next[index]];
      return next;
    });
    changed();
  };

  const save = async () => {
    if (!supabase) return;
    if (!isUnitTranslations(translations) || !isUnitGallery(gallery, unit.property_id, unit.id)) {
      setError(
        "Varje tillagt språk behöver ett namn. Kontrollera språktexterna och bilderna; ingen text har kortats.",
      );
      return;
    }
    const imageUrl = fallbackImage.trim() ? sanitizedHttpsUrl(fallbackImage) : null;
    if (fallbackImage.trim() && !imageUrl) {
      setError("Reservbilden behöver en giltig https-länk utan inloggningsuppgifter.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const draft = {
        ...original.current,
        content_translations: translations,
        gallery,
        image_url: imageUrl,
        ...(translations.sv
          ? { name: translations.sv.name, description: translations.sv.description }
          : {}),
      };
      if (!(await saveUnitContentDraft(supabase, unit, original.current, draft))) {
        setError(
          "Innehållet har ändrats i ett annat fönster. Ditt utkast finns kvar; kopiera det innan du laddar om sidan.",
        );
        return;
      }
      // Remove only files uploaded in this draft and then discarded. Existing files may be referenced elsewhere.
      const abandoned = [...pendingPaths.current].filter(
        (path) => !gallery.some((image) => image.storage_path === path),
      );
      if (abandoned.length) await supabase.storage.from("unit-images").remove(abandoned);
      pendingPaths.current.clear();
      original.current = draft;
      setDirty(false);
      setSaved(true);
      onSaved();
    } catch {
      setError("Innehållet kunde inte sparas. Ditt utkast finns kvar. Försök igen.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="mt-5 border-t border-[color:var(--line)] pt-5"
      aria-label={`Texter och bilder för ${unit.name}`}
    >
      <h3 className="text-[14px] font-bold">Texter och bilder</h3>
      <p className="mt-1 text-[12px] text-[color:var(--ink)]/60">
        Hela beskrivningen och alla språk bevaras. Ändringarna visas för gästerna när du sparar.
      </p>
      <div className="mt-3 flex flex-wrap gap-2" aria-label="Textens språk">
        {CONTENT_LANGUAGES.map((lang) => (
          <button
            key={lang}
            type="button"
            aria-pressed={language === lang}
            onClick={() => setLanguage(lang)}
            className={`rounded-full border px-3 py-1.5 text-[12px] ${language === lang ? "bg-[color:var(--forest)] text-white" : "bg-white"}`}
          >
            {languageNames[lang]}
            {translations[lang] ? " ✓" : ""}
          </button>
        ))}
      </div>
      <div className="mt-3 space-y-3">
        <label className="block text-[12px] font-semibold">
          Namn · {languageNames[language]}
          <input
            disabled={busy}
            value={current?.name ?? ""}
            onChange={(event) => patchText("name", event.target.value)}
            className="inp mt-1"
          />
        </label>
        <label className="block text-[12px] font-semibold">
          Fullständig beskrivning · {languageNames[language]}
          <textarea
            disabled={busy}
            value={current?.description ?? ""}
            onChange={(event) => patchText("description", event.target.value)}
            rows={8}
            className="inp mt-1 resize-y"
          />
        </label>
        {language !== "sv" && current && (
          <button
            type="button"
            disabled={busy}
            className="text-[12px] text-red-700 underline"
            onClick={() => {
              setTranslations((old) => {
                const next = { ...old };
                delete next[language];
                return next;
              });
              changed();
            }}
          >
            Ta bort denna översättning ur utkastet
          </button>
        )}
        {(language === "da" || language === "no") && (
          <p className="text-[12px] text-[color:var(--ink)]/60">
            Texten sparas här. Bokningens språkval är svenska, engelska och tyska.
          </p>
        )}
      </div>
      <label className="mt-4 block text-[12px] font-semibold">
        Reservbild · används när galleriet är tomt
        <input
          disabled={busy}
          type="url"
          value={fallbackImage}
          onChange={(event) => {
            setFallbackImage(event.target.value);
            changed();
          }}
          placeholder="https://…"
          className="inp mt-1"
        />
      </label>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="text-[13px] font-bold">Galleri · {gallery.length} bilder</h4>
          <p className="text-[12px] text-[color:var(--ink)]/60">
            Första bilden är omslag. Använd originalbilder för bästa kvalitet.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => input.current?.click()}
          className="btn-ghost !px-3 !py-2 text-[12px]"
        >
          <ImagePlus size={14} /> Lägg till bilder
        </button>
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          multiple
          hidden
          onChange={(event) => {
            void upload(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
      </div>
      {!gallery.length && (
        <p className="mt-2 text-[12px] text-[color:var(--ink)]/60">
          Den befintliga omslagsbilden används tills du sparar ett galleri.
        </p>
      )}
      <ol className="mt-3 grid gap-3 sm:grid-cols-2">
        {gallery.map((image, index) => (
          <li key={image.id} className="rounded-xl border border-[color:var(--line)] p-3">
            <img
              src={
                unitImageUrl(SUPABASE_URL, image.storage_path, unit.property_id, unit.id) ??
                undefined
              }
              alt={image.alt_text || `${unit.name}, bild ${index + 1}`}
              className="h-32 w-full rounded-lg object-cover"
              loading="lazy"
            />
            <label className="mt-2 block text-[12px]">
              Bildbeskrivning
              <input
                disabled={busy}
                value={image.alt_text}
                onChange={(event) => {
                  setGallery((old) =>
                    old.map((item) =>
                      item.id === image.id ? { ...item, alt_text: event.target.value } : item,
                    ),
                  );
                  changed();
                }}
                className="inp mt-1"
              />
            </label>
            <div className="mt-2 flex items-center gap-2">
              <span className="mr-auto text-[12px]">
                {index + 1}
                {index === 0 ? " · Omslag" : ""}
              </span>
              <button
                type="button"
                disabled={busy || index === 0}
                onClick={() => move(index, -1)}
                aria-label={`Flytta bild ${index + 1} uppåt`}
                className="p-2 disabled:opacity-30"
              >
                <ArrowUp size={15} />
              </button>
              <button
                type="button"
                disabled={busy || index === gallery.length - 1}
                onClick={() => move(index, 1)}
                aria-label={`Flytta bild ${index + 1} nedåt`}
                className="p-2 disabled:opacity-30"
              >
                <ArrowDown size={15} />
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setGallery((old) => old.filter((item) => item.id !== image.id));
                  changed();
                }}
                aria-label={`Ta bort bild ${index + 1} ur galleriet`}
                className="p-2 text-red-700"
              >
                <Trash2 size={15} />
              </button>
            </div>
          </li>
        ))}
      </ol>
      {error && (
        <p role="alert" className="mt-3 text-[13px] text-red-700">
          {error}
        </p>
      )}
      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          disabled={busy || !dirty}
          onClick={() => void save()}
          className="btn-primary !px-4 !py-2 text-[13px] disabled:opacity-50"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : null} Spara texter och galleri
        </button>
        <span role="status" className="text-[12px]">
          {saved ? "Sparat" : dirty ? "Osparade ändringar" : ""}
        </span>
      </div>
    </section>
  );
}
