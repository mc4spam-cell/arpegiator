# Arpegiator

Arpégiateur à pas inspiré de Stepic, dans l'esprit visuel de Harmonie. Application web locale, sans dépendance et sans étape de compilation.

## Utilisation

Ouvrir `index.html` dans un navigateur, ou servir le dossier :

```
python3 -m http.server
```

1. Tenir des notes sur le clavier à l'écran (Maj = verrouillage).
2. Régler BPM, nombre de pas, subdivision, ordre, octaves, swing.
3. Dans la grille : cliquer un pas pour l'activer, glisser verticalement pour la vélocité, régler degré et octave, activer tenue/glissé.
4. Lecture pour entendre, Exporter MIDI pour obtenir un `.mid`.

## Fichiers

- `index.html` — mise en page et styles.
- `engine.js` — moteur pur (sans DOM), exposé sur `window.Engine` et `module.exports`.
- `app.js` — DOM, audio WebAudio, clavier, export MIDI.
- `docs/` — spécification et décisions de conception.
