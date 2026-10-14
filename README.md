# Midnight Gift

**A Little Universe, Just for You** — an interactive birthday surprise for Mariam.

A midnight-black scene with a floating 3D gift box (built with CSS 3D transforms). When the gift is opened,
the lid lifts away, light and particles pour out, and a celebration begins:

- a procedural fireworks show: gold peonies, pink double rings, purple shells, lavender starbursts, heart-shaped
  bursts, golden glitter, cascading willows, pink and purple ground fountains, and rockets with glowing trails
- balloons drifting up the sides, a gentle confetti shower, and glowing hearts rising through the scene
- **MARIAM** revealed letter by letter in gold, pink and lavender
- a personal letter in a gold-framed card, revealed one paragraph at a time as it's read

Music plays throughout.

It's a plain static website: no build step, framework, backend, or API keys.

## Files

```
.
├── index.html                 page structure, gift box, birthday heading and letter
├── styles.css                 design tokens, 3D gift, letter card, balloons, reveal choreography, responsive rules
├── script.js                  animation loop, starfield, fireworks show, confetti and hearts, balloons,
│                              music, state machine
├── محمود-الحديد.mp3            background music (local file)
├── .nojekyll                  tells GitHub Pages to serve files as-is
└── README.md
```

All paths are relative, so the site works at a domain root and under a GitHub Pages project
subpath such as `https://username.github.io/midnight-gift/`.

## The music file

The page plays **`محمود-الحديد.mp3`**, which must sit **next to `index.html`** (it's already there).

`index.html` refers to it by its percent-encoded name:

```html
<audio id="bgm" preload="auto" loop src="%D9%85%D8%AD%D9%85%D9%88%D8%AF-%D8%A7%D9%84%D8%AD%D8%AF%D9%8A%D8%AF.mp3"></audio>
```

If you ever rename or replace the file, update that `src`. The simplest option is an ASCII name such as
`music.mp3` with `src="music.mp3"`. If the file is missing, the site still works: the music button shows
"Music unavailable" and the rest of the experience plays normally.

## Run it locally

Any static file server works. From this folder:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>. Opening `index.html` directly also works in most browsers.

## Publish with GitHub Pages

1. Create a new repository on GitHub, for example `midnight-gift`. It can be public or private (private
   Pages needs a paid plan).
2. Upload everything in this folder, including the MP3 and `.nojekyll`, either with **Add file → Upload files**
   on the repository page or with git:

   ```bash
   git init
   git add .
   git commit -m "Midnight Gift"
   git branch -M main
   git remote add origin https://github.com/<your-username>/midnight-gift.git
   git push -u origin main
   ```

3. In the repository, open **Settings → Pages**. Under **Build and deployment**, choose
   **Source: Deploy from a branch**, then **Branch: `main`** and **folder: `/ (root)`**, and click **Save**.
4. After a minute or two the site is live at `https://<your-username>.github.io/midnight-gift/`.

## About autoplay

Browsers block audio that starts without a user gesture, so the music never autoplays on load. It starts
when **Open Your Gift** is tapped. If the browser still refuses (some in-app browsers and power-saving modes
do), the music button changes to **"Tap to play music"** so it can be started by hand. The button always
shows the real playback state. Pausing it is respected: opening the gift won't force the sound back on.

## Behaviour notes

- **States:** intro → revealing → celebration. Repeat clicks are ignored once the reveal starts, so effects
  can't overlap or duplicate.
- **Composition:** the fireworks show keeps the middle of the screen clear. The largest bursts go to the upper
  corners, smaller ones to the sides, and only the occasional grand burst sits high above the title. The
  letter card is nearly opaque, so the message always stays readable.
- **The letter:** paragraphs appear one at a time, and never ahead of the reader. Lines below the fold appear
  as you scroll to them. If the letter starts below the fold, a **Read your letter** button appears and
  scrolls to it. Nothing is ever locked in a fixed-height box, and a safety net makes every line visible after
  30 seconds even if an effect fails.
- **Performance:** one `requestAnimationFrame` loop drives all three canvases (stars, fireworks, and confetti
  with hearts). Fireworks use a fixed, recycled particle pool, with fewer particles, balloons and confetti on
  small screens. Canvases are sized within a pixel budget, and all drawing pauses while the tab is hidden.
  Balloons are SVG animated by CSS transforms, so they cost almost nothing.
- **Reduced motion:** with *Reduce motion* turned on in the operating system:
  - floating, drifting and flying animations are switched off
  - the gift opens with a simple fade
  - fireworks become occasional slow bursts without rockets or fountains
  - confetti and rising hearts are hidden, and four balloons rest quietly at the edges
  - the heading and letter fade in without movement
- **Interaction:** after the reveal, tapping the sky (anywhere outside the letter) launches another firework.
- **No JavaScript:** the page still shows the full heading and letter, without the effects.

## Limitations

- The fonts (Cormorant Garamond and Jost) load from Google Fonts. Offline, the page falls back to
  system serif and sans-serif fonts.
- On iPhone and iPad, page scripts can't change the volume, so the music starts at full volume instead of
  fading in.
- Emoji in the letter (❤️ 😂 💜 ✨) are drawn by each device's own emoji font, so their exact look varies a
  little between iPhone, Android and Windows.
- CSS 3D rendering differs slightly between browser engines, so the box's lighting and edges can look a
  little different in Safari or Firefox than in Chrome.
