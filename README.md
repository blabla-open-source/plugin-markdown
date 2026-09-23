# Blabla Markdown Plugin

The Markdown plugin for [Blabla](https://blabla.md).

## Development

```sh
cd plugins/markdown
npm ci
npm run check
npm run build
```

Source lives in `plugins/markdown/src`. The plugin runs inside Blabla using its Host API.
Browser preview does not provide Host persistence.

## Installation

The manifest is `plugins/markdown/blabla-plugin.json`. Built `dist/` files are included so installation does not require Node.js.

## License

MIT. See LICENSE. Third-party dependencies and patches retain their original licenses and attribution.
