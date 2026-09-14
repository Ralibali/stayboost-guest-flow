# Kvalitetsfix för GitHub CI

## Omfattning
- Kör projektets Prettier endast på `src/routes/app/mallar.tsx`, `src/components/app/AppShell.tsx` och `src/routes/app/index.tsx`.
- Tillåt endast whitespace och automatiska JSX-radbrytningar; ingen logik, copy eller migration ändras.
- Verifiera de tre filerna med Prettier-kontroll och projektets befintliga ESLint-flöde.

## Leverans
Ändringarna lämnas i projektets nuvarande GitHub-synkade huvudgren. Lovable sköter commit och push automatiskt.
