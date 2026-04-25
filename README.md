# Neon Pursuit 3D

A GitHub Pages-ready 3D car chase prototype.

## What this version fixes

- Road lane lines are fixed world meshes, so they do not slide with the car.
- Left/right controls are corrected.
- Roads are wider.
- The map is finite, not infinite.
- Map has three regions:
  - City
  - Plains
  - Desert

## Files

```text
index.html
style.css
src/main.js
```

## How to run locally

Do not double click the file. Run a local server:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

## GitHub Pages

Upload these files exactly like this:

```text
your-repo/
  index.html
  style.css
  src/
    main.js
```

The game uses Three.js from jsDelivr. No images, models, textures, or audio files are needed.
