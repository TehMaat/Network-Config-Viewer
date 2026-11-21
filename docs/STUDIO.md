# Studio preliminare: Network Config Viewer

> **Stato:** novembre 2026. La [fase 0](#fase-0-fondamenta-realizzata) è realizzata: l'app si avvia in locale con Docker, riconosce le config FortiGate e Cisco e le mostra navigabili. Anche la [fase 1](#fase-1-lettura-dei-singoli-apparati-fortigate-cisco-iosios-xe-e-cisco-small-business-mvp-realizzata) è realizzata: i driver FortiOS, Cisco IOS/IOS-XE e Small Business leggono le config e l'app mostra le viste di ogni apparato (vedi il [README](../README.md)); gli output dei comandi show vanno con il loro apparato e aggiungono lo stato reale alle viste; i file di ogni cliente restano nell'archivio dell'app, sul PC, raggruppati per apparato; ogni apparato e ogni tabella si esportano in Excel. Il resto del documento raccoglie le decisioni prese e il piano delle fasi successive. Il [mockup](mockup/index.html) mostra con dati di esempio come potrebbero apparire le viste future: scarica il file e aprilo nel browser.

## 1. In breve

- **Cosa**: uno strumento per **vedere l'infrastruttura di un cliente** partendo dai backup di configurazione. Per ogni cliente si caricano nell'app config, output di show e versioni precedenti, e l'app li conserva. Si caricano tutti gli apparati (firewall, switch, wireless) e si ottengono:
  - una mappa grafica con collegamenti fisici, VPN, SD-WAN, scorciatoie ADVPN e routing/BGP;
  - le viste di dettaglio di ogni apparato: policy, porte e VLAN, ACL, regole SD-WAN, routing;
  - la vista dei rack, con patch panel e cavi.

  Sulla stessa base lo strumento aiuta a preparare e verificare le migrazioni, comprese quelle degli switch pianificate sul rack da chi lavora da remoto.
- **Come**: un'app web che si avvia **sul PC con Docker** e si usa nel browser. I file vengono elaborati nel browser e conservati dal container, sul PC, nell'archivio dei clienti: non vengono mai inviati altrove. Più avanti la stessa immagine Docker potrà girare su un server per il lavoro in team e per leggere gli apparati in diretta via SSH/API.
- **Primo traguardo (MVP)**: FortiGate, Cisco IOS/IOS-XE e Cisco Small Business, prima apparato per apparato, poi messi insieme nella mappa dell'infrastruttura.
- **Migrazioni**: arrivano dopo la parte di visualizzazione, su cui si appoggiano. Si parte da ASA, Check Point, Sophos e Juniper verso FortiGate (poi pfSense e OPNsense), in config diretta o tramite FortiManager, con verifica automatica del risultato. Poi le migrazioni switch, pianificate sul rack con la patch list per i tecnici in sede.
- **Licenza**: open source, MIT.
- **Lingua**: interfaccia in italiano e in inglese, a scelta di chi la usa.
- **Chi scrive il codice**: Claude. Tu definisci le priorità, fornisci config di esempio e provi le versioni. Ogni modifica passa da un'issue e parte solo con il tuo okay.

![La mappa dell'infrastruttura nel mockup: sede e filiali con cavi, tunnel IPsec, sessioni BGP e i problemi trovati confrontando gli apparati](img/mockup-mappa.png)

## 2. Decisioni prese

| Tema | Decisione |
|---|---|
| Obiettivo principale | Visualizzare l'infrastruttura del cliente: più apparati insieme, con VPN, SD-WAN, BGP/routing e switch. Non solo convertire config |
| Utenti | All'inizio uso personale in locale, poi il team |
| Avvio in locale | Solo in locale, con Docker sul PC (`docker compose up -d`); l'app si usa nel browser su `http://localhost:8080`. Nel container c'è il server dell'app, che serve l'interfaccia e conserva l'archivio dei clienti. Nessuna pubblicazione online, né dell'app né dell'immagine Docker |
| Server | Con Docker o simili, nella fase 6: la stessa immagine usata in locale, a partire dal server dell'archivio della fase 1 |
| Config caricate | Restano 1:1: lo strumento non le modifica mai; ciò che si vede, si copia o si scarica è identico all'originale |
| Anonimizzatore | Non previsto: le config non lasciano il PC, quindi non c'è niente da proteggere |
| Marche da supportare nel tempo | FortiGate, FortiManager, FortiSwitch, FortiAP, Cisco IOS/IOS-XE/NX-OS, Cisco ASA, Cisco Small Business (Sx300–Sx550X, CBS, Catalyst 1200/1300), Aruba/HPE switch (AOS-CX, ArubaOS-Switch, Comware), Aruba Central, Meraki, Check Point, Juniper, Sophos, Netgate pfSense, OPNsense, Ubiquiti (UniFi, EdgeRouter, EdgeSwitch), TP-Link (Omada, JetStream) |
| Primo firewall | FortiGate |
| Primo switch | Cisco IOS/IOS-XE e, insieme, Cisco Small Business, frequenti tra i clienti |
| Casi d'uso | Tutti: visualizzazione, migrazione switch, migrazione firewall, in sequenza (vedi [Roadmap](#11-roadmap)) |
| Migrazioni firewall | Tutte le sorgenti verso FortiGate: prima ASA, Check Point, Sophos e Juniper, poi pfSense e OPNsense |
| Destinazioni delle migrazioni | FortiGate, Aruba (CX/AP), Cisco, Meraki |
| FortiConverter | Insufficiente (qualità scarsa, nessun supporto switch): la conversione la facciamo noi, con verifica integrata |
| FortiManager | Sia in lettura (template e policy package esistenti) sia in generazione |
| Input | File caricati a mano e output dei comandi show; lettura live SSH/API in una fase successiva |
| Analisi | Pulizia policy, policy lookup, topologia, confronto tra versioni, controlli di coerenza tra apparati |
| Organizzazione | Clienti gestiti dall'app: all'app non si dà mai una cartella, i file si caricano (anche dentro archivi zip e tar) e l'app li conserva per cliente, raggruppati per apparato: config attuale, versioni precedenti, show, e più avanti file delle prese e collegamenti inseriti a mano |
| Archivio locale | Su disco già nella fase 1: un volume Docker sul PC (`ncv-data`), gestito dal server dell'app nel container (Node.js con Fastify), che serve l'app al posto di nginx. Per ogni cliente una cartella con i file originali, 1:1, e un indice in JSON leggibile anche a mano, con percorsi, date, correzioni e versione scelta a mano. Lo stesso archivio si vede da qualsiasi browser e non si perde pulendo il browser. Un cliente si esporta e si reimporta in un file zip, con il controllo byte per byte di ogni file. Dei file non leggibili si mostra l'avviso ma non si salvano. Senza un cliente aperto i file restano solo nella scheda del browser |
| Apparati e versioni | Nel cliente i file sono raggruppati per apparato, per hostname: config attuale, versioni precedenti e show. L'attuale è la più recente: conta la data dell'ultima modifica scritta nella config (Cisco), poi la data nel nome del file, poi la data del file sul computer, poi quella del caricamento. Si può scegliere a mano un'altra versione; il raggruppamento si corregge correggendo l'hostname. Gli show vanno con la versione attuale |
| Protezioni del server | Risponde solo ai nomi `localhost`, `127.0.0.1` e `[::1]`, contro il DNS rebinding. Ogni modifica richiede l'intestazione `X-NCV-Request` e non può arrivare da un altro sito: il server non dà mai permessi CORS e rifiuta le origini diverse. I nomi dei file sul disco li sceglie il server; limiti di 256 MB per file e di 1 GB per un cliente importato; scritture atomiche. Container senza root, con il filesystem in sola lettura tranne il volume dei dati |
| Browser | Chrome, Edge, Firefox e Safari; i test nel browser girano su Chromium, Firefox e WebKit |
| Copertura della lettura | Ogni riga è compresa, ignorata di proposito (commenti, banner, certificati, messaggi sostitutivi) o sconosciuta. Il riepilogo mostra la percentuale e le sezioni non interpretate; le righe sconosciute sono evidenziate nella config |
| Valori di default | Tabelle per marca e versione; nelle viste i valori che vengono da un default sono in corsivo, e quelli non ancora confermati su apparati reali sono segnati "da verificare" |
| Collegamenti tra apparati | Verificati con LLDP/CDP, dedotti da descrizioni e indirizzi, oppure inseriti a mano; le differenze tra le fonti vengono segnalate |
| Indirizzi MAC sulle porte | Ogni porta configurata degli switch riporta i MAC dei dispositivi collegati, con la VLAN, letti dalla tabella MAC dello switch (`show mac address-table`), non dalla config. Lo strumento li mostra e segnala le porte senza MAC e lo show mancante (vedi [5.5](#55-pannello-porte-dello-switch)) |
| Show e apparati | Ogni file di show va con il suo apparato: per hostname (dal prompt o dall'output), poi per numero di serie, poi per nome del file; se serve, si corregge a mano l'hostname del file di show. Un log di sessione si divide per prompt, anche dentro le VDOM del FortiGate, oppure dalla forma degli output. Lo stato reale si mostra accanto alla config, mai al suo posto, e ogni dato rimanda alla sua riga dello show |
| Export Excel | Nel browser, con ExcelJS caricato solo al primo export. Per ogni apparato un file con un foglio per vista, con le stesse colonne delle tabelle dell'app: porte, VLAN, ACL, routing e MAC degli switch; interfacce e VLAN del FortiGate, e policy, oggetti, routing, VPN e SD-WAN di ogni VDOM; con gli show anche lo stato reale. Su ogni tabella un pulsante la esporta così come è filtrata e ordinata. I valori restano valori: nessun testo diventa una formula |
| VPN | Anche ADVPN: ruoli, controlli e scorciatoie tra filiali |
| Migrazioni switch | Pianificate sul rack con i patch panel, per gestire i cablaggi da remoto; arrivano dopo la visualizzazione |
| Prese e patch panel | Oggi i clienti non li documentano: si parte da un rilievo in sede guidato dallo strumento, che poi resta come documentazione |
| Patch list | In tre forme: PDF da stampare per rack, Excel, pagina da telefono con spunta |
| Rack | Si compongono scegliendo cosa mettere e in quali unità: apparati del progetto (firewall, switch…), patch panel, passacavi, mensole, UPS, PDU, pannelli ciechi |
| Wireless | Meraki, FortiAP e Aruba Central |
| Controller UniFi e Omada | Sia locali sia in cloud: servono entrambi i modi di lettura |
| Frontali degli apparati | Per tutti i modelli, ricavati dalla NetBox devicetype-library; frontale generico per i modelli che mancano |
| Lingua dell'interfaccia | Italiano e inglese, a scelta di chi la usa |
| Tema dell'interfaccia | Chiaro, scuro o come il sistema, a scelta di chi la usa; si parte da "sistema" e la scelta resta salvata nel browser. Il tema salvato si applica prima dell'avvio dell'app con un piccolo script separato, senza allentare la Content Security Policy |
| Config reali per lo sviluppo | Nessuna repo con config dei clienti, nemmeno privata. Si sviluppa su config sintetiche; quando un parser sbaglia su una config reale, l'utente passa in chat solo le righe che danno problemi, con i valori sensibili cambiati a mano |
| Documentazione e screenshot | Solo con dati sintetici, generati dalle config di esempio in `samples/` |
| Licenza | Open source, MIT |
| Codice | Scritto da Claude: lo stack si sceglie per semplicità d'uso, non per familiarità |
| Strumenti | TypeScript, npm workspaces, React + Vite, Mantine, i18next, CodeMirror 6, TanStack Table e TanStack Virtual, fflate, ExcelJS, Fastify, Vitest, Playwright (vedi [capitolo 8](#8-scelte-tecniche)) |
| Test automatici | Su GitHub Actions a ogni pull request: lint, tipi, test, build, immagine Docker e test nel browser sul container, su Chromium, Firefox e WebKit, anche dopo il riavvio del container. Su `main`, con tutto verde, la CI crea il tag e la release della versione con le note del registro; non si pubblicano pacchetti, immagini o pagine |
| Metodo di lavoro | Ogni proposta viene analizzata e diventa un'issue; si lavora solo dopo l'okay. Registro delle modifiche in `CHANGELOG.md`, documentazione sempre aggiornata, Semantic Versioning: ogni pull request unita è una versione, rilasciata dalla CI con tag e note del registro. Regole complete in [`CLAUDE.md`](../CLAUDE.md) |

## 3. Architettura

```mermaid
flowchart LR
    subgraph IN["Input"]
        F["File di configurazione<br/>txt · conf · zip · json · xml"]
        S["Output di show<br/>porte · tunnel · BGP · LLDP/CDP"]
        L["Lettura live SSH/API<br/>(fase server)"]
    end
    F --> R["Riconoscimento<br/>marca · OS · modello"]
    S --> R
    L -.-> R
    R --> P["Parser per marca<br/>(plugin)"]
    P --> M[("Modello neutro<br/>per apparato")]
    M --> C["Correlazione<br/>tra apparati"]
    C --> I[("Grafo<br/>dell'infrastruttura")]
    I --> V["Viste grafiche<br/>mappa · apparati"]
    I --> A["Analisi<br/>lookup · pulizia · coerenza · confronto"]
    I --> X["Migrazione<br/>mappature e trasformazioni"]
    X --> G["Generatori per marca<br/>FortiOS · FortiManager · AOS-CX · IOS-XE · Meraki"]
    G --> O["Config nuova<br/>report · patch list"]
    O -.->|verifica con rilettura e confronto| P
```

### Principi

1. **Modello neutro al centro.** Ogni parser traduce la config della sua marca in una struttura comune (interfacce, VLAN, LAG, routing, VPN, SD-WAN, ACL, policy, oggetti…). Viste, analisi e migrazioni lavorano solo su quella: aggiungere una marca non richiede di toccare l'interfaccia.
2. **L'infrastruttura è più della somma degli apparati.** Dopo la lettura dei singoli apparati, un passaggio di *correlazione* li collega tra loro:
   - un tunnel IPsec si abbina al peer il cui IP di interfaccia corrisponde al `remote-gw`;
   - una sessione BGP si abbina all'apparato che possiede l'IP del neighbor, anche dentro un range dinamico dell'hub;
   - due interfacce nella stessa subnet diventano un collegamento L3;
   - i vicini LLDP/CDP diventano cavi, e più cavi verso lo stesso vicino diventano un LAG.

   Ogni collegamento riporta la sua fonte: verificato (LLDP/CDP), dedotto (descrizioni, subnet, IP del peer) o inserito a mano. Si può confermare o correggere, e si possono aggiungere collegamenti che nessuna fonte vede, per esempio verso apparati non gestiti. Quando le fonti non sono d'accordo, la differenza viene segnalata: per esempio la descrizione della porta dice un nome e LLDP ne vede un altro.
3. **Lettori e generatori separati.** Per ogni marca possono esistere un *lettore* (parser) e un *generatore* (che scrive la config). Di lettori ne servono tanti, di generatori pochi: solo per le destinazioni delle migrazioni (FortiGate/FortiManager, Aruba, Cisco, Meraki).
4. **Tracciabilità riga per riga.** Ogni oggetto del modello ricorda da quali righe del file proviene, così dalla grafica si salta sempre alla config originale. Ogni riga del file è classificata come *compresa*, *ignorata di proposito* (commenti, banner) o *sconosciuta*, e la percentuale di copertura è sempre visibile. In migrazione è ciò che garantisce di sapere cosa **non** è stato portato.
5. **I default contano.** La running-config non mostra i valori di default: per esempio su un Catalyst una porta senza `switchport mode` non è "access", ma negozia la modalità con DTP. Il parser deve conoscere i default per marca e versione, altrimenti la migrazione perde informazioni senza che nessuno se ne accorga.
6. **Verifica automatica.** Una config generata viene riletta con il parser della marca di destinazione e confrontata con la sorgente: stesse VLAN sulle stesse porte, stesso esito sugli stessi flussi di traffico.

### Parsing in due stadi

1. **Albero sintattico generico**, uno per *famiglia di sintassi* (non per marca), con il numero di riga di ogni nodo:

   | Famiglia di sintassi | Marche |
   |---|---|
   | Indentazione | Cisco IOS/IOS-XE/NX-OS/ASA, Cisco Small Business (con i blocchi chiusi da `exit`), Aruba AOS-CX, ArubaOS-Switch, Aruba Instant/controller, TP-Link JetStream, Ubiquiti EdgeSwitch |
   | Blocchi `config / edit / set / next / end` | FortiOS (FortiGate), FortiSwitchOS, script e template CLI di FortiManager |
   | Blocchi separati da `#` + indentazione | HPE Comware |
   | Graffe o comandi `set` | Juniper Junos, Ubiquiti EdgeRouter (EdgeOS), VyOS |
   | JSON | Check Point (ShowPolicyPackage), Meraki, UniFi, Omada, API FortiManager |
   | XML | Sophos Firewall, pfSense, OPNsense |

2. **Driver di marca**: legge l'albero e popola il modello neutro, conoscendo default, nomi delle interfacce e particolarità di ogni versione.

Così il lavoro sulla sintassi si fa una volta per famiglia, e ogni nuova marca costa solo il suo driver.

Nella fase 0 ci sono i parser generici delle due famiglie dell'MVP: indentazione e blocchi `config / edit / set / next / end`. Gestiscono anche i casi che rompono le regole: valori FortiOS tra virgolette su più righe (certificati, chiavi, messaggi), VDOM con i blocchi a colonna 0, banner Cisco con delimitatore (`^C` o il carattere ETX), catene di certificati chiuse da `quit`, intestazione e blocchi `exit` dei Cisco Small Business. Un file da 20 MB si legge in meno di un secondo, fuori dal thread dell'interfaccia.

Nella fase 1 ci sono i driver di marca dell'MVP, in `packages/core/src/drivers`:

- **Cisco IOS, IOS-XE e Small Business**: interfacce e modalità delle porte (con i default di DTP e dei trunk), liste `allowed vlan` con `add`, `remove` ed `except`, modalità `general` dei Small Business, VLAN anche quando le tiene il VTP, port-channel, stack e posizione delle porte, SVI, PoE, 802.1X/MAB, port security, VLAN voce, ACL e object-group con i punti in cui sono applicati, rotte statiche, policy route, OSPF, BGP, route-map e prefix-list.
- **FortiOS 7.0–8.0**: VDOM come contesti separati, interfacce e zone, indirizzi e gruppi (con le esclusioni), servizi, VIP, IP pool, policy nell'ordine reale, rotte statiche anche verso le zone SD-WAN, policy route, BGP con gruppi e range dinamici, OSPF, route-map, prefix-list, IPsec con fase 1, fase 2 e ruolo ADVPN, SD-WAN. Gli oggetti predefiniti (`all`, `ALL`, `HTTP`, `HTTPS`, `DNS`…) si aggiungono quando le policy li usano senza definirli.

Ogni driver classifica le righe (copertura), collega i nomi alla loro definizione e segna i valori di default. Il modello si costruisce nel Web Worker: un FortiGate con 10.000 policy si legge in meno di mezzo secondo.

### Come ottenere l'input per ogni marca

| Marca | Come esportare la configurazione | Formato |
|---|---|---|
| FortiGate | Backup dalla GUI, oppure `show full-configuration` | testo `config/edit/set` |
| FortiSwitch e FortiAP gestiti dal FortiGate | Niente da esportare: la loro configurazione è dentro quella del FortiGate | testo `config/edit/set` |
| FortiSwitch autonomo | Backup della configurazione | testo `config/edit/set` |
| FortiAP e FortiSwitch gestiti dal cloud Fortinet | API (fase server) | JSON |
| FortiManager | Template CLI (testo); policy package e oggetti via API JSON-RPC | testo / JSON |
| Cisco IOS/IOS-XE/NX-OS, ASA | `show running-config` | testo indentato |
| Cisco Small Business (Sx300–Sx550X, CBS, Catalyst 1200/1300) | `show running-config` o backup della configurazione dalla GUI | testo con intestazione `config-file-header` |
| Aruba AOS-CX | `show running-config` | testo indentato |
| ArubaOS-Switch (ex ProCurve) | `show running-config` | testo |
| HPE Comware | `display current-configuration` | testo |
| Juniper (SRX, EX) | `show configuration \| display set` | comandi `set` |
| Check Point | ShowPolicyPackage sul Management Server (tar.gz con JSON), più `show configuration` di Gaia per interfacce e rotte dei gateway | JSON + testo |
| Sophos Firewall | Backup & firmware → Import export → configurazione completa | .tar con `Entities.xml` |
| pfSense (Netgate) | Diagnostics → Backup & Restore → scarica la configurazione | `config.xml` |
| OPNsense | System → Configuration → Backups → scarica la configurazione | `config.xml` |
| Ubiquiti EdgeRouter, VyOS | `show configuration commands` | comandi `set` |
| Ubiquiti EdgeSwitch, TP-Link JetStream | `show running-config` | testo |
| Meraki | Dashboard API (fase server) | JSON |
| Ubiquiti UniFi | API del controller (fase server); il backup del controller è da valutare | JSON |
| TP-Link Omada | API del controller Omada (fase server); il backup del controller è da valutare | JSON |
| Aruba AP | Instant: `show running-config`; controller AOS 8: config del controller; Central: API | testo / JSON |

**FortiSwitch e FortiAP gestiti dal FortiGate.** Con FortiLink e il wireless controller del FortiGate, la configurazione di switch e access point è scritta in quella del FortiGate: porte, VLAN, PoE e MCLAG dei FortiSwitch; SSID, profili radio e access point dei FortiAP. Si leggono quindi insieme al FortiGate, senza file in più.

**Apparati gestiti da controller o dal cloud** (Meraki, UniFi, Omada, Aruba Central, cloud Fortinet). La configurazione non sta nei singoli apparati ma nel controller, che si interroga via API: per questo arrivano con il server (fase 6). Per UniFi e Omada servono sia i controller locali (Cloud Key, UDM, OC200, software su un server) sia quelli in cloud, perché i clienti li hanno entrambi. In cambio il controller conosce già la topologia (a cosa è collegato ogni apparato) e lo stato delle porte, quindi la mappa si costruisce anche senza LLDP. Valuteremo se i file di backup dei controller permettono di anticiparli.

### Comandi show utili

Senza show la mappa mostra la configurazione, cioè cosa *dovrebbe* succedere. Con gli show si sovrappone lo stato reale: cosa succede davvero.

| Comando Cisco | Cosa aggiunge |
|---|---|
| `show version`, `show inventory` | Modello esatto, numeri di serie, membri dello stack |
| `show interfaces status` | Porte up/down, velocità, tipo (rame/SFP) |
| `show vlan brief` | Nomi delle VLAN. **Indispensabile con VTP in modalità server/client**, perché in quel caso le VLAN non sono nella running-config |
| `show etherchannel summary` | Stato dei port-channel |
| `show cdp neighbors detail`, `show lldp neighbors detail` | Collegamenti con altri apparati, quindi la topologia |
| `show mac address-table` | **Necessario**: i MAC dei dispositivi collegati a ogni porta, con VLAN e tipo (dinamico, statico, sticky). Vale anche per Cisco Small Business, con un formato diverso (vedi sotto) |
| `show ip arp` | L'IP che corrisponde a ogni MAC, letto sul router o sullo switch L3 |
| `show power inline` | Consumo PoE per porta |

Per FortiSwitch gestiti dal FortiGate la tabella MAC si legge dal FortiGate con `diagnose switch-controller switch-info mac-table` (fase 2).

**La tabella MAC sulle porte.** Ogni porta configurata riporta i MAC dei dispositivi collegati. Senza `show mac address-table` le porte indicano "tabella MAC non caricata". Alcuni casi da gestire:

- **Formati diversi**: Cisco IOS/IOS-XE scrive `aaaa.bbbb.cccc`, Cisco Small Business `aa:bb:cc:dd:ee:ff` e con colonne diverse. Servono due lettori; nel modello neutro si usa un unico formato.
- **Port-channel**: Cisco riporta i MAC sul `Po`, non sulle porte fisiche membre. Si attribuiscono al port-channel.
- **Trunk e uplink**: si apprendono decine o centinaia di MAC. Si mostra il numero e l'elenco si apre a richiesta. Sulle porte access di solito c'è un MAC, oppure due con telefono e PC in VLAN voce.
- **Statici e sticky**: i MAC fissati con port-security stanno anche nella config e si distinguono da quelli appresi.
- **Porte L3**: non compaiono nella tabella MAC; per loro serve `show ip arp`.
- **È una fotografia**: i MAC scadono dopo un po' (aging, 300 s di default), quindi un dispositivo spento o silenzioso può non comparire.

| Comando FortiGate | Cosa aggiunge |
|---|---|
| `get system status` | Modello, numero di serie, versione, modalità HA |
| `get system interface physical` | Stato e velocità delle porte |
| `get vpn ipsec tunnel summary`, `diagnose vpn ike gateway list` | Tunnel su o giù, peer collegati (anche dial-up) |
| `get router info routing-table all` | Tabella di routing reale |
| `get router info bgp summary` | Sessioni BGP stabilite e prefissi ricevuti |
| `diagnose sys sdwan health-check`, `diagnose sys sdwan service` | Stato degli SLA e membro scelto da ogni regola SD-WAN (i nomi dei comandi cambiano leggermente tra le versioni: da FortiOS 7.4 le regole IPv4 sono in `diagnose sys sdwan service4`) |

**Nella fase 1** l'app legge tutti i comandi delle due tabelle: per Cisco IOS e IOS-XE, per Cisco Small Business con i suoi formati (`show interfaces status`, `show vlan`, `show lldp neighbors`, `show mac address-table`, `show power inline`) e per FortiOS. I comandi si riconoscono anche abbreviati, come `sh int status`. Un file può contenere un solo output o un'intera sessione con più comandi; senza prompt, l'app riconosce il comando dalla forma dell'output e lo dice. Per ogni file di show si vedono l'apparato a cui va, con il motivo, e i comandi letti, che aprono il file alla riga del loro output.

## 4. Modello dati neutro

```
Cliente (nell'archivio dell'app, sul PC)
├── Siti (sede, filiali, datacenter…)
├── Rack: elementi per posizione (U): apparati, patch panel, passacavi, UPS…; prese e cavi presa ↔ porta
├── Apparati: hostname, marca, OS e versione, modello, ruolo, sito, file sorgenti
│   ├── Contesti logici: VDOM FortiGate, contesti ASA, virtual system Check Point, logical system Juniper
│   ├── Interfacce: fisiche, LAG, SVI, loopback, tunnel, sotto-interfacce
│   │     L2 (access/trunk, VLAN, nativa, voce) · L3 (IP, VRF, DHCP relay)
│   │     LAG/MLAG (LACP, vPC, VSX, stack) · PoE · STP · 802.1X/MAB
│   │     posizione hardware (membro, slot, porta, tipo rame/SFP)
│   ├── VLAN · VRF
│   ├── Routing: rotte statiche, policy route, BGP (AS, router-id, neighbor, gruppi,
│   │     range dinamici, reti annunciate, redistribuzione, route-map, prefix-list,
│   │     community), OSPF (aree, interfacce)
│   ├── VPN: IPsec fase 1 e fase 2 (peer, proposte, DH, PFS, selettori), GRE,
│   │     ruolo ADVPN (sender/receiver) e scorciatoie attive
│   ├── SD-WAN: zone, membri (underlay/overlay), health check e SLA, regole
│   ├── Zone · oggetti indirizzo e gruppi · servizi e gruppi · schedule · utenti
│   ├── Policy firewall: ordine, interfacce/zone, sorgente, destinazione, servizio,
│   │     azione, NAT, profili di sicurezza, log, commento
│   ├── NAT: VIP, IP pool, regole NAT
│   ├── ACL: voci e punti in cui sono applicate
│   ├── Servizi di gestione: NTP, DNS, SNMP, syslog, AAA/RADIUS/TACACS, utenti locali
│   ├── Apparati gestiti: FortiSwitch e FortiAP collegati al FortiGate
│   ├── Wireless: SSID, sicurezza, VLAN, ruoli, access point e radio
│   ├── Stato da show (facoltativo): porte, tunnel, sessioni BGP, SLA, vicini LLDP/CDP,
│   │     tabella MAC per porta (MAC, VLAN, tipo dinamico/statico/sticky)
│   └── Diagnostica: righe non comprese, avvisi del parser
└── Collegamenti tra apparati: tipo (cavo, LAG, subnet, IPsec, overlay SD-WAN, scorciatoia ADVPN,
      BGP, OSPF), estremi, fonte (LLDP/CDP, descrizione, inserito a mano), affidabilità
```

- Ogni elemento porta con sé i riferimenti alle righe sorgente.
- I contesti logici vanno previsti da subito: policy e oggetti appartengono a un contesto (per esempio una VDOM), non direttamente all'apparato.

**Cosa c'è già (fase 1).** La prima versione del modello, in `packages/core/src/model/types.ts`, copre un apparato alla volta:

- l'apparato, con hostname, marca, sistema e versione, modello, membri dello stack, IP di gestione e funzioni in uso;
- le interfacce, con modalità L2, VLAN, port-channel, posizione sul frontale, PoE, 802.1X/MAB, port security, indirizzi IP, VRF, ACL applicate, OSPF, e per FortiOS alias, ruolo, accesso amministrativo e VDOM;
- le VLAN, anche quelle implicite (VLAN 1, VLAN usate dalle porte ma non scritte per via del VTP);
- i contesti logici (le VDOM, oppure un solo contesto per gli switch), con zone, indirizzi, gruppi, servizi, policy, VIP, IP pool, ACL, object-group, routing (statiche, policy route, BGP, OSPF, route-map, prefix-list), IPsec e SD-WAN;
- i riferimenti dai nomi alle definizioni, la copertura riga per riga e gli avvisi (per esempio VLAN fuori dalla config per via del VTP, policy disattivate, senza log, che permettono tutto o che aprono servizi di gestione a tutti);
- i clienti dell'archivio, con i file raggruppati per apparato in versione attuale, versioni precedenti e show (`packages/web/src/state/groups.ts`), e la data di ogni config, scritta dentro o nel nome del file (`packages/core/src/detect/date.ts`);
- lo stato dagli show, in `packages/core/src/show/`, tenuto separato dal modello della config: porte, VLAN, port-channel, vicini CDP e LLDP, tabella MAC, ARP, PoE, membri dello stack e numeri di serie, tunnel IPsec, rotte, sessioni BGP, health check e regole SD-WAN, ognuno con il file e la riga da cui viene. Più file di show dello stesso apparato si sommano.

Ogni elemento ha le righe da cui proviene e l'elenco dei campi che vengono da un default, con quelli ancora da verificare. Rack, collegamenti tra apparati, servizi di gestione, apparati gestiti e wireless arrivano nelle fasi successive.

## 5. Le viste grafiche

Il [mockup](mockup/index.html) contiene le viste 5.1–5.7, 5.9 e 5.11, con un cliente di esempio: una sede con FortiGate hub e tre Catalyst, tre filiali con FortiGate in SD-WAN e ADVPN.

### 5.1 Mappa dell'infrastruttura (vista principale)

- Apparati raggruppati per sito, con il ruolo in evidenza. Internet e i provider sono collegati alle interfacce WAN.
- **Livelli attivabili**: cavi e LAG, subnet condivise, VPN e overlay SD-WAN, scorciatoie ADVPN, sessioni BGP/OSPF.
- **Clic su un collegamento**: i due estremi affiancati. Per esempio:
  - per un tunnel IPsec, fase 1 e fase 2 confrontate parametro per parametro, con le differenze in rosso e il suggerimento per sistemarle;
  - per una sessione BGP, AS, IP, route-map e prefissi;
  - per un trunk, VLAN permesse e nativa dei due lati.
- **Clic su un apparato**: riepilogo e accesso alle sue viste di dettaglio.
- **Collegamenti a mano**: si disegnano trascinando da una porta a un'altra, anche verso apparati che non fanno parte del progetto (un router del provider, un NAS). Restano salvati nell'archivio del cliente.
- **Verifica dei cavi con LLDP/CDP**: con gli output dei vicini caricati, ogni cavo risulta verificato, solo dedotto oppure in contrasto con la descrizione della porta. Vengono segnalate anche le porte senza LLDP attivo, dove la verifica non è possibile.
- **Problemi in evidenza**: i collegamenti incoerenti (vedi capitolo 6) sono segnati sulla mappa ed elencati sotto.
- **Stato reale**, se sono stati caricati gli show: tunnel su o giù, BGP stabilito o no, SLA rispettati.
- Siti proposti in automatico (per esempio dal prefisso dell'hostname) e modificabili. Disposizione automatica, con posizioni modificabili e salvate nel progetto.
- **Esportazione in draw.io e immagine**, per la documentazione da consegnare al cliente.

### 5.2 VPN

**Nella fase 1**, per ogni FortiGate e per ogni VDOM: elenco dei tunnel con tipo, interfaccia, gateway remoto, versione IKE, proposte, ruolo ADVPN e fasi 2 (selettori, proposte, PFS, gruppi DH, negoziazione automatica, durata della chiave), con i valori di default indicati come tali. Con gli show, lo stato di ogni tunnel: quante istanze sono su e quante giù (i dial-up ne hanno una per peer), con i selettori attivi e lo stato di IKE. L'abbinamento dei due estremi arriva con la mappa (fase 2).

Elenco dei tunnel di tutto il progetto con i due estremi abbinati, e per ciascuno:

- tipo (statico o dial-up), interfacce e IP;
- IKE, proposte, gruppi DH, PFS, durate;
- selettori di fase 2, ADVPN, IP del tunnel.

Oltre a IPsec, anche WireGuard (i due lati si abbinano con le chiavi pubbliche) e OpenVPN, usati da pfSense, OPNsense e UniFi.

Le topologie hub & spoke sono riconosciute. I tunnel verso peer che non fanno parte del progetto (partner, cloud) sono segnalati come "un solo lato".

**ADVPN**, per le reti hub & spoke in cui le filiali aprono tunnel diretti tra loro:

- ruolo di ogni tunnel: sender sull'hub, receiver sulle filiali;
- controlli: policy che permettono il traffico tra filiali sull'hub e sulle filiali, BGP che non cambia il next hop delle rotte riflesse (serve a far partire le scorciatoie);
- per ogni coppia di filiali: scorciatoia attiva (dagli show), possibile o non possibile, e perché;
- sulla mappa, le scorciatoie attive collegano direttamente le filiali.

![ADVPN nel mockup: controlli sulla configurazione, stato delle scorciatoie per ogni coppia di filiali e dettaglio della scorciatoia attiva](img/mockup-advpn.png)

### 5.3 SD-WAN

![Regole SD-WAN di una filiale nel mockup: membri, health check con SLA e ordine di preferenza dei membri](img/mockup-sdwan.png)

Per ogni FortiGate:

- zone e membri (underlay e overlay), con costi e priorità;
- health check, con i target di SLA (latenza, jitter, perdita) e i membri controllati;
- **regole SD-WAN** nell'ordine di valutazione:
  - cosa intercettano: indirizzi, applicazioni, Internet Service;
  - strategia: manuale, migliore qualità, costo minore entro SLA, massima banda;
  - ordine di preferenza dei membri, con quello in uso evidenziato se c'è lo show.

  In fondo c'è la regola implicita.

Sulla mappa, gli overlay SD-WAN collegano filiali e hub. Le stesse viste valgono per il multi-WAN degli altri vendor, per esempio i gateway group di pfSense e OPNsense.

**Nella fase 1** ci sono zone, membri, health check con SLA e regole in ordine con la regola implicita. Con gli show si vedono lo stato di ogni membro negli health check (attivo o no, latenza, jitter, perdita, SLA rispettato o no) e il membro in uso da ogni regola.

### 5.4 Routing e BGP

- **Per apparato**: rotte statiche, policy route, BGP (neighbor, gruppi, range dinamici dell'hub, reti annunciate, redistribuzioni, route-map e prefix-list espanse), OSPF.
- **Sulla mappa**: sessioni BGP abbinate tra apparati, con AS, iBGP o eBGP e route reflector.
- **Tabella di routing reale**, se caricata da show, con evidenziate le rotte attese che mancano (per esempio la LAN di una filiale la cui sessione BGP non è su). Senza show, la tabella mostra le rotte che derivano dalla config: connesse, statiche, reti annunciate.

**Nella fase 1**, per ogni apparato e per ogni VDOM: rotte ricavate dalla config (connesse e statiche, anche verso le zone SD-WAN) con la ricerca della rotta per un IP, policy route, OSPF con le interfacce, l'area e quelle passive, BGP con neighbor, gruppi, range dinamici, reti annunciate e redistribuzioni, route-map e prefix-list. Con gli show: la tabella di routing reale, con le rotte apprese con OSPF e BGP e la ricerca della rotta per un IP, e le sessioni BGP con lo stato e i prefissi ricevuti, anche accanto ai neighbor della config.

### 5.5 Pannello porte dello switch

![Pannello porte di uno stack Catalyst nel mockup: colori per VLAN, trunk a strisce, porte configurate senza MAC appreso, port-channel e dettaglio della porta con i MAC collegati e la config originale](img/mockup-porte.png)

Disegno del frontale, con un riquadro per ogni membro dello stack:

- **Colore** = VLAN access. La stessa VLAN ha lo stesso colore su tutti gli apparati del progetto, così si confrontano a colpo d'occhio switch vecchio e nuovo.
- **Trunk a strisce**, una striscia per ogni VLAN permessa. Ci sono segni anche per porta L3, porta spenta, membro di port-channel, vPC/VSX, PoE, 802.1X/MAB e VLAN voce.
- **Stato reale** (attiva, non collegata, err-disabled), se è stato caricato `show interfaces status`.
- **Filtro VLAN**: scelta una VLAN, si evidenziano tutte le porte che la trasportano (access, trunk, nativa).
- **Clic su una porta**: tutta la configurazione, il vicino CDP/LLDP, i dispositivi collegati e le righe originali.
- **Indirizzi MAC** di ogni porta configurata, dalla tabella MAC dello switch (vedi [Comandi show utili](#comandi-show-utili)):
  - ogni MAC con la sua VLAN e il tipo (dinamico, statico, sticky); sui trunk il numero, con l'elenco a richiesta; sui membri di un port-channel il rimando al `Po`;
  - un segno sul frontale per le porte configurate e non spente senza nessun MAC appreso: forse sono inutilizzate, e nelle migrazioni sono da verificare prima di riportarle sul nuovo switch. Le porte in `shutdown` si vedono già come spente e non hanno il segno;
  - "tabella MAC non caricata" se manca lo show.
- **Vista logica di LAG e MLAG**: i due switch della coppia vPC/VSX, il peer-link, il keepalive e i port-channel verso il basso.
- **Disposizione delle porte**:
  - in prima battuta generica, ricavata dai nomi delle interfacce: porte dispari sopra e pari sotto, uplink a parte, un blocco per membro;
  - poi frontali realistici per tutti i modelli, ricavati dalla [NetBox devicetype-library](https://github.com/netbox-community/devicetype-library): migliaia di modelli con elenco e tipo di porte, con licenza CC0 e quindi riutilizzabile liberamente; per i modelli che mancano resta il frontale generico;
  - il modello si ricava dalla config stessa (per esempio `switch 1 provision c9300-48p` su Cisco, l'intestazione `#config-version=FGT60F-…` su FortiGate) oppure da `show inventory`.
- Lo stesso pannello serve per le **interfacce del FortiGate** (port1…, wan, x1/x2 SFP+) e per i **FortiSwitch** gestiti dal FortiGate, comprese le coppie MCLAG.

**Nella fase 1** il pannello degli switch è quello generico: un riquadro per ogni membro dello stack, porte dispari sopra e pari sotto, uplink a parte, colore per VLAN access (lo stesso su un apparato), trunk a strisce, porte spente e L3, segni per PoE, 802.1X/MAB, VLAN voce e port-channel, filtro per VLAN e dettaglio della porta con i valori di default indicati come tali. Sotto il pannello c'è la tabella di tutte le interfacce. Per il FortiGate le interfacce sono in una tabella, con tipo, VDOM, zona, interfaccia padre o membri e accesso amministrativo.

Con gli show, sempre nella fase 1:

- una barra sulla porta per lo stato reale (attiva, non collegata, in errore) e le colonne dello stato e dei MAC nella tabella; per il FortiGate lo stato e la velocità da `get system interface physical`;
- nel dettaglio della porta: stato, velocità e duplex, flag del port-channel, vicini CDP e LLDP, PoE e MAC con VLAN e tipo (quelli della port security sono segnati sticky) e con l'IP, se lo stesso switch ha la tabella ARP; l'abbinamento tra MAC e IP di apparati diversi resta fuori dalla fase 1. Sui trunk con più di 4 MAC si vede il numero e l'elenco si apre a richiesta; sui membri di un port-channel c'è il rimando al `Po`;
- il segno per le porte configurate senza MAC vale per tutte le porte configurate e non spente, collegate o no. Riguarda solo porte fisiche e port-channel: SVI, loopback e porte L3 non imparano MAC e non hanno il segno;
- senza `show mac address-table` ogni porta configurata dice "tabella MAC non caricata", e il riepilogo ha un solo avviso per tutto lo switch.

![Lo stack Catalyst 9300 degli esempi con gli show caricati: barra dello stato reale sulle porte, segno sulle porte configurate senza MAC e dettaglio di una porta con telefono e PC](img/app-stato.png)

### 5.6 VLAN

Per ogni VLAN: nome, **gateway** (anche se si trova su un altro apparato del progetto, per esempio la sotto-interfaccia del FortiGate), numero di porte access, voce e trunk, e una striscia con tutte le porte nell'ordine del frontale. È il riferimento principale nelle migrazioni switch.

**Nella fase 1**: nome, gateway se sta sullo stesso apparato, porte access, voce, untagged e tagged (i membri dei port-channel contano nel `Po`); per il FortiGate, le interfacce VLAN con ID, interfaccia padre, indirizzo e VDOM. Con `show vlan brief`, o `show vlan` dei Small Business, compaiono i nomi delle VLAN tenute dal VTP, segnati come presi dallo show.

### 5.7 Policy firewall

![Policy di un FortiGate nel mockup: regole raggruppate per coppia di interfacce, oggetti espandibili, avvisi e config originale della regola](img/mockup-policy.png)

Tabella in stile GUI FortiGate:

- **Ordine reale di valutazione**: conta la sequenza nel file, non l'ID. Si può vedere per coppia di interfacce o come lista unica.
- **Oggetti come etichette**: al passaggio del mouse i gruppi si espandono fino agli IP; con un clic si apre l'oggetto con l'elenco dei punti **dove è usato**.
- **Ricerca** testuale e **per IP**: trova le regole che coinvolgono 10.30.0.15, anche tramite subnet, gruppi e "all".
- **Avvisi**: regole oscurate, disabilitate, senza log, any-any, con sorgente "all" su servizi di gestione.
- **Viste collegate**: VIP/NAT, IP pool, interfacce e zone, rotte statiche.
- **Altri vendor**: la vista segue il modello di ognuno. Per esempio pfSense e OPNsense hanno regole per interfaccia d'ingresso, con le regole floating valutate per prime.

**Nella fase 1**: ordine reale, lista unica o per coppia di interfacce, VDOM, ricerca testuale e per IP (tramite indirizzi, subnet, gruppi con le esclusioni, VIP e `all`; le regole che contengono l'IP solo tramite `all` restano in secondo piano), dettaglio della regola con gli oggetti espansi fino agli IP e i servizi fino alle porte, avvisi (disabilitate, senza log, any-any, sorgente `all` su servizi di gestione). Gli oggetti hanno una vista propria con "dove è usato". Le regole oscurate arrivano con la pulizia policy (fase 3).

### 5.8 ACL degli switch

Elenco delle ACL con le voci, gli object-group espansi e i **punti in cui sono applicate** (interfaccia e direzione, VTY, SNMP, NAT, route-map…). Usa lo stesso motore di ricerca e di lookup delle policy firewall.

**Nella fase 1**: voci, punti di applicazione (interfacce, VTY, SNMP, route-map, accesso di gestione dei Small Business), object-group espansi e ricerca per IP tramite host, subnet, gruppi e `any`. Il lookup di un flusso arriva nella fase 3.

### 5.9 Config originale collegata

Testo originale con evidenziazione della sintassi, blocchi piegabili e numeri di riga. I nomi degli oggetti sono cliccabili (portano alla definizione) e le righe non comprese dal parser sono evidenziate. Ogni dettaglio (porta, policy, tunnel) indica le righe da cui proviene.

Nella fase 0 ci sono evidenziazione, blocchi piegabili, numeri di riga, ricerca e una struttura navigabile (blocchi `config`, VDOM, interfacce, banner…). Il testo resta identico al file: si copia o si scarica byte per byte, anche con i fine riga di Windows.

Nella fase 1, per gli apparati letti da un driver, la config è l'ultima scheda delle viste: i nomi sono cliccabili verso la definizione, con "Torna indietro"; le righe non interpretate sono evidenziate (si possono nascondere); ogni elemento delle viste apre la config sulle sue righe.

![La config collegata di uno stack Catalyst: righe non interpretate evidenziate e nomi cliccabili verso la loro definizione](img/app-config.png)

### 5.10 Riepilogo dell'apparato

Hostname, modello, versione, IP di gestione, conteggi (interfacce, VLAN, policy, oggetti), funzioni in uso (stack, vPC, VSX, 802.1X, OSPF, SD-WAN…), show caricati e percentuale di copertura del parser.

**Nella fase 1** il riepilogo è la prima scheda di ogni apparato letto da un driver: riconoscimento (correggibile a mano), IP di gestione, stack o VDOM, conteggi, funzioni in uso, avvisi raggruppati per tipo con il salto alle righe, copertura con l'elenco delle sezioni non interpretate, show caricati con il motivo dell'abbinamento e i comandi letti, che aprono il file alla riga. Sugli switch c'è un solo avviso per la tabella MAC non caricata e uno per le porte configurate senza MAC, con il numero di porte e il promemoria che la tabella MAC è una fotografia.

### 5.11 Rack e patch panel

![Il rack del CED nel mockup: firewall, stack di switch, patch panel, mensola e UPS nelle loro unità, con l'elenco degli elementi e il modulo per aggiungerne altri](img/mockup-rack-r1.png)

- **Composizione del rack**: si sceglie cosa mettere e in quali unità. Si possono inserire gli apparati del progetto (firewall, switch, controller…) ed elementi generici: patch panel da 24 o 48 porte, passacavi, mensole, UPS, PDU, pannelli ciechi. Gli elementi si spostano trascinandoli e un sito può avere più rack.
- Le porte degli apparati mostrano i colori delle VLAN presi dalla config, con i frontali realistici di ogni modello. Cliccando un elemento si apre l'apparato corrispondente.

![Rack di piano nel mockup prima della migrazione: le prese dei patch panel sono collegate a porte sparse e i cavi si incrociano](img/mockup-rack-oggi.png)

- Ogni presa collegata alla sua porta, con il colore della VLAN che serve. Cliccando una presa si vede cosa c'è dall'altra parte: utenza, porta, VLAN, telefono o PC (dalla tabella MAC).
- **Da dove arrivano i dati**: le porte dalle config e dagli show. Prese e patch panel oggi non sono documentati, quindi si parte da un **rilievo in sede** guidato dallo strumento:
  - una pagina da telefono elenca le prese di ogni patch panel; per ciascuna il tecnico indica la porta dello switch, oppure "libera";
  - lo strumento propone le corrispondenze probabili e mostra cosa c'è su ogni porta (telefono, PC, AP, dalla tabella MAC e da LLDP), così il tecnico conferma invece di scrivere;
  - con la lettura live (fase 6) basterà staccare e riattaccare un cavo alla volta: lo strumento riconosce da solo la porta che cambia stato;
  - il rilievo resta nell'archivio del cliente come documentazione per le volte successive.
- Quando esistono, si possono importare anche file dell'installatore (CSV o Excel) o dati da NetBox.
- È la base per le migrazioni switch pianificate da remoto (vedi 7.3).

## 6. Analisi

| Funzione | Cosa fa |
|---|---|
| **Controlli di coerenza** | Confronta gli estremi di ogni collegamento e trova: tunnel IPsec con proposte, gruppi DH o selettori incompatibili; sessioni BGP con AS sbagliato o senza il neighbor dall'altro lato; rotte attese che mancano; trunk con VLAN nativa o permesse diverse; LACP configurato da un solo lato; MTU diverse; IP duplicati e subnet sovrapposte tra siti (un problema classico con VPN e SD-WAN); scorciatoie ADVPN che non possono partire; descrizioni delle porte in contrasto con LLDP/CDP. Sugli switch segnala anche lo show della tabella MAC mancante (un avviso per apparato) e le porte configurate e non spente senza MAC appreso: avvisi e non errori, perché la tabella MAC è una fotografia. |
| **Policy lookup** | Dato un flusso (IP sorgente, IP destinazione, protocollo e porta, interfaccia d'ingresso), indica quale regola lo gestisce e perché. Vale sia per le policy firewall sia per le ACL. In seguito proseguirà **tra le sedi**: policy della filiale, regola SD-WAN scelta, tunnel, policy dell'hub. |
| **Pulizia policy** | Trova regole oscurate da regole precedenti (shadowed) o ridondanti, oggetti inutilizzati, oggetti duplicati (stesso valore, nome diverso), gruppi vuoti, any-any, regole disabilitate o senza log. Serve soprattutto **prima** di una migrazione, per non portarsi dietro regole e oggetti inutili. |
| **Confronto versioni** | Mostra le differenze tra due backup dello stesso apparato: non solo nel testo, ma anche nel significato (policy, oggetti, porte, VLAN, tunnel, rotte aggiunti, rimossi o modificati). |
| **Topologia** | Disegna lo schema degli apparati collegati (la mappa del capitolo 5.1), ricavato da LLDP/CDP, subnet condivise, VPN, BGP e descrizioni delle porte. |

**Limite da tenere presente**: lavorando offline non ci sono i contatori di utilizzo delle regole (hit count), né la risoluzione di FQDN, geolocalizzazione e Internet Service. Le regole che dipendono da questi elementi vengono segnalate come "non valutabili".

## 7. Migrazioni

### 7.1 Flusso generale

1. Si carica la config sorgente, e se possibile gli output dei comandi show.
2. Si sceglie la destinazione: marca, modello, versione.
3. **Mappatura**: interfacce e zone (firewall) o porte (switch), con una tabella e con il trascinamento sui frontali. È previsto anche il consolidamento (più apparati vecchi su uno nuovo).
4. **Trasformazioni**: rinomina di oggetti e interfacce, rinumerazione delle VLAN, sostituzione con gli oggetti predefiniti della destinazione (per esempio i servizi HTTP/HTTPS del FortiGate).
5. **Compatibilità**: ogni funzione della sorgente viene tradotta, segnalata come da rivedere o segnalata come non supportata, mai scartata in silenzio.
6. **Output**:
   - la config di destinazione;
   - un report (HTML/Excel) con mappature, avvisi e righe non migrate;
   - per gli switch, la **patch list** per i tecnici in campo ("cavo dalla porta 1/0/12 vecchia alla porta 2/0/5 nuova").
7. **Verifica**: la config generata viene riletta e confrontata con la sorgente.

### 7.2 Firewall verso FortiGate

**Sorgenti**: tutte. Ordine: ASA (testo, la più diffusa), Check Point, Sophos, Juniper, poi pfSense e OPNsense.

**Perché non basta FortiConverter.** Fortinet ha un tool ufficiale per questa migrazione, [FortiConverter](https://docs.fortinet.com/document/forticonverter/7.0.3/online-help/220359), ma l'esperienza sul campo è che la qualità del risultato non basta e che non copre gli switch. La conversione quindi la facciamo noi, con queste caratteristiche:

- **pulizia prima della migrazione** (oggetti inutilizzati, regole oscurate), per non portarsi dietro regole e oggetti inutili;
- **revisione visiva** di sorgente e destinazione affiancate, sulla mappa e nelle viste di dettaglio;
- **verifica di equivalenza integrata**: per ogni regola della sorgente si generano flussi di prova e si controlla che il FortiGate dia lo stesso esito. La verifica funziona anche su config prodotte da altri strumenti o scritte a mano.

**Cosa si converte**: interfacce e zone, oggetti, servizi, policy, NAT, **e anche VPN, routing e SD-WAN**. Per esempio: crypto map ASA verso VPN IPsec del FortiGate basate su interfaccia, community VPN di Check Point, tunnel `st0` e sessioni BGP di Juniper.

**Output**:

- config FortiOS da applicare al FortiGate;
- **script CLI per FortiManager** da eseguire sulla destinazione "Policy Package o ADOM Database" (oggetti e policy), oppure template CLI per il provisioning;
- report di migrazione e report di equivalenza.

**Punti difficili:**

- **ASA**: le ACL sono applicate all'interfaccia d'ingresso, mentre il FortiGate vuole sia l'interfaccia di ingresso **sia** quella di uscita. Quella di uscita va ricavata dalla tabella di routing, e una regola può dover essere divisa in più policy. Il NAT (object NAT e twice NAT) va tradotto in VIP, IP pool o central NAT. Le VPN basate su crypto map diventano VPN basate su interfaccia.
- **Check Point**: layer e inline layer, regole implicite, oggetti dinamici. Inoltre la policy sta sul Management Server, mentre le interfacce stanno sui gateway.
- **Sophos**: tipi di regola diversi (rete, utente, WAF) e oggetti propri.
- **pfSense e OPNsense**: come per ASA, le regole sono per interfaccia d'ingresso e quella di uscita va ricavata dal routing. Gli alias diventano oggetti, i port forward diventano VIP, i gateway group diventano SD-WAN. I tunnel WireGuard e OpenVPN vanno ripensati come IPsec.
- **In generale**: limiti di lunghezza e di caratteri nei nomi, mappatura dei servizi predefiniti, schedule, utenti e gruppi.

Una volta pronti lettore e generatore FortiOS, anche il **refresh FortiGate → FortiGate** (modello nuovo, interfacce rimappate) arriva quasi gratis.

### 7.3 Migrazioni switch

Arrivano dopo la parte di visualizzazione, su cui si appoggiano (lettori, modello neutro, mappa, rack).

- Refresh Cisco (per esempio Catalyst 2960/3750/3850 → 9200/9300) e Cisco → Aruba AOS-CX, compresa la traduzione vPC → VSX, port-security e 802.1X.
- **Pianificazione sul rack**, pensata per chi gestisce i cablaggi da remoto:
  1. se prese e patch panel non sono documentati, si parte dal rilievo in sede (vedi 5.11);
  2. si posiziona il nuovo switch nel rack;
  3. lo strumento propone il cablaggio migliore: ogni presa sulla porta della stessa colonna, con cavi corti e senza incroci (oppure raggruppati per VLAN, se si preferisce);
  4. la configurazione segue la presa: ogni porta nuova riceve VLAN, voce, 802.1X e descrizione della porta vecchia che sostituisce;
  5. escono la config del nuovo switch e la **patch list** per i tecnici in sede, divisa per rack ("presa A05: dalla Gi1/0/30 del vecchio switch alla Gi1/0/9 del nuovo, cavo da 0,5 m"), in tre forme: PDF da stampare, Excel e pagina da telefono dove il tecnico spunta ogni spostamento;
  6. dopo il cambio si caricano LLDP, tabella MAC e stato porte del nuovo switch: lo strumento verifica che ogni presa sia finita sulla porta prevista e segnala le differenze.
- Consolidamento di più switch su uno stack, con la stessa logica.

![Lo stesso rack dopo la migrazione pianificata: nuovo switch, cavi dritti e patch list per i tecnici](img/mockup-rack-dopo.png)

### 7.4 Meraki e cloud

Meraki non ha una config testuale: lettura e scrittura passano dalla Dashboard API, che richiede il server (fase 6).

## 8. Scelte tecniche

**Linguaggio: TypeScript per tutto.** Motivi:

- i parser girano direttamente nel browser: il server dell'app conserva i file ma non li legge;
- un solo linguaggio e un solo modello dati, condiviso tra parser e interfaccia;
- lo stesso codice girerà anche sul server per il team, senza riscriverlo;
- l'alternativa (backend Python + interfaccia web) richiederebbe due linguaggi e un server che riceve i file.

Il punto forte di Python (librerie SSH come Netmiko) serve solo per la lettura live, che arriva con il server. Lì la scelta resta aperta, perché il raccoglitore live è un componente separato che produce gli stessi file di testo dei backup.

| Area | Scelta |
|---|---|
| Interfaccia | React + Vite, con Mantine come libreria di componenti (tema chiaro, scuro o come il sistema, a scelta) |
| Traduzioni | i18next, un file JSON per lingua; un test verifica che italiano e inglese abbiano le stesse chiavi, e il lint segnala i testi scritti direttamente nel codice |
| Gestore pacchetti | npm workspaces: nessuno strumento in più da installare |
| Tabelle grandi (migliaia di policy) | TanStack Table e TanStack Virtual (MIT): ordinamento, filtro e righe virtualizzate. Un test verifica che la tabella di 10.000 policy resti fluida |
| Pannelli porte | SVG disegnato da codice |
| Mappa e schemi LAG/vPC | React Flow con layout automatico, esportazione in draw.io |
| Config originale | CodeMirror 6 (evidenziazione, piegatura, salto alla riga) |
| Elaborazione | Web Worker, così l'interfaccia non si blocca sui file grandi |
| Archivi zip, tar, tar.gz e gz | fflate per zip e gzip, lettore tar scritto nel progetto; archivi annidati, con limiti di profondità e dimensione |
| Clienti e archivio | Archivio locale su disco, in un volume Docker, gestito dal server dell'app in `packages/server`: Node.js con Fastify e @fastify/static (MIT), zip con fflate. La lettura delle config resta nel browser |
| Export | Excel con ExcelJS (MIT), caricato solo al primo export; più avanti il report HTML stampabile in PDF |
| Test | Vitest (parser, logica e server), Playwright (interfaccia, su Chromium, Firefox e WebKit) |
| Struttura del codice | Monorepo: `core` (modello, parser, driver di marca, funzioni di ricerca sul modello, poi correlazione, generatori e analisi, senza dipendenze dal browser), `web` (interfaccia), `server` (serve l'app e conserva l'archivio dei clienti) |
| Avvio | Docker: build in tre passaggi (build dell'app e del server, poi le sole dipendenze del server, poi il server Node.js senza privilegi) e `compose.yaml` con la porta aperta solo su `127.0.0.1`, il volume dei dati e il filesystem in sola lettura |

La licenza di ogni libreria va verificata prima di adottarla: deve essere compatibile con la licenza MIT del progetto.

**Distribuzione.** L'app si usa **solo in locale**: nessuna pubblicazione online.
- Si avvia sul PC con Docker (`docker compose up -d`) e si apre nel browser su `http://localhost:8080`.
- L'immagine si costruisce sul PC dal codice e non viene pubblicata su nessun registro.
- Il container contiene il server dell'app, che serve l'interfaccia e conserva l'archivio dei clienti nel volume dei dati, e risponde solo al PC stesso.
- Internet serve solo la prima volta, per costruire l'immagine; dopo, l'app funziona anche senza rete.
- La stessa immagine servirà al server della fase 6.

Docker Desktop è gratuito per uso personale e per le aziende con meno di 250 dipendenti e meno di 10 milioni di fatturato; in alternativa funzionano Podman Desktop e Rancher Desktop, gratuiti.

**Lingua.** Interfaccia in italiano e in inglese fin dalla prima versione, con la lingua scelta da chi la usa; codice e nomi tecnici in inglese. I termini di rete d'uso comune (VLAN, trunk, policy) restano invariati in entrambe le lingue.

## 9. Sicurezza e riservatezza

- **Le config dei clienti non lasciano il PC**: vengono elaborate nel browser e conservate dal server dell'app nel volume Docker sul PC, senza telemetria e senza chiamate esterne. Il server manda al browser una regola di sicurezza (Content Security Policy) che blocca qualsiasi collegamento ad altri siti, anche in caso di errore nel codice; i test automatici lo verificano.
- **Config 1:1**: lo strumento non modifica mai i file caricati. Ciò che si vede, si copia o si scarica è identico all'originale, compresi spazi, fine riga e segreti. Per questo non c'è un anonimizzatore: le config restano sul PC e non serve.
- **La repo è pubblica, quindi niente config reali nella repo.** Config di esempio, test, documentazione e screenshot usano solo dati sintetici.
- **Config reali per lo sviluppo**: nessuna repo con config dei clienti, nemmeno privata. Si sviluppa su config sintetiche; quando un parser sbaglia su una config reale, servono solo le righe che danno problemi, passate in chat con i valori sensibili cambiati a mano.
- **Il server dell'archivio** risponde solo a `localhost` e `127.0.0.1`, accetta modifiche solo dall'app e non dà permessi ad altri siti; sceglie lui i nomi dei file sul disco e gira senza root, con il filesystem in sola lettura tranne il volume dei dati. Ogni protezione ha il suo test automatico.
- **Segreti mascherati** nell'interfaccia, visibili con un clic (fase successiva): cambia solo la visualizzazione, utile quando si condivide lo schermo, e non tocca la config.
- **File dei clienti** salvati in locale, nell'archivio dell'app; la cifratura opzionale con una password resta da fare.
- **Licenza MIT**: chiunque può usare, modificare e ridistribuire il codice, anche commercialmente, mantenendo l'avviso di copyright (vedi [LICENSE](../LICENSE)).

## 10. Qualità e test

- **Raccolta di config di esempio** per ogni marca e versione, solo sintetiche, in [`samples/`](../samples/README.md), con il risultato atteso salvato accanto: il riconoscimento in `expected.json` e il riassunto del modello di ogni config in `expected-models.json`. Ogni modifica ai parser e ai driver viene verificata su tutta la raccolta.
- **Progetti di esempio multi-apparato** (sede e filiali con VPN, SD-WAN e BGP) per verificare la correlazione e i controlli di coerenza.
- **Copertura** misurata per ogni file: percentuale di righe comprese, verificata dai riassunti attesi.
- **Prestazioni**: una config da 20 MB si apre senza bloccare l'interfaccia e la tabella di 10.000 policy resta fluida durante lo scorrimento (test nel browser).
- **Server e archivio**: test unitari delle protezioni (nomi accettati, intestazione dell'app, origine, nomi dei file, limiti), dell'archivio e dell'esportazione e importazione byte per byte; nel browser, clienti, versioni, correzioni ed esportazione. In CI un test verifica che l'archivio resti dopo il riavvio e l'aggiornamento del container.
- **Andata e ritorno** per i generatori: modello → config → rilettura → stesso modello.
- **Test differenziali** per le migrazioni: stessi flussi di prova, stesso esito su sorgente e destinazione.
- **Test automatici dell'interfaccia** con screenshot.
- **CI su GitHub Actions**: a ogni pull request lint, controllo dei tipi, formattazione, test unitari, build, costruzione dell'immagine Docker, controllo delle protezioni del container e test nel browser sull'app servita dal container, su Chromium, Firefox e WebKit. Su `main`, con tutto verde, crea il tag e la release della versione con le note del registro; non pubblica pacchetti, immagini o pagine.

## 11. Roadmap

Ogni fase si chiude con qualcosa che puoi aprire e provare. L'ordine delle fasi 4–6 si può rivedere strada facendo.

### Fase 0: fondamenta (realizzata)
Issue [#4](https://github.com/TehMaat/Network-Config-Viewer/issues/4).
- Struttura del progetto, test automatici su GitHub Actions, avvio in locale con Docker.
- Caricamento di più file, anche dentro archivi zip, tar, tar.gz e gz annidati, e riconoscimento automatico di marca, OS, versione, modello, hostname, stack e VDOM, con la riga da cui viene ogni dato e la correzione a mano. Riconosciuti FortiOS, FortiSwitchOS, Cisco IOS, IOS-XE e Small Business, gli output dei comandi show e i backup FortiGate cifrati; NX-OS e ASA riconosciuti ma non ancora letti.
- Parser generici e vista della config originale, identica al file.
- Interfaccia in italiano e inglese fin dall'inizio.
- Config di esempio sintetiche: FortiOS 7.0–8.0 (anche con VDOM multiple), Catalyst 2960, 3850, 9200 e 9300 (anche in stack), Cisco Small Business SG350, CBS350 e Catalyst 1300.
- **Risultato**: avvii l'app con Docker, trascini un backup FortiGate o Cisco e l'app lo riconosce e mostra la config navigabile, identica all'originale.

### Fase 1: lettura dei singoli apparati FortiGate, Cisco IOS/IOS-XE e Cisco Small Business (MVP, realizzata)
Issue [#10](https://github.com/TehMaat/Network-Config-Viewer/issues/10).
- **Realizzato** ([#11](https://github.com/TehMaat/Network-Config-Viewer/pull/11)):
  - modello neutro, con le righe d'origine di ogni elemento, i default indicati e la copertura riga per riga;
  - FortiGate: interfacce e zone, oggetti, policy (con VDOM), VIP e IP pool, routing (statiche, policy route, BGP, OSPF), VPN IPsec, SD-WAN;
  - Cisco IOS/IOS-XE e Cisco Small Business: interfacce, VLAN, trunk, port-channel, stack, SVI, PoE, 802.1X/MAB, ACL, routing;
  - viste per apparato (5.2–5.10, per il singolo apparato) e config collegata.
- **Realizzato** ([#12](https://github.com/TehMaat/Network-Config-Viewer/pull/12)):
  - output dei comandi show di Cisco IOS/IOS-XE, Cisco Small Business e FortiOS, da file singoli e da log di sessione, ognuno con il suo apparato e la correzione a mano;
  - stato reale nelle viste: porte, vicini, PoE, tunnel, routing, BGP, SD-WAN, nomi delle VLAN del VTP; MAC su ogni porta configurata con i loro avvisi ([#6](https://github.com/TehMaat/Network-Config-Viewer/issues/6));
  - clienti nell'archivio locale su disco, con il server dell'app nel container al posto di nginx: file conservati per cliente e raggruppati per apparato con versioni precedenti e show, correzioni salvate, esportazione e importazione in zip, cliente di esempio;
  - test nel browser anche su Firefox e WebKit, e dell'archivio dopo il riavvio del container;
  - export Excel nel browser: per ogni apparato un foglio per vista, e ogni tabella così come è filtrata e ordinata.
- **Risultato**: ogni FortiGate e ogni Catalyst leggibile in forma grafica, con i file di ogni cliente conservati sul PC.

### Fase 2: mappa dell'infrastruttura
- Progetto con più apparati e siti; correlazione (cavi, LAG, subnet, IPsec, overlay SD-WAN, BGP).
- Mappa a livelli, vista VPN con ADVPN, dettaglio dei collegamenti, controlli di coerenza, stato reale dagli show.
- Verifica dei cavi con LLDP/CDP e collegamenti inseriti a mano.
- FortiSwitch e FortiAP gestiti dal FortiGate: pannello porte con la tabella MAC, MCLAG, SSID e access point.
- Esportazione in draw.io e immagine.
- **Risultato**: carichi le config di sede e filiali e vedi la rete del cliente, con i problemi evidenziati.

### Fase 3: analisi e rack
- Policy lookup (poi anche tra le sedi), pulizia policy, confronto tra versioni.
- Rack: composizione (apparati, patch panel, passacavi, UPS… nelle loro unità), frontali realistici per tutti i modelli, rilievo delle prese in sede da telefono.
- **Risultato**: risposte del tipo "questo traffico passa?", report di pulizia e rack del cliente documentati.

### Fase 4: altri firewall e conversione verso FortiGate
- Lettori ASA, Check Point, Sophos e Juniper, poi pfSense, OPNsense e Ubiquiti EdgeRouter, con le stesse viste e presenti nella mappa.
- Conversione verso FortiGate (FortiOS e FortiManager) con verifica integrata; lettura dei template CLI FortiManager.
- **Risultato**: config FortiGate generata, verificata e accompagnata dal report.

### Fase 5: altri switch e migrazioni switch
- Lettori NX-OS (vPC), AOS-CX (VSX), ArubaOS-Switch, Comware, Aruba Instant, TP-Link JetStream, Ubiquiti EdgeSwitch, FortiSwitch autonomi.
- Import delle prese da CSV/Excel o NetBox, quando esistono.
- Pianificazione del cablaggio sul rack, mappatura porte con consolidamento, generatori AOS-CX e IOS-XE, traduzione vPC → VSX.
- Patch list per rack in PDF, Excel e pagina da telefono con spunta; verifica dopo il cambio con LLDP, tabella MAC e stato porte.
- **Risultato**: config del nuovo switch, patch list per i tecnici e controllo del lavoro fatto in sede.

### Fase 6: server per il team e lettura live
- La stessa immagine Docker usata in locale, su un server, con progetti condivisi e utenti: si parte dal server dell'archivio della fase 1.
- Lettura via SSH/API: FortiGate, FortiManager (policy package), Meraki, UniFi e Omada (controller locali e in cloud), Aruba Central, cloud Fortinet per FortiAP e FortiSwitch, Cisco.
- Apparati gestiti da controller o dal cloud (Meraki, UniFi, Omada, Aruba Central) e wireless nella mappa e nelle viste; Meraki anche come destinazione delle migrazioni.
- Rilievo delle prese assistito dalla lettura live: si stacca un cavo e lo strumento riconosce la porta.
- **Risultato**: lo strumento usato dal team, con import diretto dagli apparati.

## 12. Domande aperte

Nessuna domanda aperta. Durante la fase 1, quando un parser sbaglia su una config reale, serviranno le righe che danno problemi, passate in chat con i valori sensibili cambiati a mano.

Deciso nella fase 1 ([#10](https://github.com/TehMaat/Network-Config-Viewer/issues/10)): l'archivio dei clienti sta su disco, in un volume Docker gestito da un programma lato server nel container, e si vede da qualsiasi browser.

## Riferimenti

- [NetBox devicetype-library](https://github.com/netbox-community/devicetype-library): definizioni dei modelli hardware (licenza CC0).
- [Check Point ShowPolicyPackage](https://github.com/CheckPointSW/ShowPolicyPackage): export di policy e oggetti in HTML e JSON via Management API.
- [FortiManager: script](https://docs.fortinet.com/document/FortiManager/7.6.6/administration-guide/990788/scripts) e [creare oggetti con uno script CLI](https://community.fortinet.com/t5/FortiManager/Technical-Tip-How-to-create-Policy-Objects-in-FortiManager-using/ta-p/285268).
- [FortiConverter: versioni e conversioni supportate](https://docs.fortinet.com/document/forticonverter/7.0.3/online-help/220359).
- [Sophos Firewall: import/export della configurazione](https://www.avanet.com/en/kb/sophos-firewall-configuration-import-export/) (guida di terze parti).
- [Batfish](https://github.com/batfish/batfish): strumento open source di analisi delle configurazioni multi-vendor, utile come riferimento per policy lookup e controlli di coerenza.
