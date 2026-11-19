# Regole di lavoro per Claude

Queste regole valgono in ogni sessione su questo progetto. Lo studio di riferimento, con requisiti, architettura e roadmap, è [`docs/STUDIO.md`](docs/STUDIO.md): va letto prima di iniziare qualsiasi lavoro.

## Lingua

- Con l'utente si parla sempre in italiano: messaggi, issue, pull request, commenti e messaggi di commit.
- L'interfaccia del software è in italiano e in inglese. Ogni testo visibile all'utente va nei file di traduzione, in entrambe le lingue, mai scritto direttamente nel codice.
- Codice, nomi e commenti tecnici nel codice sono in inglese.

## Prima analisi e issue, poi l'okay, poi il lavoro

1. Ogni proposta dell'utente (nuova funzione, modifica, correzione) va prima **analizzata**: cosa chiede, impatto su architettura e roadmap, alternative, rischi.
2. L'analisi diventa un'**issue su GitHub**, in italiano, con: richiesta, analisi, cosa cambia, criteri di accettazione, domande aperte.
3. **Non si scrive codice e non si modifica la repo finché l'utente non dà l'okay esplicito** su quell'issue, in chat o con un commento nell'issue.
4. Dopo l'okay si lavora su un ramo dedicato e si apre una pull request che chiude l'issue (`Closes #N`). Nella stessa pull request si aggiornano test, documentazione e registro delle modifiche.
5. Le idee che nascono durante il lavoro, anche quelle di Claude, non si realizzano di propria iniziativa: diventano nuove issue da approvare.
6. Fanno parte del lavoro già approvato solo le correzioni necessarie a completare l'issue, per esempio test che falliscono od osservazioni della revisione.

## Registro delle modifiche

- [`CHANGELOG.md`](CHANGELOG.md) è la pagina di log del progetto e deve esistere sempre.
- Ogni pull request aggiunge le sue voci nella sezione "Non rilasciato", con il riferimento all'issue o alla pull request.
- Formato [Keep a Changelog](https://keepachangelog.com/), in italiano, con le sezioni Aggiunto, Modificato, Corretto, Rimosso, Sicurezza.

## Documentazione sempre aggiornata

- La documentazione in `docs/` e il README descrivono sempre lo stato attuale del progetto.
- Ogni pull request che cambia funzioni, comportamento o decisioni aggiorna la documentazione nella stessa pull request: le decisioni nella tabella "Decisioni prese" di `docs/STUDIO.md`, i cambi di piano nella roadmap.
- Screenshot e mockup in `docs/` si rifanno quando cambia quello che mostrano.

## Versioning

- Le versioni seguono il [Semantic Versioning](https://semver.org/lang/it/): MAGGIORE.MINORE.CORREZIONE. Durante lo sviluppo si resta su 0.y.z: si alza MINORE per le nuove funzioni e CORREZIONE per correzioni e sola documentazione.
- La versione corrente è la più recente in `CHANGELOG.md`. La stessa versione sta anche nel `package.json` alla radice: un test lo verifica.
- Il rilascio lo decide l'utente. Al rilascio la sezione "Non rilasciato" diventa la nuova versione con la data, si crea il tag `vX.Y.Z` su `main` e la release su GitHub con le note del registro. Tag e release si fanno solo con l'okay dell'utente.

## Riservatezza dei dati

- La repo è pubblica: mai configurazioni reali dei clienti, nemmeno nei test o negli esempi. Solo dati sintetici.
- Nessuna repo con config dei clienti, nemmeno privata. Quando un parser sbaglia su una config reale, l'utente passa in chat solo le righe che danno problemi, con i valori sensibili cambiati a mano.
- Documentazione e screenshot solo con dati sintetici, generati dalle config di esempio in `samples/`.
- Lo strumento non modifica mai le config caricate: ciò che si vede, si copia o si scarica è identico all'originale.
- Mai password, chiavi o altri segreti nel codice, nei commit o nelle issue.
