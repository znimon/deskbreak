# DeskBreak

DeskBreak is a movement timer for people who sit for most of an approximately 8-hour workday. The app prompts short movement breaks at research-based intervals. It does not replace normal aerobic or strength exercise.

## Why

Research on prolonged sitting shows that frequent short activity breaks reduce the acute glucose and insulin effects of sitting. See `projects/desk_movement/requirements.md` in this developer's local notes for the full research basis and requirements, and the in-app Evidence page (added in a later feature) for the same information.

## How it works

* The default schedule prompts a movement break every 30 minutes.
* Breaks alternate between two styles:
  * **Break A** — a 3-5 minute walk.
  * **Break B** — a 2-3 minute walk, plus optional resistance or mobility movements.
* Walking is always an acceptable choice for the full length of any break.

## Status

This app is under active development. Features are added one at a time and validated before the next feature starts. See open pull requests and issues for current progress.

## Privacy

DeskBreak runs entirely in the browser. It does not use an account or a backend. Activity history stays on the user's device.

## Disclaimer

DeskBreak provides general movement reminders based on research on sedentary behavior. It is not medical care or a treatment for posture, pain, cardiovascular disease, diabetes, or other conditions. Stop an exercise that causes pain, dizziness, or unusual symptoms and seek appropriate medical advice when needed.

## Development

This is a static site with no build step. Serve the `src/` directory with any static file server, for example:

```
cd src
python3 -m http.server 8000
```

Then open `http://localhost:8000` in a browser.

## License

MIT
