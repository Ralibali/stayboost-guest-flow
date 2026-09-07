import { describe, expect, it } from "vitest";
import {
  bookingLanguage,
  glampingEmbedTarget,
  isGlampingProperty,
  isHostedStripeCheckout,
} from "./glamping-embed";

describe("Glamping embed contract", () => {
  it("requires a configured property, explicit embed mode and the correct parent", () => {
    expect(
      glampingEmbedTarget(
        "example",
        "example",
        "?embed=goglamping",
        "https://goglampingsweden.se/boka",
      ),
    ).toBe("https://goglampingsweden.se");
    expect(
      glampingEmbedTarget("example", undefined, "?embed=goglamping", "https://goglampingsweden.se"),
    ).toBeNull();
    expect(
      glampingEmbedTarget("other", "example", "?embed=goglamping", "https://goglampingsweden.se"),
    ).toBeNull();
    expect(glampingEmbedTarget("example", "example", "", "https://goglampingsweden.se")).toBeNull();
    expect(
      glampingEmbedTarget(
        "example",
        "example",
        "?embed=goglamping",
        "https://goglampingsweden.se.evil.example",
      ),
    ).toBeNull();
    expect(glampingEmbedTarget("example", "example", "?embed=goglamping", "")).toBeNull();
  });
  it("does not change other properties' booking terms", () => {
    expect(isGlampingProperty("other", "example")).toBe(false);
    expect(isGlampingProperty("example", "example")).toBe(true);
    expect(isGlampingProperty("", undefined)).toBe(false);
  });
  it("only accepts supported languages", () => {
    for (const lang of ["sv", "en", "de"]) expect(bookingLanguage(`?lang=${lang}`)).toBe(lang);
    expect(bookingLanguage("?lang=unknown")).toBeNull();
    expect(bookingLanguage("")).toBeNull();
  });
  it("rejects a substituted payment destination", () => {
    expect(isHostedStripeCheckout("https://checkout.stripe.com/c/pay/test")).toBe(true);
    expect(isHostedStripeCheckout("https://checkout.stripe.com.evil.example/pay")).toBe(false);
    expect(isHostedStripeCheckout("javascript:alert(1)")).toBe(false);
    expect(isHostedStripeCheckout("https://user@checkout.stripe.com/pay")).toBe(false);
  });
});
