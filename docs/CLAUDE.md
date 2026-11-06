# Consignes pour travailler sur Arpegiator

Voir `docs/README.md` et `docs/SPECIFICATIONS.md`. Ce fichier réunit les décisions à respecter dans toute modification.

## Décisions de conception

- **Pas d'étape de compilation** : trois fichiers principaux, `index.html`, `engine.js`, `app.js`, en JavaScript simple sans dépendance. Même habillage visuel que Harmonie (mêmes variables CSS, mêmes polices, mêmes radius).
- **Moteur testable seul** : `engine.js` ne touche pas au DOM et doit rester testable dans Node. Entrée = notes tenues + motif de pas + options, sortie = événements `{t, dur, pitch, vel}` en noires.
- **Source d'accord séparée du moteur** : le clavier à l'écran remplit `state.held` (ensemble de notes MIDI). WebMIDI pourra se brancher plus tard sans toucher au moteur, en appelant les mêmes ajouts/retraits.
- **Export MIDI et audio passent par la même source** : `renderPattern` produit les événements, l'audio les joue en temps réel, l'export écrit un SMF format 0 via `toSMF`. Ne pas créer un second chemin pour l'un ou l'autre.
- **Commentaires du code en français.** Interface en français pour l'instant ; passer par `window.i18n` si une autre langue est ajoutée.
- **Réutilisabilité par Harmonie** : garder `engine.js` strictement pur. Toute logique qui dépend du DOM ou de `AudioContext` reste dans `app.js`.

## Règles techniques

- **Pas de framework, pas de bundler.** Pas d'import ES modules : on expose sur `window.Engine` et `module.exports`.
- **Déterminisme** : tout aléatoire (ordre "random", probabilité) passe par `rngFrom(seed)`. L'export rejoue identique à la lecture quand la graine est la même.
- **Durées** : en noires. `RATES` donne la conversion des subdivisions en noires par pas.
- **Avant de modifier** : d'autres sessions peuvent travailler sur ce projet. Vérifier `git log` d'abord.

## Vérifier une modification

- **Moteur** : dans Node, générer pour chaque ordre/subdivision avec un accord factice (ex. C majeur), vérifier :
  - longueur de la séquence = `steps` activés × accord déplié,
  - pas d'événement dépassant la durée totale,
  - pas de pitch hors 0..127.
- **Application** : servir le dossier (`python3 -m http.server`), puis dans le navigateur :
  - absence d'erreur dans la console,
  - lecture : les pas s'allument en rythme,
  - export MIDI : le fichier s'ouvre dans un DAW et correspond à ce qu'on entend.
