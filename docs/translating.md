# Translating FeedKeeper

The web interface is available in English, German and Japanese. Adding or improving a language is a great first contribution, and you do not need to write any application code.

## Improve an existing translation

1. Open the file for the language in `web/src/i18n/locales/` (`en.json`, `de.json` or `ja.json`).
2. Change the text. Keys (the left side) stay the same.
3. Keep placeholders such as `{{count}}` or `{{name}}` exactly as they are; they are filled in by the app.
4. Open a pull request.

## Add a new language

1. Copy `web/src/i18n/locales/en.json` to `web/src/i18n/locales/<code>.json`, using a [language code](https://www.iana.org/assignments/language-subtag-registry) such as `fr` or `pt-BR`, and translate the values.
2. Register it in `web/src/i18n/index.ts`: import the file, add it to `resources` and to `supportedLngs`.
3. Add it to the list in `web/src/components/LanguageSwitcher.tsx`, labeled in the language itself (for example `Français`).
4. Mention the new language in the README features list.
5. Run `npm test`. The locale test fails if your file is missing keys or has unknown ones.

## Tips

- Check the result in the app: set the language in Settings → Reading & appearance and click through the screens that use your text.
- Keep button labels short; many of them sit in narrow mobile layouts.
- Use plural-aware wording where the English text has a count, and ask in your pull request if you are unsure how a string is used.
- A best-effort translation is welcome. Maintainers and other contributors will review it.
