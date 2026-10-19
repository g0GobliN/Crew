// Crew tab for the Hermes dashboard.
//
// Hand-written ES5 against window.__HERMES_PLUGIN_SDK__ - there is no build step;
// this file is shipped as-is (manifest.json "entry").
//
// The tab shows the same app the standalone server and Hermes Desktop show (scripts/crew_dashboard/app.js, built
// from ui/src). Auth: /api/plugins/crew/* sits behind Hermes's auth middleware, and a <script src> or an <img src>
// carries no session header (401 in token mode). So the script is fetched once with SDK.authedFetch and run as an
// inline script, and the app is mounted with SDK.authedFetch as its transport: every JSON call it makes (board,
// card, ack) and every face (a data URL from /embed/avatar) goes through it. No credential is ever put in the page.
(function () {
  "use strict";

  var SDK = window.__HERMES_PLUGIN_SDK__;
  if (!SDK) return;
  var React = SDK.React;
  var h = React.createElement;

  var BASE = "/api/plugins/crew";
  // A chat session the card page may ask to open: a profile name and a session id.
  var PROFILE_RE = /^[A-Za-z0-9_.-]{1,64}$/;
  var SESSION_RE = /^[A-Za-z0-9_-]{1,128}$/;

  var appReady = null;   // one fetch of app.js per page load

  function loadApp() {
    if (window.__crewMount) return Promise.resolve();
    if (!appReady) {
      appReady = SDK.authedFetch(BASE + "/app.js")
        .then(function (res) {
          if (!res.ok) throw new Error("HTTP " + res.status);
          return res.text();
        })
        .then(function (text) {
          var el = document.createElement("script");
          el.textContent = text;
          document.head.appendChild(el);
          document.head.removeChild(el);
          if (!window.__crewMount) throw new Error("the app did not start");
        })
        .catch(function (err) { appReady = null; throw err; });
    }
    return appReady;
  }

  // The SDK has no navigate call, so a full navigation to the chat page is the robust way.
  function openChat(profile, session) {
    if (typeof profile === "string" && typeof session === "string" && PROFILE_RE.test(profile) && SESSION_RE.test(session)) {
      window.location.assign((window.__HERMES_BASE_PATH__ || "") + "/chat?resume=" + encodeURIComponent(session) +
        "&profile=" + encodeURIComponent(profile));
    }
  }

  function CrewPage() {
    var hostRef = React.useRef(null);
    var errorState = React.useState(null);
    var error = errorState[0];
    var setError = errorState[1];
    var tryState = React.useState(0);
    var tries = tryState[0];
    var setTries = tryState[1];

    React.useEffect(function () {
      var unmount = null;
      var live = true;
      setError(null);
      loadApp().then(function () {
        if (!live || !hostRef.current) return;
        unmount = window.__crewMount(hostRef.current, { base: BASE, fetch: SDK.authedFetch, openChat: openChat });
      }).catch(function (err) {
        if (live) setError(err.message || String(err));
      });
      return function () { live = false; if (unmount) unmount(); };
    }, [tries]);

    if (error) {
      return h("div", {
        style: {
          padding: "2rem",
          maxWidth: "32rem",
          margin: "4rem auto",
          border: "1px solid var(--border, rgba(255,255,255,0.1))",
          borderRadius: "0.5rem",
          backgroundColor: "var(--card, rgba(255,255,255,0.02))",
          color: "var(--foreground, #ffffff)",
          fontFamily: "var(--font-sans, system-ui, sans-serif)",
          textAlign: "center"
        }
      },
        h("h3", { style: { margin: "0 0 1rem", fontSize: "1.25rem" } }, "Crew Dashboard Unavailable"),
        h("p", { style: { margin: "0 0 1.5rem", opacity: 0.8, fontSize: "0.875rem", lineHeight: 1.5 } },
          "Could not load the Crew app (" + error + "). See the Hermes server log for the error."
        ),
        h("button", {
          onClick: function () { setTries(tries + 1); },
          style: {
            padding: "0.5rem 1.25rem",
            backgroundColor: "var(--primary, #34d399)",
            color: "#041c1c",
            border: "none",
            borderRadius: "0.375rem",
            fontWeight: 600,
            cursor: "pointer"
          }
        }, "Retry")
      );
    }

    return h("div", {
      style: {
        width: "100%",
        height: "calc(100vh - 3.5rem)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column"
      }
    },
      // data-manual: the app is mounted by the effect above with the tab's transport, not by its own startup.
      h("div", { id: "crew-app", "data-manual": "1", "data-base": BASE, ref: hostRef, style: { height: "100%", overflow: "auto" } })
    );
  }

  if (window.__HERMES_PLUGINS__ && window.__HERMES_PLUGINS__.register) {
    window.__HERMES_PLUGINS__.register("crew", CrewPage);
  }
})();
