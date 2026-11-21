# Registro delle modifiche

Tutte le modifiche rilevanti del progetto sono annotate qui, dalla più recente.

Il formato segue [Keep a Changelog](https://keepachangelog.com/) e le versioni seguono il [Semantic Versioning](https://semver.org/lang/it/).

## [Non rilasciato]

## [0.1.0] - 2026-11-21

### Aggiunto

- Rilascio automatico: quando una pull request è unita su `main` e i test sono verdi, la CI crea il tag `vX.Y.Z` e la release su GitHub con le note della versione, prese dal registro con `scripts/release-notes.mjs` ([#13](https://github.com/TehMaat/Network-Config-Viewer/issues/13)).
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
- Fase 1, lettura degli switch Cisco ([#10](https://github.com/TehMaat/Network-Config-Viewer/issues/10)):
  - modello neutro degli apparati, in cui ogni elemento ricorda le righe della config da cui viene;
  - driver per Cisco IOS, IOS-XE e Small Business: interfacce, VLAN, trunk, modalità `general`, port-channel, stack e posizione delle porte, SVI, PoE, 802.1X e MAB, port security, VLAN voce, ACL e object-group con i punti in cui sono applicate (interfacce, VTY, SNMP, route-map, accesso di gestione), rotte statiche, policy route, OSPF, BGP, route-map e prefix-list;
  - valori di default per marca indicati come tali, con quelli ancora incerti dei Small Business segnati "da verificare"; avviso quando le VLAN non sono nella config per via del VTP;
  - ogni riga classificata come compresa, ignorata di proposito o sconosciuta, con la copertura e l'elenco delle sezioni non interpretate;
  - nomi nella config collegati alla loro definizione (VLAN, ACL, object-group, interfacce, route-map, prefix-list, peer-group).
  - viste di ogni switch: riepilogo con la copertura e le sezioni non interpretate; pannello delle porte di ogni membro dello stack, con colori per VLAN, trunk a strisce, porte spente, L3, PoE, 802.1X/MAB, VLAN voce e port-channel, filtro per VLAN e dettaglio della porta; VLAN con porte e gateway; ACL con la ricerca per IP anche tramite subnet, object-group e any; routing con le rotte ricavate dalla config, OSPF, BGP, policy route, route-map e prefix-list;
  - config collegata: righe non interpretate evidenziate, nomi cliccabili verso la definizione con "Torna indietro", e da ogni elemento delle viste si salta alle sue righe;
  - tabelle con ordinamento, filtro e righe virtualizzate, con TanStack Table e TanStack Virtual (licenza MIT).
- Fase 1, lettura dei FortiGate ([#10](https://github.com/TehMaat/Network-Config-Viewer/issues/10)):
  - driver FortiOS 7.0–8.0, con le VDOM come contesti separati: interfacce (fisiche, aggregate, VLAN, tunnel, VDOM link, switch hardware), zone, indirizzi, gruppi con esclusioni, servizi, VIP, IP pool, policy nell'ordine reale di valutazione, rotte statiche anche verso le zone SD-WAN, policy route, BGP con gruppi e range dinamici, OSPF, route-map, prefix-list, VPN IPsec con fase 1 e fase 2 e ruolo ADVPN, SD-WAN con zone, membri, health check, SLA e regole;
  - valori di default di FortiOS indicati come tali; quelli incerti (versione IKE, proposte, gruppi DH) segnati "da verificare";
  - oggetti predefiniti (all, ALL, HTTP, HTTPS, DNS…) aggiunti quando le policy li usano;
  - avvisi sulle policy disattivate, senza log, che permettono tutto o che aprono servizi di gestione a qualsiasi sorgente;
  - certificati e messaggi sostitutivi ignorati di proposito nella copertura;
  - viste di ogni FortiGate, con la scelta della VDOM: riepilogo, interfacce e zone, VLAN, policy (lista unica o per coppia di interfacce, ricerca per IP tramite indirizzi, subnet, gruppi, VIP e all, oggetti espansi fino agli IP, avvisi), oggetti con "dove è usato", routing, VPN IPsec, SD-WAN con la regola implicita;
  - test con una config da 10.000 policy: la tabella resta fluida durante lo scorrimento.
- Fase 1, comandi show e stato reale ([#10](https://github.com/TehMaat/Network-Config-Viewer/issues/10)):
  - lettura degli output da file singoli e da log di sessione, divisi per prompt (anche dentro le VDOM del FortiGate) o, senza prompt, dalla forma dell'output; comandi riconosciuti anche abbreviati, come `sh int status`;
  - lettori per Cisco IOS e IOS-XE (`show version`, `show inventory`, `show interfaces status`, `show vlan brief`, `show etherchannel summary`, `show cdp neighbors detail`, `show lldp neighbors detail`, `show mac address-table`, `show ip arp`, `show power inline`), per i formati dei Cisco Small Business (`show interfaces status`, `show vlan`, `show lldp neighbors`, `show mac address-table`, `show power inline`) e per FortiOS (`get system status`, `get system interface physical`, `get vpn ipsec tunnel summary`, `diagnose vpn ike gateway list`, `get router info routing-table all`, `get router info bgp summary`, `diagnose sys sdwan health-check` e `service`);
  - ogni file di show va con il suo apparato: per hostname, poi per numero di serie, poi per nome del file; l'hostname corretto a mano sposta il file su un altro apparato;
  - stato reale nelle viste, con ogni dato che rimanda alla sua riga dello show: stato, velocità, vicini CDP e LLDP e PoE delle porte; IP di ogni MAC dalla tabella ARP dello stesso apparato; tunnel IPsec con le istanze dei dial-up; tabella di routing reale con la ricerca per IP; sessioni BGP; health check SD-WAN e membro in uso per ogni regola; nomi delle VLAN tenute dal VTP;
  - MAC su ogni porta configurata, secondo la [#6](https://github.com/TehMaat/Network-Config-Viewer/issues/6): indirizzi con VLAN e tipo (dinamico, statico, sticky dalla port security), MAC dei port-channel attribuiti al port-channel e non ai membri, elenco a richiesta sui trunk con molti MAC, segno sul frontale e un solo avviso per apparato per le porte configurate senza MAC e per la tabella MAC non caricata;
  - log di sessione di esempio, sintetici e coerenti con le config: SW-HQ-CORE, SW-BR1-ACC (con fine riga Windows), SW-BR3-ACC (Small Business), FGT-HQ (con le VDOM) e FGT-BR1.
- Fase 1, archivio dei clienti ([#10](https://github.com/TehMaat/Network-Config-Viewer/issues/10)):
  - clienti gestiti dall'app: si creano, si aprono, si rinominano, si chiudono e si eliminano; i file caricati con un cliente aperto, anche dentro archivi, si salvano nel suo archivio così come sono, una sola volta anche se caricati di nuovo;
  - archivio su disco nel volume Docker `ncv-data`, conservato dal nuovo server dell'app (`packages/server`, Node.js con Fastify): resta dopo il riavvio e l'aggiornamento del container e si vede da qualsiasi browser, anche dopo averlo pulito;
  - file raggruppati per apparato: config attuale, versioni precedenti e show. L'attuale è la più recente per la data scritta nella config, nel nome del file o del file stesso, oppure quella scelta a mano;
  - correzioni a mano e versione scelta salvate con il cliente;
  - esportazione di un cliente in un file zip, con i file originali e un indice leggibile, e importazione con il controllo byte per byte di ogni file;
  - file caricati senza cliente salvabili in un cliente nuovo o in uno esistente; riaperto da solo l'ultimo cliente usato nel browser;
  - esempi: versioni precedenti del 9300 di sede e del FortiGate della filiale 1, e il cliente di esempio `samples/cliente-esempio.zip` da importare;
  - test del server, dell'archivio nel browser e, in CI, dell'archivio dopo il riavvio del container.
- Fase 1, export Excel ([#10](https://github.com/TehMaat/Network-Config-Viewer/issues/10)):
  - per ogni apparato un file Excel con un foglio per vista e le stesse colonne delle tabelle dell'app: porte, VLAN, ACL, routing e MAC degli switch; interfacce e VLAN del FortiGate, e policy, oggetti, routing, VPN e SD-WAN di ogni VDOM; con gli show anche lo stato reale, il routing reale e il membro SD-WAN in uso;
  - su ogni tabella un pulsante che la esporta così come è filtrata e ordinata;
  - file creato nel browser con ExcelJS (MIT), caricato solo al primo export; i valori restano valori, senza formule.

### Modificato

- Versioning: ogni pull request è una versione, scelta da Claude secondo il Semantic Versioning, e unirla su `main` è l'okay al rilascio; con "non rilasciare" le voci restano in "Non rilasciato". Regole in `CLAUDE.md`, studio e README aggiornati ([#13](https://github.com/TehMaat/Network-Config-Viewer/issues/13)).
- La CI non annulla più un'esecuzione su `main` quando ne parte un'altra, così ogni versione unita viene rilasciata ([#13](https://github.com/TehMaat/Network-Config-Viewer/issues/13)).
- Screenshot della documentazione senza il numero di versione, che cambia a ogni rilascio ([#13](https://github.com/TehMaat/Network-Config-Viewer/issues/13)).
- Docker: il container contiene il server dell'app, senza privilegi di amministratore, al posto di nginx, con il volume dei dati in `compose.yaml`; le intestazioni di sicurezza vengono da un'unica fonte, usata anche dai test ([#10](https://github.com/TehMaat/Network-Config-Viewer/issues/10)).
- Test nel browser: girano sul server dell'app invece che su `vite preview`, e in CI anche su Firefox e WebKit; il test della copia verifica il testo anche nei browser che non lasciano leggere gli appunti ([#10](https://github.com/TehMaat/Network-Config-Viewer/issues/10)).
- Pagina iniziale con l'elenco dei clienti; testi sulla riservatezza della pagina iniziale e del README aggiornati con l'archivio sul PC ([#10](https://github.com/TehMaat/Network-Config-Viewer/issues/10)).
- Studio, README e screenshot aggiornati con l'archivio dei clienti; gli screenshot si fanno dal cliente di esempio ([#10](https://github.com/TehMaat/Network-Config-Viewer/issues/10)).
- Studio, README e screenshot aggiornati con i driver e le viste della fase 1 già unite: decisioni sull'archivio dei clienti, i browser, la copertura e i default; modello neutro realizzato; viste per apparato; roadmap della fase 1 con le parti fatte e quelle che mancano ([#10](https://github.com/TehMaat/Network-Config-Viewer/issues/10)).
- Config di esempio FortiGate arricchite con servizi personalizzati e gruppi di servizi, OSPF verso il centro stella, policy route, prefix-list e route-map per BGP, la VPN del campus e policy che fanno scattare gli avvisi ([#10](https://github.com/TehMaat/Network-Config-Viewer/issues/10)).
- Config di esempio Cisco arricchite con OSPF, policy route, ACL applicate a interfacce, VTY e SNMP, object-group, 802.1X e MAB, PoE, port security con MAC sticky, VTP in modalità server con le VLAN solo nello show e modalità `general` dei Small Business; per ogni config c'è il riassunto atteso del modello in `samples/expected-models.json`, verificato dai test ([#10](https://github.com/TehMaat/Network-Config-Viewer/issues/10)).
- Screenshot della documentazione rifatti con il nuovo selettore del tema, in tema chiaro e in tema scuro; il README mostra entrambi ([#7](https://github.com/TehMaat/Network-Config-Viewer/issues/7)).
- Intestazione più compatta sugli schermi stretti: il nome dell'app compare da 768 px e sotto i 576 px il pulsante "Aggiungi file" diventa un'icona ([#7](https://github.com/TehMaat/Network-Config-Viewer/issues/7)).
- README e studio rimandano alle regole di lavoro e al registro delle modifiche ([#2](https://github.com/TehMaat/Network-Config-Viewer/issues/2)).
- Studio: avvio solo in locale con Docker; Cisco Small Business tra le marche e nella fase 1; nuove decisioni su config 1:1, dati sintetici, config reali per lo sviluppo, strumenti e test automatici ([#4](https://github.com/TehMaat/Network-Config-Viewer/issues/4)).
- README: cosa fa l'app, come avviarla con Docker, riservatezza e sviluppo ([#4](https://github.com/TehMaat/Network-Config-Viewer/issues/4)).
- Regole di riservatezza in `CLAUDE.md`: nessuna repo con config dei clienti, documentazione e screenshot solo con dati sintetici, config mai modificate ([#4](https://github.com/TehMaat/Network-Config-Viewer/issues/4)).
- Studio: ogni porta configurata degli switch riporta i MAC dei dispositivi collegati, letti da `show mac address-table`; lo strumento segnala le porte senza MAC e lo show mancante. Aggiornati decisioni, comandi show, modello dati, pannello porte, controlli di coerenza e roadmap ([#6](https://github.com/TehMaat/Network-Config-Viewer/issues/6)).
- Mockup: dettaglio della porta con gli indirizzi MAC (sintetici, intervallo di documentazione dell'RFC 7042), segno per le porte configurate senza MAC e nuovi avvisi; screenshot del mockup rifatti ([#6](https://github.com/TehMaat/Network-Config-Viewer/issues/6)).

### Rimosso

- Configurazione di nginx nella cartella `docker/`: la sostituisce il server dell'app ([#10](https://github.com/TehMaat/Network-Config-Viewer/issues/10)).
- Anonimizzatore dalla roadmap: le config restano sul PC e devono restare identiche all'originale ([#4](https://github.com/TehMaat/Network-Config-Viewer/issues/4)).
- Pubblicazione su GitHub Pages e pacchetto offline: l'app si usa solo in locale, con Docker ([#4](https://github.com/TehMaat/Network-Config-Viewer/issues/4)).

### Sicurezza

- Protezioni del server dell'archivio: risponde solo a `localhost`, `127.0.0.1` e `[::1]`, contro il DNS rebinding; accetta modifiche solo con l'intestazione dell'app e mai da altri siti, senza permessi CORS; sceglie lui i nomi dei file sul disco; limiti di dimensione; container senza root e con il filesystem in sola lettura tranne il volume dei dati. Ogni protezione è verificata dai test e, in CI, sul container ([#10](https://github.com/TehMaat/Network-Config-Viewer/issues/10)).

## [0.0.1] - 2026-11-18

### Aggiunto

- Studio preliminare in `docs/STUDIO.md`: requisiti, architettura, viste, analisi, migrazioni, scelte tecniche e roadmap ([#1](https://github.com/TehMaat/Network-Config-Viewer/pull/1)).
- Mockup con dati di esempio in `docs/mockup/index.html` e screenshot in `docs/img/` ([#1](https://github.com/TehMaat/Network-Config-Viewer/pull/1)).
- Licenza MIT ([#1](https://github.com/TehMaat/Network-Config-Viewer/pull/1)).
