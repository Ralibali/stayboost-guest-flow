-- StayBoost: kortbetalning via Stripe Checkout (gästens eget kort,
-- operatörens eget Stripe-konto — ingen plattformsprovision).

alter table public.bookings
  add column payment_method text not null default 'none'
    check (payment_method in ('none', 'swish', 'stripe')),
  add column stripe_session_id text;
