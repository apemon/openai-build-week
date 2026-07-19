# Prepared Demo prompt audio

The committed MP3 files were generated locally with `gpt-4o-mini-tts` and the
`marin` voice by `npm run generate:demo-audio`. Each file uses the corresponding
`teamBillingPrompts[*].spokenQuestion` as its input. Container, duration, and
non-silence checks passed after generation.

Listen to all eight files and confirm the spoken words match the fixture inputs
before a recorded presentation. The Prepared Demo deliberately continues from
the visible prompt if playback fails.
