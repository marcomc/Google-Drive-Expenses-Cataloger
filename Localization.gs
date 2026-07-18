function getLocalizationRegistry_() {
  return Object.freeze({ en: getEnglishLocalization_(), it: getItalianLocalization_() });
}

function getLocalization_() {
  return getLocalizationRegistry_()[getAutomationConfig_().locale];
}

function getSupportedLocales_() {
  return Object.keys(getLocalizationRegistry_());
}
