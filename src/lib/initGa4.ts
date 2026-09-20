import { initGa4 } from "./ga4Runtime";
export function initializeSiteAnalytics() {
  initGa4({
    measurementId: "G-7VM7W21VH9",
    hosts: ["stayboost.se", "www.stayboost.se"],
    excluded: ["/app", "/g", "/admin"],
    consentKey: "stayboost_ga4_consent_v1",
  });
}
