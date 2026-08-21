# StayBoost — Grok operating handoff

## Mission

Build StayBoost into the simplest revenue-and-operations platform for small accommodation businesses (initial ICP: 1–20 units such as glamping, cabins, B&Bs, small campsites and boutique stays).

StayBoost should make a small property feel professionally operated without requiring a full-time receptionist or revenue manager.

Core promise:

> Connect your booking sources. StayBoost keeps the operation together, automates the guest journey and helps every stay earn more.

## What already exists on current main

Do not re-audit or rebuild these from zero before checking current implementation:

- direct booking engine
- accommodation/unit capacity and booking validation
- Stripe booking payments and refunds
- Swish-related reservation handling
- guest page / guest journey foundations
- scheduled guest communication
- add-ons / upsell foundations
- admin booking workflows
- Today operations view
- Revenue view with occupancy/channel/revenue metrics
- iCal source configuration, import/export and health state
- Sirvoy-related integration foundations
- rate-rule model and server-side pricing foundations
- Supabase backend, RLS and Edge Functions
- deployment/runbook material

The current `DEPLOY.md` already describes iCal sync every ~15 minutes and scheduled messaging every ~5 minutes. Preserve this reliable baseline until a better connector is verified.

## Repo reconciliation already done

- PR #1 is closed as superseded by modern main. Do not merge it.
- PR #4 is closed because its rate-rules migration already exists on main. Do not redo it.
- PR #5 remains DRAFT / reference only. It contains valuable Guest Experience 2027 capabilities but diverged from newer V2/V3 work. Port only missing capabilities onto a fresh branch from current main.

From PR #5, selectively evaluate/port:

- post-purchase add-ons via guest page + Stripe
- pricing per booking/night/person/person-day
- race-safe daily add-on capacity
- service-day semantics
- timed access-code reveal
- add-on operating instructions / service timing
- explicit consent improvements
- isolated Stripe after-purchase order/webhook flow

Preserve the newer current-main admin, booking and Revenue/Today UX unless a capability is intentionally improved.

## Product hierarchy

Prioritize in this order:

1. ZERO DOUBLE BOOKINGS / DATA LOSS
2. RELIABLE CHANNEL + CALENDAR STATE
3. FAST DAILY OPERATIONS
4. DIRECT BOOKING CONVERSION
5. UPSELL REVENUE PER STAY
6. AUTOMATED GUEST COMMUNICATION
7. RETENTION / CUSTOMER SUCCESS
8. ACQUISITION / SCALE
9. NEW FEATURES

If reliability is uncertain, do not scale sales aggressively yet.

## North Star + mandatory KPIs

Primary North Star:

**Active paying properties that run real stays through StayBoost each month.**

Mandatory supporting metrics:

- MRR
- activated properties
- time from signup to first live unit/channel
- bookings processed/month
- % bookings synchronized without manual intervention
- channel sync failures and consecutive failures
- double-booking incidents (target: 0)
- direct booking conversion
- direct booking share
- upsell revenue per stay
- scheduled-message delivery success
- payment success/failure
- 30/90-day property retention
- support interventions/property/month

Do not report commits, pages, prompts, impressions or feature count as business success by themselves.

## Product loop

Use continuously:

DATA → BOTTLENECK → HYPOTHESIS → IMPLEMENT → TEST → PREVIEW → DEPLOY → PROD VERIFY → MEASURE → NEXT BOTTLENECK

One major primary objective at a time.

## Grok team

Keep the permanent team small to preserve AI capacity.

### StayBoost CEO
Owns product, revenue, pricing, retention, prioritization, customer value and cross-functional execution.

### StayBoost Engineer & Integrations
Owns GitHub, Supabase, payments, channel/calendar connectors, reliability, multi-tenancy, tests, CI/CD, Vercel, observability and production QA.

### StayBoost Growth & Sales
Owns ICP, prospecting, outreach, demo funnel, onboarding, case studies, SEO/CRO and paid acquisition within already-approved budget.

QA/security specialists should be invoked for concrete releases/incidents rather than continuously running independent audits.

## Autonomy

Autonomous:

- normal reversible code fixes
- UX/CRO
- tracking
- tests
- docs
- previews
- SEO
- onboarding
- sales materials
- personalized B2B prospecting with sensible volume and opt-out/compliance
- product experiments
- deploys after gates pass

Owner gate:

- meaningful new external spend
- material pricing/business-model change
- destructive DB migration or data deletion
- secrets/login/2FA requiring owner
- legal commitments
- refunds outside policy
- domain ownership transfer
- large-scale outreach with compliance/reputation risk
- replacing a proven booking source before rollback is verified

## Definition of Done

A change is not DONE because code exists.

For product work:

- implementation complete
- tests pass
- build passes
- preview/browser QA passes
- production deployed when intended
- production verified
- relevant KPI/event verified where applicable
- rollback known for risky changes

For channel sync:

- duplicate-safe
- idempotent
- source/external ID retained
- retries observable
- conflicts conservative
- last successful sync visible
- failure alerting exists
- test fixtures cover create/update/cancel/date changes
- production reconciliation proves state convergence

## Immediate sequence for Grok

Do not start a giant full-product audit.

1. Read this file and `docs/CHANNEL_SYNC_ARCHITECTURE.md`.
2. Verify current main build/test/CI state.
3. Confirm what is actually deployed vs only committed/pending migration.
4. Create a short deployment-gap list only.
5. Finish/verify the reliable core before new feature expansion.
6. Create the first robust channel-sync/reconciliation milestone.
7. Make one real property fully operational end-to-end.
8. Turn that operational proof into a sellable demo/case.
9. Start targeted sales while product reliability remains monitored.

The goal is not to build the most feature-rich PMS. The goal is to become the easiest way for a small host to run bookings, guests and ancillary revenue with minimal administration.