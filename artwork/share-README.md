# Paperwork social card

`share-20261024.svg` is the editable layout. It uses the existing `press-20261024.png`, the original icon geometry and `public/fonts/SpaceGrotesk.ttf`; no screenshot is generated or altered. The committed PNG is `public/social/paperwork-20261024.png`.

The export used `@resvg/resvg-wasm` 2.6.2 and HarfBuzz 14.6.0 from tools already available on the development host. Pin the variable font to weights 400 and 700 with `hb-subset --keep-everything --variations=wght=400` (and 700), supply both static instances as Resvg font buffers, and resolve the SVG's relative press-image reference to the existing PNG. Render at the authored 1200×630 dimensions. This is artwork maintenance, not an app build dependency; production builds use the committed PNG. Input/output hashes are in `share-provenance-20261024.json`.
