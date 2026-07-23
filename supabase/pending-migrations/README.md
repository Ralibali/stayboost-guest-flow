# Pending migrations (not yet deployed)

Dessa SQL-filer är förberedda för produktionsuppgraderingen men har medvetet **inte** körts mot databasen. Kör dem i ordning nästa gång du kör `supabase db push` mot dev/prod:

1. `20260724000000_admin_audit_log.sql` — audit-logg för administrativa ändringar (RLS scopat till ägaren).
2. `20260724100000_rate_rules.sql` — datumstyrda prisregler, stängda datum och ankomst-/avresespärrar.

Klientkoden är bakåtkompatibel: appen fungerar utan dessa tabeller. När tabellerna finns börjar audit-loggning och prisregler användas automatiskt.
