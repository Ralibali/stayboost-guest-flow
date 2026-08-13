// Minimal mock av Supabase edge functions för visuell verifiering.
import http from "node:http";

const json = (res, body, status = 200) => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  });
  res.end(JSON.stringify(body));
};

const MONTHLY = [70, 70, 80, 90, 100, 110, 115, 115, 100, 85, 70, 70];

const engineData = {
  property: {
    name: "Göta kanal Glamping",
    slug: "gota-kanal-glamping",
    checkinTime: "15:00",
    checkoutTime: "11:00",
    swishNumber: "123 456 78 90",
    stripeAvailable: true,
  },
  units: [
    {
      id: "u1",
      name: "Glampingtält Ek",
      basePrice: 950,
      weekendPct: 25,
      minStay: 2,
      cleaningFee: 250,
      monthlyMult: MONTHLY,
      booked: [
        { from: "2026-08-18", to: "2026-08-21" },
        { from: "2026-09-04", to: "2026-09-06" },
      ],
    },
    {
      id: "u2",
      name: "Glampingtält Ask",
      basePrice: 1095,
      weekendPct: 25,
      minStay: 2,
      cleaningFee: 250,
      monthlyMult: MONTHLY,
      booked: [{ from: "2026-08-25", to: "2026-08-28" }],
    },
  ],
  addons: [
    {
      id: "a1",
      name: "Frukostkorg",
      description: "Lokalproducerat: bröd, ost, ägg och kaffe.",
      price: 145,
      priceType: "per_night",
      imageUrl: null,
    },
    {
      id: "a2",
      name: "Ved till kaminen",
      description: "En säck torr björkved.",
      price: 85,
      priceType: "per_booking",
      imageUrl: null,
    },
    {
      id: "a3",
      name: "Sen utcheckning",
      description: "Stanna till 14:00 på avresedagen.",
      price: 200,
      priceType: "per_booking",
      imageUrl: null,
    },
  ],
};

const guestData = {
  guestName: "Anna",
  checkinDate: "2026-08-21",
  checkoutDate: "2026-08-23",
  unit: {
    name: "Glampingtält Ek",
    door_code: "4271",
    checkin_instructions: "Nyckelboxen sitter på stolpen vid tältet.",
  },
  property: {
    name: "Göta kanal Glamping",
    checkin_time: "15:00",
    checkout_time: "11:00",
    directions: "Följ vägen längs kanalen, parkera vid den stora eken.",
    wifi_name: "GotaKanal-Gast",
    wifi_password: "sommar2026",
    house_rules: "Tyst efter 22:00. Inga fyrverkerier.",
    contact_phone: "070-123 45 67",
    swish_number: "123 456 78 90",
  },
  payment: { status: "paid", amount: 2190, ref: "SB-0821-ANNA", expiresAt: null },
};

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (req.method === "OPTIONS") return json(res, {});
    if (url.pathname === "/functions/v1/booking-engine" && req.method === "GET")
      return json(res, engineData);
    if (url.pathname === "/functions/v1/booking-engine" && req.method === "POST")
      return json(res, { ok: true, token: "a".repeat(24), total: 2190 });
    if (url.pathname === "/functions/v1/guest-page") return json(res, guestData);
    return json(res, { error: "not_mocked", path: url.pathname }, 404);
  })
  .listen(3999, () => console.log("mock på :3999"));
