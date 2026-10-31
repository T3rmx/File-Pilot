// Pre-paint boot: applied before first paint so there is no theme/language flash.
(function () {
  try {
    var stored = localStorage.getItem("fp_theme");
    var system = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    document.documentElement.dataset.theme = stored === "light" || stored === "dark" ? stored : system;
  } catch (e) {
    document.documentElement.dataset.theme = "dark";
  }
})();

(function () {
  try {
    var lang = "en";
    var stored = localStorage.getItem("fp_lang");
    if (stored === "en" || stored === "ar") {
      lang = stored;
    } else {
      var preferred = (navigator.languages && navigator.languages[0]) || navigator.language || "en";
      lang = preferred.toLowerCase().indexOf("ar") === 0 ? "ar" : "en";
    }
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  } catch (e) {
    /* keep the default */
  }
})();
