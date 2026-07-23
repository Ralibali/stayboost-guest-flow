/*!
 * StayBoost Chatt-widget — bädda in på valfri hemsida:
 * <script src="https://DIN-APP/chat-widget.js"
 *         data-api="https://DITT-PROJEKT.supabase.co/functions/v1/chat-message"
 *         data-slug="DIN-SLUG" async></script>
 *
 * Vanilla JS, inline stilar — krockar aldrig med sidans egen CSS.
 */
(function () {
  var script = document.currentScript;
  if (!script) return;
  var api = script.getAttribute("data-api");
  var slug = script.getAttribute("data-slug");
  if (!api || !slug) return;

  fetch(api + "?slug=" + encodeURIComponent(slug))
    .then(function (r) {
      return r.json();
    })
    .then(function (cfg) {
      if (!cfg || !cfg.enabled) return;
      init(cfg);
    })
    .catch(function () {
      /* tyst — en chatt-widget får aldrig störa sidan den bor på */
    });

  function init(cfg) {
    var color = cfg.color || "#1B1B19";
    var side = cfg.position === "left" ? "left" : "right";
    var offset = side + ":24px;";

    // ---------- Knapp-bubbla ----------
    var bubble = document.createElement("button");
    bubble.setAttribute("aria-label", cfg.title || "Chatta med oss");
    bubble.style.cssText =
      "position:fixed;bottom:24px;" +
      offset +
      "z-index:99998;width:56px;height:56px;border-radius:50%;border:none;cursor:pointer;" +
      "background:" +
      color +
      ";display:flex;align-items:center;justify-content:center;" +
      "box-shadow:0 2px 12px rgba(0,0,0,0.12);transition:transform .15s;";
    bubble.innerHTML =
      '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
    bubble.onmouseenter = function () {
      bubble.style.transform = "scale(1.06)";
    };
    bubble.onmouseleave = function () {
      bubble.style.transform = "scale(1)";
    };

    // ---------- Panel ----------
    var panel = document.createElement("div");
    panel.style.cssText =
      "position:fixed;bottom:92px;" +
      offset +
      "z-index:99999;width:340px;max-width:calc(100vw - 32px);" +
      "background:#FAFAF8;border:1px solid #E7E7E1;border-radius:4px;" +
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;" +
      "display:none;overflow:hidden;";
    panel.innerHTML =
      '<div style="padding:20px 20px 16px;border-bottom:1px solid #E7E7E1;">' +
      '<div style="font-size:16px;font-weight:600;color:#1B1B19;">' +
      esc(cfg.title || "Chatta med oss") +
      "</div>" +
      '<div style="margin-top:4px;font-size:13px;line-height:1.5;color:#8B8B85;">' +
      esc(cfg.greeting || "") +
      "</div>" +
      "</div>" +
      '<div style="padding:16px 20px 20px;">' +
      '<input type="text" name="company" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px;" aria-hidden="true" />' +
      field("sb-name", "Namn (valfritt)") +
      field("sb-email", "Din e-post", "email") +
      '<textarea class="sb-input" placeholder="Ditt meddelande…" rows="3" style="' +
      inputCss() +
      'resize:none;"></textarea>' +
      '<button class="sb-send" style="margin-top:12px;width:100%;padding:13px;border:none;border-radius:999px;' +
      "background:" +
      color +
      ';color:#fff;font-size:14px;font-weight:600;cursor:pointer;">' +
      esc(cfg.buttonLabel || "Skicka") +
      "</button>" +
      '<div class="sb-status" style="margin-top:8px;font-size:12px;color:#8B8B85;text-align:center;min-height:16px;"></div>' +
      "</div>";

    document.body.appendChild(bubble);
    document.body.appendChild(panel);

    var open = false;
    bubble.onclick = function () {
      open = !open;
      panel.style.display = open ? "block" : "none";
      if (open) {
        var emailInput = panel.querySelector(".sb-email");
        if (emailInput) emailInput.focus();
      }
    };

    panel.querySelector(".sb-send").onclick = function () {
      var status = panel.querySelector(".sb-status");
      var email = panel.querySelector(".sb-email").value.trim();
      var message = panel.querySelector(".sb-input").value.trim();
      var name = panel.querySelector(".sb-name").value.trim();
      var company = panel.querySelector('[name="company"]').value;

      if (!email || email.indexOf("@") < 0) {
        status.textContent = "Ange din e-post så vi kan svara.";
        status.style.color = "#A33B2A";
        return;
      }
      if (message.length < 2) {
        status.textContent = "Skriv ett meddelande först.";
        status.style.color = "#A33B2A";
        return;
      }

      var btn = panel.querySelector(".sb-send");
      btn.disabled = true;
      status.style.color = "#8B8B85";
      status.textContent = "Skickar…";

      fetch(api, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: slug,
          name: name,
          email: email,
          message: message,
          pageUrl: window.location.href,
          company: company,
        }),
      })
        .then(function (r) {
          return r.json().then(function (d) {
            return { ok: r.ok, d: d };
          });
        })
        .then(function (res) {
          if (res.ok && res.d.ok) {
            panel.querySelector(".sb-input").value = "";
            status.style.color = "#1B1B19";
            status.textContent = "Tack! Vi återkommer så snart vi kan.";
            setTimeout(function () {
              panel.style.display = "none";
              open = false;
              status.textContent = "";
            }, 2600);
          } else {
            status.style.color = "#A33B2A";
            status.textContent = "Något gick fel — försök igen om en stund.";
          }
        })
        .catch(function () {
          status.style.color = "#A33B2A";
          status.textContent = "Något gick fel — försök igen om en stund.";
        })
        .finally(function () {
          btn.disabled = false;
        });
    };
  }

  function field(cls, placeholder, type) {
    return (
      '<input class="' +
      cls +
      '" type="' +
      (type || "text") +
      '" placeholder="' +
      placeholder +
      '" style="' +
      inputCss() +
      '" />'
    );
  }

  function inputCss() {
    return (
      "width:100%;box-sizing:border-box;border:none;border-bottom:1px solid #E7E7E1;" +
      "background:transparent;padding:10px 2px;font-size:14px;color:#1B1B19;outline:none;" +
      "margin-bottom:10px;font-family:inherit;"
    );
  }

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
})();
