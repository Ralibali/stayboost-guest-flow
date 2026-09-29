import { afterEach, describe, expect, it, vi } from 'vitest';
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
describe('acquisition and interaction context', () => {
  it('requires consent and keeps landing UTMs separate from UI placement', async () => {
    const gtag = vi.fn();
    vi.stubGlobal('window', {
      location: { hostname: 'example.test', origin: 'https://example.test', href: 'https://example.test/?utm_source=newsletter&utm_medium=email', search: '?utm_source=newsletter&utm_medium=email' },
      history: { pushState: vi.fn(), replaceState: vi.fn() }, addEventListener: vi.fn(), gtag,
    });
    vi.stubGlobal('document', { referrer: '', cookie: '', querySelector: () => ({}), addEventListener: vi.fn() });
    vi.stubGlobal('localStorage', { getItem: () => 'declined' });
    const { initGa4, setAnalyticsConsent, sendAnalyticsEvent } = await import('./ga4Runtime');
    initGa4({ measurementId: 'G-TEST123', hosts: ['example.test'], excluded: ['/admin'], consentKey: 'test' });
    gtag.mockClear();
    sendAnalyticsEvent('Form Submitted', { props: { source: 'hero' } });
    expect(gtag).not.toHaveBeenCalled();
    setAnalyticsConsent(true);
    expect(gtag).toHaveBeenCalledWith('config', 'G-TEST123', expect.objectContaining({ campaign_source: 'newsletter', campaign_medium: 'email', send_page_view: false }));
    gtag.mockClear();
    sendAnalyticsEvent('Form Submitted', { props: { source: 'hero', campaign: 'internal_offer', email: 'private@example.test' } });
    expect(gtag).toHaveBeenCalledOnce();
    const payload = gtag.mock.calls[0][2];
    expect(payload).toMatchObject({ interaction_source: 'hero', interaction_campaign: 'internal_offer', page_location: 'https://example.test/' });
    for (const key of ['source', 'campaign', 'email']) expect(payload).not.toHaveProperty(key);
    setAnalyticsConsent(false);
    gtag.mockClear();
    sendAnalyticsEvent('Form Submitted');
    expect(gtag).not.toHaveBeenCalled();
  });
});
