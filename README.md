# Fullban SEQ-TRAK

A controller app for the Yamaha SEQTRAK: mixer, sound, DX (FM) editor, FX, sequencer and M-One pages.

**Open:** https://fullbann.github.io/fullban-seqtrak/ in Chrome (Android or PC), then *Install app*. It works offline once it has loaded.

## Connect
- **Bluetooth (Android):** on the SEQTRAK hold **ALL** and press **SWING** (meter lights white, waits 30 s), then tap **MIDI → Connect Bluetooth**. Don't pair the SEQTRAK in Android's Bluetooth settings.
- **USB:** plug the SEQTRAK into the tablet/PC, then **MIDI → Scan USB**.

Parameter addresses come from the community SEQTRAK protocol docs ([jaeggerr/seqtrak-docs](https://github.com/jaeggerr/seqtrak-docs)).

## Build
`src/` holds the sources; `python src/build.py index.html` bundles them into the single `index.html` served here.
