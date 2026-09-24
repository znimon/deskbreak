# DeskBreak

DeskBreak is a movement timer for people who sit for most of a working session. It prompts short movement breaks at research-based intervals. It does not replace regular aerobic or strength exercise.

## How it works

- DeskBreak prompts a movement break at a configurable interval (default 30 minutes, adjustable in Settings).
- Each break offers a plain walk, or a short bundle of movements — the exercise pool and bundles are configurable in `src/exercises.yaml`.
- A walk is always an acceptable choice for the full length of any break.

## Research

Short activity breaks during long sitting periods reduce the acute glucose and insulin effects of sitting, even without a full exercise session. This schedule is based on:

- Dunstan DW, Kingwell BA, Larsen R, et al. "Breaking Up Prolonged Sitting Reduces Postprandial Glucose and Insulin Responses." *Diabetes Care*, 2012.
- Healy GN, Dunstan DW, Salmon J, et al. "Breaks in Sedentary Time: Beneficial Associations With Metabolic Risk." *Diabetes Care*, 2008.
- Dempsey PC, Larsen RN, Sethi P, et al. "Benefits for Type 2 Diabetes of Interrupting Prolonged Sitting With Brief Bouts of Light Walking or Simple Resistance Activities." *Diabetes Care*, 2016.
- Owen N, Healy GN, Matthews CE, Dunstan DW. "Too Much Sitting: The Population-Health Science of Sedentary Behavior." *Exercise and Sport Sciences Reviews*, 2010.

DeskBreak gives general movement reminders. It is not medical care and does not treat any condition. Stop an exercise that causes pain, dizziness, or unusual symptoms, and seek medical advice when needed.

## Development

DeskBreak is a static site with no build step. Serve the `src/` directory with any static file server:

```
cd src
python3 -m http.server 8000
```

Then open `http://localhost:8000` in a browser.

## Privacy

DeskBreak runs entirely in the browser. It has no account and no backend. Activity history stays on the device.

## License

MIT
