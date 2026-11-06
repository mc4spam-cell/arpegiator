# Spécifications — Arpegiator

Version initiale.

## 1. Transport

- BPM entier, 40 à 240.
- Nombre de pas, 1 à 32.
- Subdivision : 1/4, 1/8, 1/8T, 1/16, 1/16T, 1/32.
- Swing : 0 à 0,6 ; décale les pas impairs.

## 2. Accord (source)

- Clavier à l'écran, deux octaves (C3..B4). Clic pour tenir, clic avec Maj pour verrouiller.
- Les notes tenues forment l'accord joué par l'arpégiateur.
- Prévu pour recevoir une entrée WebMIDI plus tard, qui alimente le même ensemble.

## 3. Ordre de parcours

`up`, `down`, `updown`, `downup`, `as-played`, `random`, `chord` (joue toutes les notes à chaque pas).

## 4. Octaves

Multiplicateur 1..4 ; la séquence est dépliée sur plusieurs octaves pour tous les ordres sauf `chord`.

## 5. Pas (motif)

Chaque pas possède :

- `on` : activé ou non.
- `vel` : vélocité 1..127 (réglée en glissant verticalement sur la case).
- `degree` : décalage d'index dans la séquence (−7..+7). `0` prend la note courante, `+1` la suivante, etc.
- `octave` : décalage d'octave sur le pas (−2..+2).
- `gate` : durée en fraction de la longueur totale (0,8 par défaut).
- `len` : longueur en pas (0,5 à 8). La durée sonore vaut `len × rate × gate` noires ; la position reste calée sur la grille.
- `tie` : à l'export, raccroche le pas aux pas `tie` consécutifs pour prolonger la note. En lecture, préférer `len`.
- `rand` : si vrai, la note du pas est tirée au hasard dans la séquence déroulée de l'accord (graine déterministe). `degree` est ignoré.
- `glide` : si vrai, l'audio rampe la fréquence depuis la dernière note jouée (portamento court, max 80 ms). L'export MIDI ne pose pas encore de pitch bend.

## 2 bis. Source d'accord

Un sélecteur `Source` choisit d'où vient l'accord :

- **Clavier à l'écran** : comportement par défaut.
- **Grille Harmonie** : la page est ouverte avec `#data=<base64(JSON)>` dans l'URL. Le JSON contient `{bpm, meter, stepsPerBar, chords:[{name, notes, beats}]}`. Au chargement, BPM et nombre de pas sont pré-réglés ; un sélecteur « Accord » permet de parcourir la grille.
- **Harmonie (live)** : l'accord est poussé par un appel externe à `window.Arpegiator.setChord(notes)` (notes MIDI entières). Un tableau vide stoppe l'arpège. L'API publique expose aussi `play()`, `stop()` et `setBpm(bpm)`.

## 6. Moteur

- `renderPattern(notes, pattern, opts)` renvoie une liste `{t, dur, pitch, vel}` en noires.
- `toSMF(events, {bpm, ppq})` écrit un fichier MIDI format 0.
- Aléatoire déterministe via `rngFrom(seed)`.

## 7. Audio

- WebAudio, synthé additif simple (sinus + triangle, enveloppe AR).
- Planification par look-ahead de 100 ms, pas de 25 ms.

## 8. Export MIDI

- Format 0, une piste, tempo meta au BPM courant. 480 ticks par noire.
- Contient exactement les mêmes événements que la lecture.

## 9. À venir (non implémenté)

- Entrée WebMIDI (clavier matériel).
- `slide` traité à l'export (chevauchement / pitch bend).
- Probabilité par pas.
- Verrouillage de hauteur (note absolue par pas, pour sortir de l'accord).
- Plusieurs voies de pas (lanes) comme Stepic.
- Traduction i18n si utilisé hors français.
