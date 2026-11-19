# Registro delle modifiche

Tutte le modifiche rilevanti del progetto sono annotate qui, dalla più recente.

Il formato segue [Keep a Changelog](https://keepachangelog.com/) e le versioni seguono il [Semantic Versioning](https://semver.org/lang/it/).

## [Non rilasciato]

### Aggiunto

- Regole di lavoro in `CLAUDE.md`: analisi e issue prima di ogni modifica, lavoro solo dopo l'okay, registro delle modifiche, documentazione sempre aggiornata, versioning e riservatezza dei dati ([#2](https://github.com/TehMaat/Network-Config-Viewer/issues/2)).
- Questo registro delle modifiche ([#2](https://github.com/TehMaat/Network-Config-Viewer/issues/2)).
- Prima versione dell'app, fase 0 della roadmap ([#4](https://github.com/TehMaat/Network-Config-Viewer/issues/4)):
  - caricamento di più file, anche in archivi zip, tar, tar.gz e gz annidati, con i file illeggibili segnalati (binari, vuoti, archivi danneggiati o protetti da password, backup FortiGate cifrati);
  - riconoscimento di marca, sistema operativo, versione, modello, hostname, stack e VDOM, con la riga da cui viene ogni dato e la correzione a mano. Riconosciuti FortiOS, FortiSwitchOS, Cisco IOS, IOS-XE e Small Business e gli output dei comandi show; Cisco NX-OS e ASA riconosciuti ma non ancora letti;
  - parser generici per le sintassi a indentazione e `config / edit / set / next / end`;
  - vista della config originale con evidenziazione, blocchi piegabili, ricerca e struttura navigabile; copia e download identici al file;
  - interfaccia in italiano e inglese.
- Avvio in locale con Docker (`docker compose up -d`): solo nginx senza privilegi con i file statici, porta aperta solo verso il PC, Content Security Policy che blocca i collegamenti ad altri siti ([#4](https://github.com/TehMaat/Network-Config-Viewer/issues/4)).
- Config di esempio sintetiche: FortiOS 7.0, 7.2, 7.4, 7.6 e 8.0, Catalyst 2960, 3850, 9200 e 9300, Cisco SG350, CBS350 e Catalyst 1300, output di comandi show ([#4](https://github.com/TehMaat/Network-Config-Viewer/issues/4)).
- Test automatici su GitHub Actions a ogni pull request: lint, tipi, formattazione, test unitari, build, immagine Docker e test nel browser sul container ([#4](https://github.com/TehMaat/Network-Config-Viewer/issues/4)).
- Scelta del tema nell'intestazione: chiaro, scuro o come il sistema, con la scelta salvata nel browser e applicata già all'avvio, senza lampi del tema sbagliato ([#7](https://github.com/TehMaat/Network-Config-Viewer/issues/7)).

### Modificato

- Screenshot della documentazione rifatti con il nuovo selettore del tema, in tema chiaro e in tema scuro; il README mostra entrambi ([#7](https://github.com/TehMaat/Network-Config-Viewer/issues/7)).
- Intestazione più compatta sugli schermi stretti: il nome dell'app compare da 768 px e sotto i 576 px il pulsante "Aggiungi file" diventa un'icona ([#7](https://github.com/TehMaat/Network-Config-Viewer/issues/7)).
- README e studio rimandano alle regole di lavoro e al registro delle modifiche ([#2](https://github.com/TehMaat/Network-Config-Viewer/issues/2)).
- Studio: avvio solo in locale con Docker; Cisco Small Business tra le marche e nella fase 1; nuove decisioni su config 1:1, dati sintetici, config reali per lo sviluppo, strumenti e test automatici ([#4](https://github.com/TehMaat/Network-Config-Viewer/issues/4)).
- README: cosa fa l'app, come avviarla con Docker, riservatezza e sviluppo ([#4](https://github.com/TehMaat/Network-Config-Viewer/issues/4)).
- Regole di riservatezza in `CLAUDE.md`: nessuna repo con config dei clienti, documentazione e screenshot solo con dati sintetici, config mai modificate ([#4](https://github.com/TehMaat/Network-Config-Viewer/issues/4)).
- Studio: ogni porta configurata degli switch riporta i MAC dei dispositivi collegati, letti da `show mac address-table`; lo strumento segnala le porte senza MAC e lo show mancante. Aggiornati decisioni, comandi show, modello dati, pannello porte, controlli di coerenza e roadmap ([#6](https://github.com/TehMaat/Network-Config-Viewer/issues/6)).
- Mockup: dettaglio della porta con gli indirizzi MAC (sintetici, intervallo di documentazione dell'RFC 7042), segno per le porte configurate senza MAC e nuovi avvisi; screenshot del mockup rifatti ([#6](https://github.com/TehMaat/Network-Config-Viewer/issues/6)).

### Rimosso

- Anonimizzatore dalla roadmap: le config restano sul PC e devono restare identiche all'originale ([#4](https://github.com/TehMaat/Network-Config-Viewer/issues/4)).
- Pubblicazione su GitHub Pages e pacchetto offline: l'app si usa solo in locale, con Docker ([#4](https://github.com/TehMaat/Network-Config-Viewer/issues/4)).

## [0.0.1] - 2026-11-18

### Aggiunto

- Studio preliminare in `docs/STUDIO.md`: requisiti, architettura, viste, analisi, migrazioni, scelte tecniche e roadmap ([#1](https://github.com/TehMaat/Network-Config-Viewer/pull/1)).
- Mockup con dati di esempio in `docs/mockup/index.html` e screenshot in `docs/img/` ([#1](https://github.com/TehMaat/Network-Config-Viewer/pull/1)).
- Licenza MIT ([#1](https://github.com/TehMaat/Network-Config-Viewer/pull/1)).
